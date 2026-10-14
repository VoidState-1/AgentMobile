import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../src/adapters/workspace/service';
import { startAgent } from '../src/adapters/agent/runner';
import type { Operation, TaskRecord } from '../src/core/prototype/types';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const f = await testStorage(); cleanups.push(f.cleanup);
  const workspace = new WorkspaceService(f.files, f.metadata, randomUUID); const project = await workspace.create('Git 测试');
  const cli = (...args: string[]) => execFileSync('git', ['-C', f.resolve(workspace.git.dir(project.id)), ...args], { encoding: 'utf8' });
  const save = async (path: string, text: string) => workspace.write(project.id, path, Buffer.from(text), (await workspace.files(project.id)).find((file) => file.path === path)?.revision ?? null);
  const stage = async (...paths: string[]) => { const status = await workspace.status(project.id);
    await workspace.stage(project.id, paths, { ...status, revisions: Object.fromEntries(paths.map((path) => [path, status.files.find((file) => file.path === path)?.workingRevision ?? null])) }); };
  const commit = async (message: string, paths?: string[]) => workspace.commitStaged(project.id, message, await workspace.status(project.id), paths);
  return { ...f, workspace, project, cli, save, stage, commit };
}

describe('标准工作区、暂存区与提交', () => {
  it('反复保存不移动 HEAD；内部检查点不进入 git log，标准 CLI 可查看未暂存内容', async () => {
    const f = await fixture(); const head = await f.workspace.git.head(f.project.id);
    await f.save('documents/notes.md', 'A'); await f.save('documents/notes.md', 'B'); await f.save('documents/notes.md', 'A');
    expect(await f.workspace.git.head(f.project.id)).toBe(head); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(f.cli('status', '--porcelain')).toContain(' M documents/notes.md');
    expect(f.cli('diff', '--', 'documents/notes.md')).toContain('+A');
    expect(f.cli('for-each-ref', 'refs/agent-mobile/checkpoints')).toContain('operations/');
  });

  it('暂存 v1 后编辑 v2，提交冻结的 v1；v2 保留未暂存，重启仍一致', async () => {
    const f = await fixture(); const path = 'documents/new.md'; await f.save(path, 'v1'); await f.stage(path); await f.save(path, 'v2');
    expect((await f.workspace.status(f.project.id)).files[0]).toMatchObject({ path, staged: 'added', unstaged: 'modified' });
    expect((await f.workspace.diff(f.project.id, 'staged'))[0].after).toBe('v1');
    expect((await f.workspace.diff(f.project.id, 'unstaged'))[0]).toMatchObject({ before: 'v1', after: 'v2' });
    await f.commit('添加文档'); expect(f.cli('show', 'HEAD:' + path)).toBe('v1'); expect(f.cli('show', ':' + path)).toBe('v1');
    expect(f.cli('status', '--porcelain')).toContain(' M ' + path); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2');
    const reopened = new WorkspaceService(f.files, f.metadata, randomUUID); await reopened.recover();
    expect(await reopened.status(f.project.id)).toEqual(await f.workspace.status(f.project.id)); expect((await reopened.readText(f.project.id, path)).text).toBe('v2');
  });

  it('取消新增/删除暂存保留工作文件，丢弃以暂存区为准，重命名为新增加删除', async () => {
    const f = await fixture(); const path = 'documents/new.md'; await f.save(path, 'v1'); await f.stage(path);
    await f.workspace.unstage(f.project.id, [path], await f.workspace.status(f.project.id));
    expect(f.cli('status', '--porcelain')).toContain('?? ' + path); expect((await f.workspace.readText(f.project.id, path)).text).toBe('v1');
    await f.stage(path); await f.save(path, 'v2'); await f.workspace.discard(f.project.id, [path], await f.workspace.status(f.project.id));
    expect((await f.workspace.readText(f.project.id, path)).text).toBe('v1'); await f.commit('新文档');
    const file = await f.workspace.readText(f.project.id, path); await f.workspace.move(f.project.id, path, 'documents/moved.md', file.revision);
    expect((await f.workspace.status(f.project.id)).files.map((item) => [item.path, item.unstaged])).toEqual([['documents/moved.md', 'added'], [path, 'deleted']]);
    await f.stage(path, 'documents/moved.md'); expect(f.cli('diff', '--cached', '--name-status')).toContain('R100'); await f.commit('重命名');
    await f.workspace.remove(f.project.id, 'documents/moved.md', file.revision); await f.stage('documents/moved.md');
    await f.workspace.unstage(f.project.id, ['documents/moved.md'], await f.workspace.status(f.project.id));
    expect(f.cli('status', '--porcelain')).toContain(' D documents/moved.md');
  });

  it('选择性提交保留其他已暂存更改；陈旧 HEAD/index/file 指纹与空提交被拒绝', async () => {
    const f = await fixture(); await f.save('a.md', 'A'); await f.save('b.md', 'B'); const stale = await f.workspace.status(f.project.id);
    await f.stage('a.md', 'b.md');
    await expect(f.workspace.commitStaged(f.project.id, '陈旧请求', stale)).rejects.toThrow('VERSION_CONFLICT');
    await expect(f.workspace.unstage(f.project.id, ['a.md'], stale)).rejects.toThrow('VERSION_CONFLICT');
    const current = await f.workspace.status(f.project.id);
    await expect(f.workspace.stage(f.project.id, ['a.md'], { ...current, revisions: { 'a.md': 'stale' } })).rejects.toThrow('VERSION_CONFLICT');
    await expect(f.workspace.commitStaged(f.project.id, ' ', current)).rejects.toThrow('提交说明');
    await expect(f.workspace.commitStaged(f.project.id, 'AgentMobile-Operation: forged', current)).rejects.toThrow('提交说明');
    await f.commit('只提交 A', ['a.md']); expect(f.cli('ls-tree', '--name-only', 'HEAD')).toContain('a.md'); expect(f.cli('ls-tree', '--name-only', 'HEAD')).not.toContain('b.md');
    expect(f.cli('status', '--porcelain')).toContain('A  b.md');
    await expect(f.workspace.commitStaged(f.project.id, '旧 HEAD', { ...await f.workspace.status(f.project.id), head: stale.head })).rejects.toThrow('VERSION_CONFLICT');
    await f.commit('提交 B'); await expect(f.commit('没有更改')).rejects.toThrow('没有可提交');
    expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('3');
  });

  it('丢弃未跟踪文件不改变暂存区/HEAD；陈旧丢弃和历史恢复不覆盖新编辑', async () => {
    const f = await fixture(); await f.save('a.md', 'A'); const stale = await f.workspace.status(f.project.id); await f.save('a.md', 'B');
    await expect(f.workspace.discard(f.project.id, ['a.md'], stale)).rejects.toThrow('VERSION_CONFLICT');
    await expect(f.workspace.restore(f.project.id, stale.head, stale.head)).rejects.toThrow('未提交');
    await f.workspace.discard(f.project.id, ['a.md'], await f.workspace.status(f.project.id));
    expect((await f.workspace.status(f.project.id)).files).toEqual([]); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('1');
  });
});

describe('跨 Git/元数据存储的中断恢复', () => {
  it('明确提交后数据库中断，恢复补记且不产生重复提交', async () => {
    const f = await fixture(); await f.save('a.md', 'A'); await f.stage('a.md'); const put = f.metadata.put; let fail = true;
    f.metadata.put = async (bucket, id, value) => { if (bucket === 'operations' && (value as Operation).kind === 'commit' && (value as Operation).phase === 'committed' && fail) { fail = false; throw new Error('模拟提交回执中断'); } await put(bucket, id, value); };
    await expect(f.commit('明确提交 A')).rejects.toThrow('回执中断'); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2');
    const reopened = new WorkspaceService(f.files, f.metadata, randomUUID); await reopened.recover(); await reopened.recover();
    expect(reopened.recoveryIssues).toEqual([]); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2'); expect((await reopened.status(f.project.id)).files).toEqual([]);
    expect((await f.metadata.all<Operation>('operations')).every((op) => op.phase === 'recorded')).toBe(true);
  });

  it('暂存批次只写入第一个文件时中断，恢复完成整个批次并保留 HEAD', async () => {
    const f = await fixture(); await f.save('a.md', 'A'); await f.save('b.md', 'B'); const setIndex = f.workspace.git.setIndex; let count = 0;
    f.workspace.git.setIndex = async (...args) => { await setIndex(...args); if (++count === 1) throw new Error('模拟 index 中断'); };
    await expect(f.stage('a.md', 'b.md')).rejects.toThrow('index 中断');
    const reopened = new WorkspaceService(f.files, f.metadata, randomUUID); await reopened.recover();
    expect(reopened.recoveryIssues).toEqual([]); expect((await reopened.status(f.project.id)).files.map((file) => file.staged)).toEqual(['added', 'added']);
    expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('1'); expect(f.cli('show', ':a.md')).toBe('A'); expect(f.cli('show', ':b.md')).toBe('B');
  });

  it('旧版自动提交日志仍可恢复，旧历史不被改写', async () => {
    const f = await fixture(); const operation: Operation = { id: randomUUID(), projectId: f.project.id, expectedHead: await f.workspace.git.head(f.project.id), message: '旧版保存',
      changes: [{ path: 'old.md', before: null, after: Buffer.from('legacy').toString('base64') }], phase: 'prepared', createdAt: new Date().toISOString() };
    await f.metadata.put('operations', operation.id, operation); const reopened = new WorkspaceService(f.files, f.metadata, randomUUID); await reopened.recover(); await reopened.recover();
    expect(reopened.recoveryIssues).toEqual([]); expect(f.cli('show', 'HEAD:old.md')).toBe('legacy'); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2');
    await reopened.write(f.project.id, 'new.md', Buffer.from('new'), null); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2');
  });
});

describe('任务基线、保护与撤销', () => {
  it('SQLite 返回 ID 顺序时，恢复仍采用操作序号；纯暂存变化也可预览和撤销', async () => {
    const f = await fixture(); const all = f.metadata.all;
    f.metadata.all = async <T>(bucket: string) => { const result = await all<T>(bucket); return bucket === 'operations' ? result.sort((a, b) => (a as Operation).id.localeCompare((b as Operation).id)) : result; };
    const owner = randomUUID(); f.workspace.claim(f.project.id, owner); const baseline = await f.workspace.taskBaseline(f.project.id, owner);
    await f.workspace.write(f.project.id, 'a.md', Buffer.from('A'), null, { owner, operationId: 'zzz-first' });
    await f.workspace.write(f.project.id, 'b.md', Buffer.from('B'), null, { owner, operationId: 'aaa-second' });
    const path = 'documents/notes.md'; const original = await f.workspace.readText(f.project.id, path);
    await f.workspace.write(f.project.id, path, Buffer.from('staged task edit'), original.revision, { owner });
    const status = await f.workspace.status(f.project.id);
    await f.workspace.stage(f.project.id, [path], { ...status, revisions: { [path]: status.files.find((file) => file.path === path)!.workingRevision } }, owner, baseline);
    await f.workspace.write(f.project.id, path, Buffer.from(original.text), (await f.workspace.readText(f.project.id, path)).revision, { owner });
    const task = await f.workspace.taskFinal({ id: owner, projectId: f.project.id, baseCommit: baseline.head, baseSnapshot: baseline.working, baseIndexSnapshot: baseline.index,
      prompt: '编辑', response: '', events: [], state: 'interrupted', mode: 'demo', createdAt: new Date().toISOString() }, true); f.workspace.release(f.project.id, owner);
    expect(task.changedPaths).toContain(path); expect(task.changedPaths).toContain('b.md');
    expect(task.uncommittedPaths).toContain(path);
    expect((await f.workspace.taskChanges(task)).find((file) => file.path === path)).toMatchObject({ kind: '暂存修改', after: 'staged task edit' });
    await f.workspace.undoTask(task); expect((await f.workspace.status(f.project.id)).files).toEqual([]);
  });

  it('任务修改已脏文件时，差异以任务前工作区为准，禁止 Agent 暂存，撤销恢复原暂存和未暂存内容', async () => {
    const f = await fixture(); const path = 'documents/notes.md'; await f.save(path, 'user staged'); await f.stage(path); await f.save(path, 'user unstaged');
    const owner = randomUUID(); f.workspace.claim(f.project.id, owner); const baseline = await f.workspace.taskBaseline(f.project.id, owner);
    await f.workspace.write(f.project.id, path, Buffer.from('agent edit'), (await f.workspace.readText(f.project.id, path)).revision, { owner });
    const status = await f.workspace.status(f.project.id);
    await expect(f.workspace.stage(f.project.id, [path], { ...status, revisions: { [path]: status.files[0].workingRevision } }, owner, baseline)).rejects.toThrow('任务开始前已有');
    await expect(f.workspace.unstage(f.project.id, [path], status, owner, baseline)).rejects.toThrow('任务开始前已有');
    await expect(f.workspace.commitStaged(f.project.id, '禁止夹带', status, [path], owner, baseline)).rejects.toThrow('任务开始前已有');
    const task = await f.workspace.taskFinal({ id: owner, projectId: f.project.id, baseCommit: baseline.head, baseSnapshot: baseline.working, baseIndexSnapshot: baseline.index,
      prompt: '编辑', response: '', events: [], state: 'completed', mode: 'demo', createdAt: new Date().toISOString() }); f.workspace.release(f.project.id, owner);
    expect((await f.workspace.changes(f.project.id, task.baseSnapshot, task.finalSnapshot!))[0]).toMatchObject({ before: 'user unstaged', after: 'agent edit' });
    await f.save('later.md', 'unrelated edit'); await f.workspace.undoTask(task);
    expect((await f.workspace.readText(f.project.id, path)).text).toBe('user unstaged'); expect(f.cli('show', ':' + path)).toBe('user staged');
    expect((await f.workspace.readText(f.project.id, 'later.md')).text).toBe('unrelated edit'); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  it('中断任务基于自身最后检查点恢复，后续用户编辑不混入旧任务；撤销有冲突时不改文件', async () => {
    const f = await fixture(); const owner = randomUUID(); f.workspace.claim(f.project.id, owner); const baseline = await f.workspace.taskBaseline(f.project.id, owner);
    const task: TaskRecord = { id: owner, projectId: f.project.id, baseCommit: baseline.head, baseSnapshot: baseline.working, baseIndexSnapshot: baseline.index,
      prompt: '写文档', response: '', events: [], state: 'running', mode: 'demo', createdAt: new Date().toISOString() };
    await f.workspace.write(f.project.id, 'a.md', Buffer.from('agent'), null, { owner }); f.workspace.release(f.project.id, owner);
    await f.save('a.md', 'later user'); await f.save('b.md', 'unrelated'); const recovered = await f.workspace.taskFinal(task, true);
    expect(recovered.changedPaths).toEqual(['a.md']); expect((await f.workspace.git.tree(f.project.id, recovered.finalSnapshot!))['b.md']).toBeUndefined();
    await expect(f.workspace.undoTask(recovered)).rejects.toThrow('后续修改'); expect((await f.workspace.readText(f.project.id, 'a.md')).text).toBe('later user');
  });
});

it('Pi 通过明确 Git 工具完成一次提交，其他用户暂存内容不进入提交，撤销提交后的任务保留历史', async () => {
  const f = await fixture(); await f.save('user.md', 'user staged'); await f.stage('user.md'); let round = 0; let writeResult: any;
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); const last = body.messages.filter((message: any) => message.role === 'tool').at(-1); const value = last ? JSON.parse(last.content) : undefined;
    round++; const path = 'agent.md'; let name = ''; let args = {};
    if (round === 1) { name = 'write_text'; args = { path, text: 'agent content', expectedRevision: null }; }
    if (round === 2) { writeResult = value; name = 'git_status'; }
    if (round === 3) { name = 'git_stage'; args = { paths: [path], expectedHead: value.head, indexRevision: value.indexRevision, revisions: { [path]: value.files.find((file: any) => file.path === path).workingRevision } }; }
    if (round === 4) { name = 'git_commit'; args = { message: '添加 Agent 文档', paths: [path], expectedHead: value.head, indexRevision: value.indexRevision }; }
    const event = name ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_git_' + round, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] } : { choices: [{ delta: { content: '已提交 Agent 文档。' }, finish_reason: 'stop' }] };
    return new Response('data: ' + JSON.stringify(event) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const started = await startAgent(f.workspace, f.project.id, '写文档并提交', { mode: 'remote', model: 'test', baseUrl: 'https://example.test/v1', imageInput: false }, 'test-only', randomUUID, () => {});
  const task = await started.done; expect(task.state).toBe('completed'); expect(task.events.every((event) => event.state === 'done')).toBe(true);
  expect(writeResult).toMatchObject({ saved: true }); expect(writeResult.commit).toBeUndefined(); expect(task.finalCommit).not.toBe(task.baseCommit); expect(task.uncommittedPaths).toEqual([]);
  expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2'); expect(f.cli('ls-tree', '--name-only', 'HEAD')).not.toContain('user.md'); expect(f.cli('status', '--porcelain')).toContain('A  user.md');
  await f.workspace.undoTask(task); expect(f.cli('rev-list', '--count', 'HEAD').trim()).toBe('2'); expect(f.cli('status', '--porcelain')).toContain('D  agent.md'); expect(f.cli('show', ':user.md')).toBe('user staged');
});
