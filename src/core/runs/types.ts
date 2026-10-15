import type { ModelRunSnapshot } from '@/core/models/types';
import type { TraceItem } from '@/core/trace';
import type { AgentSettings } from '../agent/settings';
import type { McpServerSnapshot } from '../mcp/types';
import type { SkillSummary } from '../skills/types';
import type { StopReason } from './termination';

export type RunState = 'queued' | 'running' | 'waiting_children' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

/** In-memory execution view. Persistence and queries use independent records. */
export interface ExecutionView {
  id: string;
  projectId: string;
  conversationId?: string;
  draftRevision?: number;
  prompt: string;
  mode: 'demo' | 'remote';
  modelSnapshot?: ModelRunSnapshot;
  agentSettingsSnapshot?: AgentSettings;
  mcpSnapshot?: readonly McpServerSnapshot[];
  skillsSnapshot?: readonly SkillSummary[];
  skillActivations?: { name: string; revision: string; source: 'explicit' | 'agent'; at: string }[];
  state: RunState;
  baseCommit?: string;
  finalCommit?: string;
  baseSnapshot?: string;
  finalSnapshot?: string;
  baseIndexSnapshot?: string;
  finalIndexSnapshot?: string;
  changedPaths?: string[];
  uncommittedPaths?: string[];
  response: string;
  trace?: TraceItem[];
  error?: string;
  stopReason?: StopReason;
  createdAt: string;
  /** Public child views; persisted separately, never part of parent transcript. */
  children?: ExecutionView[];
  kind?: 'root' | 'child';
  proposalId?: string;
}
