import type { ModelConfiguration, ModelEntry, ModelRunSnapshot, ProviderConnection } from './types';

export function normalizedServiceAddress(value: string): string {
  let address: URL;
  try { address = new URL(value.trim()); } catch { throw new Error('请输入有效的服务基础地址。'); }
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname))) {
    throw new Error('服务地址需要 HTTPS；本机开发地址可使用 HTTP。');
  }
  if (address.username || address.password || address.search || address.hash) throw new Error('服务地址不能包含凭证、查询参数或片段。');
  return address.href.replace(/\/+$/, '');
}
export function serviceOrigin(value: string): string { return new URL(normalizedServiceAddress(value)).origin; }
export function validateConnectionEntity(value: ProviderConnection): void {
  if (!value.name.trim() || value.name.trim().length > 80) throw new Error('连接名称需要 1–80 个字符。');
  normalizedServiceAddress(value.baseUrl);
  if (!['chat-completions', 'anthropic-messages', 'gemini'].includes(value.protocol)) throw new Error('当前版本不支持此协议。');
  if (value.auth === 'none' && value.protocol !== 'chat-completions') throw new Error('此原生协议需要 API Key。');
  if (value.protocol === 'anthropic-messages' && !/^\d{4}-\d{2}-\d{2}$/.test(value.apiVersion)) throw new Error('Anthropic API 版本请使用 YYYY-MM-DD 格式。');
  if (value.compatibility === 'deepseek' && value.protocol !== 'chat-completions') throw new Error('DeepSeek 兼容特性适用于 Chat Completions。');
}
export function validateModelEntity(model: ModelEntry): void {
  if (!model.name.trim() || model.name.trim().length > 100) throw new Error('模型显示名称需要 1–100 个字符。');
  if (!model.apiId.trim() || model.apiId.trim().length > 180 || /[\s?#\\\u0000-\u001f]/.test(model.apiId)) throw new Error('请输入有效的请求模型 ID。');
  const p = model.parameters;
  if (!Number.isInteger(p.maxOutputTokens) || p.maxOutputTokens < 16 || p.maxOutputTokens > 16384) throw new Error('输出上限应为 16–16,384 tokens。');
  if (model.limits?.outputTokens && p.maxOutputTokens > model.limits.outputTokens) throw new Error('输出上限超过模型公布的限制。');
  if (p.temperature !== undefined && (!Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > (model.limits?.maxTemperature ?? 2))) throw new Error('温度超出此模型支持的范围。');
  if (!['off', 'provider-default'].includes(p.reasoning)) throw new Error('此版本尚未开放思考模式的参数控制。');
  if (p.allowImages && model.capabilities.images.support === 'unsupported') throw new Error('此模型明确不支持图片，请关闭图片输入。');
}
export function selectedModelId(state: ModelConfiguration, projectId?: string, sessionId?: string): string | undefined {
  return (sessionId && state.defaults.sessions[sessionId]) || (projectId && state.defaults.projects[projectId]) || state.defaults.global;
}
export function mainSessionId(projectId: string): string { return projectId + ':main'; }
export function selectedModelMode(state: ModelConfiguration, sessionId?: string): ModelConfiguration['mode'] {
  return (sessionId && state.sessionModes?.[sessionId]) || state.mode;
}
export function configurationFingerprint(connection: ProviderConnection, model?: ModelEntry): string {
  return JSON.stringify([connection.protocol, connection.baseUrl, connection.auth, connection.credentialRef ?? '',
    connection.compatibility, connection.apiVersion, model?.apiId, model?.parameters]);
}
export function runSnapshot(connection: ProviderConnection, model: ModelEntry): ModelRunSnapshot {
  return { connectionId: connection.id, connectionName: connection.name, connectionRevision: connection.revision,
    modelEntryId: model.id, modelName: model.name, modelRevision: model.revision, apiModelId: model.apiId,
    protocol: connection.protocol, baseUrl: connection.baseUrl, compatibility: connection.compatibility,
    apiVersion: connection.apiVersion, auth: connection.auth, parameters: { ...model.parameters, reasoning: connection.compatibility === 'deepseek' ? 'off' : 'provider-default' },
    contextTokens: model.limits?.contextTokens ?? 32000 };
}
