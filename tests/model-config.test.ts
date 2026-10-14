import { describe, expect, it } from 'vitest';
import type { CredentialStore, MetadataStore } from '../src/core/storage/contracts';
import { ModelConfigurationService } from '@/application/models/configuration';
import { configurationFingerprint, mainSessionId, selectedModelId } from '../src/core/models/rules';
import { defaultModelParameters } from '../src/core/models/types';
import type { ModelEntry, ProviderConnection } from '../src/core/models/types';

function fixture() {
  let index = 0; const records = new Map<string, unknown>(); const keys = new Map<string, string>();
  let failGraph = false; let failCredentialDelete = false;
  const metadata: MetadataStore = {
    get: async <T>(bucket: string, id: string) => structuredClone(records.get(bucket + '/' + id)) as T | undefined,
    put: async (bucket, id, value) => {
      if (failGraph && bucket === 'model-config') throw new Error('模拟数据库写入失败');
      records.set(bucket + '/' + id, structuredClone(value));
    },
    all: async <T>(bucket: string) => [...records].filter(([key]) => key.startsWith(bucket + '/')).map(([, value]) => structuredClone(value) as T),
  };
  const credentials: CredentialStore = {
    get: async (reference = 'legacy') => keys.get(reference) ?? '',
    set: async (value, reference = 'legacy') => {
      if (!value && failCredentialDelete) throw new Error('模拟安全存储清理失败');
      if (value) keys.set(reference, value); else keys.delete(reference);
    },
  };
  const create = () => new ModelConfigurationService(metadata, credentials, () => 'config-id-' + ++index);
  return { records, keys, metadata, credentials, create,
    failGraph: (value: boolean) => { failGraph = value; }, failDelete: (value: boolean) => { failCredentialDelete = value; } };
}
const connectionInput = (name: string) => ({ name, presetId: 'custom' as const, protocol: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', compatibility: 'standard' as const, apiVersion: '', auth: 'key' as const, enabled: true });
async function addModel(service: ModelConfigurationService, connection: ProviderConnection, name = 'test-model') {
  return service.saveModel({ connectionId: connection.id, apiId: name, name, enabled: true, favorite: false,
    capabilities: { tools: 'unknown', images: 'unknown', reasoning: 'unknown' }, parameters: { ...defaultModelParameters } });
}
function edit(model: ModelEntry) {
  return { ...model, capabilities: { tools: model.capabilities.tools.support, images: model.capabilities.images.support,
    reasoning: model.capabilities.reasoning.support } };
}

describe('多连接配置、凭证和运行快照', () => {
  it('同连接两个并行运行的旧凭证只在两个租约都释放后回收', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('共享连接'), { value: 'parallel-old-key' }); const model = await addModel(service, connection);
    const a = await service.acquireModel(model.id); const b = await service.acquireModel(model.id);
    await service.saveConnection({ ...connection, name: '新凭证连接' }, { value: 'parallel-new-key' }, connection.revision);
    await a.release(); expect(f.keys.has(connection.credentialRef!)).toBe(true); expect(b.secret).toBe('parallel-old-key');
    await b.release(); expect(f.keys.has(connection.credentialRef!)).toBe(false); expect([...f.keys.values()]).toContain('parallel-new-key');
  });
  it('同名模型和两份连接独立使用密钥，快照与元数据不包含凭证', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const a = await service.saveConnection(connectionInput('个人'), { value: 'private-key-A' });
    const b = await service.saveConnection(connectionInput('工作'), { value: 'private-key-B' });
    const ma = await addModel(service, a); const mb = await addModel(service, b);
    const la = await service.acquireModel(ma.id); const lb = await service.acquireModel(mb.id);
    expect(la.secret).toBe('private-key-A'); expect(lb.secret).toBe('private-key-B');
    expect(JSON.stringify(la.snapshot)).not.toContain('private-key');
    expect(JSON.stringify([...f.records])).not.toContain('private-key');
    await la.release(); await lb.release();
  });

  it('保存失败原密钥仍可用，重启清理孤立新凭证', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'original-key' });
    const model = await addModel(service, connection);
    f.failGraph(true); f.failDelete(true);
    await expect(service.saveConnection({ ...connection, name: '新名称' }, { value: 'replacement-key' })).rejects.toThrow('数据库');
    expect((await service.acquireModel(model.id)).secret).toBe('original-key');
    f.failGraph(false); f.failDelete(false);
    const restarted = f.create(); await restarted.initialize();
    expect((await restarted.acquireModel(model.id)).secret).toBe('original-key');
    expect([...f.keys.values()]).not.toContain('replacement-key');
  });

  it('正在运行的租约保留原参数和密钥，释放后回收旧凭证', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'old-key' });
    const model = await addModel(service, connection); const running = await service.acquireModel(model.id);
    await service.saveConnection({ ...connection, name: '更新名称' }, { value: 'new-key' });
    await service.saveModel({ ...edit(model), parameters: { ...model.parameters, maxOutputTokens: 1024 } });
    expect(running.secret).toBe('old-key'); expect(running.snapshot.parameters.maxOutputTokens).toBe(8192);
    expect(f.keys.get(connection.credentialRef!)).toBe('old-key');
    const next = await service.acquireModel(model.id);
    expect(next.secret).toBe('new-key'); expect(next.snapshot.parameters.maxOutputTokens).toBe(1024);
    await running.release(); expect(f.keys.has(connection.credentialRef!)).toBe(false); await next.release();
  });

  it('会话、项目、全局优先级明确，删除显式选择不会偷偷换供应商', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const a = await addModel(service, connection, 'a'); const b = await addModel(service, connection, 'b'); const c = await addModel(service, connection, 'c');
    await service.setSelection('global', a.id); await service.setSelection('project', b.id, 'project');
    await service.setSelection('session', c.id, mainSessionId('project'));
    expect(selectedModelId(service.getSnapshot(), 'project', mainSessionId('project'))).toBe(c.id);
    await service.removeModel(c.id);
    await expect(service.acquireSelection('project', mainSessionId('project'))).rejects.toThrow('已删除');
    await service.setSelection('session', undefined, mainSessionId('project'));
    expect(selectedModelId(service.getSnapshot(), 'project', mainSessionId('project'))).toBe(b.id);
  });

  it('旧配置迁移可重复执行，保留模型和密钥，元数据写失败不清旧密钥', async () => {
    const f = fixture(); f.records.set('settings/model', { mode: 'remote', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', imageInput: true });
    f.keys.set('legacy', 'legacy-secret'); f.failGraph(true);
    await expect(f.create().initialize()).rejects.toThrow('数据库'); expect(f.keys.get('legacy')).toBe('legacy-secret');
    f.failGraph(false); const service = f.create(); await service.initialize();
    const second = f.create(); await second.initialize();
    expect(second.getSnapshot().connections).toHaveLength(1); expect(second.getSnapshot().models).toHaveLength(1);
    expect((await second.acquireSelection()).secret).toBe('legacy-secret'); expect(f.keys.has('legacy')).toBe(false);
    expect(second.getSnapshot().mode).toBe('remote');
  });

  it('同 Origin 路径更改保留凭证，改变目标服务需要重新绑定', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const updated = await service.saveConnection({ ...connection, baseUrl: 'https://example.test/other' });
    expect(updated.credentialRef).toBe(connection.credentialRef);
    const changed = await service.saveConnection({ ...updated, baseUrl: 'https://another.test/v1' });
    expect(changed.credentialRef).toBeUndefined(); expect(await service.keyReady(changed.id)).toBe(false);
  });

  it('目录合并保留用户选择和参数，失去的模型不被删除；陈旧结果不覆盖配置', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const fp = configurationFingerprint(connection);
    await service.mergeCatalog(connection.id, [{ apiId: 'a', name: '原名', capabilities: { images: 'supported' } }, { apiId: 'b', name: '第二个' }], fp);
    const model = service.getSnapshot().models.find((item) => item.apiId === 'a')!;
    await service.saveModel({ ...edit(model), name: '我的名字', favorite: true, parameters: { ...model.parameters, maxOutputTokens: 512 } });
    await service.mergeCatalog(connection.id, [{ apiId: 'a', name: '服务新名' }], fp);
    expect(service.getSnapshot().models.find((item) => item.apiId === 'a')).toMatchObject({ name: '我的名字', favorite: true, parameters: { maxOutputTokens: 512 } });
    expect(service.getSnapshot().models.find((item) => item.apiId === 'b')?.catalog.missing).toBe(true);
    await service.saveConnection({ ...connection, baseUrl: 'https://different.test/v1' });
    await expect(service.mergeCatalog(connection.id, [], fp)).rejects.toThrow('已变更');
  });

  it('复制连接克隆模型但不复制密钥，明确不支持工具的模型不能运行 Agent', async () => {
    const f = fixture(); const service = f.create(); await service.initialize();
    const connection = await service.saveConnection(connectionInput('个人'), { value: 'test-key' });
    const model = await addModel(service, connection); const copy = await service.copyConnection(connection.id);
    expect(await service.keyReady(copy.id)).toBe(false); expect(service.getSnapshot().models.filter((item) => item.connectionId === copy.id)).toHaveLength(1);
    await service.saveModel({ ...edit(model), capabilities: { tools: 'unsupported', images: 'unknown', reasoning: 'unknown' } });
    await expect(service.acquireModel(model.id)).rejects.toThrow('不支持工具');
  });
});
