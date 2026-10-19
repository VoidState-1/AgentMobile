import type { GitPort } from '@/core/git/contracts';
import type { HostFileSystem } from '@/core/storage/contracts';
import { contentCodec } from '@/adapters/storage/codec';
import { nativeGit } from './native-client';
import type { GitRepositoryInfo } from '@/core/git/repository';

/** Platform selection is resolved by Metro; mobile never constructs the JS Git filesystem. */
export function createGitRepository(_host: HostFileSystem): GitPort {
  return {
    recoverLocks: id => nativeGit(id, 'recoverLocks'),
    indexState: id => nativeGit(id, 'indexState'),
    setIndexState: (id, entries, beforeConflicts, afterConflicts) =>
      nativeGit(id, 'setIndexState', { entries, beforeConflicts, afterConflicts }),
    gitState: id => nativeGit(id, 'gitState'),
    applyGitState: (id, before, after) => nativeGit(id, 'applyGitState', { before, after }),
    operationReceipt: async (id, operationId) =>
      (await nativeGit<string | null>(id, 'operationReceipt', { operationId })) ?? undefined,
    completeOperation: (id, operationId, checkpoint) =>
      nativeGit(id, 'completeOperation', { operationId, checkpoint }),
    mergePlan: (id, target, message) => nativeGit(id, 'mergePlan', { target, message }),
    rebasePlan: (id, target) => nativeGit(id, 'rebasePlan', { target }),
    rebaseStep: (id, commit, current) => nativeGit(id, 'rebaseStep', { commit, current }),
    rebaseCommit: (id, entries, original, parent) =>
      nativeGit(id, 'rebaseCommit', { entries, original, parent }),
    mergeCommit: (id, entries, parents, message) =>
      nativeGit(id, 'mergeCommit', { entries, parents, message }),
    filterEntries: (id, entries, attributes, direction) =>
      nativeGit(id, 'filterEntries', { entries, attributes, direction }),
    clone: (id, url, options) =>
      nativeGit(id, 'clone', { url, operationId: options.operationId }, options),
    cloneState: (id, url, operationId) => nativeGit(id, 'cloneState', { url, operationId }),
    publishClone: (id, url, operationId) => nativeGit(id, 'publishClone', { url, operationId }),
    discardClone: id => nativeGit(id, 'discardClone'),
    repositoryInfo: async id => ({
      ...(await nativeGit<Omit<GitRepositoryInfo, 'capabilities'>>(id, 'overview')),
      capabilities: {
        fetch: true,
        push: true,
        clone: true,
        merge: true,
        rebase: true,
      },
    }),
    repositoryCommand: (id, command, guard, transport) =>
      nativeGit(id, command.method, { ...command, guard }, transport),
    remoteHead: (id, name, branch, transport) =>
      nativeGit(id, 'remoteHead', { name, branch }, transport),
    switchPlan: (id, target) => nativeGit(id, 'switchPlan', { target }),
    changeHead: (id, before, after, branchGuard) =>
      nativeGit(id, 'changeHead', { before, after, branchGuard }),
    dir: id => '/workspaces/' + id + '/repository',
    init: id => nativeGit(id, 'init'),
    head: async id => (await nativeGit<string | null>(id, 'head')) || null,
    branch: id => nativeGit(id, 'branch'),
    revision: bytes =>
      nativeGit('blob-hashing', 'revision', { bytes: contentCodec.encodeBase64(bytes) }),
    commit: (id, paths, message) => nativeGit(id, 'commit', { paths, message }),
    historyPage: (id, query) => nativeGit(id, 'history', { query: query ?? {} }),
    findOperation: async (id, operationId) =>
      (await nativeGit<string | null>(id, 'findOperation', { operationId })) ?? undefined,
    tree: (id, ref) => nativeGit(id, 'tree', { ref: ref ?? '' }),
    entries: (id, ref) => nativeGit(id, 'entries', { ref: ref ?? '' }),
    readAt: async (id, ref, path) =>
      contentCodec.decodeBase64(await nativeGit(id, 'readAt', { ref, path })),
    blob: async (id, oid) => contentCodec.decodeBase64(await nativeGit(id, 'blob', { oid })),
    blobInfo: (id, oid) => nativeGit(id, 'blobInfo', { oid }),
    writeBlob: (id, bytes) =>
      nativeGit(id, 'writeBlob', { bytes: contentCodec.encodeBase64(bytes) }),
    workingTree: (id, paths) => nativeGit(id, 'workingTree', { paths }),
    stageEntries: (id, paths) => nativeGit(id, 'stageEntries', { paths }),
    applyWorktree: (id, changes, move) => nativeGit(id, 'applyWorktree', { changes, move }),
    status: (id, working) => nativeGit(id, 'status', { working }),
    uncommittedPaths: (id, head, indexSnapshot, workingSnapshot, paths) =>
      nativeGit(id, 'uncommittedPaths', { head, indexSnapshot, workingSnapshot, paths }),
    index: id => nativeGit(id, 'index'),
    setIndex: (id, entries) => nativeGit(id, 'setIndex', { entries }),
    checkpoint: (id, files, key, parent) =>
      nativeGit(id, 'checkpoint', {
        files,
        key,
        parent: parent ?? '',
      }),
    checkpointRef: async (id, key) =>
      (await nativeGit<string | null>(id, 'checkpointRef', { key })) ?? undefined,
    commitSnapshot: (id, snapshot, message, expectedHead) =>
      nativeGit(id, 'commitSnapshot', { snapshot, message, expectedHead }),
  };
}
