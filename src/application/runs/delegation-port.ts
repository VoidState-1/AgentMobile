import type { ControlledTool } from '@/core/agent/tools';
import type { ChildResult } from '@/core/runs/delegation';
import type { RunToolsContext } from '@/application/tools/context';
import type { RunRecorder } from './recorder';

export interface DelegationPort {
  tools(context: RunToolsContext, recorder: RunRecorder): ControlledTool[];
  needsSummary(): boolean;
  settle(cancel: boolean): Promise<ChildResult[]>;
}
