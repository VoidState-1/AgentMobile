import type { WorkspaceApplication } from '../src/application/workspace/service';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { contentCodec } from '../src/adapters/storage/codec';
import { defaultAgentSettings } from '../src/core/agent/settings';
import { builtinAgents } from '../src/core/agent/definitions';
import type { RunRecord } from '../src/core/runs/records';
import { RunRepository } from '../src/application/runs/repository';
import { ProposalService } from '../src/application/runs/proposals';
import { recoverRuns } from '../src/application/runs/recovery';
import { testStorage, readOperations } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(paths = ['documents/notes.md', 'documents/new.md'], dirty = false, setup?: (workspace: WorkspaceApplication, id: string) => Promise<void>) {
  const f = await testStorage(); cleanups.push(f.cleanup); const workspace = createWorkspace(f.files, f.metadata, randomUUID); const project = await workspace.create('隔离提案');
  await setup?.(workspace, project.id);
  if (dirty) {
    const path = 'documents/notes.md'; const original = await workspace.readText(project.id, path); await workspace.write(project.id, path, contentCodec.encodeText('user v1'), original.revision);
    const status = await workspace.status(project.id); await workspace.stage(project.id, [path], { head: status.head, indexRevision: status.indexRevision, revisions: { [path]: status.files.find((file) => file.path === path)!.workingRevision } });
    const v1 = await workspace.readText(project.id, path); await workspace.write(project.id, path, contentCodec.encodeText('user v2'), v1.revision);
  }
  workspace.claim(project.id, 'root'); const baseline = await workspace.taskBaseline(project.id, 'root'); const original = await workspace.readText(project.id, 'documents/notes.md');
  const runs = new RunRepository(f.metadata); const root: RunRecord = { schemaVersion: 3, id: 'root', rootRunId: 'root', kind: 'root', depth: 0, state: 'running', projectId: project.id, conversationId: 'conversation',
    prompt: '合入提案', response: '', createdAt: new Date().toISOString(), mode: 'demo', agentDefinitionId: 'main', agentDefinitionRevision: 1, launchSnapshotRef: 'root',
    agentSettingsSnapshot: defaultAgentSettings(), baseCommit: baseline.head, baseSnapshot: baseline.working, baseIndexSnapshot: baseline.index };
  const child: RunRecord = { ...root, id: 'child', rootRunId: root.id, parentRunId: root.id, kind: 'child', depth: 1, agentDefinitionId: 'writer', agentDefinitionRevision: 1, launchSnapshotRef: 'child',
    inputSnapshotRef: baseline.working, proposalId: 'proposal-child', baseSnapshot: undefined, baseIndexSnapshot: undefined };
  await runs.save(root, { id: root.id }); await runs.save(child, { id: child.id, agent: builtinAgents.find((agent) => agent.id === 'writer'), settings: child.agentSettingsSnapshot, selectedPaths: paths });
  const proposals = new ProposalService(workspace, runs, contentCodec); const overlay = await proposals.create(child); const tools = overlay.tools(() => 1, false);
  async function write(path: string, text: string, expectedRevision: string | null, call = path) {
    return tools.find((tool) => tool.name === 'write_text')!.execute(call, { path, text, expectedRevision });
  }
  async function ready() { await overlay.close('completed'); await runs.save({ ...child, state: 'completed', finalSnapshot: overlay.snapshot().candidateSnapshot }); }
  return { ...f, workspace, project, baseline, original, runs, root, child, proposals, overlay, tools, write, ready };
}

it('候选写入不改变真实文件/index/HEAD，稳定回执不重复；合入归属根与子，整组撤销保留用户工作区/index', async () => {
  const f = await fixture(undefined, true); const status = await f.workspace.status(f.project.id);
  expect((await f.write('documents/notes.md', 'PRIVATE_CANDIDATE_CONTENT', f.original.revision)).isError).not.toBe(true);
  await f.write('documents/new.md', 'child draft', null); await f.write('documents/new.md', 'child draft', null);
  expect(await f.proposals.repository.writes()).toHaveLength(2);
  expect((await f.workspace.readText(f.project.id, 'documents/notes.md')).text).toBe('user v2'); expect(await f.workspace.status(f.project.id)).toEqual(status);
  expect(JSON.stringify(await f.metadata.all('proposal-writes'))).not.toContain('PRIVATE_CANDIDATE_CONTENT');
  const denied = await f.write('documents/escape.md', 'escape', null); expect(denied.isError).toBe(true);
  await f.ready(); await expect(f.proposals.apply('foreign-root', f.overlay.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  const result = await f.proposals.apply('root', f.overlay.id); expect(result.applied).toBe(true);
  expect((await f.workspace.readText(f.project.id, 'documents/notes.md')).text).toBe('PRIVATE_CANDIDATE_CONTENT');
  expect((await f.workspace.status(f.project.id)).indexRevision).toBe(status.indexRevision); expect(await f.workspace.git.head(f.project.id)).toBe(status.head);
  const op = (await readOperations(f.metadata, f.project.id)).find((operation) => operation.proposalId === f.overlay.id)!;
  expect(op).toMatchObject({ ownerRootRunId: 'root', actorRunId: 'child', mergedByRunId: 'root', phase: 'recorded' });
  const task = await f.workspace.taskFinal({ ...f.root, state: 'completed' }); expect(task.changedPaths!.sort()).toEqual(['documents/new.md', 'documents/notes.md']);
  await expect(f.workspace.stage(f.project.id, ['documents/notes.md'], { head: status.head, indexRevision: status.indexRevision, revisions: {} }, 'root', f.baseline)).rejects.toThrow();
  f.workspace.release(f.project.id, 'root'); await f.workspace.undoTask(task);
  expect((await f.workspace.readText(f.project.id, 'documents/notes.md')).text).toBe('user v2'); expect(await f.workspace.status(f.project.id)).toEqual(status); expect((await f.workspace.git.historyPage(f.project.id, { limit: 100 })).versions).toHaveLength(1);
});

it('多文件全部预检，冲突不合入任何路径，提案保持可检查；候选==基线/当前==候选均不覆盖', async () => {
  const f = await fixture(); await f.write('documents/notes.md', 'candidate', f.original.revision); await f.write('documents/new.md', 'new candidate', null); await f.ready();
  await f.workspace.write(f.project.id, 'documents/notes.md', contentCodec.encodeText('parent later edit'), f.original.revision, { owner: 'root' });
  const merged = await f.proposals.apply('root', f.overlay.id); expect(merged).toMatchObject({ applied: false, conflicts: ['documents/notes.md'], changedPaths: [] });
  expect((await f.proposals.repository.get(f.overlay.id))?.state).toBe('conflicted'); expect((await f.workspace.files(f.project.id)).some((file) => file.path === 'documents/new.md')).toBe(false);
  const parent = await f.workspace.readText(f.project.id, 'documents/notes.md'); await f.workspace.write(f.project.id, 'documents/notes.md', contentCodec.encodeText('candidate'), parent.revision, { owner: 'root' });
  expect((await f.proposals.apply('root', f.overlay.id)).changedPaths).toEqual(['documents/new.md']);
  const empty = await fixture(); await empty.write('documents/notes.md', 'temporary', empty.original.revision);
  const reading = await empty.tools.find((tool) => tool.name === 'read_text')!.execute('read', { path: 'documents/notes.md' });
  const part = reading.content[0]; const temporary = JSON.parse(part.type === 'text' ? part.text : '{}');
  await empty.write('documents/notes.md', empty.original.text, temporary.revision, 'restore'); await empty.ready();
  await empty.workspace.write(empty.project.id, 'documents/notes.md', contentCodec.encodeText('unrelated parent'), empty.original.revision, { owner: 'root' });
  expect((await empty.proposals.apply('root', empty.overlay.id)).changedPaths).toEqual([]); expect((await empty.workspace.readText(empty.project.id, 'documents/notes.md')).text).toBe('unrelated parent');
});

it('候选 Git 写入成功而元数据回执中断，重启采用私有检查点，不重放写入、不碰真实工作区', async () => {
  const f = await fixture(); const batch = f.metadata.batch!;
  f.metadata.batch = async (entries) => { if (entries.some((entry) => entry.bucket === 'proposal-writes')) throw new Error('receipt interrupted'); await batch(entries); };
  expect((await f.write('documents/new.md', 'recover candidate', null)).isError).toBe(true); await expect(f.overlay.close('completed')).rejects.toMatchObject({ code: 'STORAGE' });
  f.metadata.batch = batch; await f.proposals.recover(); await recoverRuns(f.runs, f.workspace, [], async (id) => (await f.proposals.repository.get(id))?.candidateSnapshot);
  const proposal = (await f.proposals.repository.get(f.overlay.id))!; expect(proposal.state).toBe('interrupted'); expect(proposal.changedPaths).toEqual(['documents/new.md']);
  expect(contentCodec.decodeText(await f.workspace.git.readAt(f.project.id, proposal.candidateSnapshot, 'documents/new.md'))).toBe('recover candidate');
  expect((await f.workspace.files(f.project.id)).some((file) => file.path === 'documents/new.md')).toBe(false); expect((await f.runs.get('child'))?.state).toBe('interrupted');
});

it('合入在第二文件写入中断，文件日志恢复整批并补提案回执；已完成子结果保留，根差异包括合入文件', async () => {
  const f = await fixture(); await f.write('documents/notes.md', 'merged note', f.original.revision); await f.write('documents/new.md', 'merged new', null); await f.ready();
  const write = f.files.write; let fail = true;
  f.files.write = async (path, bytes) => { if (path.endsWith('/documents/new.md') && fail) { fail = false; throw new Error('file interrupted'); } await write(path, bytes); };
  await expect(f.proposals.apply('root', f.overlay.id)).rejects.toThrow('interrupted'); expect((await f.proposals.repository.get(f.overlay.id))?.state).toBe('applying');
  f.files.write = write; f.workspace.release(f.project.id, 'root'); const reopened = createWorkspace(f.files, f.metadata, randomUUID); await reopened.recover();
  await new ProposalService(reopened, f.runs, contentCodec).recover(); await recoverRuns(f.runs, reopened, []);
  expect((await f.proposals.repository.get(f.overlay.id))?.state).toBe('applied'); expect((await f.runs.get('child'))?.state).toBe('completed');
  const root = (await f.runs.view('root'))!; expect(root.state).toBe('interrupted'); expect(root.changedPaths!.sort()).toEqual(['documents/new.md', 'documents/notes.md']);
  expect((await f.workspace.readText(f.project.id, 'documents/new.md')).text).toBe('merged new');
  await reopened.undoTask(root); expect((await reopened.readText(f.project.id, 'documents/notes.md')).text).toBe(f.original.text);
});

it('图片移动与删除按二进制基线预检；冲突保留整批，合入不触碰真实 index，禁止子任务独立撤销', async () => {
  const image = contentCodec.decodeBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=');
  const f = await fixture(['assets/original.png', 'assets/moved.png', 'assets/delete.png'], false, async (workspace, id) => {
    await workspace.write(id, 'assets/original.png', image, null); await workspace.write(id, 'assets/delete.png', image, null);
  });
  const before = await f.workspace.status(f.project.id); const revision = await f.workspace.git.revision(image);
  const move = f.tools.find((tool) => tool.name === 'move_file')!; const remove = f.tools.find((tool) => tool.name === 'delete_file')!;
  expect((await move.execute('move', { from: 'assets/original.png', to: 'assets/moved.png', expectedRevision: revision })).isError).not.toBe(true);
  await remove.execute('delete', { path: 'assets/delete.png', expectedRevision: revision }); await f.ready();
  const changed = new Uint8Array([...image, 0]); await f.workspace.write(f.project.id, 'assets/delete.png', changed, revision, { owner: 'root' });
  expect((await f.proposals.apply('root', f.overlay.id)).conflicts).toEqual(['assets/delete.png']); expect((await f.workspace.files(f.project.id)).some((file) => file.path === 'assets/moved.png')).toBe(false);
  await f.workspace.write(f.project.id, 'assets/delete.png', image, await f.workspace.git.revision(changed), { owner: 'root' });
  expect((await f.proposals.apply('root', f.overlay.id)).applied).toBe(true); expect((await f.workspace.read(f.project.id, 'assets/moved.png')).bytes).toEqual(image);
  expect((await f.workspace.status(f.project.id)).indexRevision).toBe(before.indexRevision); await expect(f.workspace.undoTask({ ...f.child, state: 'completed' })).rejects.toThrow('根任务');
});

it('文件合入已记录但提案 applied 回执失败时阻止组完成，重启从文件回执补记提案', async () => {
  const f = await fixture(); await f.write('documents/new.md', 'merged before receipt', null); await f.ready(); const put = f.metadata.put;
  f.metadata.put = async (bucket, id, value) => { if (bucket === 'change-proposals' && (value as { state: string }).state === 'applied') throw new Error('proposal receipt failed'); await put(bucket, id, value); };
  await expect(f.proposals.apply('root', f.overlay.id)).rejects.toMatchObject({ code: 'STORAGE' }); expect(() => f.proposals.assertSettled()).toThrow('回执');
  expect((await f.workspace.readText(f.project.id, 'documents/new.md')).text).toBe('merged before receipt');
  f.metadata.put = put; const reopened = new ProposalService(f.workspace, f.runs, contentCodec); await reopened.recover();
  expect((await reopened.repository.get(f.overlay.id))?.state).toBe('applied'); expect(() => reopened.assertSettled()).not.toThrow();
});
