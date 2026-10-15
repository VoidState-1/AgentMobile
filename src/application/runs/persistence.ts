import type { HistoryEntry } from '@/core/agent/engine';
import type { ExecutionView } from '@/core/runs/types';
import type { TraceItem } from '@/core/trace';
import type { TranscriptFrame } from '@/core/runs/trace-storage';

export interface HistoryQuery { projectId: string; conversationId: string; mode: ExecutionView['mode']; count: number; characters: number }
export interface RunPersistence {
  saveCheckpoint(task: ExecutionView, changes: TraceItem[], frames: TranscriptFrame[], saveResult: boolean): Promise<void>;
  history(query: HistoryQuery): Promise<HistoryEntry[]>;
}
