import type { WorkspaceId, WorkspacePath } from '../workspace/contracts';
import type { Version } from '../prototype/types';

export type CommitOid = string;

export interface GitChange {
  path: WorkspacePath;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  previousPath?: WorkspacePath;
}

/** Version operations are mediated by the host; never exposed as raw model tools. */
export interface GitPort {
  /** Internal logical directory, not a device absolute path. */
  dir(workspaceId: WorkspaceId): string;
  init(workspaceId: WorkspaceId): Promise<void>;
  head(workspaceId: WorkspaceId): Promise<CommitOid>;
  revision(bytes: Uint8Array): Promise<string>;
  commit(workspaceId: WorkspaceId, paths: WorkspacePath[], message: string): Promise<CommitOid>;
  log(workspaceId: WorkspaceId): Promise<Version[]>;
  findOperation(workspaceId: WorkspaceId, operationId: string): Promise<CommitOid | undefined>;
  tree(workspaceId: WorkspaceId, ref: CommitOid): Promise<Record<WorkspacePath, Uint8Array>>;
  entries(workspaceId: WorkspaceId, ref: CommitOid): Promise<{ path: WorkspacePath; revision: string }[]>;
  readAt(workspaceId: WorkspaceId, ref: CommitOid, path: WorkspacePath): Promise<Uint8Array>;
}
