import type { AppServices } from '../src/application/services';
import { Buffer } from 'buffer';

export interface GitBranchFixture {
  name: string;
  id: string;
  source: string;
  ours: string;
}
export async function prepareApplicationBranches(
  api: AppServices,
  directoryConflict = false,
  identity?: { name: string; email: string },
): Promise<GitBranchFixture> {
  const project = await api.workspace.create('MergeIntegration-' + Date.now());
  const id = project.id;
  const save = async (path: string, text: string) => {
    const file = (await api.workspace.files(id)).find(file => file.path === path);
    await api.workspace.writeText(id, path, Buffer.from(text), file?.revision ?? null);
  };
  const commit = async (paths: string[]) => {
    const status = await api.workspace.status(id);
    await api.workspace.stage(id, paths, {
      ...status,
      revisions: Object.fromEntries(status.files.map(file => [file.path, file.workingRevision])),
    });
    return api.workspace.commitStaged(id, 'merge fixture', await api.workspace.status(id));
  };
  await save('.gitattributes', '*.txt text eol=crlf\n');
  await save('base.txt', 'base\r\n');
  await commit(['.gitattributes', 'base.txt']);
  await api.workspace.gitCommand(
    id,
    { method: 'branchCreate', name: 'incoming' },
    await api.workspace.status(id),
  );
  if (identity)
    await api.workspace.gitCommand(
      id,
      { method: 'identity', ...identity },
      await api.workspace.status(id),
    );
  await save(directoryConflict ? 'shape' : 'base.txt', 'ours\r\n');
  const ours = await commit([directoryConflict ? 'shape' : 'base.txt']);
  await api.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'incoming' },
    await api.workspace.status(id),
  );
  await save(directoryConflict ? 'shape/nested.txt' : 'base.txt', 'theirs\r\n');
  const source = await commit([directoryConflict ? 'shape/nested.txt' : 'base.txt']);
  await api.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'main' },
    await api.workspace.status(id),
  );
  return { id, name: project.name, source, ours };
}
export async function prepareApplicationMerge(
  api: AppServices,
  directoryConflict = false,
): Promise<GitBranchFixture> {
  const fixture = await prepareApplicationBranches(api, directoryConflict);
  const result = await api.workspace.mergeBranch(
    fixture.id,
    { name: 'incoming', oid: fixture.source },
    await api.workspace.status(fixture.id),
  );
  if (result !== 'conflicts') throw new Error('Application merge did not preserve a conflict');
  return fixture;
}
export async function verifyMergeContinuation(api: AppServices, fixture: GitBranchFixture) {
  const { id, ours, source } = fixture;
  const repo = await api.workspace.repository(id);
  if (repo.state !== 'merge' || repo.conflicts.length !== 1 || repo.merge?.sourceOid !== source)
    throw new Error('Merge stages or session did not survive');
  const preview = await api.workspace.conflictPreview(id, 'base.txt');
  if (preview.ours?.content !== 'ours\n' || preview.theirs?.content !== 'theirs\n')
    throw new Error('Three-way versions diverged');
  const current = await api.workspace.preview(id, 'base.txt');
  await api.workspace.writeText(id, 'base.txt', Buffer.from('resolved\r\n'), current.revision);
  await api.workspace.resolveConflict(id, 'base.txt', 'working', await api.workspace.status(id));
  await api.workspace.continueMerge(id, await api.workspace.status(id));
  const top = (await api.workspace.historyPage(id)).versions[0];
  if (
    JSON.stringify(top.parents) !== JSON.stringify([ours, source]) ||
    (await api.workspace.status(id)).files.length
  )
    throw new Error('Merge did not create a clean dual-parent commit');
}
export async function verifyDirectoryMerge(api: AppServices) {
  const fixture = await prepareApplicationMerge(api, true),
    id = fixture.id;
  const conflict = (await api.workspace.repository(id)).conflicts.find(
    conflict => conflict.path === 'shape',
  );
  if (!conflict) throw new Error('Missing directory-file conflict');
  await api.workspace.resolveConflict(id, 'shape', 'ours', await api.workspace.status(id));
  if ((await api.workspace.preview(id, 'shape')).content !== 'ours\r\n')
    throw new Error('Directory-file ours resolution lost file content');
  await api.workspace.abortMerge(id, await api.workspace.status(id));
  for (const choice of ['theirs', 'delete', 'working'] as const) {
    await api.workspace.mergeBranch(
      id,
      { name: 'incoming', oid: fixture.source },
      await api.workspace.status(id),
    );
    await api.workspace.resolveConflict(id, 'shape', choice, await api.workspace.status(id));
    const files = await api.workspace.files(id);
    if (
      files.some(file => file.path.startsWith('shape~')) ||
      (await api.workspace.repository(id)).conflicts.length
    )
      throw new Error('Directory resolution left conflicts or checkout artifacts: ' + choice);
    if (choice === 'delete') {
      if (files.some(file => file.path === 'shape' || file.path.startsWith('shape/')))
        throw new Error('Directory deletion left children');
    } else if ((await api.workspace.preview(id, 'shape/nested.txt')).content !== 'theirs\r\n')
      throw new Error('Directory side selection lost descendants: ' + choice);
    await api.workspace.abortMerge(id, await api.workspace.status(id));
  }
  await api.workspace.mergeBranch(
    id,
    { name: 'incoming', oid: fixture.source },
    await api.workspace.status(id),
  );
  await api.workspace.writeText(id, 'unrelated.txt', Buffer.from('keep\r\n'), null);
  await api.workspace.abortMerge(id, await api.workspace.status(id));
  if (
    (await api.workspace.preview(id, 'unrelated.txt')).content !== 'keep\r\n' ||
    (await api.workspace.repository(id)).state !== 'none'
  )
    throw new Error('Abort discarded unrelated content');
}
