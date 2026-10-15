import { modelHttpError } from '@/core/models/http-status';
import { AppError } from '@/core/errors';
import { fetch } from 'expo/fetch';
import type { ModelRunSnapshot, ProviderConnection } from '@/core/models/types';
import { normalizedServiceAddress } from '@/core/models/rules';
import { SseDecoder } from './sse';
import { contentLimits, defaultAgentLimits } from '@/core/agent/settings';

import { geminiResource } from '@/core/models/model-id';
export { geminiResource };
export function safeModelError(error: unknown, aborted = false): string {
  if (aborted) return '请求已取消';
  if (error instanceof AppError) return error.message;
  if (error instanceof SyntaxError) return '服务返回了无效 JSON，请检查协议兼容性。';
  return '网络请求失败，请检查服务地址、网络或浏览器跨域设置。';
}
export function modelEndpoint(
  config: Pick<ModelRunSnapshot, 'baseUrl' | 'protocol'>,
  suffix: string,
): string {
  return normalizedServiceAddress(config.baseUrl) + '/' + suffix;
}

export function modelHeaders(
  config: Pick<ProviderConnection, 'protocol' | 'auth' | 'apiVersion'>,
  secret: string,
  web = false,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.auth === 'none') return headers;
  if (!secret.trim()) throw new AppError('VALIDATION', '此连接尚未填写 API Key。');
  if (config.protocol === 'anthropic-messages') {
    headers['x-api-key'] = secret.trim();
    headers['anthropic-version'] = config.apiVersion;
    if (web) headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (config.protocol === 'gemini') headers['x-goog-api-key'] = secret.trim();
  else headers.Authorization = 'Bearer ' + secret.trim();
  return headers;
}
export async function withRequest<T>(
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 60_000,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (timedOut) throw new AppError('REMOTE', '请求超时，请检查网络和服务状态。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function requestJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  return withRequest(signal, async requestSignal => {
    const response = await fetch(url, { headers, signal: requestSignal });
    if (!response.ok) throw modelHttpError(response.status);
    if (!response.body) throw new AppError('REMOTE', '服务返回了空目录。');
    const reader = response.body.getReader();
    let text = '';
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2 * 1024 * 1024) throw new AppError('REMOTE', '模型目录超过读取限制。');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      try {
        return JSON.parse(text);
      } catch {
        throw new AppError('REMOTE', '模型目录格式与所选协议不匹配。');
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  });
}
export async function requestStream(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  receive: (data: string) => boolean,
  timeoutMs = defaultAgentLimits.requestTimeoutMs,
): Promise<void> {
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > contentLimits.requestBytes)
    throw new AppError('LIMIT', '本次输入超过 8 MB，请分段处理资料。');
  await withRequest(
    signal,
    async requestSignal => {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: serialized,
        signal: requestSignal,
      });
      if (!response.ok) throw modelHttpError(response.status);
      if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
        throw new AppError('REMOTE', '服务未返回 SSE 流，请确认所选协议。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sse = new SseDecoder();
      let size = 0;
      const cancelReader = () => {
        void reader.cancel().catch(() => {});
      };
      requestSignal.addEventListener('abort', cancelReader, { once: true });
      try {
        while (true) {
          if (requestSignal.aborted) throw new AppError('REMOTE', '请求已取消或超时。');
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > contentLimits.responseBytes)
            throw new AppError('REMOTE', '模型响应超过 4 MB 限制，请分段处理。');
          for (const data of sse.push(decoder.decode(chunk.value, { stream: true })))
            if (receive(data)) return;
        }
        for (const data of sse.push(decoder.decode())) if (receive(data)) return;
        if (requestSignal.aborted) throw new AppError('REMOTE', '请求已取消或超时。');
      } finally {
        requestSignal.removeEventListener('abort', cancelReader);
        await reader.cancel().catch(() => {});
      }
    },
    timeoutMs,
  );
}
