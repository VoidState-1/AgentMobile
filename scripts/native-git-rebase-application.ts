import type { AppServices } from '../src/application/services';
import { Buffer } from 'buffer';
import { prepareApplicationBranches, type GitBranchFixture } from './native-git-merge-application';

export async function prepareApplicationRebase(api: AppServices): Promise<GitBranchFixture> {
  const fixture = await prepareApplicationBranches(api, false, {
    name: "Rebase O'Neil $(printf should-not-run)",
    email: 'rebase-author@example.invalid',
  });
  const result = await api.workspace.rebaseBranch(
    fixture.id,
    { name: 'incoming', oid: fixture.source },
    await api.workspace.status(fixture.id),
  );
  if (result !== 'conflicts') throw new Error('Application rebase did not pause on conflict');
  return fixture;
}
export async function verifyRebaseContinuation(api: AppServices, fixture: GitBranchFixture) {
  const { id } = fixture,
    info = await api.workspace.repository(id);
  if (
    info.state !== 'rebase' ||
    info.rebase?.position !== 0 ||
    info.conflicts.length !== 1 ||
    info.head.branch !== null
  )
    throw new Error('Rebase session or stages did not survive');
  const preview = await api.workspace.conflictPreview(id, 'base.txt');
  if (preview.ours?.content !== 'theirs\n' || preview.theirs?.content !== 'ours\n')
    throw new Error('Rebase sides are reversed');
  const before = (await api.workspace.historyPage(id, { head: fixture.ours })).versions[0];
  await api.workspace.writeText(
    id,
    'base.txt',
    Buffer.from('rebase-resolved\r\n'),
    preview.working!.revision,
  );
  await api.workspace.resolveConflict(id, 'base.txt', 'working', await api.workspace.status(id));
  if ((await api.workspace.continueRebase(id, await api.workspace.status(id))) !== 'completed')
    throw new Error('Rebase did not finish');
  const next = (await api.workspace.historyPage(id)).versions[0],
    status = await api.workspace.status(id);
  if (
    JSON.stringify(next.parents) !== JSON.stringify([fixture.source]) ||
    next.message !== before.message ||
    next.author.name !== before.author.name ||
    status.files.length ||
    status.state !== 'none' ||
    status.branch !== 'main'
  )
    throw new Error('Rebase lost commit metadata or did not attach the branch');
}
export async function verifyRebaseSkipAndAbort(api: AppServices) {
  const skip = await prepareApplicationRebase(api);
  await api.workspace.skipRebase(skip.id, await api.workspace.status(skip.id));
  if (
    (await api.workspace.repository(skip.id)).head.oid !== skip.source ||
    (await api.workspace.status(skip.id)).state !== 'none'
  )
    throw new Error('Rebase skip did not update the branch to the target');
  const abort = await prepareApplicationRebase(api);
  await api.workspace.writeText(
    abort.id,
    'unrelated.txt',
    Buffer.from('keep user content\r\n'),
    null,
  );
  await api.workspace.abortRebase(abort.id, await api.workspace.status(abort.id));
  if (
    (await api.workspace.repository(abort.id)).head.oid !== abort.ours ||
    (await api.workspace.preview(abort.id, 'unrelated.txt')).content !== 'keep user content\r\n' ||
    (await api.workspace.preview(abort.id, 'base.txt')).content !== 'ours\r\n'
  )
    throw new Error('Rebase abort lost the original state or unrelated edits');
}
