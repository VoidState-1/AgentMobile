import type { WorkspaceId, WorkspacePath } from '../workspace/contracts';
import type { Version } from '@/core/git/types';

export type CommitOid = string;
export interface GitFileStatus { path: string; headRevision: string | null; indexRevision: string | null; workingRevision: string | null;
  staged?: 'added' | 'modified' | 'deleted'; unstaged?: 'added' | 'modified' | 'deleted' }
export interface GitStatus { head: string; indexRevision: string; workingRevision: string; files: GitFileStatus[] }
export interface GitBaseline { head: string; working: string; index: string }

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
  blob(workspaceId: WorkspaceId, oid: string): Promise<Uint8Array>;
  index(workspaceId: WorkspaceId): Promise<Record<string, string>>;
  setIndex(workspaceId: WorkspaceId, entries: Record<string, string | null>): Promise<void>;
  checkpoint(workspaceId: WorkspaceId, files: Record<string, Uint8Array>, key: string, parent: string): Promise<string>;
  checkpointRef(workspaceId: WorkspaceId, key: string): Promise<string | undefined>;
  commitSnapshot(workspaceId: WorkspaceId, snapshot: string, message: string, expectedHead: string): Promise<string>;
}
