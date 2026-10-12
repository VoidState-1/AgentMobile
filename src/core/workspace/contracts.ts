export type WorkspaceId = string;
export type FileRevision = string;

/** Paths are relative to the workspace and use forward slashes. */
export type WorkspacePath = string;

export interface WorkspaceEntry {
  path: WorkspacePath;
  kind: 'file' | 'directory';
  mimeType?: string;
  sizeBytes?: number;
  revision?: FileRevision;
}

export interface TextDocument {
  path: WorkspacePath;
  text: string;
  revision: FileRevision;
}

export interface WorkspaceAccess {
  workspaceId: WorkspaceId;
  readableRoots: readonly WorkspacePath[];
  writableRoots: readonly WorkspacePath[];
}

export interface WorkspacePort {
  list(access: WorkspaceAccess, path: WorkspacePath): Promise<readonly WorkspaceEntry[]>;
  readText(access: WorkspaceAccess, path: WorkspacePath): Promise<TextDocument>;
  writeText(
    access: WorkspaceAccess,
    input: {
      path: WorkspacePath;
      text: string;
      /** null means that the path must not exist. */
      expectedRevision: FileRevision | null;
      operationId: string;
    },
  ): Promise<TextDocument>;
}
