import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { mergeFixture } from './merge-fixture';
import { AppError } from '../src/core/errors';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const f = await mergeFixture();
  cleanups.push(f.cleanup);
  return f;
}
async function begin(f: Awaited<ReturnType<typeof fixture>>) {
  const id = f.project.id;
  return f.workspace.mergeBranch(
    id,
    { name: 'feature', oid: f.source },
    await f.workspace.status(id),
  );
}
it('冲突保留三方索引，可通过普通编辑器保存，再继续生成双父提交', async () => {
  const f = await fixture(),
    id = f.project.id;
  expect(await begin(f)).toBe('conflicts');
  expect((await f.workspace.repository(id)).conflicts[0]).toMatchObject({
    path: 'a.txt',
    base: { mode: 33188 },
    ours: { mode: 33188 },
    theirs: { mode: 33188 },
  });
  await expect(f.workspace.taskBaseline(id, 'agent')).rejects.toThrow('正在进行');
  const preview = await f.workspace.conflictPreview(id, 'a.txt');
  expect(preview.ours?.content).toBe('ours-a\n');
  expect(preview.theirs?.content).toBe('theirs-a\n');
  await f.save('a.txt', 'resolved\n');
  await f.workspace.resolveConflict(id, 'a.txt', 'working', await f.workspace.status(id));
  expect((await f.workspace.repository(id)).conflicts).toEqual([]);
  const resolved = await f.workspace.status(id);
  await expect(f.workspace.commitStaged(id, 'wrong single parent', resolved)).rejects.toThrow(
    '继续合并',
  );
  await expect(
    f.workspace.stage(id, ['a.txt'], {
      ...resolved,
      revisions: { 'a.txt': resolved.files.find(file => file.path === 'a.txt')!.workingRevision },
    }),
  ).rejects.toThrow('正在进行');
  await expect(f.workspace.unstage(id, ['a.txt'], resolved)).rejects.toThrow('正在进行');
  expect(await f.git.head(id)).toBe(f.ours);
  await f.workspace.continueMerge(id, await f.workspace.status(id));
  const version = (await f.workspace.historyPage(id)).versions[0];
  expect(version.parents).toEqual([f.ours, f.source]);
  expect((await f.workspace.status(id)).state).toBe('none');
  expect((await f.workspace.status(id)).files).toEqual([]);
});
it('意图尚未登记的预检拒绝不遗留合并会话，可以处理问题后重试', async () => {
  const f = await fixture(),
    id = f.project.id,
    checkpoint = f.git.checkpoint;
  let reject = true;
  f.git.checkpoint = async (...args) => {
    if (reject && args[2].startsWith('operations/') && args[2].endsWith('/target'))
      throw new AppError('CONFLICT', 'preflight refused');
    return checkpoint(...args);
  };
  await expect(begin(f)).rejects.toThrow('preflight refused');
  expect(f.workspace.needsRecovery(id)).toBe(false);
  expect((await f.workspace.repository(id)).merge).toBeUndefined();
  reject = false;
  expect(await begin(f)).toBe('conflicts');
});
it('虚拟合并基础产生的 stage 对象有私有引用，标准 Git GC 后仍可预览与解决', async () => {
  const f = await fixture(),
    id = f.project.id;
  const revision = await f.git.writeBlob(id, Buffer.from('virtual merge base\n'));
  const plan = f.git.mergePlan;
  f.git.mergePlan = async (...args) => {
    const value = await plan(...args);
    value.index.conflicts[0].base = { path: 'a.txt', oid: revision, mode: 0o100644 };
    return value;
  };
  await begin(f);
  execFileSync('git', ['-C', f.resolve(f.git.dir(id)), 'gc', '--prune=now'], { stdio: 'pipe' });
  expect((await f.workspace.conflictPreview(id, 'a.txt')).base?.content).toBe(
    'virtual merge base\n',
  );
  await f.workspace.resolveConflict(id, 'a.txt', 'base', await f.workspace.status(id));
  await f.workspace.continueMerge(id, await f.workspace.status(id));
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe('virtual merge base\n');
});
it.each(['continue', 'abort'] as const)(
  '合并 %s 在意图前拒绝后保留可操作会话，允许直接重试',
  async action => {
    const f = await fixture(),
      id = f.project.id;
    await begin(f);
    if (action === 'continue')
      await f.workspace.resolveConflict(id, 'a.txt', 'ours', await f.workspace.status(id));
    const checkpoint = f.git.checkpoint;
    let reject = true;
    f.git.checkpoint = async (...args) => {
      if (reject && args[2].startsWith('operations/') && args[2].endsWith('/target'))
        throw new AppError('CONFLICT', 'finish preflight refused');
      return checkpoint(...args);
    };
    const finish = () =>
      f.workspace
        .status(id)
        .then(status =>
          action === 'continue'
            ? f.workspace.continueMerge(id, status)
            : f.workspace.abortMerge(id, status),
        );
    await expect(finish()).rejects.toThrow('finish preflight refused');
    expect(f.workspace.needsRecovery(id)).toBe(false);
    expect((await f.workspace.repository(id)).merge?.sourceOid).toBe(f.source);
    reject = false;
    await finish();
    expect((await f.workspace.repository(id)).merge).toBeUndefined();
  },
);
it('SQLite 已登记意图但确认丢失时立即阻断写入，重启按既有意图完成合并', async () => {
  const f = await fixture(),
    id = f.project.id,
    prepare = f.metadata.prepareOperation;
  f.metadata.prepareOperation = async (...args) => {
    const result = await prepare(...args);
    if (args[0].kind === 'merge') throw new Error('prepare acknowledgement lost');
    return result;
  };
  await expect(begin(f)).rejects.toThrow('acknowledgement lost');
  expect(f.workspace.needsRecovery(id)).toBe(true);
  f.metadata.prepareOperation = prepare;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.repository(id)).state).toBe('merge');
  expect((await reopened.repository(id)).merge?.sourceOid).toBe(f.source);
});
it('索引已建立冲突但状态文件写入中断，重启继续收束且不丢失 stages', async () => {
  const f = await fixture(),
    id = f.project.id,
    apply = f.git.applyGitState;
  let fail = true;
  f.git.applyGitState = async (...args) => {
    if (fail) throw new Error('metadata interrupted');
    await apply(...args);
  };
  await expect(begin(f)).rejects.toThrow('metadata interrupted');
  expect((await f.git.indexState(id)).conflicts).toHaveLength(1);
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.repository(id)).state).toBe('merge');
  expect((await reopened.repository(id)).merge?.sourceOid).toBe(f.source);
  await reopened.abortMerge(id, await reopened.status(id));
  expect((await reopened.readText(id, 'a.txt')).text).toBe('ours-a\n');
});
it('冲突解决完成标记已写而 SQLite 回执中断，恢复保留其后的用户编辑', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  const write = f.metadata.writeBusiness;
  let fail = true;
  f.metadata.writeBusiness = async batch => {
    if (
      fail &&
      batch.operations?.some(
        update =>
          update.header.message.startsWith('解决合并冲突') && update.header.phase === 'recorded',
      )
    )
      throw new Error('receipt interrupted');
    return write(batch);
  };
  await expect(
    f.workspace.resolveConflict(id, 'a.txt', 'ours', await f.workspace.status(id)),
  ).rejects.toThrow('receipt interrupted');
  await f.files.write(f.git.dir(id) + '/a.txt', Buffer.from('later user edit\n'));
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.readText(id, 'a.txt')).text).toBe('later user edit\n');
  expect((await reopened.repository(id)).conflicts).toEqual([]);
});
it('中止只恢复本次合并触及路径，保留无关的用户更改', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  await f.save('b.txt', 'unrelated user work\n');
  await f.save('new.txt', 'new user file\n');
  expect((await f.workspace.diff(id, 'unstaged', ['b.txt']))[0]).toMatchObject({
    after: 'unrelated user work\n',
  });
  await expect(f.workspace.diff(id, 'unstaged', ['a.txt'])).rejects.toThrow('三方预览');
  await f.workspace.abortMerge(id, await f.workspace.status(id));
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe('ours-a\n');
  expect((await f.workspace.readText(id, 'b.txt')).text).toBe('unrelated user work\n');
  expect((await f.workspace.readText(id, 'new.txt')).text).toBe('new user file\n');
  expect(await f.git.head(id)).toBe(f.ours);
});
it('合并提交的 HEAD 已更新而完成标记中断，重启补回执并保留后续工作内容', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  await f.workspace.resolveConflict(id, 'a.txt', 'theirs', await f.workspace.status(id));
  const complete = f.git.completeOperation;
  let fail = true;
  f.git.completeOperation = async (...args) => {
    if (fail) throw new Error('marker interrupted');
    return complete(...args);
  };
  await expect(f.workspace.continueMerge(id, await f.workspace.status(id))).rejects.toThrow(
    'marker interrupted',
  );
  const head = await f.git.head(id);
  expect(head).not.toBe(f.ours);
  await f.files.write(f.git.dir(id) + '/a.txt', Buffer.from('after commit'));
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect(await f.git.head(id)).toBe(head);
  expect((await reopened.readText(id, 'a.txt')).text).toBe('after commit');
  expect((await reopened.repository(id)).merge).toBeUndefined();
});
it('中断后发现第三种工作内容，恢复拒绝覆盖并保留原始三方信息', async () => {
  const f = await fixture(),
    id = f.project.id,
    apply = f.git.applyWorktree;
  let fail = true;
  f.git.applyWorktree = async (...args) => {
    if (fail) throw new Error('file interrupted');
    return apply(...args);
  };
  await expect(begin(f)).rejects.toThrow('file interrupted');
  await f.files.write(f.git.dir(id) + '/a.txt', Buffer.from('third content'));
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.needsRecovery(id)).toBe(true);
  expect((await reopened.readText(id, 'a.txt')).text).toBe('third content');
  expect(await f.git.head(id)).toBe(f.ours);
});
