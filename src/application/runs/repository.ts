import type { MetadataEntry, MetadataStore } from '@/core/storage/contracts';
import type { TaskRecord } from '@/core/runs/types';
import { terminalRun, type DelegationReceipt, type LaunchSnapshot, type RunRecord } from '@/core/runs/records';
import type { TraceItem } from '@/core/trace';
import { AppError } from '@/core/errors';

const runsBucket = 'runs-v2';
interface RunIndex { ids: string[] }
export interface RunPage { runs: RunRecord[]; cursor?: string }

/** Typed, indexed metadata access. New execution never overwrites the legacy tasks bucket. */
export class RunRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: MetadataStore) {
    if (!store.batch) throw new AppError('STORAGE', '运行仓库需要原子元数据批次能力。');
  }
  private exclusive<T>(work: () => Promise<T>) { const next = this.queue.catch(() => {}).then(work); this.queue = next; return next; }
  private batch(entries: MetadataEntry[]) { return this.store.batch!(entries); }
  private async indexes(run: RunRecord): Promise<MetadataEntry[]> {
    const keys = ['root/' + run.rootRunId];
    if (run.kind === 'root') keys.push('project/' + run.projectId, 'conversation/' + run.projectId + '/' + run.conversationId);
    const entries: MetadataEntry[] = [];
    for (const id of keys) {
      const index = await this.store.get<RunIndex>('run-indexes', id) ?? { ids: [] };
      if (!index.ids.includes(run.id)) entries.push({ bucket: 'run-indexes', id, value: { ids: [...index.ids, run.id] } });
    }
    return entries;
  }
  get(id: string) { return this.store.get<RunRecord>(runsBucket, id); }
  launch(id: string) { return this.store.get<LaunchSnapshot>('run-launches', id); }
  async save(run: RunRecord, launch?: LaunchSnapshot): Promise<void> {
    return this.exclusive(async () => {
      const entries = [{ bucket: runsBucket, id: run.id, value: run }, ...await this.indexes(run)];
      if (launch) entries.push({ bucket: 'run-launches', id: launch.id, value: launch });
      await this.batch(entries);
    });
  }
  async initialize(): Promise<void> {
    const legacy = (await this.store.all<TaskRecord>('tasks')).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const task of legacy) await this.exclusive(async () => {
      if (await this.get(task.id)) return;
      const { trace, ...fields } = task;
      const run: RunRecord = { ...fields, schemaVersion: 2, rootRunId: task.id, kind: 'root', depth: 0,
        agentDefinitionId: 'legacy-main', agentDefinitionRevision: 0, launchSnapshotRef: task.id, inputSnapshotRef: task.baseSnapshot };
      const launch: LaunchSnapshot = { id: task.id, legacy: true, settings: task.agentSettingsSnapshot, model: task.modelSnapshot, mcp: task.mcpSnapshot, skills: task.skillsSnapshot };
      await this.batch([{ bucket: runsBucket, id: run.id, value: run }, { bucket: 'run-launches', id: launch.id, value: launch },
        { bucket: 'run-traces', id: run.id, value: trace ?? [] }, { bucket: 'run-migrations', id: run.id, value: { source: 'tasks', state: 'recorded' } }, ...await this.indexes(run)]);
    });
  }
  async list(projectId: string, conversationId?: string, cursor?: string, limit = 30): Promise<RunPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('VALIDATION', '运行查询每页需要 1–100 条。');
    const id = conversationId ? 'conversation/' + projectId + '/' + conversationId : 'project/' + projectId;
    const index = await this.store.get<RunIndex>('run-indexes', id) ?? { ids: [] };
    const ids = [...index.ids].reverse(); const start = cursor ? ids.indexOf(cursor) + 1 : 0;
    if (cursor && start === 0) throw new AppError('CONFLICT', '运行列表游标已变化，请重新读取。');
    const selected = ids.slice(start, start + limit); const runs: RunRecord[] = [];
    for (const id of selected) { const run = await this.get(id); if (run) runs.push(run); }
    return { runs, cursor: start + limit < ids.length ? selected.at(-1) : undefined };
  }
  async group(rootRunId: string): Promise<RunRecord[]> {
    const index = await this.store.get<RunIndex>('run-indexes', 'root/' + rootRunId) ?? { ids: [] };
    const runs: RunRecord[] = [];
    for (const id of index.ids) { const run = await this.get(id); if (run) runs.push(run); }
    return runs;
  }
  createChild(receipt: DelegationReceipt, child: RunRecord, launch: LaunchSnapshot): Promise<string> {
    return this.exclusive(async () => {
      const previous = await this.store.get<DelegationReceipt>('run-delegations', receipt.id);
      if (previous) {
        if (previous.parentRunId !== receipt.parentRunId || previous.fingerprint !== receipt.fingerprint) throw new AppError('CONFLICT', '委派调用与已保存参数不匹配。');
        return previous.childRunId;
      }
      const parent = await this.get(receipt.parentRunId);
      if (!parent || terminalRun(parent.state) || child.parentRunId !== parent.id || child.rootRunId !== parent.rootRunId || child.projectId !== parent.projectId || child.conversationId !== parent.conversationId || receipt.childRunId !== child.id || child.launchSnapshotRef !== launch.id)
        throw new AppError('VALIDATION', '子任务与父任务的范围不匹配。');
      if (await this.get(child.id)) throw new AppError('CONFLICT', '子任务标识已存在。');
      await this.batch([{ bucket: runsBucket, id: child.id, value: child }, { bucket: 'run-launches', id: launch.id, value: launch },
        { bucket: 'run-delegations', id: receipt.id, value: receipt }, ...await this.indexes(child)]);
      return child.id;
    });
  }
  trace(id: string) { return this.store.get<TraceItem[]>('run-traces', id).then((value) => value ?? []); }
  saveTrace(id: string, trace: TraceItem[]) { return this.store.put('run-traces', id, trace); }
  transcript(id: string) { return this.store.get<unknown>('run-transcripts', id); }
  saveTranscript(id: string, transcript: unknown) { return this.store.put('run-transcripts', id, transcript); }
}
