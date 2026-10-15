import type { HistoryEntry } from '@/core/agent/engine';

export function historyEntries(
  tasks: HistoryEntry[],
  count: number,
  characters: number,
): HistoryEntry[] {
  return (count ? tasks.slice(-count) : [])
    .reverse()
    .filter(task => {
      const size =
        Math.min(task.prompt.length, 8000) + Math.min((task.response || '').length, 12_000);
      if (size > characters) return false;
      characters -= size;
      return true;
    })
    .reverse()
    .map(task => ({
      prompt: task.prompt.slice(0, 8000),
      response: (task.response || '上一次任务未完成，请参考当前项目文件。').slice(0, 12_000),
      createdAt: task.createdAt,
    }));
}
