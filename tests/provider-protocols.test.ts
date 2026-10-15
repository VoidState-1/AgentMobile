import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContext, type Message } from '@earendil-works/pi-ai';
import { protocolBody, protocolModel, protocolTransport } from '../src/adapters/model/protocols';
import { discoverModels } from '../src/adapters/model/catalog';
import { diagnosticImage, runDiagnostic } from '../src/adapters/model/diagnostics';
import { ModelConfigurationService } from '@/application/models/configuration';
import { createWorkspace } from '../src/bootstrap/workspace';
import { startTestRun } from './agent-runtime';
import type { CredentialStore } from '../src/core/storage/contracts';
import type { ModelProtocol, ProviderConnection } from '../src/core/models/types';
import { configurationFingerprint } from '../src/core/models/rules';
import { protocols, snapshot, toolEvents, answerEvents, streamed } from './protocol-fixtures';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const connectionFor = (protocol: ModelProtocol): ProviderConnection => ({
  id: 'connection',
  name: '测试',
  presetId: 'custom',
  protocol,
  baseUrl: 'https://example.test/v1',
  apiVersion: '2023-06-01',
  auth: 'key',
  enabled: true,
  compatibility: 'standard',
  revision: 1,
  createdAt: '',
  updatedAt: '',
});

describe.each(protocols)('%s 原生协议模拟', protocol => {
  it('多个工具调用保持关联，达到输出上限时不交付工具', async () => {
    const events = toolEvents(protocol, 'first', { value: 1 }) as any[];
    if (protocol === 'chat-completions')
      events.splice(1, 0, {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'second-id',
                  function: { name: 'second', arguments: '{"value":2}' },
                },
              ],
            },
          },
        ],
      });
    else if (protocol === 'gemini')
      events[0].candidates[0].content.parts.push({
        functionCall: { id: 'second-id', name: 'second', args: { value: 2 } },
      });
    else
      events.splice(
        events.length - 2,
        0,
        {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'second-id', name: 'second', input: { value: 2 } },
        },
        { type: 'content_block_stop', index: 2 },
      );
    vi.stubGlobal('fetch', async () => streamed(events));
    const config = snapshot(protocol);
    const context = normalizeContext({
      messages: [{ role: 'user', content: '测试', timestamp: 0 }],
    });
    const answer = await (
      await protocolTransport(config, 'fixture')(protocolModel(config), context)
    ).result();
    expect(answer.stopReason).toBe('toolUse');
    expect(answer.content.filter(p => p.type === 'toolCall').map(p => p.arguments)).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
    for (const event of events) {
      if (protocol === 'chat-completions' && event?.choices?.[0]?.finish_reason)
        event.choices[0].finish_reason = 'length';
      if (protocol === 'gemini' && event?.candidates?.[0])
        event.candidates[0].finishReason = 'MAX_TOKENS';
      if (protocol === 'anthropic-messages' && event?.type === 'message_delta')
        event.delta.stop_reason = 'max_tokens';
    }
    const limited = await (
      await protocolTransport(config, 'fixture')(protocolModel(config), context)
    ).result();
    expect(limited.stopReason).toBe('length');
    expect(limited.content.some(p => p.type === 'toolCall')).toBe(false);
  });
  it('Pi 工具循环写入 Git，参数与认证进入正确字段，签名跨轮回传', async () => {
    const storage = await testStorage();
    cleanups.push(storage.cleanup);
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('协议模拟');
    const bodies: Record<string, any>[] = [];
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      requests.push(init);
      return streamed(
        bodies.length === 1
          ? toolEvents(protocol, 'write_text', {
              path: 'documents/native.md',
              text: '原生协议工具写入成功',
              expectedRevision: null,
            })
          : answerEvents(protocol, '文档已保存。'),
      );
    });
    const config = snapshot(protocol);
    const task = await startTestRun(workspace, project.id, '创建一份笔记', {
      model: config,
      secret: 'private-test-key',
      web: true,
    });
    const completed = await task.done;
    expect(completed.state).toBe('completed');
    expect((await workspace.readText(project.id, 'documents/native.md')).text).toBe(
      '原生协议工具写入成功',
    );
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies)).not.toContain('private-test-key');
    expect(completed.modelSnapshot?.protocol).toBe(protocol);
    expect(JSON.stringify(completed)).not.toContain('private-test-key');
    const headers = requests[0].headers as Record<string, string>;
    expect(
      headers[
        protocol === 'gemini'
          ? 'x-goog-api-key'
          : protocol === 'anthropic-messages'
            ? 'x-api-key'
            : 'Authorization'
      ],
    ).toContain('private-test-key');
    expect(protocol === 'gemini' ? bodies[0].generationConfig : bodies[0]).toMatchObject(
      protocol === 'gemini'
        ? { maxOutputTokens: 512, temperature: 0.7 }
        : { max_tokens: 512, temperature: 0.7 },
    );
    if (protocol === 'gemini') {
      expect(JSON.stringify(bodies[1])).toContain('opaque-signature');
      expect(JSON.stringify(bodies[1])).toContain('native-call');
    }
    if (protocol === 'anthropic-messages') {
      expect(JSON.stringify(bodies[1])).toContain('anthropic-signature');
      expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    }
  });
  it('图片进入协议原生格式，关闭时明确拒绝', () => {
    const config = snapshot(protocol);
    const messages: Message[] = [
      {
        role: 'user',
        timestamp: 0,
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', data: diagnosticImage, mimeType: 'image/png' },
        ],
      },
    ];
    const body = protocolBody(config, messages, []);
    expect(JSON.stringify(body)).toContain(diagnosticImage);
    expect(JSON.stringify(body)).toContain(
      protocol === 'gemini'
        ? 'inlineData'
        : protocol === 'anthropic-messages'
          ? 'base64'
          : 'image_url',
    );
    expect(() =>
      protocolBody(
        { ...config, parameters: { ...config.parameters, allowImages: false } },
        messages,
        [],
      ),
    ).toThrow('未开启图片');
  });
  it('截断工具流和流内错误不会触发工具；取消与鉴权错误有安全诊断', async () => {
    const config = snapshot(protocol);
    const transport = protocolTransport(config, 'never-log-me');
    const context = normalizeContext({
      messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
    });
    const partial = toolEvents(protocol, 'write_text', { path: 'x' })
      .filter(event => typeof event !== 'string')
      .slice(0, protocol === 'anthropic-messages' ? 2 : 1);
    if (protocol === 'gemini') delete (partial[0] as any).candidates[0].finishReason;
    for (const events of [partial, [{ error: { message: 'never-log-me' }, type: 'error' }]]) {
      vi.stubGlobal('fetch', async () => streamed(events));
      const final = await (await transport(protocolModel(config), context)).result();
      expect(final.stopReason).toBe('error');
      expect(final.content.some(p => p.type === 'toolCall')).toBe(false);
      expect(JSON.stringify(final)).not.toContain('never-log-me');
    }
    vi.stubGlobal('fetch', async () => new Response('never-log-me', { status: 401 }));
    expect(
      (await (await transport(protocolModel(config), context)).result()).errorMessage,
    ).toContain('HTTP 401');
    vi.stubGlobal(
      'fetch',
      async (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('never-log-me')), {
            once: true,
          }),
        ),
    );
    const abort = new AbortController();
    const stream = await transport(protocolModel(config), context, { signal: abort.signal });
    abort.abort();
    expect((await stream.result()).stopReason).toBe('aborted');
  });
  it('目录分页按协议解析，不猜测工具和图片能力', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (protocol === 'gemini')
        return Response.json({
          models: [
            {
              name: 'models/test-' + urls.length,
              displayName: 'Test',
              supportedGenerationMethods: ['generateContent'],
              inputTokenLimit: 32000,
              outputTokenLimit: 8000,
            },
            { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
          ],
          ...(urls.length === 1 ? { nextPageToken: 'page+2' } : {}),
        });
      if (protocol === 'anthropic-messages')
        return Response.json({
          data: [
            {
              id: 'test-' + urls.length,
              display_name: 'Test',
              capabilities: { image_input: { supported: true } },
              max_tokens: 8192,
            },
          ],
          has_more: urls.length === 1,
          last_id: 'test-1',
        });
      return Response.json({ data: [{ id: 'test' }] });
    });
    const models = await discoverModels(connectionFor(protocol), 'fake');
    expect(models).toHaveLength(protocol === 'chat-completions' ? 1 : 2);
    expect(models[0].capabilities?.tools).toBeUndefined();
    if (protocol === 'gemini') expect(urls[1]).toContain('pageToken=page%2B2');
    if (protocol === 'anthropic-messages') expect(models[0].capabilities?.images).toBe('supported');
  });
  it('分层检测核对宿主随机结果与内置图，不读取工作区', async () => {
    const storage = await testStorage();
    cleanups.push(storage.cleanup);
    const keys = new Map<string, string>();
    const credentials: CredentialStore = {
      get: async r => (r ? (keys.get(r) ?? '') : ''),
      set: async (v, r) => {
        if (v) keys.set(r, v);
        else keys.delete(r);
      },
    };
    const service = new ModelConfigurationService(storage.metadata, credentials, randomUUID);
    await service.initialize();
    const connection = await service.saveConnection(
      { ...connectionFor(protocol), id: undefined },
      { value: 'diagnostic-test-key' },
    );
    const model = await service.saveModel({
      connectionId: connection.id,
      name: 'Test',
      apiId: snapshot(protocol).apiModelId,
      enabled: true,
      favorite: false,
      capabilities: { tools: 'unknown', images: 'unknown', reasoning: 'unknown' },
      parameters: { maxOutputTokens: 64, allowImages: false, reasoning: 'off' },
    });
    await service.mergeCatalog(
      connection.id,
      [{ apiId: model.apiId, name: model.name, limits: { outputTokens: 64 } }],
      configurationFingerprint(connection),
    );
    let request = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if ((body.max_tokens ?? body.generationConfig?.maxOutputTokens) > 64)
        return new Response('test provider limit', { status: 400 });
      request++;
      if (request === 1) return streamed(toolEvents(protocol, 'diagnostic_echo'));
      const marker = String(init.body).match(/host_[a-z0-9]+/)?.[0];
      expect(marker).toBeTruthy();
      return streamed(answerEvents(protocol, marker!));
    });
    const tool = await runDiagnostic(service, connection.id, model.id, 'tools', 'web');
    expect(tool.status).toBe('passed');
    expect(tool.requests).toBe(2);
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      expect(String(init.body)).toContain(diagnosticImage);
      return streamed(answerEvents(protocol, 'red, green, blue, yellow'));
    });
    expect((await runDiagnostic(service, connection.id, model.id, 'images', 'native')).status).toBe(
      'passed',
    );
    expect(service.getSnapshot().models[0].capabilities.images.source).toBe('verified');
    expect(JSON.stringify([...storage.records])).not.toContain('diagnostic-test-key');
    vi.stubGlobal('fetch', async () => streamed(answerEvents(protocol, 'unrelated')));
    expect((await runDiagnostic(service, connection.id, model.id, 'text', 'web')).status).toBe(
      'failed',
    );
  });
});

it('自定义无需认证服务不发送认证头', async () => {
  const config = { ...snapshot('chat-completions'), auth: 'none' as const };
  let headers: HeadersInit | undefined;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    headers = init.headers;
    return streamed(answerEvents('chat-completions', 'ok'));
  });
  const context = normalizeContext({
    messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
  });
  expect(
    (await (await protocolTransport(config, '')(protocolModel(config), context)).result())
      .stopReason,
  ).toBe('stop');
  expect(JSON.stringify(headers)).not.toMatch(/Authorization|x-api-key|x-goog-api-key/);
});

it('Gemini 在相同时间戳的后续轮次仍分配不同工具 ID', async () => {
  const config = snapshot('gemini');
  const transport = protocolTransport(config, 'fixture');
  vi.stubGlobal('fetch', async () => streamed(toolEvents('gemini', 'test')));
  const context = normalizeContext({
    messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
  });
  const original = Date.now;
  Date.now = () => 1;
  try {
    const first = await (await transport(protocolModel(config), context)).result();
    const second = await (await transport(protocolModel(config), context)).result();
    expect(first.content.find(p => p.type === 'toolCall')?.id).not.toBe(
      second.content.find(p => p.type === 'toolCall')?.id,
    );
  } finally {
    Date.now = original;
  }
});
