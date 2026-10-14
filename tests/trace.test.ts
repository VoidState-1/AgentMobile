import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContext } from '@earendil-works/pi-ai';
import type { TaskRecord } from '../src/core/prototype/types';
import type { TraceItem } from '../src/core/prototype/trace';
import { finishTool, settleTrace } from '../src/core/prototype/trace';
import { protocolBody, protocolModel, protocolTransport } from '../src/adapters/model/protocols';
import { runSnapshot, validateModelEntity, validateReasoningParameters } from '../src/core/models/rules';
import type { ModelEntry, ProviderConnection } from '../src/core/models/types';
import { WorkspaceService } from '../src/adapters/workspace/service';
import { startAgent } from '../src/adapters/agent/runner';
import { protocols, snapshot, streamed, answerEvents, toolEvents } from './protocol-fixtures';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe.each(protocols)('%s 工作轨迹', (protocol) => {
  it('推理逐段传递，文字与工具跨轮交错保存；同名工具按调用 ID 配对', async () => {
    const storage = await testStorage(); cleanups.push(storage.cleanup);
    const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('轨迹验证');
    await workspace.write(project.id, 'documents/one.md', new TextEncoder().encode('FIRST_NOTE'), null);
    await workspace.write(project.id, 'documents/two.md', new TextEncoder().encode('SECOND_NOTE'), null);
    const config = snapshot(protocol); config.parameters = { maxOutputTokens: 4096, allowImages: false, reasoning: 'on' };
    if (protocol === 'chat-completions') config.compatibility = 'deepseek';
    const events = toolEvents(protocol, 'read_text', { path: 'documents/one.md' }) as any[];
    if (protocol === 'chat-completions') events.unshift(
      { choices: [{ delta: { reasoning_content: '先核对' } }] }, { choices: [{ delta: { reasoning_content: '两份资料。' } }] },
      { choices: [{ delta: { content: '我先读取两份笔记。' } }] });
    if (protocol === 'chat-completions') events.splice(events.length - 2, 0, { choices: [{ delta: { tool_calls: [{ index: 1, id: 'second-call', function: {
      name: 'read_text', arguments: '{"path":"documents/two.md"}',
    } }] } }] });
    if (protocol === 'gemini') events[0].candidates[0].content.parts.unshift({ thought: true, text: '先核对', thoughtSignature: 'private-gemini-signature' },
      { thought: true, text: '两份资料。' }, { text: '我先读取两份笔记。' });
    if (protocol === 'gemini') events[0].candidates[0].content.parts.push({ functionCall: { name: 'read_text', args: { path: 'documents/two.md' } } });
    if (protocol === 'anthropic-messages') {
      for (const event of events) if (event.index === 1) event.index = 2;
      events.splice(5, 0, { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '我先读取两份笔记。' } }, { type: 'content_block_stop', index: 1 });
      events.splice(events.length - 2, 0, { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'second-call', name: 'read_text', input: { path: 'documents/two.md' } } }, { type: 'content_block_stop', index: 3 });
    }
    const bodies: any[] = []; const updates: TaskRecord[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body))); return streamed(bodies.length === 1 ? events : answerEvents(protocol, '两份笔记已核对。'));
    });
    const run = await startAgent(workspace, project.id, '核对笔记', { mode: 'remote', baseUrl: config.baseUrl, model: config.apiModelId, imageInput: false },
      'fixture-only-secret', randomUUID, (task) => updates.push(task), config);
    const task = await run.done;
    expect(task.state).toBe('completed');
    expect(task.trace?.map((item) => item.kind)).toEqual(['reasoning', 'text', 'tool', 'tool', 'text']);
    const trace = task.trace!;
    expect(trace[0]).toMatchObject({ state: 'completed', visibility: protocol === 'chat-completions' ? 'reasoning' : 'summary' });
    expect(trace[1]).toMatchObject({ text: '我先读取两份笔记。', round: 1 });
    expect(trace[2]).toMatchObject({ target: 'documents/one.md', output: expect.stringContaining('FIRST_NOTE'), state: 'completed' });
    expect(trace[3]).toMatchObject({ target: 'documents/two.md', output: expect.stringContaining('SECOND_NOTE'), state: 'completed' });
    expect(trace[4]).toMatchObject({ round: 2, text: '两份笔记已核对。' });
    expect(task.response).toBe('两份笔记已核对。');
    expect(updates.some((value) => value.trace?.some((item) => item.kind === 'reasoning' && item.state === 'running' && !!item.text))).toBe(true);
    expect(updates.find((value) => value.trace?.length === 1)?.trace).toHaveLength(1);
    expect(await storage.metadata.get('tasks', task.id)).toEqual(task);
    expect(JSON.stringify(task.trace)).not.toMatch(/signature|fixture-only-secret|opaque/);
    if (protocol === 'chat-completions') expect(bodies[1].messages.find((message: any) => message.role === 'assistant').reasoning_content).toBe('先核对两份资料。');
    if (protocol === 'anthropic-messages') expect(JSON.stringify(bodies[1])).toContain('anthropic-signature');
    if (protocol === 'gemini') expect(JSON.stringify(bodies[1])).toContain('private-gemini-signature');
  });
});

describe('轨迹恢复与推理参数', () => {
  it('内容块交错不被合并到首个文本块，Gemini 原生内容保持签名', async () => {
    const config = snapshot('gemini');
    vi.stubGlobal('fetch', async () => streamed([{ candidates: [{ content: { parts: [
      { text: '说明一' }, { thought: true, text: '摘要一' }, { text: '说明二' }, { thought: true, text: '摘要二' }, { text: '最终回答' },
    ] }, finishReason: 'STOP' }] }]));
    const stream = await protocolTransport(config, 'fixture')(protocolModel(config), normalizeContext({ messages: [{ role: 'user', content: 'test', timestamp: 0 }] }));
    const events: string[] = []; for await (const event of stream) if (event.type.endsWith('_start')) events.push(event.type);
    expect(events).toEqual(['text_start', 'thinking_start', 'text_start', 'thinking_start', 'text_start']);
    expect((await stream.result()).content.map((part) => part.type)).toEqual(['text', 'thinking', 'text', 'thinking', 'text']);
  });
  it('受保护推理仅显示未公开状态，签名仅跨轮回传', async () => {
    const config = snapshot('anthropic-messages'); const events = answerEvents(config.protocol, '完成') as any[];
    events.splice(1, 0, { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'encrypted-only' } }, { type: 'content_block_stop', index: 1 });
    vi.stubGlobal('fetch', async () => streamed(events));
    const message = await (await protocolTransport(config, 'fixture')(protocolModel(config), normalizeContext({ messages: [{ role: 'user', content: 'test', timestamp: 0 }] }))).result();
    expect(message.content[0]).toMatchObject({ type: 'thinking', thinking: '', redacted: true, visibility: 'unavailable' });
    expect(JSON.stringify(protocolBody(config, [message], []))).toContain('encrypted-only');
    const storage = await testStorage(); cleanups.push(storage.cleanup);
    const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID); const project = await workspace.create('受保护推理');
    const run = await startAgent(workspace, project.id, 'test', { mode: 'remote', baseUrl: config.baseUrl, model: config.apiModelId, imageInput: false }, 'fixture', randomUUID, () => {}, config);
    const task = await run.done;
    expect(task.trace?.[0]).toMatchObject({ kind: 'reasoning', visibility: 'unavailable', text: '' });
    expect(JSON.stringify(task.trace)).not.toContain('encrypted-only');
  });
  it('中断只收束未结束节点，同一调用 ID 在不同轮次独立', () => {
    const trace: TraceItem[] = [1, 2].map((round) => ({ id: String(round), round, kind: 'tool', tool: 'read_text', callId: 'same', input: '{}', state: 'running', startedAt: '2026-10-14T00:00:00Z' }));
    finishTool(trace, 1, 'same', 'first-result', false, '2026-10-14T00:00:01Z');
    const restored = settleTrace(trace, 'interrupted', '2026-10-14T00:00:02Z')!;
    expect(restored[0]).toMatchObject({ state: 'completed', output: 'first-result' });
    expect(restored[1]).toMatchObject({ state: 'interrupted', endedAt: '2026-10-14T00:00:02Z' });
    expect(trace[1].state).toBe('running'); expect(settleTrace(undefined, 'interrupted', '')).toBeUndefined();
  });
  it('取消保留部分推理，串行检查点最终状态不被旧写入覆盖', async () => {
    const storage = await testStorage(); cleanups.push(storage.cleanup);
    const originalPut = storage.metadata.put; let writing = 0; let maximum = 0;
    storage.metadata.put = async (bucket, id, value) => {
      if (bucket === 'tasks') { maximum = Math.max(maximum, ++writing); await new Promise((resolve) => setTimeout(resolve, 15)); }
      await originalPut(bucket, id, value); if (bucket === 'tasks') writing--;
    };
    const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID); const project = await workspace.create('取消推理');
    const config = snapshot('chat-completions'); config.compatibility = 'deepseek'; config.parameters.reasoning = 'on';
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"部分公开推理"}}]}\n\n'));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    let sawThinking!: () => void; const thinking = new Promise<void>((resolve) => { sawThinking = resolve; });
    const run = await startAgent(workspace, project.id, 'test', { mode: 'remote', baseUrl: config.baseUrl, model: config.apiModelId, imageInput: false }, 'fixture', randomUUID,
      (task) => { if (task.trace?.some((item) => item.kind === 'reasoning' && item.text)) sawThinking(); }, config);
    await thinking; run.cancel(); const task = await run.done;
    expect(task.state).toBe('cancelled'); expect(task.trace?.[0]).toMatchObject({ text: '部分公开推理', state: 'cancelled' });
    expect(await storage.metadata.get('tasks', task.id)).toEqual(task); expect(maximum).toBe(1);
  });
  it('参数原样进入快照与三种协议，默认／关闭／开启含义保持独立', () => {
    const deepseek = snapshot('chat-completions'); deepseek.compatibility = 'deepseek'; deepseek.parameters.reasoning = 'on';
    expect(protocolBody(deepseek, [], []).thinking).toEqual({ type: 'enabled' });
    deepseek.parameters.reasoning = 'provider-default'; expect(protocolBody(deepseek, [], []).thinking).toBeUndefined();
    const anthropic = snapshot('anthropic-messages'); anthropic.parameters = { maxOutputTokens: 4096, allowImages: false, reasoning: 'on', reasoningBudget: 2048 };
    expect(protocolBody(anthropic, [], []).thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    anthropic.parameters.reasoningStrategy = 'adaptive'; expect(protocolBody(anthropic, [], []).thinking).toEqual({ type: 'adaptive' });
    const gemini = snapshot('gemini'); gemini.parameters.reasoning = 'on'; gemini.parameters.reasoningStrategy = 'level'; gemini.parameters.reasoningEffort = 'high';
    expect(protocolBody(gemini, [], []).generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'high' });
    const connection = { protocol: 'anthropic-messages', compatibility: 'standard' } as ProviderConnection;
    const model = { parameters: anthropic.parameters, capabilities: { reasoning: { support: 'supported' } } } as ModelEntry;
    expect(runSnapshot(connection, model).parameters).toEqual(model.parameters);
    expect(() => validateReasoningParameters(connection, model)).not.toThrow();
    model.parameters.temperature = 0.7; expect(() => validateReasoningParameters(connection, model)).toThrow('温度留空');
    expect(() => validateReasoningParameters({ ...connection, protocol: 'chat-completions' }, model)).toThrow('没有统一');
  });
  it('不支持推理、无效预算和格式在发送前被拒绝', () => {
    const model = { name: 'test', apiId: 'test', parameters: { maxOutputTokens: 4096, allowImages: false, reasoning: 'on' },
      capabilities: { reasoning: { support: 'unsupported' }, images: { support: 'unknown' } } } as ModelEntry;
    expect(() => validateModelEntity(model)).toThrow('不支持推理');
    model.capabilities.reasoning.support = 'unknown'; model.parameters.reasoningBudget = 4096;
    expect(() => validateModelEntity(model)).toThrow('必须小于');
    model.parameters.reasoningBudget = 1024; expect(() => validateModelEntity(model)).not.toThrow();
  });
});
