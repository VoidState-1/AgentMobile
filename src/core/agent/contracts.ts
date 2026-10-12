import type { CommitOid } from '../git/contracts';
import type { WorkspaceAccess, WorkspaceId } from '../workspace/contracts';

export type RunState =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'paused'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentRun {
  id: string;
  workspaceId: WorkspaceId;
  state: RunState;
  access: WorkspaceAccess;
  baseCommit: CommitOid;
  checkpointCommit?: CommitOid;
  createdAt: string;
  updatedAt: string;
}

export interface RunLimits {
  maxModelRounds: number;
  maxToolCalls: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  maxRuntimeMs: number;
}

export interface ToolExecution {
  operationId: string;
  runId: string;
  modelCallId: string;
  toolName: string;
  state: 'prepared' | 'applied' | 'recorded' | 'failed' | 'unknown';
}
