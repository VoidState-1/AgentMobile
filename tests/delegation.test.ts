import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../src/adapters/workspace/service';
import { contentCodec } from '../src/adapters/storage/codec';
import { defaultAgentSettings } from '../src/core/agent/settings';
import { defaultSchedulerLimits } from '../src/core/runs/scheduling';
import type { RunRecord } from '../src/core/runs/records';
import type { SpawnRequest } from '../src/core/runs/delegation';
import type { EngineInput, AgentEnginePort } from '../src/core/agent/engine';
import { DelegationSession } from '../src/application/runs/delegation';
import { RunRepository } from '../src/application/runs/repository';
import { GroupBudget } from '../src/application/runs/budget';
import { RequestScheduler } from '../src/application/runs/request-scheduler';
import type { PreparedRun } from '../src/application/runs/resources';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const request = (prompt: string): SpawnRequest => ({ role: 'reader', prompt, paths: ['documents/notes.md'], budget: { requests: 4, tools: 3 } });
async function fixture() {
  const f = await testStorage(); cleanups.push(f.cleanup); const workspace = new WorkspaceService(f.files, f.metadata, randomUUID);
  const project = await workspace.create('只读委派'); const original = await workspace.readText(project.id, 'documents/notes.md');
  const repository = new RunRepository(f.metadata); const settings = defaultAgentSettings(); const abort = new AbortController();
  const root: RunRecord = { schemaVersion: 2, id: 'root', rootRunId: 'root', kind: 'root', depth: 0, state: 'running', projectId: project.id, conversationId: 'conversation',
    prompt: '父任务秘密上下文', response: '', events: [], createdAt: new Date().toISOString(), mode: 'demo', agentSettingsSnapshot: settings, agentDefinitionId: 'main', agentDefinitionRevision: 1, launchSnapshotRef: 'root' };
  await repository.save(root, { id: 'root', settings }); workspace.claim(project.id, root.id);
  const budget = new GroupBudget(f.metadata, root.id, settings.limits); await budget.start(); const scheduler = new RequestScheduler(2, 2);
  const inputs: EngineInput[] = []; const reads: string[] = []; const gates = new Map<string, { release(): void; promise: Promise<void> }>();
  const factory = async (prompt: string) => {
    const gate = Promise.withResolvers<void>(); gates.set(prompt, { release: gate.resolve, promise: gate.promise }); let cancelled = false;
    const engine: AgentEnginePort = { create(input, receive, controls) { inputs.push(input); return { round: 1, cancel() { cancelled = true; gate.resolve(); }, async execute() {
      await controls.beforeRequest?.(); receive({ type: 'assistant_start', round: 1 }); controls.afterRequest?.();
      receive({ type: 'tool_start', round: 1, callId: 'read', tool: 'read_text', args: { path: 'documents/notes.md' } });
      const blocked = await controls.beforeTool?.({ round: 1, callId: 'read', tool: 'read_text', args: {} });
      expect(blocked).toBeUndefined(); const reading = await input.tools.find((tool) => tool.name === 'read_text')!.execute('read', { path: 'documents/notes.md' });
      reads.push(JSON.parse(reading.content[0].type === 'text' ? reading.content[0].text : '{}').text);
      receive({ type: 'tool_end', round: 1, callId: 'read', output: '已读取', error: false, unknown: false });
      await gate.promise;
      if (cancelled) return { stopReason: 'aborted' };
      receive({ type: 'content', round: 1, index: 0, kind: 'text', text: prompt + '结果', response: prompt + '结果', ended: true });
      receive({ type: 'assistant_end', round: 1, response: prompt + '结果', transcript: { goal: prompt } }); return { stopReason: 'stop' };
    } }; } };
    return { engine, resources: { codec: contentCodec } };
  };
  const prepared: PreparedRun = { launch: { mode: 'demo', imageInput: false, contextTokens: 32000, outputTokens: 4096 }, engine: { create() { throw new Error('unused'); } },
    resources: { codec: contentCodec }, release: async () => {}, createChild: factory };
  const delegation = new DelegationSession(root, prepared, workspace, repository, budget, scheduler, defaultSchedulerLimits, abort, randomUUID);
  return { ...f, workspace, project, original, repository, budget, scheduler, delegation, gates, inputs, reads, abort };
}

it('异步委派两个独立只读上下文，固定共享快照不受父写入影响，去重/范围/数量受宿主限制', async () => {
  const f = await fixture(); const a = await f.delegation.spawn('1:a', request('A'));
  await vi.waitFor(() => expect(f.inputs).toHaveLength(1));
  await f.workspace.write(f.project.id, 'documents/notes.md', contentCodec.encodeText('父任务后来的修改'), f.original.revision, { owner: 'root' });
  const b = await f.delegation.spawn('1:b', request('B')); await vi.waitFor(() => expect(f.reads).toHaveLength(2));
  expect(f.reads).toEqual([f.original.text, f.original.text]);
  expect((await f.repository.get(a))!.inputSnapshotRef).toBe((await f.repository.get(b))!.inputSnapshotRef);
  expect(await f.delegation.spawn('1:a', request('A'))).toBe(a); expect((await f.repository.group('root')).length).toBe(3);
  await expect(f.delegation.spawn('1:a', request('changed'))).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.delegation.getResult('other-run')).rejects.toMatchObject({ code: 'VALIDATION' });
  for (const input of f.inputs) {
    expect(input.history).toEqual([]); expect(input.prompt).not.toContain('父任务秘密上下文'); expect(input.tools.every((tool) => tool.effect === 'read')).toBe(true);
    expect(input.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(['write_text', 'git_stage', 'mcp_0_0', 'spawn_agent']));
    const unauthorized = await input.tools.find((tool) => tool.name === 'read_text')!.execute('attack', { path: 'project.json' }); expect(unauthorized.isError).toBe(true);
  }
  expect(f.scheduler.getSnapshot().active).toBe(0); f.gates.get('A')!.release(); f.gates.get('B')!.release();
  const results = await f.delegation.settle(false); expect(results.map((item) => item.state)).toEqual(['completed', 'completed']);
  expect(results[0].references).toEqual([{ path: 'documents/notes.md', revision: f.original.revision }]); expect(f.budget.snapshot()).toMatchObject({ requests: 2, tools: 2, allocations: {} });
  const traces = (await f.repository.children('root')).flatMap((child) => child.trace!);
  expect(new Set(traces.map((item) => item.groupSequence)).size).toBe(traces.length);
  expect(traces.every((item) => item.rootRunId === 'root' && item.parentRunId === 'root' && item.runSequence! > 0)).toBe(true);
  expect((await f.repository.list(f.project.id)).runs.map((run) => run.id)).toEqual(['root']); expect(await f.repository.transcript(a)).toEqual({ goal: 'A' });
});

it('子创建/回执/额度事务中断不会留下部分预算或运行，重试只创建一份', async () => {
  const f = await fixture(); const batch = f.metadata.batch!; let fail = true;
  f.metadata.batch = async (entries) => { if (fail && entries.some((entry) => entry.bucket === 'run-delegations')) { fail = false; throw new Error('creation interrupted'); } await batch(entries); };
  await expect(f.delegation.spawn('retry', request('A'))).rejects.toThrow('creation interrupted');
  expect((await f.repository.group('root')).map((run) => run.id)).toEqual(['root']); expect(f.budget.snapshot().allocations ?? {}).toEqual({});
  const id = await f.delegation.spawn('retry', request('A')); await vi.waitFor(() => expect(f.inputs).toHaveLength(1));
  expect(await f.delegation.spawn('retry', request('A'))).toBe(id); f.gates.get('A')!.release(); await f.delegation.settle(false);
  expect((await f.repository.group('root')).map((run) => run.kind)).toEqual(['root', 'child']);
});

it('最多两个并行/四个总数，定向取消与根递归取消都先保存结果再收束，不占额外会话写锁', async () => {
  const f = await fixture(); const ids = [];
  for (const goal of ['A', 'B', 'C', 'D']) ids.push(await f.delegation.spawn('call:' + goal, request(goal)));
  await vi.waitFor(() => expect(f.inputs).toHaveLength(2)); expect((await f.repository.get(ids[2]))!.state).toBe('queued');
  await expect(f.delegation.spawn('call:E', request('E'))).rejects.toMatchObject({ code: 'LIMIT' });
  await f.delegation.cancel(ids[0]); await vi.waitFor(() => expect(f.inputs).toHaveLength(3));
  expect((await f.repository.get(ids[0]))!.state).toBe('cancelled'); expect((await f.repository.get(ids[1]))!.state).toBe('running');
  f.abort.abort(); const results = await f.delegation.settle(true);
  expect(results).toHaveLength(4); expect(results.every((item) => item.state === 'cancelled')).toBe(true);
  expect(f.scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 }); expect(f.budget.snapshot().allocations).toEqual({});
  expect((await f.workspace.readText(f.project.id, 'documents/notes.md')).revision).toBe(f.original.revision);
});
