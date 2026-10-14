import '@/adapters/polyfills';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { TaskRecord } from '@/core/prototype/types';
import { settleTrace } from '@/core/prototype/trace';
import { ModelConfigurationService } from '@/core/models/service';
import { ConversationService } from '@/core/conversations/service';
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
  await workspace.recover();
  const conversations = new ConversationService(storage.metadata, Crypto.randomUUID);
  await conversations.initialize(await workspace.projects());
  const tasks = await storage.metadata.all<TaskRecord>('tasks');
  for (const task of tasks) {
    if (task.state === 'running') await storage.metadata.put('tasks', task.id, {
      ...task, state: 'interrupted', finalCommit: await workspace.git.head(task.projectId).catch(() => undefined),
      trace: settleTrace(task.trace, 'interrupted', new Date().toISOString()),
      error: workspace.needsRecovery(task.projectId) ? '部分修改尚未完成恢复，请保留本地数据。' :
        '应用运行被中断，文件修改已恢复。可查看已完成结果后发起新任务。',
    });
  }
  return {
    workspace, ...storage, models, conversations, agent: new TaskManager(workspace, models, Crypto.randomUUID, Platform.OS === 'web', conversations),
    tasks: async (projectId: string, conversationId?: string) => (await storage.metadata.all<TaskRecord>('tasks'))
      .filter((task) => task.projectId === projectId && (!conversationId || task.conversationId === conversationId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export function getRuntime(): Promise<Runtime> {
  instance ??= initialize().catch((error) => { instance = undefined; throw error; });
  return instance;
}
