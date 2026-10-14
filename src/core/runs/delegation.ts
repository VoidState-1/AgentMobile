import type { RunState } from './types';

export interface SpawnRequest {
  role: 'reader' | 'reviewer' | 'writer';
  prompt: string;
  paths: string[];
  budget: { requests: number; tools: number };
}
export interface ChildResult {
  runId: string;
  state: RunState;
  inputSnapshotRef?: string;
  response: string;
  references: { path: string; revision: string }[];
  warnings: string[];
  proposal?: { id: string; state: string; paths: string[]; conflicts?: string[] };
}
