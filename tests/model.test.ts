import { contentCodec } from '../src/adapters/storage/codec';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContext } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { protocolTransport, protocolModel } from '../src/adapters/model/protocols';
import { runDiagnostic } from '../src/adapters/model/diagnostics';
import { ModelConfigurationService } from '../src/application/models/configuration';
import { chatSnapshot } from './protocol-fixtures';
import { testStorage } from './storage';

afterEach(() => vi.unstubAllGlobals());
const context = () =>
  normalizeContext({ messages: [{ role: 'user', content: '你好', timestamp: Date.now() }] });
const deepseek = chatSnapshot({
  baseUrl: 'https://api.deepseek.com',
  apiModelId: 'deepseek-flash',
  compatibility: 'deepseek',
});

describe('真实服务兼容与连接诊断', () => {
  it('DeepSeek 明确关闭思考，完成帧之后仍读取用量帧', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":20,"total_tokens":140,"prompt_cache_hit_tokens":80}}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const stream = await protocolTransport(deepseek, 'test-only')(
      protocolModel(deepseek),
      context(),
    );
    const final = await stream.result();
    expect(final.stopReason).toBe('stop');
    expect(final.usage).toMatchObject({ input: 40, output: 20, totalTokens: 140, cacheRead: 80 });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('服务报错只展示宿主诊断，不把原始响应或密钥写入会话', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('provider echoed secret-test-value', { status: 401 }),
    );
    const stream = await protocolTransport(deepseek, 'secret-test-value')(
      protocolModel(deepseek),
      context(),
    );
    const final = await stream.result();
    expect(final.stopReason).toBe('error');
    expect(final.errorMessage).toContain('HTTP 401');
    expect(JSON.stringify(final)).not.toContain('secret-test-value');
    expect(final.errorMessage).toContain('更新密钥');
  });

  it('仅收到 DONE、拒绝或缺失工具内容的完成标记不会误报任务成功', async () => {
    for (const data of [
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    ]) {
      vi.stubGlobal(
        'fetch',
        async () => new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }),
      );
      const stream = await protocolTransport(deepseek, 'test-only')(
        protocolModel(deepseek),
        context(),
      );
      const final = await stream.result();
      expect(final.stopReason).toBe('error');
    }
  });

  it('目录检测不生成付费内容，目录移除模型后保留选择并标记缺失', async () => {
    const storage = await testStorage();
    try {
      const models = new ModelConfigurationService(
        storage.metadata,
        { get: async () => 'test-only', set: async () => {} },
        randomUUID,
        contentCodec,
      );
      await models.initialize();
      const connection = await models.saveConnection(
        {
          name: 'DeepSeek',
          baseUrl: deepseek.baseUrl,
          protocol: 'chat-completions',
          presetId: 'deepseek',
          compatibility: 'deepseek',
          apiVersion: '',
          auth: 'key',
          enabled: true,
        },
        { value: 'test-only' },
      );
      const requests: { url: unknown; init: RequestInit }[] = [];
      vi.stubGlobal('fetch', async (url: unknown, init: RequestInit) => {
        requests.push({ url, init });
        return Response.json({ data: [{ id: 'deepseek-flash' }] });
      });
      expect(
        await runDiagnostic(models, connection.id, undefined, 'connection', 'web'),
      ).toMatchObject({ status: 'passed', requests: 1, totalTokens: 0 });
      expect(requests[0].url).toBe('https://api.deepseek.com/models');
      expect(requests[0].init.body).toBeUndefined();
      expect(new Headers(requests[0].init.headers).get('authorization')).toBe('Bearer test-only');
      const model = models.getSnapshot().models[0];
      expect(model.apiId).toBe('deepseek-flash');
      await models.setSelection('global', model.id);
      vi.stubGlobal('fetch', async () => Response.json({ data: [] }));
      await runDiagnostic(models, connection.id, undefined, 'connection', 'web');
      expect(models.getSnapshot().defaults.global).toBe(model.id);
      expect(models.getSnapshot().models[0].catalog.missing).toBe(true);
    } finally {
      await storage.cleanup();
    }
  });

  it('余额不足给出可以采取操作的提示', async () => {
    vi.stubGlobal('fetch', async () => new Response('private provider payload', { status: 402 }));
    const stream = await protocolTransport(deepseek, 'test-only')(
      protocolModel(deepseek),
      context(),
    );
    const final = await stream.result();
    expect(final.errorMessage).toContain('余额不足');
    expect(final.errorMessage).not.toContain('private');
  });
});
