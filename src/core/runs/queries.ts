import type { RunState } from './types';
import type { PublicError, StopReason } from './termination';
import type { TraceItem } from '../trace';

export interface RunDetail {
  id: string; projectId: string; conversationId: string; kind: 'root' | 'child'; state: RunState; mode: 'demo' | 'remote';
  prompt: string; response: string; createdAt: string; modelName?: string; connectionName?: string;
  error?: PublicError; stopReason?: StopReason; proposalId?: string;
  baseCommit?: string; finalCommit?: string; baseSnapshot?: string; finalSnapshot?: string; baseIndexSnapshot?: string; finalIndexSnapshot?: string;
  changedPaths?: string[]; uncommittedPaths?: string[];
}
/** Live view and visible trace; never persisted as a parent tree. */
export type DisplayTrace = TraceItem & { textCharacters?: number };
export interface RunView extends RunDetail { trace?: DisplayTrace[]; traceCursor?: string; children?: RunView[] }
export interface RunListQuery { projectId: string; conversationId?: string; cursor?: string; limit?: number }
export interface RunChange { runId: string; projectId: string; conversationId: string; rootRunId: string; state: RunState }

export interface RunSummary {
  id: string; projectId: string; conversationId: string; rootRunId: string; parentRunId?: string;
  kind: 'root' | 'child'; state: RunState; mode: 'demo' | 'remote'; admissionSequence: number; revision: number;
  promptPreview: string; responsePreview: string; promptCharacters: number; responseCharacters: number;
  modelName?: string; connectionName?: string; childCount: number; changedFileCount: number; createdAt: string; error?: PublicError;
  proposalId?: string;
}
export interface RunHeaderQuery {
  projectId?: string;
  conversationId?: string;
  rootRunId?: string;
  kind?: 'root' | 'child';
  active?: boolean;
  mode?: 'demo' | 'remote';
  highWater?: number;
  beforeSequence?: number;
  limit: number;
}
export const runQueryLimits = { page: 30, maxPage: 100, promptPreview: 300, responsePreview: 1200 } as const;
export interface RunPage { runs: RunSummary[]; cursor?: string }
