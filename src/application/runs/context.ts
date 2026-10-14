import type { HistoryEntry } from '@/core/agent/engine';
import type { TaskRecord } from '@/core/runs/types';
import type { MetadataStore } from '@/core/storage/contracts';
import { terminalRun } from '@/core/runs/records';

export async function conversationHistory(store: MetadataStore, projectId: string, conversationId: string, mode: TaskRecord['mode'], count: number, characters: number): Promise<HistoryEntry[]> {
  const tasks = (await store.all<TaskRecord>('tasks')).filter((task) => task.projectId === projectId &&
    (task.conversationId ?? task.projectId + ':main') === conversationId && task.mode === mode && terminalRun(task.state))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return historyEntries(tasks, count, characters);
}

export function historyEntries(tasks: TaskRecord[], count: number, characters: number): HistoryEntry[] {
  return (count ? tasks.slice(-count) : []).reverse().filter((task) => {
    const size = Math.min(task.prompt.length, 8000) + Math.min((task.response || '').length, 12_000);
    if (size > characters) return false; characters -= size; return true;
  }).reverse().map((task) => ({ prompt: task.prompt.slice(0, 8000), response: (task.response || '上一次任务未完成，请参考当前项目文件。').slice(0, 12_000), createdAt: task.createdAt }));
}
