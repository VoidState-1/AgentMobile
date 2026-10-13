import '@/adapters/polyfills';
import * as Crypto from 'expo-crypto';
import type { ModelSettings, TaskRecord } from '@/core/prototype/types';
import { defaultSettings } from '@/core/prototype/types';
import { createStorage } from './storage/platform';
import { WorkspaceService } from './workspace/service';

let instance: Promise<Runtime> | undefined;
export type Runtime = Awaited<ReturnType<typeof initialize>>;

async function initialize() {
  const storage = await createStorage();
  const workspace = new WorkspaceService(storage.fs, storage.metadata, Crypto.randomUUID);
  await workspace.recover();
  const tasks = await storage.metadata.all<TaskRecord>('tasks');
  for (const task of tasks) {
    if (task.state === 'running') await storage.metadata.put('tasks', task.id, {
      ...task, state: 'interrupted', finalCommit: await workspace.git.head(task.projectId).catch(() => undefined),
      error: workspace.needsRecovery(task.projectId) ? '部分修改尚未完成恢复，请保留本地数据。' :
        '应用运行被中断，文件修改已恢复。可查看已完成结果后发起新任务。',
    });
  }
  return {
    workspace, ...storage,
    settings: async () => await storage.metadata.get<ModelSettings>('settings', 'model') ?? defaultSettings,
    tasks: async (projectId: string) => (await storage.metadata.all<TaskRecord>('tasks'))
      .filter((task) => task.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export function getRuntime(): Promise<Runtime> {
  instance ??= initialize().catch((error) => { instance = undefined; throw error; });
  return instance;
}
