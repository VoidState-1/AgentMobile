import type { ModelSettings } from '@/core/legacy/model-settings';
import type { TaskRecord } from '@/core/runs/types';
import type { ModelRunSnapshot } from '@/core/models/types';
import { mainSessionId } from '@/core/models/rules';
import { defaultAgentSettings, type AgentSettings } from '@/core/agent/settings';
import type { McpRunPort } from '@/core/mcp/run';
import type { SkillRunPort } from '@/core/skills/run';
import type { WorkspaceApplication } from '@/application/workspace/service';
import { startRun } from '@/application/runs/controller';
import { contentCodec } from '@/adapters/storage/codec';
import { compatibleTransport, modelFor } from '@/adapters/model/compatible';
import { protocolModel, protocolTransport } from '@/adapters/model/protocols';
import { demoTransport } from './demo';
import { PiEngineAdapter } from './pi/engine';

/** Host binding adapter. Legacy callers are normalized before application execution. */
export async function startAgent(
  workspace: WorkspaceApplication, projectId: string, prompt: string, settings: ModelSettings, apiKey: string,
  id: () => string, update: (task: TaskRecord) => void, snapshot?: ModelRunSnapshot, web = false,
  conversationId = mainSessionId(projectId), draftRevision?: number, configuredAgentSettings: AgentSettings = defaultAgentSettings(),
  mcpRun?: McpRunPort, skillRun?: SkillRunPort,
) {
  const transport = settings.mode === 'demo' ? demoTransport(prompt) : snapshot ? {
    model: protocolModel(snapshot), streamFn: protocolTransport(snapshot, apiKey, web, configuredAgentSettings.limits.requestTimeoutMs),
  } : { model: modelFor(settings), streamFn: compatibleTransport(settings, apiKey, configuredAgentSettings.limits.requestTimeoutMs) };
  return startRun(workspace, { runId: id(), projectId, conversationId, prompt, mode: settings.mode, imageInput: settings.imageInput, draftRevision,
    modelSnapshot: snapshot, agentSettings: configuredAgentSettings, contextTokens: transport.model.contextWindow, outputTokens: transport.model.maxTokens },
  new PiEngineAdapter(transport, snapshot?.parameters.reasoningDisplay ?? (snapshot && snapshot.protocol !== 'chat-completions' ? 'summary' : 'reasoning')),
  { codec: contentCodec, mcp: mcpRun, skills: skillRun }, update);
}
