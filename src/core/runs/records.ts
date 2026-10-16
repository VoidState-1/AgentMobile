import type { RunState } from './types';
import { AppError } from '../errors';
import type { StopReason, PublicError } from './termination';
import type { AgentDefinition } from '../agent/definitions';
import type { AgentSettings } from '../agent/settings';
import type { ModelRunSnapshot } from '../models/types';
import type { McpServerSnapshot } from '../mcp/types';
import type { SkillSummary } from '../skills/types';

export type { RunState } from './types';
/** Current execution entity; independent of UI views and storage layout. */
export interface RunRecord {
  schemaVersion: 4;
  id: string;
  projectId: string;
  conversationId: string;
  draftRevision?: number;
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
  revision?: number;
  admissionSequence?: number;
  delegationSnapshotRef?: string;
  prompt: string;
  response: string;
  modelSnapshot?: ModelRunSnapshot;
  agentSettingsSnapshot?: AgentSettings;
  mcpSnapshot?: readonly McpServerSnapshot[];
  skillsSnapshot?: readonly SkillSummary[];
  skillActivations?: { name: string; revision: string; source: 'explicit' | 'agent'; at: string }[];
  stopReason?: StopReason;
  error?: string;
  finalCommit?: string;
  baseSnapshot?: string;
  finalSnapshot?: string;
  baseIndexSnapshot?: string;
  finalIndexSnapshot?: string;
  changedPaths?: string[];
  uncommittedPaths?: string[];
  proposalId?: string;
  createdAt: string;
}

/** Only this small, indexed record participates in list and recovery queries. */
export interface RunHeader {
  schemaVersion: 4;
  id: string;
  projectId: string;
  conversationId: string;
  rootRunId: string;
  parentRunId?: string;
  kind: 'root' | 'child';
  depth: number;
  agentDefinitionId: string;
  agentDefinitionRevision: number;
  state: RunState;
  launchSnapshotRef: string;
  inputSnapshotRef?: string;
  draftRevision?: number;
  deadlineAt?: string;
  delegationSnapshotRef?: string;
  proposalId?: string;
  baseCommit?: string;
  finalCommit?: string;
  baseSnapshot?: string;
  finalSnapshot?: string;
  baseIndexSnapshot?: string;
  finalIndexSnapshot?: string;
  changedPaths?: string[];
  uncommittedPaths?: string[];
  stopReason?: StopReason;
  error?: PublicError;
  createdAt: string;
  revision: number;
  admissionSequence: number;
  promptPreview: string;
  responsePreview: string;
  promptCharacters: number;
  responseCharacters: number;
  modelName?: string;
  connectionName?: string;
  childCount: number;
  changedFileCount: number;
}
export interface RunInput {
  prompt: string;
}
export interface RunResult {
  response: string;
  skillActivations?: RunRecord['skillActivations'];
}
export interface RunWrite {
  header: Omit<RunHeader, 'revision' | 'admissionSequence'>;
  expectedRevision: number;
  input?: RunInput;
  result?: RunResult;
}
export function assertRunWrite(previous: RunHeader | undefined, update: RunWrite): void {
  if ((previous?.revision ?? 0) !== update.expectedRevision || (!previous && !update.input))
    throw new AppError('CONFLICT', '运行记录版本已变化或缺少输入。');
  if (
    previous &&
    (terminalRun(previous.state) ||
      previous.projectId !== update.header.projectId ||
      previous.conversationId !== update.header.conversationId ||
      previous.rootRunId !== update.header.rootRunId ||
      previous.parentRunId !== update.header.parentRunId ||
      previous.kind !== update.header.kind ||
      previous.createdAt !== update.header.createdAt ||
      previous.launchSnapshotRef !== update.header.launchSnapshotRef ||
      previous.agentDefinitionId !== update.header.agentDefinitionId ||
      previous.agentDefinitionRevision !== update.header.agentDefinitionRevision ||
      previous.depth !== update.header.depth ||
      (previous.state === 'cancelling' &&
        !['cancelling', 'completed', 'cancelled', 'failed', 'interrupted'].includes(
          update.header.state,
        )) ||
      update.input !== undefined)
  )
    throw new AppError('CONFLICT', '运行归属、冻结输入或终态不能修改。');
}
export interface LaunchSnapshot {
  id: string;
  agent?: AgentDefinition;
  settings?: AgentSettings;
  model?: ModelRunSnapshot;
  mcp?: readonly McpServerSnapshot[];
  skills?: readonly SkillSummary[];
  selectedPaths?: readonly string[];
}
export interface DelegationReceipt {
  id: string;
  parentRunId: string;
  childRunId: string;
  fingerprint: string;
  parentTraceId?: string;
}
export const terminalRun = (state: RunState): boolean =>
  ['completed', 'failed', 'cancelled', 'interrupted'].includes(state);
