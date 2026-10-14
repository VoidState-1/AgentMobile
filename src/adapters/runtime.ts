import '@/adapters/polyfills';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { TaskRecord } from '@/core/prototype/types';
import { settleTrace } from '@/core/prototype/trace';
import { AgentSettingsService } from '@/core/agent/settings';
import { ModelConfigurationService } from '@/core/models/service';
import { ConversationService } from '@/core/conversations/service';
import { McpConfigurationService } from '@/core/mcp/service';
import { McpRuntime } from './mcp/runtime';
import { SkillService } from '@/core/skills/service';
import { GitSkillRepository } from './skills/repository';
import { TaskManager } from './agent/task-manager';
import { createStorage } from './storage/platform';
import { WorkspaceService } from './workspace/service';

let instance: Promise<Runtime> | undefined;
export type Runtime = Awaited<ReturnType<typeof initialize>>;

async function initialize() {
  const storage = await createStorage();
  const workspace = new WorkspaceService(storage.fs, storage.metadata, Crypto.randomUUID);
  const models = new ModelConfigurationService(storage.metadata, storage.credentials, Crypto.randomUUID);
  await models.initialize();
  const agentSettings = new AgentSettingsService(storage.metadata); await agentSettings.initialize();
  const mcpConfiguration = new McpConfigurationService(storage.metadata, storage.credentials, Crypto.randomUUID);
  await mcpConfiguration.initialize();
  const mcp = new McpRuntime(mcpConfiguration, storage.metadata, Crypto.randomUUID,
    (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value));
  await mcp.recover();
  const unknownMcp = await mcp.unknown();
  await workspace.recover();
  const skills = new SkillService(storage.metadata, new GitSkillRepository(storage.fs, storage.metadata, Crypto.randomUUID));
  await skills.initialize();
  const conversations = new ConversationService(storage.metadata, Crypto.randomUUID);
  await conversations.initialize(await workspace.projects());
  const tasks = await storage.metadata.all<TaskRecord>('tasks');
  for (const task of tasks) {
    if (task.state === 'running') await storage.metadata.put('tasks', task.id, {
      ...await workspace.taskFinal(task, true).catch(() => task), state: 'interrupted',
      trace: settleTrace(task.trace?.map((item) => item.kind === 'tool' && unknownMcp.some((attempt) => attempt.traceId === item.id) ?
        { ...item, state: 'unknown', output: '远端结果未知，可能已执行。请在 MCP 设置中核对后解除重试限制。', endedAt: new Date().toISOString() } : item), 'interrupted', new Date().toISOString()),
      error: workspace.needsRecovery(task.projectId) ? '部分修改尚未完成恢复，请保留本地数据。' :
        unknownMcp.some((attempt) => attempt.taskId === task.id) ? '任务已中断，部分 MCP 调用的远端结果未知，请先核对服务状态。' :
        '应用运行被中断，文件修改已恢复。可查看已完成结果后发起新任务。',
    });
  }
  return {
    workspace, ...storage, models, conversations, agentSettings, mcp, skills, agent: new TaskManager(workspace, models, Crypto.randomUUID, Platform.OS === 'web', conversations, agentSettings, mcp, skills),
    tasks: async (projectId: string, conversationId?: string) => (await storage.metadata.all<TaskRecord>('tasks'))
      .filter((task) => task.projectId === projectId && (!conversationId || task.conversationId === conversationId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export function getRuntime(): Promise<Runtime> {
  instance ??= initialize().catch((error) => { instance = undefined; throw error; });
  return instance;
}
