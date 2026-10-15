export interface ProjectFile {
  path: string;
  revision: string;
  size: number;
  mimeType: string;
}

export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface WorkspaceChange { projectId: string; paths: readonly string[]; commit: string }
