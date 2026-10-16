import { contentCodec } from '../src/adapters/storage/codec';
import { describe, expect, it } from 'vitest';
import type { CredentialStore, MetadataStore } from '../src/core/storage/contracts';
import { ModelConfigurationService } from '@/application/models/configuration';
import { configurationFingerprint, selectedModelId } from '../src/core/models/rules';
import { defaultModelParameters } from '../src/core/models/types';
import type { ModelEntry, ProviderConnection } from '../src/core/models/types';
import { diagnosticImage } from '../src/adapters/model/diagnostics';
import {
  getProviderPreset,
  providerPresets,
  resolveProviderBrand,
} from '../src/core/models/presets';
import { providerIconMaxBytes } from '../src/core/models/provider-icon';
import {
  connectionKey,
  mergeVisibleProviderOrder,
  providerKey,
} from '../src/core/models/provider-order';

function fixture() {
  let index = 0;
  const records = new Map<string, unknown>();
  const keys = new Map<string, string>();
  let failGraph = false;
  let failCredentialDelete = false;
  const metadata: MetadataStore = {
    get: async <T>(bucket: string, id: string) =>
      structuredClone(records.get(bucket + '/' + id)) as T | undefined,
    put: async (bucket, id, value) => {
      if (failGraph && bucket === 'model-config') throw new Error('模拟数据库写入失败');
      records.set(bucket + '/' + id, structuredClone(value));
    },
    all: async <T>(bucket: string) =>
      [...records]
        .filter(([key]) => key.startsWith(bucket + '/'))
        .map(([, value]) => structuredClone(value) as T),
  };
  const credentials: CredentialStore = {
    get: async reference => (reference ? (keys.get(reference) ?? '') : ''),
    set: async (value, reference) => {
      if (!value && failCredentialDelete) throw new Error('模拟安全存储清理失败');
      if (value) keys.set(reference, value);
      else keys.delete(reference);
    },
  };
  const create = () =>
    new ModelConfigurationService(
      metadata,
      credentials,
      () => 'config-id-' + ++index,
      contentCodec,
    );
  return {
    records,
    keys,
    metadata,
    credentials,
    create,
    failGraph: (value: boolean) => {
      failGraph = value;
    },
    failDelete: (value: boolean) => {
      failCredentialDelete = value;
    },
  };
}
const connectionInput = (name: string) => ({
  name,
  presetId: 'custom' as const,
  protocol: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1',
  compatibility: 'standard' as const,
  apiVersion: '',
  auth: 'key' as const,
  enabled: true,
});
async function addModel(
  service: ModelConfigurationService,
  connection: ProviderConnection,
  name = 'test-model',
) {
  return service.saveModel({
    connectionId: connection.id,
    apiId: name,
    name,
    enabled: true,
    favorite: false,
    capabilities: { tools: 'unknown', images: 'unknown', reasoning: 'unknown' },
    parameters: { ...defaultModelParameters },
  });
}
function edit(model: ModelEntry) {
  return {
    ...model,
    capabilities: {
      tools: model.capabilities.tools.support,
      images: model.capabilities.images.support,
      reasoning: model.capabilities.reasoning.support,
    },
  };
}

describe('多连接配置、凭证和运行快照', () => {
  it('供应商排序原子持久化，重开保留，增删连接维护顺序，冲突和写入失败不覆盖', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const original = [...service.getSnapshot().providerOrder];
    const reversed = [...original].reverse();
    await service.setProviderOrder(reversed, service.getSnapshot().revision);
    const restarted = f.create();
    await restarted.initialize();
    expect(restarted.getSnapshot().providerOrder).toEqual(reversed);
    const revision = service.getSnapshot().revision;
    const connection = await service.saveConnection(connectionInput('排序测试'));
    expect(service.getSnapshot().providerOrder).toEqual([
      ...reversed,
      connectionKey(connection.id),
    ]);
    await expect(service.setProviderOrder(original, revision)).rejects.toThrow('列表已变化');
    await expect(
      service.setProviderOrder([...reversed, reversed[0]], service.getSnapshot().revision),
    ).rejects.toThrow();
    await expect(
      service.setProviderOrder([...reversed, 'connection:unknown'], service.getSnapshot().revision),
    ).rejects.toThrow();
    await service.removeConnection(connection.id);
    expect(service.getSnapshot().providerOrder).toEqual(reversed);
    f.failGraph(true);
    await expect(
      service.setProviderOrder(original, service.getSnapshot().revision),
    ).rejects.toThrow();
    expect(service.getSnapshot().providerOrder).toEqual(reversed);
  });

  it('筛选排序只替换可见节点，拒绝重复或已删除节点', () => {
    const order = ['openai', 'deepseek', 'anthropic', 'gemini'].map(providerKey);
    expect(mergeVisibleProviderOrder(order, [order[3], order[1]])).toEqual([
      order[0],
      order[3],
      order[2],
      order[1],
    ]);
    expect(() => mergeVisibleProviderOrder(order, [order[0], order[0]])).toThrow();
    expect(() => mergeVisibleProviderOrder(order, ['connection:deleted'])).toThrow();
  });

  it('图标随连接原子保存、重启、复制和清除，运行快照不携带图标', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const icon = service.prepareIcon({
      name: 'brand.png',
      bytes: contentCodec.decodeBase64(diagnosticImage),
    });
    expect(icon).toEqual({ mediaType: 'image/png', base64: diagnosticImage });
    const connection = await service.saveConnection(
      { ...connectionInput('图标'), icon },
      { value: 'test-key' },
    );
    const model = await addModel(service, connection);
    const lease = await service.acquireModel(model.id);
    expect(lease.snapshot).not.toHaveProperty('icon');
    await lease.release();

    f.failGraph(true);
    await expect(
      service.saveConnection({ ...connection, icon: undefined }, {}, connection.revision),
    ).rejects.toThrow();
    expect(service.getSnapshot().connections[0].icon).toEqual(icon);
    f.failGraph(false);

    const restarted = f.create();
    await restarted.initialize();
    expect(restarted.getSnapshot().connections[0].icon).toEqual(icon);
    const copied = await restarted.copyConnection(connection.id);
    expect(copied.icon).toEqual(icon);
    const cleared = await restarted.saveConnection(
      { ...connection, icon: undefined },
      {},
      connection.revision,
    );
    expect(cleared.icon).toBeUndefined();
    const reopened = f.create();
    await reopened.initialize();
    expect(
      reopened.getSnapshot().connections.find(item => item.id === connection.id)?.icon,
    ).toBeUndefined();
    expect(reopened.getSnapshot().connections.find(item => item.id === copied.id)?.icon).toEqual(
      icon,
    );
  });

  it('直接保存也校验图标格式、编码和体积，不接受外部地址或伪造图片', async () => {
    const service = fixture().create();
    await service.initialize();
    expect(() =>
      service.prepareIcon({ name: 'icon.svg', bytes: new Uint8Array([1, 2, 3]) }),
    ).toThrow('PNG / JPEG / WebP');
    expect(() =>
      service.prepareIcon({ name: 'large.png', bytes: new Uint8Array(providerIconMaxBytes + 1) }),
    ).toThrow('256 KB');
    for (const base64 of ['https://example.test/icon.png', 'AAAA', diagnosticImage + '!']) {
      await expect(
        service.saveConnection({
          ...connectionInput('无效图标'),
          icon: { mediaType: 'image/png', base64 },
        }),
      ).rejects.toThrow();
    }
    expect(service.getSnapshot().connections).toHaveLength(0);
  });

  it('常用模板有独立地址，品牌识别只接受已知主机并对未知供应商回退', () => {
    expect(new Set(providerPresets.map(preset => preset.id)).size).toBe(providerPresets.length);
    for (const id of [
      'openai',
      'deepseek',
      'qwen',
      'kimi',
      'zhipu',
      'doubao',
      'minimax',
      'siliconflow',
      'openrouter',
      'groq',
      'mistral',
      'xai',
    ])
      expect(getProviderPreset(id).id).toBe(id);
    expect(getProviderPreset('unknown').id).toBe('custom');
    expect(resolveProviderBrand('custom', 'https://api.openai.com/v1')).toBe('openai');
    expect(
      resolveProviderBrand('custom', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
    ).toBe('qwen');
    expect(
      resolveProviderBrand('custom', 'https://api.openai.com.example.test/v1'),
    ).toBeUndefined();
    expect(resolveProviderBrand('unknown', 'invalid')).toBeUndefined();
    expect(resolveProviderBrand('custom', 'https://third-party.test/v1')).toBeUndefined();
  });
  it('同连接两个并行运行的旧凭证只在两个租约都释放后回收', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('共享连接'), {
      value: 'parallel-old-key',
    });
    const model = await addModel(service, connection);
    const a = await service.acquireModel(model.id);
    const b = await service.acquireModel(model.id);
    await service.saveConnection(
      { ...connection, name: '新凭证连接' },
      { value: 'parallel-new-key' },
      connection.revision,
    );
    await a.release();
    expect(f.keys.has(connection.credentialRef!)).toBe(true);
    expect(b.secret).toBe('parallel-old-key');
    await b.release();
    expect(f.keys.has(connection.credentialRef!)).toBe(false);
    expect([...f.keys.values()]).toContain('parallel-new-key');
  });
  it('同名模型和两份连接独立使用密钥，快照与元数据不包含凭证', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const a = await service.saveConnection(connectionInput('个人'), { value: 'private-key-A' });
    const b = await service.saveConnection(connectionInput('工作'), { value: 'private-key-B' });
    const ma = await addModel(service, a);
    const mb = await addModel(service, b);
    const la = await service.acquireModel(ma.id);
    const lb = await service.acquireModel(mb.id);
    expect(la.secret).toBe('private-key-A');
    expect(lb.secret).toBe('private-key-B');
    expect(JSON.stringify(la.snapshot)).not.toContain('private-key');
    expect(JSON.stringify([...f.records])).not.toContain('private-key');
    await la.release();
    await lb.release();
  });

  it('保存失败原密钥仍可用，重启清理孤立新凭证', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), {
      value: 'original-key',
    });
    const model = await addModel(service, connection);
    f.failGraph(true);
    f.failDelete(true);
    await expect(
      service.saveConnection({ ...connection, name: '新名称' }, { value: 'replacement-key' }),
    ).rejects.toThrow('数据库');
    expect((await service.acquireModel(model.id)).secret).toBe('original-key');
    f.failGraph(false);
    f.failDelete(false);
    const restarted = f.create();
    await restarted.initialize();
    expect((await restarted.acquireModel(model.id)).secret).toBe('original-key');
    expect([...f.keys.values()]).not.toContain('replacement-key');
  });

  it('正在运行的租约保留原参数和密钥，释放后回收旧凭证', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'old-key' });
    const model = await addModel(service, connection);
    const running = await service.acquireModel(model.id);
    await service.saveConnection({ ...connection, name: '更新名称' }, { value: 'new-key' });
    await service.saveModel({
      ...edit(model),
      parameters: { ...model.parameters, maxOutputTokens: 1024 },
    });
    expect(running.secret).toBe('old-key');
    expect(running.snapshot.parameters.maxOutputTokens).toBe(8192);
    expect(f.keys.get(connection.credentialRef!)).toBe('old-key');
    const next = await service.acquireModel(model.id);
    expect(next.secret).toBe('new-key');
    expect(next.snapshot.parameters.maxOutputTokens).toBe(1024);
    await running.release();
    expect(f.keys.has(connection.credentialRef!)).toBe(false);
    await next.release();
  });

  it('会话、项目、全局优先级明确，删除显式选择不会偷偷换供应商', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const a = await addModel(service, connection, 'a');
    const b = await addModel(service, connection, 'b');
    const c = await addModel(service, connection, 'c');
    await service.setSelection('global', a.id);
    await service.setSelection('project', b.id, 'project');
    await service.setSelection('session', c.id, 'conversation-a');
    expect(selectedModelId(service.getSnapshot(), 'project', 'conversation-a')).toBe(c.id);
    await service.removeModel(c.id);
    await expect(service.acquireSelection('project', 'conversation-a')).rejects.toThrow('已删除');
    await service.setSelection('session', undefined, 'conversation-a');
    expect(selectedModelId(service.getSnapshot(), 'project', 'conversation-a')).toBe(b.id);
  });

  it('同 Origin 路径更改保留凭证，改变目标服务需要重新绑定', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const updated = await service.saveConnection({
      ...connection,
      baseUrl: 'https://example.test/other',
    });
    expect(updated.credentialRef).toBe(connection.credentialRef);
    const changed = await service.saveConnection({
      ...updated,
      baseUrl: 'https://another.test/v1',
    });
    expect(changed.credentialRef).toBeUndefined();
    expect(await service.keyReady(changed.id)).toBe(false);
  });

  it('目录合并保留用户选择和参数，失去的模型不被删除；陈旧结果不覆盖配置', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const fp = configurationFingerprint(connection);
    await service.mergeCatalog(
      connection.id,
      [
        { apiId: 'a', name: '原名', capabilities: { images: 'supported' } },
        { apiId: 'b', name: '第二个' },
      ],
      fp,
    );
    const model = service.getSnapshot().models.find(item => item.apiId === 'a')!;
    await service.saveModel({
      ...edit(model),
      name: '我的名字',
      favorite: true,
      parameters: { ...model.parameters, maxOutputTokens: 512 },
    });
    await service.mergeCatalog(connection.id, [{ apiId: 'a', name: '服务新名' }], fp);
    expect(service.getSnapshot().models.find(item => item.apiId === 'a')).toMatchObject({
      name: '我的名字',
      favorite: true,
      parameters: { maxOutputTokens: 512 },
    });
    expect(service.getSnapshot().models.find(item => item.apiId === 'b')?.catalog.missing).toBe(
      true,
    );
    await service.saveConnection({ ...connection, baseUrl: 'https://different.test/v1' });
    await expect(service.mergeCatalog(connection.id, [], fp)).rejects.toThrow('已变更');
  });

  it('复制连接克隆模型但不复制密钥，明确不支持工具的模型不能运行 Agent', async () => {
    const f = fixture();
    const service = f.create();
    await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const model = await addModel(service, connection);
    const copy = await service.copyConnection(connection.id);
    expect(await service.keyReady(copy.id)).toBe(false);
    expect(service.getSnapshot().models.filter(item => item.connectionId === copy.id)).toHaveLength(
      1,
    );
    await service.saveModel({
      ...edit(model),
      capabilities: { tools: 'unsupported', images: 'unknown', reasoning: 'unknown' },
    });
    await expect(service.acquireModel(model.id)).rejects.toThrow('不支持工具');
  });
});
