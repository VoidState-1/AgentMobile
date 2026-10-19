import type { GitEntry } from '../git/objects';
export type FileKind = 'text' | 'image' | 'binary';

export interface ContentPreview {
  kind: FileKind;
  mimeType: string;
  content: string;
  unavailableReason?: string;
}

export interface ProjectFile {
  path: string;
  revision: string;
  size: number;
  mimeType: string;
  kind: FileKind;
  mode?: number;
}

export interface FileChange {
  path: string;
  before: GitEntry | null;
  after: GitEntry | null;
}

export interface WorkspaceChange {
  projectId: string;
  paths: readonly string[];
  commit: string | null;
}
