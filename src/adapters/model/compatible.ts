import type { ModelSettings } from '@/core/prototype/types';
import type { ModelRunSnapshot } from '@/core/models/types';
import { isDeepseek, validateConnection } from './settings';
import { protocolModel, protocolTransport } from './protocols';
import { defaultAgentLimits, defaultOutputTokens } from '@/core/agent/settings';

/** Legacy API kept for integration callers. New runs use frozen snapshots. */
function legacySnapshot(settings: ModelSettings): ModelRunSnapshot {
  return { connectionId: 'legacy-connection', connectionName: '原有连接', connectionRevision: 1,
    modelEntryId: 'legacy-model', modelName: settings.model, modelRevision: 1, apiModelId: settings.model,
    protocol: 'chat-completions', baseUrl: settings.baseUrl, compatibility: isDeepseek(settings) ? 'deepseek' : 'standard',
    apiVersion: '', auth: 'key', parameters: { maxOutputTokens: defaultOutputTokens, allowImages: settings.imageInput, reasoning: 'off' }, contextTokens: 32000 };
}
export const modelFor = (settings: ModelSettings) => protocolModel(legacySnapshot(settings));
export function compatibleTransport(settings: ModelSettings, secret: string, timeoutMs = defaultAgentLimits.requestTimeoutMs) {
  validateConnection(settings, secret); return protocolTransport(legacySnapshot(settings), secret, false, timeoutMs);
}
