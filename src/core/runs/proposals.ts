import type { RunState } from './types';

export type ProposalState =
  'draft' | 'ready' | 'conflicted' | 'applying' | 'applied' | 'cancelled' | 'interrupted';
export interface ChangeProposal {
  schemaVersion: 1;
  id: string;
  projectId: string;
  rootRunId: string;
  sourceRunId: string;
  baseSnapshot: string;
  candidateSnapshot: string;
  allowedPaths: string[];
  changedPaths: string[];
  state: ProposalState;
  sourceState: RunState;
  conflicts?: string[];
  operationId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProposalWrite {
  id: string;
  proposalId: string;
  projectId: string;
  rootRunId: string;
  sourceRunId: string;
  fingerprint: string;
  checkpointKey: string;
  previousSnapshot: string;
  candidateSnapshot?: string;
  phase: 'prepared' | 'recorded' | 'cancelled';
  sequence: number;
}
export interface CandidateMergeInput {
  rootRunId: string;
  actorRunId: string;
  proposalId: string;
  operationId: string;
  baseSnapshot: string;
  candidateSnapshot: string;
  paths: readonly string[];
}
export interface CandidateMergeResult {
  conflicts: string[];
  changedPaths: string[];
  checkpoint?: string;
}
