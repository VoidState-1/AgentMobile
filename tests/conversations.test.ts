import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationService } from '@/application/conversations/service';
import { ModelConfigurationService } from '@/application/models/configuration';
import { mainSessionId, selectedModelId, selectedModelMode } from '../src/core/models/rules';
import { createTestRuntime } from './agent-runtime';
import { WorkspaceService } from '../src/adapters/workspace/service';
import type { Project } from '../src/core/projects/types';
import type { TaskRecord } from '../src/core/runs/types';
import { testStorage } from './storage';
import { answerEvents, streamed } from './protocol-fixtures';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
const project: Project = { id: 'project-a', name: '测试项目', createdAt: '2026-10-13', updatedAt: '2026-10-13' };
const legacy: TaskRecord = { id: 'old-task', projectId: project.id, prompt: '原有历史', response: '原有回答', mode: 'demo', state: 'completed', events: [], baseCommit: 'old', createdAt: '2026-10-13' };

async function fixture() {
  const storage = await testStorage(); cleanups.push(storage.cleanup); await storage.metadata.put('projects', project.id, project);
  const create = () => new ConversationService(storage.metadata, randomUUID); const service = create();
  return { ...storage, create, service };
}
describe('项目与多对话元数据', () => {
  it('迁移先提交稳定对话 ID，任务写入中断后重试不重复创建、不丢历史和模型 pin', async () => {
    const f = await fixture(); await f.metadata.put('tasks', legacy.id, legacy);
    const realPut = f.metadata.put; let fail = true;
    f.metadata.put = async (bucket, id, value) => { if (bucket === 'tasks' && fail) throw new Error('migration interrupted'); await realPut(bucket, id, value); };
    await expect(f.service.initialize([project])).rejects.toThrow('interrupted');
    fail = false; const restarted = f.create(); await restarted.initialize([project]); await restarted.initialize([project]);
    expect(restarted.getSnapshot().conversations).toHaveLength(1);
    expect(restarted.getSnapshot().selected[project.id]).toBe(mainSessionId(project.id));
    expect(await f.metadata.get('tasks', legacy.id)).toMatchObject({ ...legacy, conversationId: mainSessionId(project.id) });
    const config = { mode: 'remote' as const, schemaVersion: 1 as const, revision: 1, connections: [], models: [], recent: [], migratedLegacy: true,
      defaults: { sessions: { [mainSessionId(project.id)]: 'existing-pin' }, projects: {} } };
    expect(selectedModelId(config, project.id, restarted.getSnapshot().selected[project.id])).toBe('existing-pin');
  });
  it('草稿和附件独立持久化，跨项目选择被拒绝，归档/恢复保留内容，运行中禁止归档', async () => {
    const f = await fixture(); await f.service.initialize([project]); const a = await f.service.ensureProject(project.id); const b = await f.service.create(project.id);
    await f.service.saveDraft(a.id, { text: '草稿 A', attachment: 'documents/notes.md' }); await f.service.saveDraft(b.id, { text: '草稿 B' });
    await f.service.rename(a.id, '手工名称'); const lease = await f.service.acquireRun(a.id, project.id, '不能覆盖手工名称');
    expect(lease.conversation.title).toBe('手工名称'); await expect(f.service.archive(a.id)).rejects.toThrow('正在运行'); lease.release();
    await expect(f.service.select(a.id, 'another-project')).rejects.toThrow('不存在');
    await f.service.archive(a.id); expect(f.service.getSnapshot().selected[project.id]).toBe(b.id);
    const restarted = f.create(); await restarted.initialize([project]);
    expect(restarted.getSnapshot().drafts[a.id]).toMatchObject({ text: '草稿 A', attachment: 'documents/notes.md' });
    expect(restarted.getSnapshot().drafts[b.id].text).toBe('草稿 B'); await restarted.restore(a.id);
    expect(restarted.getSnapshot().selected[project.id]).toBe(a.id);
    await expect(restarted.saveDraft(a.id, { text: '', attachment: '../secret' })).rejects.toThrow();
  });
  it('最后一个对话归档后创建空对话，重启不复活已归档历史', async () => {
    const f = await fixture(); await f.metadata.put('tasks', legacy.id, legacy); await f.service.initialize([project]);
    const a = await f.service.ensureProject(project.id); await f.service.archive(a.id); const selected = f.service.getSnapshot().selected[project.id];
    expect(selected).not.toBe(a.id); const restarted = f.create(); await restarted.initialize([project]);
    expect(restarted.getSnapshot().conversations.filter((c) => !c.archivedAt)).toHaveLength(1);
    expect(restarted.getSnapshot().selected[project.id]).toBe(selected);
  });
  it('草稿保存失败保留原版本；任务提交后清理失败可恢复，不清除后来编辑的新草稿', async () => {
    const f = await fixture(); await f.service.initialize([project]); const a = await f.service.ensureProject(project.id);
    const draft = await f.service.saveDraft(a.id, { text: '待提交' }); const realPut = f.metadata.put; let fail = true;
    f.metadata.put = async (bucket, id, value) => { if (bucket === 'conversations' && fail) throw new Error('database failed'); await realPut(bucket, id, value); };
    await expect(f.service.saveDraft(a.id, { text: '未成功保存' })).rejects.toThrow(); expect(f.service.getSnapshot().drafts[a.id].text).toBe('待提交');
    await f.metadata.put('tasks', legacy.id, { ...legacy, conversationId: a.id, draftRevision: draft.revision });
    await expect(f.service.acknowledgeSubmission(a.id, draft.revision)).rejects.toThrow(); fail = false;
    const restarted = f.create(); await restarted.initialize([project]); expect(restarted.getSnapshot().drafts[a.id].text).toBe('');
    const next = await restarted.saveDraft(a.id, { text: '后来编辑的新草稿' }); expect(next.revision).toBeGreaterThan(draft.revision);
    const again = f.create(); await again.initialize([project]); expect(again.getSnapshot().drafts[a.id].text).toBe('后来编辑的新草稿');
  });
});

it('实际 Agent 仅携带本对话历史，独立选择模型和模式，任务携带对话与草稿版本', async () => {
  const storage = await testStorage(); cleanups.push(storage.cleanup); const workspace = new WorkspaceService(storage.files, storage.metadata, randomUUID);
  const p = await workspace.create('独立上下文'); const conversations = new ConversationService(storage.metadata, randomUUID); await conversations.initialize([p]);
  const a = await conversations.ensureProject(p.id); const b = await conversations.create(p.id);
  const models = new ModelConfigurationService(storage.metadata, { get: async () => '', set: async () => {} }, randomUUID); await models.initialize();
  const connection = await models.saveConnection({ name: 'fixture', auth: 'none', baseUrl: 'https://example.test', protocol: 'chat-completions', presetId: 'custom', enabled: true, compatibility: 'standard', apiVersion: '' });
  const input = { connectionId: connection.id, enabled: true, favorite: false, capabilities: { tools: 'unknown' as const, images: 'unknown' as const, reasoning: 'unknown' as const }, parameters: { maxOutputTokens: 128, allowImages: false, reasoning: 'off' as const } };
  const ma = await models.saveModel({ ...input, name: 'Model A', apiId: 'model-a' }); const mb = await models.saveModel({ ...input, name: 'Model B', apiId: 'model-b' });
  await models.setSelection('session', ma.id, a.id); await models.setSelection('session', mb.id, b.id);
  const requests: any[] = []; vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return streamed(answerEvents('chat-completions', '测试回复')); });
  const { kernel: manager } = await createTestRuntime(workspace, { models, conversations, files: storage.files });
  const draft = await conversations.saveDraft(a.id, { text: 'A_ONLY' });
  await manager.start(p.id, 'A_ONLY', false, a.id, draft.revision); await expect.poll(() => manager.getSnapshot().active).toBeUndefined();
  expect(manager.getSnapshot().completed).toMatchObject({ conversationId: a.id, draftRevision: draft.revision });
  expect(conversations.getSnapshot().drafts[a.id].text).toBe('');
  await manager.start(p.id, 'B_ONLY', false, b.id); await expect.poll(() => manager.getSnapshot().active).toBeUndefined();
  await manager.start(p.id, 'A_FOLLOWUP', false, a.id); await expect.poll(() => manager.getSnapshot().active).toBeUndefined();
  expect(requests.map((r) => r.model)).toEqual(['model-a', 'model-b', 'model-a']);
  expect(JSON.stringify(requests[1])).not.toContain('A_ONLY'); expect(JSON.stringify(requests[2])).toContain('A_ONLY'); expect(JSON.stringify(requests[2])).not.toContain('B_ONLY');
  await models.setMode('demo', b.id); expect(selectedModelMode(models.getSnapshot(), a.id)).toBe('remote'); expect(selectedModelMode(models.getSnapshot(), b.id)).toBe('demo');
  await expect(manager.start('wrong-project', 'invalid', false, a.id)).rejects.toThrow('不存在');
});
