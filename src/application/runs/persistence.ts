import type { HistoryEntry } from '@/core/agent/engine';
import type { TaskRecord } from '@/core/runs/types';
import type { MetadataStore } from '@/core/storage/contracts';
import { conversationHistory } from './context';

export interface HistoryQuery { projectId: string; conversationId: string; mode: TaskRecord['mode']; count: number; characters: number }
export interface RunPersistence {
  saveTask(task: TaskRecord): Promise<void>;
  saveTranscript(id: string, transcript: unknown): Promise<void>;
  history(query: HistoryQuery): Promise<HistoryEntry[]>;
}

/** Only direct legacy runner callers use this; the app writes v2 exclusively. */
export function legacyRunPersistence(store: MetadataStore): RunPersistence {
  return {
    saveTask: (task) => store.put('tasks', task.id, task),
    saveTranscript: (id, transcript) => store.put('transcripts', id, transcript),
    history: (q) => conversationHistory(store, q.projectId, q.conversationId, q.mode, q.count, q.characters),
  };
}
