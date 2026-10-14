import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContext } from '@earendil-works/pi-ai';
import { AgentSettingsService, contentLimits, defaultAgentSettings, effectiveSystemPrompt, validateAgentSettings } from '../src/core/agent/settings';
import { WorkspaceService } from '../src/adapters/workspace/service';
import { ConversationService } from '../src/core/conversations/service';
import { startAgent } from '../src/adapters/agent/runner';
import { protocolModel, protocolTransport } from '../src/adapters/model/protocols';
import { validateModelEntity } from '../src/core/models/rules';
import { defaultModelParameters, unknownCapabilities } from '../src/core/models/types';
import { answerEvents, snapshot, streamed, toolEvents, sse } from './protocol-fixtures';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const storage = await testStorage(); cleanups.push(storage.cleanup);
  const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID); const project = await workspace.create('长任务');
  const settings = new AgentSettingsService(storage.metadata); await settings.initialize();
  return { ...storage, workspace, project, settings };
}
const remote = { mode: 'remote' as const, baseUrl: 'https://example.test/v1', model: 'test', imageInput: false };

describe('Agent 设置持久化', () => {
  it('首次使用新默认预算，保存后重启恢复；快照不可修改', async () => {
    const f = await fixture(); const before = f.settings.getSnapshot();
    expect(before.limits).toMatchObject({ maxModelRounds: 50, maxToolCalls: 200, maxRuntimeMs: 1_200_000, requestTimeoutMs: 300_000 });
    const saved = await f.settings.save({ systemPrompt: '请用简短的中文回答。', limits: { ...before.limits, maxModelRounds: 80 } }, before.revision);
    expect(saved.revision).toBe(1); expect(before.limits.maxModelRounds).toBe(50);
    expect(Object.isFrozen(saved.limits)).toBe(true);
    const reopened = new AgentSettingsService(f.metadata); await reopened.initialize(); expect(reopened.getSnapshot()).toEqual(saved);
    expect(effectiveSystemPrompt(saved)).toContain('仅通过宿主提供的工具'); expect(effectiveSystemPrompt(saved)).toContain('请用简短的中文回答。');
  });
  it('失败保存不改变有效值，并发旧版本不能覆盖新设置', async () => {
    const f = await fixture(); const before = f.settings.getSnapshot(); const put = f.metadata.put;
    f.metadata.put = async () => { throw new Error('模拟保存失败'); };
    await expect(f.settings.save({ ...before, systemPrompt: '待保存' }, 0)).rejects.toThrow('模拟保存失败'); expect(f.settings.getSnapshot()).toEqual(before);
    f.metadata.put = put;
    const first = f.settings.save({ ...before, systemPrompt: '版本一' }, 0);
    const second = f.settings.save({ ...before, systemPrompt: '版本二' }, 0);
    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']); expect(f.settings.getSnapshot().systemPrompt).toBe('版本一');
  });
  it('拒绝空提示词、过长提示词、无限预算与不合理超时关系', () => {
    const value = defaultAgentSettings();
    expect(() => validateAgentSettings({ ...value, systemPrompt: '' })).toThrow('系统提示词');
    expect(() => validateAgentSettings({ ...value, systemPrompt: 'x'.repeat(16001) })).toThrow('系统提示词');
    expect(() => validateAgentSettings({ ...value, limits: { ...value.limits, maxToolCalls: Infinity } })).toThrow('工具调用');
    expect(() => validateAgentSettings({ ...value, limits: { ...value.limits, maxRuntimeMs: 60_000 } })).toThrow('不能超过');
  });
});

describe('长任务真实 Pi 循环', () => {
  it('执行 35 次工具操作，不再触及旧的 10 轮/30 次上限', async () => {
    const f = await fixture(); let rounds = 0;
    vi.stubGlobal('fetch', async () => streamed(++rounds <= 35 ? toolEvents('chat-completions', 'list_files') : answerEvents('chat-completions', '长任务已完成。')));
    const run = await startAgent(f.workspace, f.project.id, '请处理长任务', remote, 'fixture', randomUUID, () => {});
    const task = await run.done; expect(task.state).toBe('completed'); expect(rounds).toBe(36);
    expect(task.events.filter((event) => event.state === 'done')).toHaveLength(35);
    expect(task.agentSettingsSnapshot?.limits.maxToolCalls).toBe(200);
  });
  it('用户设置的轮数与工具次数仍执行，错误明确说明触及的预算', async () => {
    const f = await fixture(); vi.stubGlobal('fetch', async () => streamed(toolEvents('chat-completions', 'list_files')));
    const value = defaultAgentSettings(); value.limits.maxModelRounds = 2;
    const rounds = await startAgent(f.workspace, f.project.id, 'test', remote, 'fixture', randomUUID, () => {}, undefined, false, undefined, undefined, value);
    expect((await rounds.done).error).toContain('模型请求上限（2 轮）');
    value.limits.maxModelRounds = 10; value.limits.maxToolCalls = 2;
    const tools = await startAgent(f.workspace, f.project.id, 'test', remote, 'fixture', randomUUID, () => {}, undefined, false, undefined, undefined, value);
    expect((await tools.done).error).toContain('工具调用上限（2 次）');
    f.workspace.claim(f.project.id, 'new-owner'); f.workspace.release(f.project.id, 'new-owner');
  });
  it('历史能携带超过 6 条，设为 0 后不携带旧任务', async () => {
    const f = await fixture(); const requests: any[] = [];
    for (let index = 0; index < 8; index++) await f.metadata.put('tasks', 'history-' + index, { id: 'history-' + index, projectId: f.project.id,
      prompt: 'HISTORY_' + index, response: 'REPLY_' + index, mode: 'remote', state: 'completed', events: [], baseCommit: '', createdAt: '2026-10-14T00:00:0' + index + 'Z' });
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return streamed(answerEvents('chat-completions', '完成。')); });
    const run = await startAgent(f.workspace, f.project.id, 'current', remote, 'fixture', randomUUID, () => {}); await run.done;
    expect(requests[0].messages.filter((message: any) => message.role === 'user')).toHaveLength(9);
    const settings = defaultAgentSettings(); settings.limits.historyTasks = 0;
    const next = await startAgent(f.workspace, f.project.id, 'no-history', remote, 'fixture', randomUUID, () => {}, undefined, false, undefined, undefined, settings); await next.done;
    expect(requests[1].messages.filter((message: any) => message.role === 'user')).toHaveLength(1);
    expect(JSON.stringify(requests[1])).not.toContain('HISTORY_');
  });
  it('设置在同一任务跨轮固定，下次任务采用修改后的系统提示词', async () => {
    const f = await fixture(); const requests: any[] = []; let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const old = await f.settings.save({ ...f.settings.getSnapshot(), systemPrompt: 'INITIAL_PROMPT' }, 0);
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body))); if (requests.length === 1) { await held; return streamed(toolEvents('chat-completions', 'list_files')); }
      return streamed(answerEvents('chat-completions', '完成。'));
    });
    const run = await startAgent(f.workspace, f.project.id, 'test', remote, 'fixture', randomUUID, () => {}, undefined, false, undefined, undefined, old);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const updated = await f.settings.save({ ...old, systemPrompt: 'UPDATED_PROMPT', limits: { ...old.limits, maxModelRounds: 80 } }, 1);
    release(); const task = await run.done;
    expect(task.agentSettingsSnapshot?.systemPrompt).toBe('INITIAL_PROMPT'); expect(task.agentSettingsSnapshot?.revision).toBe(1);
    expect(Object.isFrozen(task.agentSettingsSnapshot)).toBe(true); expect(Object.isFrozen(task.agentSettingsSnapshot?.limits)).toBe(true);
    for (const request of requests) expect(request.messages[0].content).toContain('INITIAL_PROMPT');
    const next = await startAgent(f.workspace, f.project.id, 'next', remote, 'fixture', randomUUID, () => {}, undefined, false, undefined, undefined, updated);
    await next.done; expect(requests[2].messages[0].content).toContain('UPDATED_PROMPT');
    expect((await f.metadata.get<any>('tasks', task.id)).agentSettingsSnapshot.systemPrompt).toBe('INITIAL_PROMPT');
  });
  it('大文本写入和分页读取保留完整版本，实际响应可超过旧的 512 KB', async () => {
    const f = await fixture(); const text = '资料'.repeat(100_000); const requests: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(sse(requests.length === 1 ? toolEvents('chat-completions', 'write_text', { path: 'documents/long.md', text, expectedRevision: null }) :
        requests.length === 2 ? toolEvents('chat-completions', 'read_text', { path: 'documents/long.md', offset: 12000, length: 16000 }) : answerEvents('chat-completions', '保存成功。')), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const run = await startAgent(f.workspace, f.project.id, 'test', remote, 'fixture', randomUUID, () => {});
    expect((await run.done).state).toBe('completed'); expect((await f.workspace.readText(f.project.id, 'documents/long.md')).text).toBe(text);
    const reading = requests[2].messages.filter((message: any) => message.role === 'tool').at(-1);
    expect(JSON.parse(reading.content)).toMatchObject({ text: text.slice(12000, 28000), offset: 12000, nextOffset: 28000, truncated: true, totalCharacters: 200000 });
    await expect(f.workspace.write(f.project.id, 'documents/too-large.md', new Uint8Array(contentLimits.textFileBytes + 1), null)).rejects.toThrow('1 MB');
  });
  it('16,000 字符的任务草稿可持久化，模型输出上限尊重服务公布的能力', async () => {
    const f = await fixture(); const conversations = new ConversationService(f.metadata, randomUUID); await conversations.initialize([f.project]);
    const conversation = conversations.getSnapshot().conversations[0];
    expect((await conversations.saveDraft(conversation.id, { text: '长'.repeat(16000) })).text).toHaveLength(16000);
    await expect(conversations.saveDraft(conversation.id, { text: '长'.repeat(16001) })).rejects.toThrow('16,000');
    const model = { id: 'model', name: 'test', apiId: 'test', parameters: { ...defaultModelParameters, maxOutputTokens: 32768 }, capabilities: unknownCapabilities() };
    expect(() => validateModelEntity(model as any)).not.toThrow();
    expect(() => validateModelEntity({ ...model, limits: { outputTokens: 16384 } } as any)).toThrow('超过模型');
  });
  it('单次流式请求超过 60 秒仍可完成，显式短超时仍会停止', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(controller) {
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"慢任务完成"},"finish_reason":"stop"}]}\n\n')); controller.close(); }, 75_000);
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const config = snapshot('chat-completions'); const context = normalizeContext({ messages: [{ role: 'user', content: 'test', timestamp: 0 }] });
    const stream = await protocolTransport(config, 'fixture')(protocolModel(config), context);
    await vi.advanceTimersByTimeAsync(75_000); expect((await stream.result()).stopReason).toBe('stop');
    const timed = await protocolTransport(config, 'fixture', false, 10_000)(protocolModel(config), context);
    await vi.advanceTimersByTimeAsync(10_000); expect((await timed.result()).errorMessage).toContain('超时');
  });
  it('任务总时长耗尽标记失败并说明上限，保留已经收到的推理', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"正在核对资料"}}]}\n\n'));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const configured = defaultAgentSettings(); configured.limits.maxRuntimeMs = 60_000; configured.limits.requestTimeoutMs = 60_000;
    let received!: () => void; const generating = new Promise<void>((resolve) => { received = resolve; });
    const run = await startAgent(f.workspace, f.project.id, 'test', remote, 'fixture', randomUUID,
      (task) => { if (task.trace?.some((item) => item.kind === 'reasoning' && item.text)) received(); }, undefined, false, undefined, undefined, configured);
    await generating; await vi.advanceTimersByTimeAsync(60_000); const task = await run.done;
    expect(task.state).toBe('failed'); expect(task.error).toContain('任务总时长上限（1 分钟）');
    expect(task.trace?.[0]).toMatchObject({ text: '正在核对资料', state: 'error' });
    expect(await f.metadata.get('tasks', task.id)).toEqual(task);
  });
});
