import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContext } from '@earendil-works/pi-ai';
import { compatibleTransport, modelFor } from '../src/adapters/model/compatible';
import { deepseekSettings, testModelConnection } from '../src/adapters/model/settings';

afterEach(() => vi.unstubAllGlobals());
const context = () => normalizeContext({ messages: [{ role: 'user', content: '你好', timestamp: Date.now() }] });

describe('真实服务兼容与连接诊断', () => {
  it('DeepSeek 明确关闭思考，完成帧之后仍读取用量帧', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response([
        'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":20,"total_tokens":140,"prompt_cache_hit_tokens":80}}',
        'data: [DONE]', '',
      ].join('\n\n'), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const stream = await compatibleTransport(deepseekSettings, 'test-only')(modelFor(deepseekSettings), context());
    const final = await stream.result();
    expect(final.stopReason).toBe('stop');
    expect(final.usage).toMatchObject({ input: 120, output: 20, totalTokens: 140, cacheRead: 80 });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('服务报错只展示宿主诊断，不把原始响应或密钥写入会话', async () => {
    vi.stubGlobal('fetch', async () => new Response('provider echoed secret-test-value', { status: 401 }));
    const stream = await compatibleTransport(deepseekSettings, 'secret-test-value')(modelFor(deepseekSettings), context());
    const final = await stream.result();
    expect(final.stopReason).toBe('error');
    expect(final.errorMessage).toContain('HTTP 401');
    expect(JSON.stringify(final)).not.toContain('secret-test-value');
    expect(final.errorMessage).toContain('更新密钥');
  });

  it('仅收到 DONE、拒绝或缺失工具内容的完成标记不会误报任务成功', async () => {
    for (const data of ['data: [DONE]\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n']) {
      vi.stubGlobal('fetch', async () => new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }));
      const stream = await compatibleTransport(deepseekSettings, 'test-only')(modelFor(deepseekSettings), context());
      const final = await stream.result();
      expect(final.stopReason).toBe('error');
    }
  });

  it('检测密钥与确切模型，不生成付费内容', async () => {
    const requests: { url: unknown; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: unknown, init: RequestInit) => {
      requests.push({ url, init });
      return Response.json({ data: [{ id: 'deepseek-flash' }] });
    });
    expect(await testModelConnection(deepseekSettings, 'test-only')).toContain('连接已通过');
    expect(requests[0].url).toBe('https://api.deepseek.com/models');
    expect(requests[0].init.body).toBeUndefined();
    await expect(testModelConnection({ ...deepseekSettings, model: 'missing-model' }, 'test-only')).rejects.toThrow('未提供所选模型');
  });

  it('余额不足给出可以采取操作的提示', async () => {
    vi.stubGlobal('fetch', async () => new Response('private provider payload', { status: 402 }));
    const stream = await compatibleTransport(deepseekSettings, 'test-only')(modelFor(deepseekSettings), context());
    const final = await stream.result();
    expect(final.errorMessage).toContain('余额不足');
    expect(final.errorMessage).not.toContain('private');
  });
});
