import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceService, type WorkspaceChange } from '../src/adapters/workspace/service';
import type { Operation } from '../src/core/prototype/types';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it('每次提交都通知订阅者，观察者异常不破坏写入，重试不重复通知', async () => {
  const f = await testStorage(); cleanups.push(f.cleanup);
  const workspace = new WorkspaceService(f.files, f.metadata, randomUUID, () => { throw new Error('视图异常'); });
  const changes: WorkspaceChange[] = []; const observedPhases: string[] = []; workspace.subscribe(() => { throw new Error('观察者异常'); });
  const unsubscribe = workspace.subscribe((change) => {
    changes.push(change);
    const operations = [...f.records.values()].filter((value) => (value as Operation).commit === change.commit) as Operation[];
    if (operations.length) observedPhases.push(operations[0].phase);
  });
  const project = await workspace.create('实时资料'); const operationId = randomUUID();
  const commit = await workspace.write(project.id, 'documents/live.md', Buffer.from('第一版'), null, { operationId });
  expect(changes).toHaveLength(2); expect(changes[1]).toEqual({ projectId: project.id, paths: ['documents/live.md'], commit });
  expect(observedPhases).toEqual(['recorded']);
  expect(Object.isFrozen(changes[1].paths)).toBe(true);
  expect(await workspace.write(project.id, 'documents/live.md', Buffer.from('第一版'), null, { operationId })).toBe(commit);
  expect(changes).toHaveLength(2); expect(workspace.needsRecovery(project.id)).toBe(false);
  unsubscribe(); await workspace.write(project.id, 'documents/after.md', Buffer.from('退订后'), null); expect(changes).toHaveLength(2);
});

it('快照等到移动提交完成，文件、预览、Git 和操作记录对应同一版本', async () => {
  const f = await testStorage(); cleanups.push(f.cleanup); const workspace = new WorkspaceService(f.files, f.metadata, randomUUID);
  const project = await workspace.create('一致性视图'); const original = await workspace.readText(project.id, 'documents/notes.md');
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void; const applying = new Promise<void>((resolve) => { entered = resolve; }); const write = f.files.write;
  f.files.write = async (path, bytes) => { if (path.endsWith('/moved.md')) { entered(); await held; } await write(path, bytes); };
  const moving = workspace.move(project.id, 'documents/notes.md', 'documents/moved.md', original.revision); await applying;
  let read = false; const snapshot = workspace.snapshot(project.id, 'documents/moved.md').then((value) => { read = true; return value; });
  expect((await workspace.files(project.id)).some((file) => file.path === 'documents/notes.md')).toBe(false); expect(read).toBe(false);
  release(); const commit = await moving; const view = await snapshot;
  expect(view.files.map((file) => file.path)).toContain('documents/moved.md'); expect(view.files.map((file) => file.path)).not.toContain('documents/notes.md');
  expect(view.versions[0].oid).toBe(commit); expect(view.operations[0].commit).toBe(commit);
  expect(view.preview).toMatchObject({ path: 'documents/moved.md', revision: original.revision, content: original.text });
});

it('失败修改不发布成功通知，恢复补记后才发布可读取版本', async () => {
  const f = await testStorage(); cleanups.push(f.cleanup); const workspace = new WorkspaceService(f.files, f.metadata, randomUUID);
  const project = await workspace.create('恢复通知'); const changes: WorkspaceChange[] = []; workspace.subscribe((change) => changes.push(change));
  const put = f.metadata.put; let fail = true;
  f.metadata.put = async (bucket, id, value) => { if (bucket === 'operations' && (value as Operation).phase === 'recorded' && fail) { fail = false; throw new Error('数据库中断'); } await put(bucket, id, value); };
  await expect(workspace.write(project.id, 'documents/live.md', Buffer.from('待恢复内容'), null)).rejects.toThrow('数据库中断'); expect(changes).toHaveLength(0);
  const reopened = new WorkspaceService(f.files, f.metadata, randomUUID); reopened.subscribe((change) => changes.push(change)); await reopened.recover();
  expect(changes).toHaveLength(1); const view = await reopened.snapshot(project.id, 'documents/live.md');
  expect(view.preview?.content).toBe('待恢复内容'); expect(view.versions).toHaveLength(2);
});
