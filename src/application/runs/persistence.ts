import type { HistoryEntry } from '@/core/agent/engine';
import type { TaskRecord } from '@/core/runs/types';

export interface HistoryQuery { projectId: string; conversationId: string; mode: TaskRecord['mode']; count: number; characters: number }
export interface RunPersistence {
  saveTask(task: TaskRecord): Promise<void>;
  saveTranscript(id: string, transcript: unknown): Promise<void>;
  history(query: HistoryQuery): Promise<HistoryEntry[]>;
}
