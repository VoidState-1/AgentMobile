import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createAppServices } from '../src/bootstrap/facade';
import { PreferencesService } from '../src/application/settings/preferences';
import { createWorkspace } from '../src/bootstrap/workspace';
import { ModelConfigurationService } from '@/application/models/configuration';
import { ConversationService } from '@/application/conversations/service';
import { AgentSettingsService } from '@/application/settings/agent';
import { McpConfigurationService } from '@/application/mcp/configuration';
import { McpRuntime } from '../src/adapters/mcp/runtime';
import { SkillService } from '@/application/skills/library';
import { GitSkillRepository } from '../src/adapters/skills/repository';
import { createTestRuntime } from './agent-runtime';
import {
  decodeSkillText,
  importSkillPackage,
  validateBundle,
} from '../src/adapters/skills/package';
import { testStorage } from './storage';
import { ProposalService } from '../src/application/runs/proposals';
import { contentCodec } from '../src/adapters/storage/codec';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture() {
  const storage = await testStorage();
  cleanup.push(storage.cleanup);
  const keys = new Map<string, string>();
  const credentials = {
    get: async (id = '') => keys.get(id) ?? '',
    set: async (value: string, id = '') => {
      keys.set(id, value);
    },
  };
  const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
  const project = await workspace.create('API');
  const models = new ModelConfigurationService(
    storage.metadata,
    credentials,
    randomUUID,
    contentCodec,
  );
  await models.initialize();
  const conversations = new ConversationService(storage.metadata, randomUUID);
  await conversations.initialize([project]);
  const agentSettings = new AgentSettingsService(storage.metadata);
  await agentSettings.initialize();
  const mcpConfiguration = new McpConfigurationService(storage.metadata, credentials, randomUUID);
  await mcpConfiguration.initialize();
  const mcp = new McpRuntime(mcpConfiguration, storage.metadata, randomUUID, async text => text);
  const skills = new SkillService(
    storage.metadata,
    new GitSkillRepository(
      createWorkspace(storage.files, storage.metadata, randomUUID, { namespace: 'skills' }),
    ),
  );
  await skills.initialize();
  const { kernel, repository } = await createTestRuntime(workspace, {
    models,
    conversations,
    settings: agentSettings,
    mcp,
    skills,
  });
  const io = {
    pickFile: async () => undefined,
    pickSkillPackage: async () => undefined,
    exportFile: vi.fn(async () => {}),
    exportSkill: vi.fn(async () => {}),
  };
  const api = createAppServices({
    workspace,
    models,
    conversations,
    agentSettings,
    mcp,
    skills,
    preferences: new PreferencesService(storage.metadata),
    agent: kernel,
    runs: repository,
    io,
    proposals: new ProposalService(workspace, repository, contentCodec),
    diagnose: async () => {
      throw new Error('native HTTP failure /private/path');
    },
    skillPackage: {
      decodeText: decodeSkillText,
      validateBundle,
      importPackage: importSkillPackage,
    },
  });
  return { ...storage, workspace, project, api, io };
}

it('界面入口在运行时也没有原始存储、Git、凭证租约或内部执行方法', async () => {
  const { api } = await fixture();
  for (const name of ['fs', 'metadata', 'credentials', 'git']) expect(name in api).toBe(false);
  for (const name of ['fs', 'metadata', 'git', 'claim', 'recover', 'replaceFiles', 'taskBaseline'])
    expect(name in api.workspace).toBe(false);
  expect(Object.keys(api.proposals!)).toEqual(['preview']);
  for (const name of ['credentials', 'acquireSelection', 'acquireConnection', 'acquireModel'])
    expect(name in api.models).toBe(false);
  expect('createRun' in api.mcp).toBe(false);
  expect('acquireProject' in api.mcp.configuration).toBe(false);
  expect('repository' in api.skills).toBe(false);
  expect(Object.isFrozen(api)).toBe(true);
  expect(Object.isFrozen(api.workspace)).toBe(true);
});

it('兼容原偏好记录，文件和 Git 查询工作，但操作摘要不暴露恢复内容', async () => {
  const { api, metadata, project } = await fixture();
  await metadata.put('preferences', 'workbench', { projectId: project.id, appearance: 'dark' });
  expect(await api.preferences.getWorkbench()).toEqual({
    projectId: project.id,
    appearance: 'dark',
  });
  await api.preferences.saveWorkbench({ projectId: project.id, appearance: 'light' });
  expect(await metadata.get('preferences', 'workbench')).toEqual({
    projectId: project.id,
    appearance: 'light',
  });
  await api.workspace.write(project.id, 'a.md', Buffer.from('A'), null);
  const view = await api.workspace.snapshot(project.id);
  expect(view.versions).toHaveLength(1);
  expect(view.gitStatus.files[0].path).toBe('a.md');
  expect(view.operations[0].changedPaths).toEqual(['a.md']);
  expect('expectedHead' in view.operations[0]).toBe(false);
  const status = view.gitStatus;
  await api.workspace.stage(project.id, ['a.md'], {
    ...status,
    revisions: { 'a.md': status.files[0].workingRevision },
  });
  await api.workspace.commitStaged(project.id, '提交 A', await api.workspace.status(project.id));
  expect((await api.workspace.snapshot(project.id)).versions).toHaveLength(2);
});

it('额外的 owner 参数不能绕过项目锁；平台错误不会包含私有路径', async () => {
  const { api, workspace, files, project } = await fixture();
  workspace.claim(project.id, 'active-run');
  await expect(
    api.workspace.write(project.id, 'a.md', Buffer.from('A'), null, {
      owner: 'active-run',
    } as never),
  ).rejects.toThrow('请等待');
  workspace.release(project.id, 'active-run');
  files.write = async () => {
    throw new Error('EIO /data/user/0/private/key');
  };
  await expect(
    api.workspace.write(project.id, 'a.md', Buffer.from('A'), null),
  ).rejects.toMatchObject({ code: 'UNKNOWN', message: '操作失败，请重试或重新打开应用。' });
  await expect(api.models.diagnose('test', undefined, 'text')).rejects.toMatchObject({
    code: 'UNKNOWN',
  });
});

it('视图订阅者异常不会把已保存的模型设置或对话变成失败操作', async () => {
  const { api, project } = await fixture();
  api.models.subscribe(() => {
    throw new Error('UI failed');
  });
  const configuration = api.models.getSnapshot();
  const order = [...configuration.providerOrder].reverse();
  await api.models.setProviderOrder(order, configuration.revision);
  expect(api.models.getSnapshot().providerOrder).toEqual(order);
  api.conversations.subscribe(() => {
    throw new Error('UI failed');
  });
  const conversation = await api.conversations.create(project.id);
  expect(
    api.conversations.getSnapshot().conversations.some(value => value.id === conversation.id),
  ).toBe(true);
});
