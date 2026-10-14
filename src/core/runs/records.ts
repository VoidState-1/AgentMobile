import type { TaskRecord } from './types';
import type { AgentDefinition } from '../agents/types';
import type { AgentSettings } from '../agent/settings';
import type { ModelRunSnapshot } from '../models/types';
import type { McpServerSnapshot } from '../mcp/types';
import type { SkillSummary } from '../skills/types';

export type RunState = 'queued' | 'running' | 'waiting_children' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface RunRecord extends Omit<TaskRecord, 'state' | 'baseCommit' | 'trace'> {
  schemaVersion: 2;
  rootRunId: string;
  parentRunId?: string;
  kind: 'root' | 'child';
  agentDefinitionId: string;
  agentDefinitionRevision: number;
  depth: number;
  state: RunState;
  launchSnapshotRef: string;
  inputSnapshotRef?: string;
  baseCommit?: string;
  deadlineAt?: string;
}
export interface LaunchSnapshot {
  id: string;
  legacy?: boolean;
  agent?: AgentDefinition;
  settings?: AgentSettings;
  model?: ModelRunSnapshot;
  mcp?: readonly McpServerSnapshot[];
  skills?: readonly SkillSummary[];
  selectedPaths?: readonly string[];
}
export interface DelegationReceipt { id: string; parentRunId: string; childRunId: string; fingerprint: string }
export const terminalRun = (state: RunState): boolean => ['completed', 'failed', 'cancelled', 'interrupted'].includes(state);
