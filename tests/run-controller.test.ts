import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { startRun } from '../src/application/runs/controller';
import { defaultAgentSettings } from '../src/core/agent/settings';
import type { AgentEnginePort } from '../src/core/agent/engine';
import type { TaskRecord } from '../src/core/runs/types';
import { WorkspaceService } from '../src/adapters/workspace/service';
import { contentCodec } from '../src/adapters/storage/codec';
import { ModelConfigurationService } from '../src/application/models/configuration';
import { ConversationService } from '../src/application/conversations/service';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const engine: AgentEnginePort = { create(input, receive, controls) { return { round: 1, cancel() {}, async execute() {
  await controls.beforeRequest?.(); receive({ type: 'assistant_start', round: 1 });
  receive({ type: 'content', round: 1, index: 0, kind: 'text', text: '完成', ended: true, response: '完成' });
  receive({ type: 'assistant_end', round: 1, response: '完成', transcript: { messages: [{ role: 'user', content: input.prompt }] } });
  return { stopReason: 'stop' };
} }; } };

it('终态落库并释放项目租约后才发布完成，返回的初始视图不会被内部任务变更', async () => {
  const storage = await testStorage(); cleanups.push(storage.cleanup); const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID); const project = await workspace.create('终态');
  const put = storage.metadata.put; let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; }); const held = new Promise<void>((resolve) => { release = resolve; });
  storage.metadata.put = async (bucket, id, value) => { if (bucket === 'tasks' && (value as TaskRecord).state === 'completed') { enter(); await held; } await put(bucket, id, value); };
  const updates: string[] = [];
  const started = await startRun(workspace, { runId: randomUUID(), projectId: project.id, conversationId: project.id + ':main', prompt: '完成任务', mode: 'demo', imageInput: false,
    agentSettings: defaultAgentSettings(), contextTokens: 32000, outputTokens: 4096 }, engine, { codec: contentCodec }, (task) => {
    if (task.state === 'completed') { workspace.claim(project.id, 'view-write'); workspace.release(project.id, 'view-write'); }
    updates.push(task.state);
  });
  await entered; expect(updates).not.toContain('completed'); expect(started.task.state).toBe('running');
  release(); const task = await started.done; expect(task.state).toBe('completed'); expect(updates.at(-1)).toBe('completed');
  expect((await storage.metadata.get<TaskRecord>('tasks', task.id))?.state).toBe('completed');
});

it('视图订阅者异常不会把已保存的模型设置或对话变成失败操作', async () => {
  const storage = await testStorage(); cleanups.push(storage.cleanup);
  const models = new ModelConfigurationService(storage.metadata, { get: async () => '', set: async () => {} }, randomUUID); await models.initialize();
  models.subscribe(() => { throw new Error('UI failed'); }); await models.setMode('remote'); expect(models.getSnapshot().mode).toBe('remote');
  const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID); const project = await workspace.create('订阅隔离');
  const conversations = new ConversationService(storage.metadata, randomUUID); await conversations.initialize([project]);
  conversations.subscribe(() => { throw new Error('UI failed'); }); const conversation = await conversations.create(project.id);
  expect(conversations.getSnapshot().conversations.some((value) => value.id === conversation.id)).toBe(true);
});
