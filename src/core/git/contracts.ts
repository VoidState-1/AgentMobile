import type { WorkspaceId, WorkspacePath } from '../workspace/contracts';
import type { Version } from '@/core/git/types';
import type {
  GitRepositoryInfo,
  GitRepositoryCommand,
  GitRepositoryGuard,
  GitRefState,
  GitSwitchPlan,
  GitTransportOptions,
} from './repository';
import type { GitEntry, GitTree } from './objects';
import type { FileChange, ProjectFile } from '../workspace/types';
import type { GitIndexState, GitMergePlan, GitStateFiles } from './merge';
import type { GitBranchGuard, GitRebasePlan, GitRebaseStep } from './rebase';

export type CommitOid = string;
export interface GitFileStatus {
  path: string;
  headRevision: string | null;
  indexRevision: string | null;
  workingRevision: string | null;
  headMode?: number | null;
  indexMode?: number | null;
  workingMode?: number | null;
  conflict?: boolean;
  staged?: 'added' | 'modified' | 'deleted';
  unstaged?: 'added' | 'modified' | 'deleted';
}
export interface GitStatus {
  head: string | null;
  branch: string | null;
  indexRevision: string;
  workingRevision: string;
  files: GitFileStatus[];
  state: GitRepositoryInfo['state'];
}
export interface GitBaseline {
  head: string | null;
  working: string;
  index: string;
  dirtyPaths: string[];
}
export interface GitHistoryQuery {
  head?: CommitOid;
  cursor?: string;
  limit?: number;
}
export interface GitHistoryPage {
  head: CommitOid | null;
  versions: Version[];
  cursor?: string;
}
export const gitHistoryLimits = { page: 30, maxPage: 100 } as const;

/** Version operations are mediated by the host; never exposed as raw model tools. */
export interface GitPort {
  /** Startup only: clear abandoned engine locks while holding the native repository lease. */
  recoverLocks(workspaceId: WorkspaceId): Promise<void>;
  indexState(workspaceId: WorkspaceId): Promise<GitIndexState>;
  setIndexState(
    workspaceId: WorkspaceId,
    entries: Record<string, GitEntry | null>,
    beforeConflicts: GitIndexState['conflicts'],
    afterConflicts: GitIndexState['conflicts'],
  ): Promise<void>;
  gitState(workspaceId: WorkspaceId): Promise<GitStateFiles>;
  applyGitState(
    workspaceId: WorkspaceId,
    before: GitStateFiles,
    after: GitStateFiles,
  ): Promise<void>;
  operationReceipt(workspaceId: WorkspaceId, operationId: string): Promise<string | undefined>;
  completeOperation(
    workspaceId: WorkspaceId,
    operationId: string,
    checkpoint: string,
  ): Promise<void>;
  mergePlan(workspaceId: WorkspaceId, target: string, message: string): Promise<GitMergePlan>;
  rebasePlan(workspaceId: WorkspaceId, target: string): Promise<GitRebasePlan>;
  rebaseStep(workspaceId: WorkspaceId, commit: string, current: string): Promise<GitRebaseStep>;
  rebaseCommit(
    workspaceId: WorkspaceId,
    entries: GitTree,
    original: string,
    parent: string,
  ): Promise<string | null>;
  mergeCommit(
    workspaceId: WorkspaceId,
    entries: GitTree,
    parents: string[],
    message: string,
  ): Promise<string>;
  filterEntries(
    workspaceId: WorkspaceId,
    entries: GitTree,
    attributes: string,
    direction: 'clean' | 'smudge',
  ): Promise<GitTree>;
  clone(workspaceId: WorkspaceId, url: string, transport: GitTransportOptions): Promise<void>;
  cloneState(
    workspaceId: WorkspaceId,
    url: string,
    operationId: string,
  ): Promise<import('./repository').GitCloneState>;
  publishClone(workspaceId: WorkspaceId, url: string, operationId: string): Promise<void>;
  discardClone(workspaceId: WorkspaceId): Promise<void>;
  repositoryInfo(workspaceId: WorkspaceId): Promise<GitRepositoryInfo>;
  repositoryCommand(
    workspaceId: WorkspaceId,
    command: Exclude<GitRepositoryCommand, { method: 'checkout' }>,
    guard: GitRepositoryGuard,
    transport?: GitTransportOptions,
  ): Promise<void>;
  remoteHead(
    workspaceId: WorkspaceId,
    name: string,
    branch: string,
    transport: GitTransportOptions,
  ): Promise<string | null>;
  switchPlan(workspaceId: WorkspaceId, target: string): Promise<GitSwitchPlan>;
  changeHead(
    workspaceId: WorkspaceId,
    before: GitRefState,
    after: GitRefState,
    branchGuard?: GitBranchGuard,
  ): Promise<void>;
  /** Internal logical directory, not a device absolute path. */
  dir(workspaceId: WorkspaceId): string;
  init(workspaceId: WorkspaceId): Promise<void>;
  head(workspaceId: WorkspaceId): Promise<CommitOid | null>;
  branch(workspaceId: WorkspaceId): Promise<string | null>;
  revision(bytes: Uint8Array): Promise<string>;
  commit(workspaceId: WorkspaceId, paths: WorkspacePath[], message: string): Promise<CommitOid>;
  historyPage(workspaceId: WorkspaceId, query?: GitHistoryQuery): Promise<GitHistoryPage>;
  findOperation(workspaceId: WorkspaceId, operationId: string): Promise<CommitOid | undefined>;
  tree(workspaceId: WorkspaceId, ref: CommitOid | null): Promise<GitTree>;
  entries(
    workspaceId: WorkspaceId,
    ref: CommitOid | null,
  ): Promise<({ path: WorkspacePath } & GitEntry)[]>;
  readAt(workspaceId: WorkspaceId, ref: CommitOid, path: WorkspacePath): Promise<Uint8Array>;
  blob(workspaceId: WorkspaceId, oid: string): Promise<Uint8Array>;
  blobInfo(workspaceId: WorkspaceId, oid: string): Promise<{ size: number }>;
  writeBlob(workspaceId: WorkspaceId, bytes: Uint8Array): Promise<string>;
  workingTree(workspaceId: WorkspaceId, paths?: readonly string[]): Promise<GitTree>;
  stageEntries(
    workspaceId: WorkspaceId,
    paths: readonly string[],
  ): Promise<Record<string, GitEntry | null>>;
  applyWorktree(
    workspaceId: WorkspaceId,
    changes: readonly FileChange[],
    move?: { from: string; to: string },
  ): Promise<void>;
  status(workspaceId: WorkspaceId, working?: readonly ProjectFile[]): Promise<GitStatus>;
  uncommittedPaths(
    workspaceId: WorkspaceId,
    head: string | null,
    indexSnapshot: string,
    workingSnapshot: string,
    paths: readonly string[],
  ): Promise<string[]>;
  index(workspaceId: WorkspaceId): Promise<GitTree>;
  setIndex(workspaceId: WorkspaceId, entries: Record<string, GitEntry | null>): Promise<void>;
  checkpoint(
    workspaceId: WorkspaceId,
    files: GitTree,
    key: string,
    parent: string | null,
  ): Promise<string>;
  checkpointRef(workspaceId: WorkspaceId, key: string): Promise<string | undefined>;
  commitSnapshot(
    workspaceId: WorkspaceId,
    snapshot: string,
    message: string,
    expectedHead: string | null,
  ): Promise<string>;
}
