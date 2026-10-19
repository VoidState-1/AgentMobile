import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { rebaseFixture } from './rebase-fixture';
import { AppError } from '../src/core/errors';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const f = await rebaseFixture();
  cleanups.push(f.cleanup);
  return f;
}
async function begin(f: Awaited<ReturnType<typeof fixture>>) {
  return f.workspace.rebaseBranch(
    f.project.id,
    { name: 'feature', oid: f.source },
    await f.workspace.status(f.project.id),
  );
}
it('变基保留作者/说明并逐个重放提交，冲突编辑后继续更新原分支', async () => {
  const f = await fixture(),
    id = f.project.id;
  const original = f.describe(f.ours);
  await f.save('b.txt', 'second change\n');
  const second = await f.commit(['b.txt']);
  expect(await begin(f)).toBe('conflicts');
  expect((await f.workspace.repository(id)).rebase).toMatchObject({
    position: 0,
    total: 2,
    phase: 'conflicts',
  });
  const preview = await f.workspace.conflictPreview(id, 'a.txt');
  expect(preview.ours?.content).toBe('theirs-a\n');
  expect(preview.theirs?.content).toBe('ours-a\n');
  await expect(f.workspace.taskBaseline(id, 'agent')).rejects.toThrow('正在进行');
  await f.save('a.txt', 'resolved\n');
  await f.workspace.resolveConflict(id, 'a.txt', 'working', await f.workspace.status(id));
  expect(await f.workspace.continueRebase(id, await f.workspace.status(id))).toBe('completed');
  const history = await f.workspace.historyPage(id),
    current = history.versions[0];
  expect(current.oid).not.toBe(second);
  expect(current.parents).toHaveLength(1);
  const first = f.describe(current.parents[0]);
  expect(first.parent).toBe(f.source);
  expect(first.author).toEqual(original.author);
  expect(first.message).toBe(original.message);
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe('resolved\n');
  expect((await f.workspace.readText(id, 'b.txt')).text).toBe('second change\n');
  expect((await f.workspace.repository(id)).rebase).toBeUndefined();
  expect(await f.git.branch(id)).toBe('main');
  expect((await f.workspace.status(id)).files).toEqual([]);
});
it('跳过冲突提交恢复该步内容，再完成原分支的更新', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  expect(await f.workspace.skipRebase(id, await f.workspace.status(id))).toBe('completed');
  expect(await f.git.head(id)).toBe(f.source);
  expect(await f.git.branch(id)).toBe('main');
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe('theirs-a\n');
  expect((await f.workspace.status(id)).state).toBe('none');
});
it('中止变基恢复原始 HEAD、工作区和索引，保留无关用户更改', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  await f.save('unrelated.txt', 'keep\n');
  await f.workspace.abortRebase(id, await f.workspace.status(id));
  expect(await f.git.head(id)).toBe(f.ours);
  expect(await f.git.branch(id)).toBe('main');
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe('ours-a\n');
  expect((await f.workspace.readText(id, 'unrelated.txt')).text).toBe('keep\n');
});
it('索引已写而冲突状态中断，重启收束日志及变基步骤，不自动重放后续提交', async () => {
  const f = await fixture(),
    id = f.project.id,
    apply = f.git.applyGitState;
  let fail = true;
  f.git.applyGitState = async (...args) => {
    if (fail && args[2].REBASE_HEAD) throw new Error('state interrupted');
    await apply(...args);
  };
  await expect(begin(f)).rejects.toThrow('state interrupted');
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.repository(id)).rebase?.phase).toBe('conflicts');
  expect((await f.git.indexState(id)).conflicts).toHaveLength(1);
  await reopened.abortRebase(id, await reopened.status(id));
  expect(await f.git.head(id)).toBe(f.ours);
});
it('解决完成但 SQLite 回执丢失，恢复保留之后用户编辑并继续提交冻结结果', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  const write = f.metadata.writeBusiness;
  let fail = true;
  f.metadata.writeBusiness = async batch => {
    if (
      fail &&
      batch.operations?.some(
        value =>
          value.header.message.startsWith('解决变基冲突') && value.header.phase === 'recorded',
      )
    )
      throw new Error('receipt lost');
    return write(batch);
  };
  await expect(
    f.workspace.resolveConflict(id, 'a.txt', 'theirs', await f.workspace.status(id)),
  ).rejects.toThrow('receipt lost');
  await f.files.write(f.git.dir(id) + '/a.txt', Buffer.from('later user edit\n'));
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  await reopened.continueRebase(id, await reopened.status(id));
  expect((await reopened.readText(id, 'a.txt')).text).toBe('later user edit\n');
  expect(f.cli('show', 'HEAD:a.txt')).toBe('ours-a\n');
});
it('原分支 CAS 后、挂接 HEAD 前中断，恢复可以补齐挂接且不重复重放', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  await f.workspace.resolveConflict(id, 'a.txt', 'theirs', await f.workspace.status(id));
  const change = f.git.changeHead;
  let fail = true;
  f.git.changeHead = async (...args) => {
    if (fail && args[3]) {
      f.cli('update-ref', 'refs/heads/' + args[3].name, args[2].oid!, args[3].oid);
      throw new Error('attach interrupted');
    }
    await change(...args);
  };
  await expect(f.workspace.continueRebase(id, await f.workspace.status(id))).rejects.toThrow(
    'attach interrupted',
  );
  const target = await f.git.head(id);
  expect(await f.git.branch(id)).toBeNull();
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect(await f.git.head(id)).toBe(target);
  expect(await f.git.branch(id)).toBe('main');
  expect((await reopened.repository(id)).rebase).toBeUndefined();
});
it('开始前预检拒绝撤回会话，可直接重试且不改变工作区', async () => {
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
  expect((await f.workspace.repository(id)).rebase).toBeUndefined();
  expect(await f.git.head(id)).toBe(f.ours);
  reject = false;
  expect(await begin(f)).toBe('conflicts');
});
it('原分支在变基期间被外部修改，继续操作拒绝覆盖该引用', async () => {
  const f = await fixture(),
    id = f.project.id;
  await begin(f);
  const before = (await f.workspace.readText(id, 'a.txt')).text;
  f.cli('update-ref', 'refs/heads/main', f.source, f.ours);
  await expect(f.workspace.continueRebase(id, await f.workspace.status(id))).rejects.toThrow(
    '原分支',
  );
  expect(f.cli('rev-parse', 'refs/heads/main').trim()).toBe(f.source);
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe(before);
});
it('超预算的 UTF-8 状态在登记意图前拒绝，仍可中止并恢复原分支', async () => {
  const f = await fixture(),
    id = f.project.id,
    plan = f.git.rebasePlan;
  f.git.rebasePlan = async (...args) => {
    const value = await plan(...args);
    value.commits[0].message = '中'.repeat(30000);
    return value;
  };
  await expect(begin(f)).rejects.toMatchObject({ code: 'LIMIT' });
  expect(f.workspace.needsRecovery(id)).toBe(false);
  expect((await f.workspace.repository(id)).rebase?.phase).toBe('ready');
  await f.workspace.abortRebase(id, await f.workspace.status(id));
  expect(await f.git.head(id)).toBe(f.ours);
  expect(await f.git.branch(id)).toBe('main');
});
it.each(['merge', 'rebase'] as const)('技能库恢复不读写用户项目待恢复的 %s 会话', async kind => {
  const f = await fixture(),
    id = f.project.id,
    apply = f.git.applyGitState;
  let fail = true;
  f.git.applyGitState = async (...args) => {
    if (fail && (kind === 'merge' ? args[2].MERGE_HEAD : args[2].REBASE_HEAD))
      throw new Error('project state interrupted');
    await apply(...args);
  };
  const start =
    kind === 'merge'
      ? f.workspace.mergeBranch.bind(f.workspace)
      : f.workspace.rebaseBranch.bind(f.workspace);
  await expect(
    start(id, { name: 'feature', oid: f.source }, await f.workspace.status(id)),
  ).rejects.toThrow('project state interrupted');
  const bucket = kind === 'merge' ? 'git-merges' : 'git-rebases';
  const before = await f.metadata.get(bucket, id);
  const skills = createWorkspace(f.files, f.metadata, randomUUID, {
    namespace: 'skills',
    git: f.git,
  });
  await skills.recover();
  expect(await f.metadata.get(bucket, id)).toEqual(before);
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git: f.git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  if (kind === 'merge') await reopened.abortMerge(id, await reopened.status(id));
  else await reopened.abortRebase(id, await reopened.status(id));
  expect(await f.git.head(id)).toBe(f.ours);
});
