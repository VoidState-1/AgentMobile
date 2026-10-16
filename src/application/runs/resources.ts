import type { AgentEnginePort } from '@/core/agent/engine';
import type { AgentSettings } from '@/core/agent/settings';
import type { RunLaunch, RunResources } from './controller';

export interface RunRequest {
  projectId: string;
  conversationId: string;
  prompt: string;
  imageAttached: boolean;
  settings: AgentSettings;
}
/** No credential fields: the adapter closes over secrets and exposes one cleanup. */
export interface PreparedRun {
  launch: Pick<RunLaunch, 'imageInput' | 'modelSnapshot' | 'contextTokens' | 'outputTokens'>;
  engine: AgentEnginePort;
  resources: Omit<RunResources, 'execution'>;
  release(): Promise<void>;
  createChild?(
    prompt: string,
  ): Promise<{ engine: AgentEnginePort; resources: Omit<RunResources, 'execution' | 'mcp'> }>;
}
export interface RunResourceFactory {
  prepare(request: RunRequest): Promise<PreparedRun>;
}
