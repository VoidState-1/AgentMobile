import { testNotifications } from './notifications';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { contentCodec } from '../src/adapters/storage/codec';
import { ConversationService } from '../src/application/conversations/service';
import { AgentSettingsService } from '../src/application/settings/agent';
import { RunRepository } from '../src/application/runs/repository';
import { RunKernel } from '../src/application/runs/kernel';
import { recoverRuns } from '../src/application/runs/recovery';
import type { RunResourceFactory } from '../src/application/runs/resources';
import type { AgentEnginePort, EngineInput, EngineControls } from '../src/core/agent/engine';
import { defaultSchedulerLimits } from '../src/core/runs/scheduling';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function fixture(work: (input: EngineInput, controls: EngineControls) => Promise<void> = async () => {}) {
  const f = await testStorage(); cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID); const project = await workspace.create('运行内核');
  const conversations = new ConversationService(f.metadata, randomUUID); await conversations.initialize([project]);
  const a = await conversations.ensureProject(project.id); const b = await conversations.create(project.id);
  const settings = new AgentSettingsService(f.metadata); await settings.initialize();
  const repository = new RunRepository(f.metadata);
  const executions: string[] = []; const releases: string[] = []; const prepared: string[] = [];
  const factory: RunResourceFactory = { async prepare(request) {
    prepared.push(request.prompt);
    let cancelled = false;
    const engine: AgentEnginePort = { create(input, receive, controls) { return { round: 1, cancel() { cancelled = true; }, async execute() {
      executions.push(input.prompt);
      try { await controls.beforeRequest?.(); await work(input, controls); }
      finally { controls.afterRequest?.(); }
      if (cancelled) return { stopReason: 'aborted' };
      receive({ type: 'assistant_start', round: 1 }); receive({ type: 'content', round: 1, index: 0, kind: 'text', ended: true, text: '已完成', response: '已完成' });
      receive({ type: 'transcript_frame', ordinal: 0, schemaVersion: 1, payload: { role: 'user', content: input.prompt } }); receive({ type: 'assistant_end', round: 1, response: '已完成' }); return { stopReason: 'stop' };
    } }; } };
    return { launch: { mode: 'demo', imageInput: false, contextTokens: 32000, outputTokens: 4096 }, engine,
      resources: { codec: contentCodec, notifications: testNotifications }, async release() { releases.push(request.prompt); } };
  } };
  const kernel = new RunKernel(workspace, repository, factory, conversations, settings, randomUUID);
  return { ...f, workspace, project, conversations, a, b, settings, repository, kernel, factory, executions, releases, prepared };
}
async function idle(kernel: RunKernel) { await vi.waitFor(() => expect(kernel.getSnapshot().runs).toHaveLength(0), { timeout: 5000 }); }

it('模型已结束但最终快照尚未完成时到期，终态提交前复核截止并保留结构化原因', async () => {
  const f = await fixture(); const finalizing = gate(); const entered = gate();
  const finalize = f.workspace.taskFinal;
  f.workspace.taskFinal = async (...args) => { entered.release(); await finalizing.promise; return finalize(...args); };
  vi.useFakeTimers();
  await f.kernel.start(f.project.id, '延迟终态', false, f.a.id); await entered.promise;
  const id = f.kernel.getSnapshot().active!.id;
  await vi.advanceTimersByTimeAsync(f.settings.getSnapshot().limits.maxRuntimeMs + 1);
  finalizing.release(); await idle(f.kernel);
  expect(f.kernel.getSnapshot().completed).toMatchObject({ state: 'failed', stopReason: { kind: 'deadline', originRunId: id } });
  expect((await f.repository.get(id))?.stopReason?.kind).toBe('deadline');
  expect(f.kernel.requests.getSnapshot().active).toBe(0);
});

it('入队冻结配置、消费精确草稿；真实开始时捕获基线，历史只读 v2 且运行不依赖 UI 订阅', async () => {
  const first = gate(); const observed: EngineInput[] = [];
  const f = await fixture(async (input) => { observed.push(input); if (input.prompt === '第一项') await first.promise; });
  const draft = await f.conversations.saveDraft(f.a.id, { text: '第一项' });
  const detach = f.kernel.subscribe(() => { throw new Error('UI subscriber'); });
  await f.kernel.start(f.project.id, '第一项', false, f.a.id, draft.revision); detach();
  await vi.waitFor(() => expect(f.executions).toEqual(['第一项']));
  const initial = f.settings.getSnapshot(); await f.kernel.start(f.project.id, '第二项', false, f.b.id);
  const queued = f.kernel.getSnapshot().runs.find((run) => run.prompt === '第二项')!;
  expect(queued.state).toBe('queued'); expect(queued.baseSnapshot).toBeUndefined();
  expect(f.conversations.getSnapshot().drafts[f.a.id].text).toBe('');
  await f.settings.save({ systemPrompt: '修改后的设置', limits: initial.limits }, initial.revision);
  // The queued task's history starts after the preceding write completes.
  const firstRun = f.kernel.getSnapshot().active!;
  await f.workspace.write(f.project.id, 'documents/new.md', contentCodec.encodeText('最新基线'), null, { owner: firstRun.id });
  first.release(); await idle(f.kernel);
  const task = (await f.repository.view(queued.id))!;
  expect(queued.state).toBe('queued'); // Published snapshots remain unchanged after execution.
  expect(task.state).toBe('completed'); expect(task.agentSettingsSnapshot!.systemPrompt).toBe(initial.systemPrompt);
  expect(contentCodec.decodeText((await f.workspace.git.tree(f.project.id, task.baseSnapshot!))['documents/new.md'])).toBe('最新基线');
  expect(await f.metadata.all('tasks')).toEqual([]); expect(await f.repository.transcript(task.id)).toBeDefined();
  expect(f.releases.sort()).toEqual(['第一项', '第二项']); expect(f.kernel.requests.getSnapshot().active).toBe(0);
});

it('排队取消不创建引擎、不消耗请求槽，释放冻结资源与对话租约各一次', async () => {
  const f = await fixture(); f.kernel.setForeground(false);
  await f.kernel.start(f.project.id, '待取消', false, f.a.id);
  const id = f.kernel.getSnapshot().active!.id;
  expect((await f.repository.get(id))?.state).toBe('queued');
  await f.kernel.cancel(id); await f.kernel.cancel(id); f.kernel.setForeground(true);
  expect(f.executions).toEqual([]); expect(f.releases).toEqual(['待取消']);
  expect((await f.repository.get(id))?.state).toBe('cancelled'); expect(f.kernel.getSnapshot().completed?.id).toBe(id);
  await f.conversations.archive(f.a.id); expect(f.kernel.requests.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
});

it('准备中取消保留草稿，并在资源创建完成后统一清理', async () => {
  const f = await fixture(); const preparing = gate(); const entered = gate(); const prepare = f.factory.prepare;
  f.factory.prepare = async (request) => { entered.release(); await preparing.promise; return prepare(request); };
  const draft = await f.conversations.saveDraft(f.a.id, { text: '准备中' });
  const start = f.kernel.start(f.project.id, '准备中', false, f.a.id, draft.revision);
  await entered.promise; await f.kernel.cancel(); preparing.release();
  await expect(start).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(f.releases).toEqual(['准备中']); expect(f.executions).toEqual([]);
  expect((await f.repository.list(f.project.id)).runs).toEqual([]); expect(f.conversations.getSnapshot().drafts[f.a.id].text).toBe('准备中');
});

it('刚取得执行槽但尚未建立文件基线时取消，正常收束而不会误判存储故障', async () => {
  const f = await fixture(); const entered = gate(); const resumed = gate(); const put = f.metadata.put;
  f.metadata.put = async (bucket, id, value) => { if (bucket === 'run-groups') { entered.release(); await resumed.promise; } await put(bucket, id, value); };
  await f.kernel.start(f.project.id, '刚开始取消', false, f.a.id); await entered.promise;
  const id = f.kernel.getSnapshot().active!.id; await f.kernel.cancel(id); resumed.release(); await idle(f.kernel);
  expect(f.kernel.getSnapshot().error).toBeUndefined(); expect(f.kernel.getSnapshot().completed?.state).toBe('cancelled');
  expect(f.executions).toEqual([]); expect(f.releases).toEqual(['刚开始取消']);
  expect((await f.repository.get(id))?.state).toBe('cancelled');
});

it('completed 在终态事务与资源清理完成后才发布，旧进度不能覆盖终态', async () => {
  const f = await fixture(); const entered = gate(); const stored = gate(); const writeBusiness = f.metadata.writeBusiness;
  f.metadata.writeBusiness = async (batch) => {
    if (batch.runs?.some(update => update.header.state === 'completed')) { entered.release(); await stored.promise; }
    await writeBusiness(batch);
  };
  await f.kernel.start(f.project.id, '终态保存', false, f.a.id); const id = f.kernel.getSnapshot().active!.id;
  await entered.promise;
  expect(f.kernel.getSnapshot().completed).toBeUndefined(); expect(f.releases).toEqual([]);
  expect((await f.repository.get(id))?.state).toBe('running');
  stored.release(); await idle(f.kernel);
  expect(f.kernel.getSnapshot().completed?.state).toBe('completed'); expect(f.releases).toEqual(['终态保存']);
  const finished = (await f.repository.get(id))!;
  await f.repository.save({ ...finished, state: 'running', response: '陈旧输出' });
  expect((await f.repository.get(id))?.response).toBe('已完成');
  f.workspace.claim(f.project.id, 'next'); f.workspace.release(f.project.id, 'next');
});

it('终态保存中断不会发布成功；恢复自己的检查点、不重发请求，当前草稿回执重启修复', async () => {
  const f = await fixture(); const writeBusiness = f.metadata.writeBusiness;
  f.metadata.writeBusiness = async (batch) => {
    if (batch.runs?.some(update => update.header.state === 'completed')) throw new Error('disk interrupted');
    await writeBusiness(batch);
  };
  const revision = (await f.conversations.saveDraft(f.a.id, { text: '需恢复' })).revision;
  await f.kernel.start(f.project.id, '需恢复', false, f.a.id, revision); const id = f.kernel.getSnapshot().active!.id;
  await vi.waitFor(() => expect(f.kernel.getSnapshot().error).toContain('保存失败'));
  expect(f.kernel.getSnapshot().completed).toBeUndefined(); expect(f.releases).toEqual(['需恢复']);
  expect((await f.repository.get(id))?.state).toBe('running');
  f.metadata.writeBusiness = writeBusiness;
  // Simulate a crash after queued was committed but before acknowledging draft.
  await f.metadata.put('conversations', 'state', { ...f.conversations.getSnapshot(), drafts: { ...f.conversations.getSnapshot().drafts, [f.a.id]: { text: '需恢复', revision } } });
  const repository = new RunRepository(f.metadata); await recoverRuns(repository, f.workspace, []);
  expect((await repository.get(id))?.state).toBe('interrupted'); expect(await repository.active()).toEqual([]);
  const conversations = new ConversationService(f.metadata, randomUUID); await conversations.initialize([f.project], (projectId, conversationId, revision) => repository.acceptedDraft(projectId, conversationId, revision));
  expect(conversations.getSnapshot().drafts[f.a.id].text).toBe(''); expect(f.executions).toEqual(['需恢复']);
});

it('同对话与队列上限在准备前校验，拒绝时保留草稿和原租约', async () => {
  const f = await fixture(); const kernel = new RunKernel(f.workspace, f.repository, f.factory, f.conversations, f.settings, randomUUID,
    { ...defaultSchedulerLimits, activeRoots: 1, queuedRoots: 1, queuedPerProject: 1 });
  kernel.setForeground(false); await kernel.start(f.project.id, '第一个', false, f.a.id);
  const draft = await f.conversations.saveDraft(f.b.id, { text: '超限' });
  await expect(kernel.start(f.project.id, '超限', false, f.b.id, draft.revision)).rejects.toMatchObject({ code: 'LIMIT' });
  expect(f.conversations.getSnapshot().drafts[f.b.id].text).toBe('超限'); expect(f.prepared).toEqual(['第一个']);
  await kernel.cancel();
});

it('不同项目两根并行、同项目另一对话排队；定向取消不影响另一项目或放大预算', async () => {
  const gates = new Map<string, ReturnType<typeof gate>>();
  const f = await fixture(async (input) => { const held = gate(); gates.set(input.prompt, held); await held.promise; });
  const other = await f.workspace.create('另一项目'); const conversation = await f.conversations.ensureProject(other.id);
  await f.kernel.start(f.project.id, '甲运行', false, f.a.id); await f.kernel.start(other.id, '乙运行', false, conversation.id);
  await vi.waitFor(() => expect(f.executions).toHaveLength(2)); expect(f.kernel.requests.getSnapshot().active).toBe(2);
  await f.kernel.start(f.project.id, '甲排队', false, f.b.id); expect(f.kernel.getSnapshot().runs.find((run) => run.prompt === '甲排队')?.state).toBe('queued');
  const cancel = f.kernel.getSnapshot().runs.find((run) => run.prompt === '乙运行')!;
  await f.kernel.cancel(cancel.id); gates.get('乙运行')!.release(); await vi.waitFor(() => expect(f.kernel.getSnapshot().runs).toHaveLength(2));
  expect((await f.repository.get(cancel.id))?.state).toBe('cancelled'); expect(new Set(f.executions)).toEqual(new Set(['甲运行', '乙运行']));
  gates.get('甲运行')!.release(); await vi.waitFor(() => expect(f.executions).toHaveLength(3)); expect(f.executions.at(-1)).toBe('甲排队');
  gates.get('甲排队')!.release(); await idle(f.kernel);
  for (const run of [...(await f.repository.list(f.project.id)).runs, ...(await f.repository.list(other.id)).runs])
    expect((await f.metadata.get<any>('run-groups', run.id)).requests).toBe(1);
});
