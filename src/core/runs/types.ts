import type { ModelRunSnapshot } from '@/core/models/types';
import type { TraceItem } from '@/core/trace';
import type { AgentSettings } from '../agent/settings';
import type { McpServerSnapshot } from '../mcp/types';
import type { SkillSummary } from '../skills/types';

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
