import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import type { WorkspaceChange } from '../src/core/workspace/types';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('每次工作区保存都通知订阅者，观察者异常不破坏写入，重试不重复通知', async () => {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID, {
    changed: () => {
      throw new Error('视图异常');
    },
  });
  const changes: WorkspaceChange[] = [];
  const observedPhases: string[] = [];
  workspace.subscribe(() => {
    throw new Error('观察者异常');
  });
  const unsubscribe = workspace.subscribe(change => {
    changes.push(change);
    const operations = [...f.headers.values()].filter(value =>
      value.changedPaths.some(path => change.paths.includes(path)),
    );
    if (operations.length) observedPhases.push(operations[0].phase);
  });
  const project = await workspace.create('实时资料');
  const operationId = randomUUID();
  const commit = await workspace.write(
    project.id,
    'documents/live.md',
    Buffer.from('第一版'),
    null,
    { operationId },
  );
  expect(changes).toHaveLength(2);
  expect(changes[1]).toEqual({
    projectId: project.id,
    paths: ['documents/live.md'],
    commit: await workspace.git.head(project.id),
  });
  expect(observedPhases).toEqual(['recorded']);
  expect(Object.isFrozen(changes[1].paths)).toBe(true);
  expect(
    await workspace.write(project.id, 'documents/live.md', Buffer.from('第一版'), null, {
      operationId,
    }),
  ).toBe(commit);
  expect(changes).toHaveLength(2);
  expect(workspace.needsRecovery(project.id)).toBe(false);
  unsubscribe();
  await workspace.write(project.id, 'documents/after.md', Buffer.from('退订后'), null);
  expect(changes).toHaveLength(2);
});

it('快照等到移动提交完成，文件、预览、Git 和操作记录对应同一版本', async () => {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('一致性视图');
  const original = await workspace.readText(project.id, 'documents/notes.md');
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let entered!: () => void;
  const applying = new Promise<void>(resolve => {
    entered = resolve;
  });
  const write = f.files.write;
  f.files.write = async (path, bytes) => {
    if (path.endsWith('/moved.md')) {
      entered();
      await held;
    }
    await write(path, bytes);
  };
  const moving = workspace.move(
    project.id,
    'documents/notes.md',
    'documents/moved.md',
    original.revision,
  );
  await applying;
  let read = false;
  const snapshot = workspace.snapshot(project.id, 'documents/moved.md').then(value => {
    read = true;
    return value;
  });
  expect((await workspace.files(project.id)).some(file => file.path === 'documents/notes.md')).toBe(
    false,
  );
  expect(read).toBe(false);
  release();
  const commit = await moving;
  const view = await snapshot;
  expect(view.files.map(file => file.path)).toContain('documents/moved.md');
  expect(view.files.map(file => file.path)).not.toContain('documents/notes.md');
  expect(view.versions).toHaveLength(1);
  expect(view.operations[0].checkpoint).toBe(commit);
  expect(view.gitStatus.files).toHaveLength(2);
  expect(view.preview).toMatchObject({
    path: 'documents/moved.md',
    revision: original.revision,
    content: original.text,
  });
});

it('一次刷新中清单、Git 状态和选中文件预览共用一次内容读取', async () => {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('单次文件视图');
  const read = f.files.read;
  const reads = new Map<string, number>();
  f.files.read = async path => {
    if (!path.includes('/.git/')) reads.set(path, (reads.get(path) ?? 0) + 1);
    return read(path);
  };
  const snapshot = await workspace.snapshot(project.id, 'documents/notes.md');
  expect(snapshot.preview?.path).toBe('documents/notes.md');
  expect([...reads.values()]).toEqual([1, 1]);
});

it('可信内容指纹支持温刷新；同时间同大小的未知修改仍失效，写前检查真实内容', async () => {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  // Fingerprints are computed independently of the counted JS read boundary.
  f.files.contentStamp = async path =>
    createHash('sha256')
      .update(await fs.readFile(f.resolve(path)))
      .digest('hex');
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('文件修订索引');
  const original = await workspace.snapshot(project.id);
  const note = original.files.find(file => file.path === 'documents/notes.md')!;
  const read = f.files.read;
  const reads: string[] = [];
  f.files.read = async path => {
    if (!path.includes('/.git/')) reads.push(path);
    return read(path);
  };
  expect((await workspace.snapshot(project.id)).files).toEqual(original.files);
  expect(reads).toHaveLength(0);
  await workspace.snapshot(project.id, note.path);
  expect(reads).toHaveLength(1);
  reads.length = 0;
  const absolute = f.resolve(workspace.git.dir(project.id) + '/' + note.path);
  const before = await fs.stat(absolute);
  await fs.writeFile(absolute, Buffer.alloc(note.size, 97));
  await fs.utimes(absolute, before.atime, before.mtime);
  const next = await workspace.snapshot(project.id);
  expect(next.files.find(file => file.path === note.path)?.revision).not.toBe(note.revision);
  expect(reads).toHaveLength(1);
  await expect(
    workspace.write(project.id, note.path, Buffer.from('旧编辑器保存'), note.revision),
  ).rejects.toThrow('文件已变化');
  reads.length = 0;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  await reopened.recover();
  await reopened.snapshot(project.id);
  expect(reads).toHaveLength(2); // A new reader never trusts another process's index.
});

it('没有可信内容指纹时不以 mtime/size 复用修订；失败恢复清空已暖索引', async () => {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('保守索引');
  const read = f.files.read;
  let reads = 0;
  f.files.read = async path => {
    if (!path.includes('/.git/')) reads++;
    return read(path);
  };
  await workspace.files(project.id);
  reads = 0;
  await workspace.files(project.id);
  expect(reads).toBe(2);
  f.files.contentStamp = async path =>
    createHash('sha256')
      .update(await fs.readFile(f.resolve(path)))
      .digest('hex');
  await workspace.files(project.id);
  reads = 0;
  await workspace.files(project.id);
  expect(reads).toBe(0);
  const writeBusiness = f.metadata.writeBusiness;
  f.metadata.writeBusiness = async batch => {
    if (batch.operations?.some(update => update.header.phase === 'recorded'))
      throw new Error('中断回执');
    return writeBusiness(batch);
  };
  await expect(
    workspace.write(project.id, 'documents/fault.md', Buffer.from('中断内容'), null),
  ).rejects.toThrow('中断回执');
  reads = 0;
  await workspace.files(project.id);
  expect(reads).toBe(3);
  f.metadata.writeBusiness = writeBusiness;
  await workspace.recover();
  expect((await workspace.snapshot(project.id)).files.map(file => file.path)).toContain(
    'documents/fault.md',
  );
});

it('失败修改不发布成功通知，恢复补记后才发布可读取版本', async () => {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('恢复通知');
  const changes: WorkspaceChange[] = [];
  workspace.subscribe(change => changes.push(change));
  const writeBusiness = f.metadata.writeBusiness;
  let fail = true;
  f.metadata.writeBusiness = async batch => {
    if (batch.operations?.some(update => update.header.phase === 'recorded') && fail) {
      fail = false;
      throw new Error('数据库中断');
    }
    await writeBusiness(batch);
  };
  await expect(
    workspace.write(project.id, 'documents/live.md', Buffer.from('待恢复内容'), null),
  ).rejects.toThrow('数据库中断');
  expect(changes).toHaveLength(0);
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  reopened.subscribe(change => changes.push(change));
  await reopened.recover();
  expect(changes).toHaveLength(1);
  const view = await reopened.snapshot(project.id, 'documents/live.md');
  expect(view.preview?.content).toBe('待恢复内容');
  expect(view.versions).toHaveLength(1);
  expect(view.gitStatus.files[0].unstaged).toBe('added');
});
