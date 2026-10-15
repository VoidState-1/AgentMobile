export interface FileDescriptor {
  path: string;
  revision: string;
  size?: number;
  mimeType?: string;
}
export interface FileListQuery {
  cursor?: string;
  limit?: number;
}
export interface FilePage {
  files: FileDescriptor[];
  cursor?: string;
  source: string;
}
export interface FileContent {
  path: string;
  revision: string;
  bytes: Uint8Array;
  source: string;
}
export interface ScopedFileReader {
  list(query?: FileListQuery, signal?: AbortSignal): Promise<FilePage>;
  read(path: string, signal?: AbortSignal): Promise<FileContent>;
}
export interface FileManifest {
  version: string;
  files: readonly FileDescriptor[];
}
export const fileQueryLimits = { page: 200, maxPage: 500, matches: 100 } as const;
