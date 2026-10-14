import type { ModelRunSnapshot } from '@/core/models/types';
import type { TraceItem } from './trace';
import type { AgentSettings } from '../agent/settings';
import type { McpServerSnapshot } from '../mcp/types';
import type { SkillSummary } from '../skills/types';

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
  parentOid?: string;
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

export interface TaskRecord {
  id: string;
  projectId: string;
  conversationId?: string;
  draftRevision?: number;
  prompt: string;
  mode: 'demo' | 'remote';
  modelSnapshot?: ModelRunSnapshot;
  agentSettingsSnapshot?: AgentSettings;
  mcpSnapshot?: McpServerSnapshot[];
  skillsSnapshot?: readonly SkillSummary[];
  skillActivations?: { name: string; revision: string; source: 'explicit' | 'agent'; at: string }[];
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  baseCommit: string;
  finalCommit?: string;
  baseSnapshot?: string;
  finalSnapshot?: string;
  baseIndexSnapshot?: string;
  finalIndexSnapshot?: string;
  changedPaths?: string[];
  uncommittedPaths?: string[];
  response: string;
  /** Absent on legacy tasks, whose original ordering cannot be reconstructed. */
  trace?: TraceItem[];
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
