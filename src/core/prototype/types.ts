import type { ModelRunSnapshot } from '@/core/models/types';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  path: string;
  revision: string;
  size: number;
  mimeType: string;
}

export interface Version {
  oid: string;
  message: string;
  timestamp: number;
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
  expectedHead: string;
  message: string;
  changes: FileChange[];
  phase: 'prepared' | 'applied' | 'committed' | 'recorded';
  commit?: string;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  conversationId?: string;
  draftRevision?: number;
  prompt: string;
  mode: 'demo' | 'remote';
  modelSnapshot?: ModelRunSnapshot;
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  baseCommit: string;
  finalCommit?: string;
  response: string;
  events: { tool: string; state: 'started' | 'done' | 'error'; description: string }[];
  error?: string;
  createdAt: string;
}

export interface ModelSettings {
  mode: 'demo' | 'remote';
  baseUrl: string;
  model: string;
  imageInput: boolean;
}

export const defaultSettings: ModelSettings = {
  mode: 'demo',
  baseUrl: '',
  model: '',
  imageInput: false,
};
