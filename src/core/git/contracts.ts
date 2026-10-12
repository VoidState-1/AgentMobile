import type { WorkspaceId, WorkspacePath } from '../workspace/contracts';

export type CommitOid = string;

export interface GitChange {
  path: WorkspacePath;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  previousPath?: WorkspacePath;
}

/** Version operations are mediated by the host; never exposed as raw model tools. */
export interface GitPort {
  initialize(workspaceId: WorkspaceId): Promise<CommitOid>;
  head(workspaceId: WorkspaceId): Promise<CommitOid>;
  status(workspaceId: WorkspaceId): Promise<readonly GitChange[]>;
  commit(
    workspaceId: WorkspaceId,
    input: {
      expectedHead: CommitOid;
      message: string;
      operationId: string;
      paths: readonly WorkspacePath[];
    },
  ): Promise<CommitOid>;
}
