import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { ModelConfigurationService } from '@/application/models/configuration';
import { createTestRuntime } from './agent-runtime';
import { testStorage } from './storage';
import { answerEvents, streamed, toolEvents } from './protocol-fixtures';

it('界面取消订阅不取消任务，启动时配置跨工具轮次固定，完成后释放凭证', async () => {
  const storage = await testStorage();
  const keys = new Map<string, string>();
  try {
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('运行时验证');
    const models = new ModelConfigurationService(
      storage.metadata,
      {
        get: async (r = '') => keys.get(r) ?? '',
        set: async (v, r = '') => {
          if (v) keys.set(r, v);
          else keys.delete(r);
        },
      },
      randomUUID,
    );
    await models.initialize();
    const connection = await models.saveConnection(
      {
        name: 'test',
        baseUrl: 'https://example.test',
        protocol: 'chat-completions',
        auth: 'key',
        compatibility: 'standard',
        presetId: 'custom',
        enabled: true,
        apiVersion: '',
      },
      { value: 'old-fixture' },
    );
    const input = {
      connectionId: connection.id,
      name: 'test',
      apiId: 'test',
      enabled: true,
      favorite: false,
      capabilities: {
        tools: 'unknown' as const,
        images: 'unknown' as const,
        reasoning: 'unknown' as const,
      },
      parameters: { maxOutputTokens: 4096, allowImages: false, reasoning: 'off' as const },
    };
    const model = await models.saveModel(input);
    await models.setSelection('global', model.id);
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const requests: { body: any; headers: any }[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requests.push({ body: JSON.parse(String(init.body)), headers: init.headers });
      if (requests.length === 1) await held;
      return streamed(
        requests.length === 1
          ? toolEvents('chat-completions', 'list_files')
          : answerEvents('chat-completions', '完成。'),
      );
    });
    const { kernel: manager } = await createTestRuntime(workspace, {
      models,
      files: storage.files,
    });
    const detach = manager.subscribe(() => {});
    await manager.start(project.id, '查看资料');
    detach();
    await expect.poll(() => requests.length).toBe(1);
    await models.saveConnection({ ...connection, name: 'edited' }, { value: 'new-fixture' });
    await models.saveModel({
      ...input,
      id: model.id,
      parameters: { ...input.parameters, maxOutputTokens: 512 },
    });
    expect(keys.get(connection.credentialRef!)).toBe('old-fixture');
    release();
    await expect.poll(() => manager.getSnapshot().completed?.state).toBe('completed');
    for (const request of requests) {
      expect(request.body.max_tokens).toBe(4096);
      expect(request.headers.Authorization).toBe('Bearer old-fixture');
    }
    expect(keys.has(connection.credentialRef!)).toBe(false);
    expect(manager.getSnapshot().completed?.modelSnapshot?.connectionName).toBe('test');
    await manager.start(project.id, '新的任务');
    await expect.poll(() => requests.length).toBe(3);
    await expect.poll(() => manager.getSnapshot().active).toBeUndefined();
    expect(requests[2].body.max_tokens).toBe(512);
    expect(requests[2].headers.Authorization).toBe('Bearer new-fixture');
    expect(JSON.stringify([...storage.records])).not.toContain('old-fixture');
  } finally {
    vi.unstubAllGlobals();
    await storage.cleanup();
  }
});
