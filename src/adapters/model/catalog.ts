import { AppError } from '@/core/errors';
import type { DiscoveredModel, ProviderConnection } from '@/core/models/types';
import { validateConnectionEntity } from '@/core/models/rules';
import { modelEndpoint, modelHeaders, requestJson, withRequest } from './http';

export async function discoverModels(connection: ProviderConnection, secret: string, signal?: AbortSignal, web = false): Promise<DiscoveredModel[]> {
  validateConnectionEntity(connection);
  return withRequest(signal, async (requestSignal) => {
    const headers = modelHeaders(connection, secret, web); const result = new Map<string, DiscoveredModel>();
    const seen = new Set<string>(); let cursor = '';
    for (let page = 0; page < 20; page++) {
      const query = connection.protocol === 'gemini' ? 'pageSize=1000' + (cursor ? '&pageToken=' + encodeURIComponent(cursor) : '') :
        connection.protocol === 'anthropic-messages' ? 'limit=1000' + (cursor ? '&after_id=' + encodeURIComponent(cursor) : '') : '';
      const body = await requestJson(modelEndpoint(connection, 'models' + (query ? '?' + query : '')), headers, requestSignal);
      const entries = connection.protocol === 'gemini' ? body.models : body.data;
      if (!Array.isArray(entries)) throw new AppError('REMOTE', '服务目录与所选协议不匹配；仍可手工添加模型。');
      for (const item of entries) {
        const id = connection.protocol === 'gemini' ? item.name : item.id;
        if (typeof id !== 'string' || !id || id.length > 180) continue;
        if (connection.protocol === 'gemini' && !item.supportedGenerationMethods?.includes('generateContent')) continue;
        const model: DiscoveredModel = { apiId: id, name: item.display_name ?? item.displayName ?? id };
        if (connection.protocol === 'anthropic-messages') {
          model.limits = { contextTokens: item.max_input_tokens, outputTokens: item.max_tokens, maxTemperature: 1 };
          if (typeof item.capabilities?.image_input?.supported === 'boolean') model.capabilities = { images: item.capabilities.image_input.supported ? 'supported' : 'unsupported' };
          if (typeof item.capabilities?.thinking?.supported === 'boolean') model.capabilities = { ...model.capabilities, reasoning: item.capabilities.thinking.supported ? 'supported' : 'unsupported' };
        } else if (connection.protocol === 'gemini') {
          model.limits = { contextTokens: item.inputTokenLimit, outputTokens: item.outputTokenLimit, maxTemperature: item.maxTemperature };
          if (typeof item.thinking === 'boolean') model.capabilities = { reasoning: item.thinking ? 'supported' : 'unsupported' };
        }
        result.set(id, model);
        if (result.size > 5000) throw new AppError('REMOTE', '模型目录超过 5,000 条限制。');
      }
      const next = connection.protocol === 'gemini' ? body.nextPageToken : connection.protocol === 'anthropic-messages' && body.has_more ? body.last_id : '';
      if (!next) return [...result.values()];
      if (typeof next !== 'string' || seen.has(next)) throw new AppError('REMOTE', '服务目录分页游标无效。');
      seen.add(next); cursor = next;
    }
    throw new AppError('REMOTE', '目录分页超过限制，请手工添加所需模型。');
  }, 20_000);
}
