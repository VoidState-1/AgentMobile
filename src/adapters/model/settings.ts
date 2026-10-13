import { fetch } from 'expo/fetch';
import type { ModelSettings } from '@/core/prototype/types';

export const deepseekSettings: ModelSettings = {
  mode: 'remote', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', imageInput: true,
};

export function modelAddress(settings: ModelSettings): URL {
  let address: URL;
  try { address = new URL(settings.baseUrl.trim()); } catch { throw new Error('请输入有效的模型服务地址。'); }
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(address.hostname))) {
    throw new Error('模型服务地址需要 HTTPS（本地开发地址除外）。');
  }
  if (address.username || address.password || address.search || address.hash) throw new Error('基础地址不能包含凭证、查询参数或片段。');
  return address;
}

export function isDeepseek(settings: ModelSettings): boolean {
  try { return modelAddress(settings).hostname === 'api.deepseek.com'; } catch { return false; }
}

export function validateConnection(settings: ModelSettings, key: string): void {
  modelAddress(settings);
  if (!settings.model.trim() || !key.trim()) throw new Error('请填写模型名称和 API Key。');
}

/** Only host-authored messages cross into task logs; never echo provider bodies. */
export class ModelServiceError extends Error {
  constructor(status: number) {
    const messages: Record<number, string> = {
      400: '模型服务拒绝了请求（HTTP 400），请检查模型名称、图片输入和工具调用支持。',
      401: 'API Key 无效或已过期（HTTP 401），请在设置中更新密钥。',
      402: '模型账户余额不足（HTTP 402），请充值后重试。',
      403: '当前密钥没有访问此模型的权限（HTTP 403）。',
      404: '服务地址或模型不存在（HTTP 404），请检查设置。',
      429: '模型请求过于频繁（HTTP 429），请稍后重试。',
    };
    super(messages[status] ?? (status >= 500 ? '模型服务暂不可用（HTTP ' + status + '），请稍后重试。' :
      '模型服务返回 HTTP ' + status + '，请检查连接设置。'));
  }
}

export async function testModelConnection(settings: ModelSettings, key: string): Promise<string> {
  validateConnection(settings, key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(modelAddress(settings).href.replace(/\/+$/, '') + '/models', {
      headers: { Authorization: 'Bearer ' + key.trim() }, signal: controller.signal,
    });
    if (!response.ok) throw new ModelServiceError(response.status);
    const payload = await response.json() as { data?: { id?: string }[] };
    if (!Array.isArray(payload.data)) throw new Error('服务未返回兼容的模型列表，请检查基础地址。');
    if (!payload.data.some((model) => model.id === settings.model.trim())) throw new Error('密钥有效，但服务未提供所选模型，请检查模型名称。');
    return '连接已通过，密钥有效且模型可用。此检查不会生成内容。';
  } catch (error) {
    if (error instanceof ModelServiceError) throw error;
    if (controller.signal.aborted) throw new Error('连接检测超时，请检查网络后重试。');
    if (error instanceof Error && /^服务未返回|^密钥有效/.test(error.message)) throw error;
    throw new Error('无法连接模型服务，请检查网络和地址；浏览器还需要服务允许跨域。');
  } finally { clearTimeout(timeout); }
}
