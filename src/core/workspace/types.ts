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

export interface Operation {
  id: string;
  projectId: string;
  runId?: string;
  ownerRootRunId?: string;
  actorRunId?: string;
  proposalId?: string;
  mergedByRunId?: string;
  expectedHead: string;
  message: string;
  changes: FileChange[];
  /** Missing kind denotes the original auto-commit journal, retained for recovery. */
  kind?: 'files' | 'index' | 'commit';
  phase: 'prepared' | 'applied' | 'checkpointed' | 'committed' | 'recorded';
  commit?: string;
  checkpoint?: string;
  indexChanges?: { path: string; before: string | null; after: string | null }[];
  indexBefore?: string;
  indexAfter?: string;
  /** Project queue order; SQLite queries do not guarantee insertion order. */
  sequence?: number;
  createdAt: string;
}


export interface WorkspaceChange { projectId: string; paths: readonly string[]; commit: string }
