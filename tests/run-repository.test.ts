import { afterEach, expect, it } from 'vitest';
import { RunRepository } from '../src/application/runs/repository';
import type { RunRecord } from '../src/core/runs/records';
import type { TaskRecord } from '../src/core/runs/types';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const legacy = (id: string, createdAt = '2026-10-14T00:00:00Z'): TaskRecord => ({ id, projectId: 'project', conversationId: 'conversation', prompt: '旧目标', response: '旧结果', mode: 'demo', state: 'completed', baseCommit: 'old-head', events: [], createdAt });
const rootRun = (): RunRecord => ({ ...legacy('root'), schemaVersion: 2, rootRunId: 'root', kind: 'root', depth: 0,
  state: 'running', agentDefinitionId: 'main', agentDefinitionRevision: 1, launchSnapshotRef: 'root' });
async function fixture() { const f = await testStorage(); cleanups.push(f.cleanup); return f; }

it('迁移保留来源，目标/索引/轨迹/标记原子写入；中断后重试不重复，查询按对话分页', async () => {
  const f = await fixture(); await f.metadata.put('tasks', 'b-old', legacy('b-old', '2026-10-13T00:00:00Z')); await f.metadata.put('tasks', 'a-new', legacy('a-new'));
  const batch = f.metadata.batch!; let fail = true;
  f.metadata.batch = async (entries) => { if (fail) { fail = false; throw new Error('模拟迁移中断'); } await batch(entries); };
  const repo = new RunRepository(f.metadata); await expect(repo.initialize()).rejects.toThrow('迁移中断');
  expect(await repo.get('b-old')).toBeUndefined(); expect(await f.metadata.get('tasks', 'b-old')).toEqual(legacy('b-old', '2026-10-13T00:00:00Z'));
  await repo.initialize(); await repo.initialize(); const page = await repo.list('project', 'conversation', undefined, 1);
  expect(page.runs.map((run) => run.id)).toEqual(['a-new']); expect(page.cursor).toBe('a-new');
  expect((await repo.list('project', 'conversation', page.cursor, 1)).runs.map((run) => run.id)).toEqual(['b-old']);
  expect((await repo.get('a-new'))?.agentDefinitionRevision).toBe(0); expect(await repo.launch('a-new')).toMatchObject({ legacy: true });
  expect(await f.metadata.get('run-migrations', 'a-new')).toMatchObject({ state: 'recorded' });
});

it('子创建与回执同批提交，重复调用返回原子任务，参数变化或跨项目委派被拒绝', async () => {
  const f = await fixture(); const repo = new RunRepository(f.metadata); const parent = rootRun(); await repo.save(parent, { id: 'root' });
  const child: RunRecord = { ...parent, id: 'child', kind: 'child', parentRunId: 'root', depth: 1, state: 'queued', agentDefinitionId: 'reader', launchSnapshotRef: 'child' };
  const receipt = { id: 'root:call', parentRunId: 'root', childRunId: 'child', fingerprint: 'original' };
  const batch = f.metadata.batch!; let fail = true; f.metadata.batch = async (entries) => { if (fail) { fail = false; throw new Error('模拟创建中断'); } await batch(entries); };
  await expect(repo.createChild(receipt, child, { id: 'child' })).rejects.toThrow('创建中断'); expect(await repo.get('child')).toBeUndefined();
  expect(await f.metadata.get('run-delegations', receipt.id)).toBeUndefined();
  expect(await repo.createChild(receipt, child, { id: 'child' })).toBe('child');
  expect(await repo.createChild({ ...receipt, childRunId: 'unused' }, { ...child, id: 'unused', launchSnapshotRef: 'unused' }, { id: 'unused' })).toBe('child');
  expect((await repo.group('root')).map((run) => run.id)).toEqual(['root', 'child']); expect((await repo.list('project')).runs.map((run) => run.id)).toEqual(['root']);
  await expect(repo.createChild({ ...receipt, fingerprint: 'changed' }, child, { id: 'child' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(repo.createChild({ ...receipt, id: 'other' }, { ...child, id: 'outside', projectId: 'other' }, { id: 'child' })).rejects.toMatchObject({ code: 'VALIDATION' });
});
