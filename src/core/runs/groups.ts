import type { AgentLimits } from '../agent/settings';

export interface RunGroupRecord {
  schemaVersion: 1;
  rootRunId: string;
  limits: AgentLimits;
  deadlineAt: string;
  requests: number;
  tools: number;
  byRun: Record<string, { requests: number; tools: number }>;
  allocations?: Record<string, { requests: number; tools: number }>;
}
