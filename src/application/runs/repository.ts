import type { MetadataEntry, MetadataStore } from '@/core/storage/contracts';
import type { TaskRecord } from '@/core/runs/types';
import { terminalRun, type DelegationReceipt, type LaunchSnapshot, type RunRecord } from '@/core/runs/records';
import type { TraceItem } from '@/core/trace';
import { AppError } from '@/core/errors';
import { mainSessionId } from '@/core/models/rules';
import { historyEntries } from './context';
import type { RunPersistence } from './persistence';

const runsBucket = 'runs-v2';
interface RunIndex { ids: string[] }
export interface RunPage { runs: RunRecord[]; cursor?: string }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
  private async activeIndex(run: RunRecord): Promise<MetadataEntry> {
    const previous = await this.store.get<RunIndex>('run-indexes', 'active') ?? { ids: [] };
    const ids = previous.ids.filter((id) => id !== run.id);
    if (!terminalRun(run.state)) ids.push(run.id);
    return { bucket: 'run-indexes', id: 'active', value: { ids } };
  }
  get(id: string) { return this.store.get<RunRecord>(runsBucket, id); }
  launch(id: string) { return this.store.get<LaunchSnapshot>('run-launches', id); }
  private async write(run: RunRecord, launch?: LaunchSnapshot, trace?: TraceItem[]): Promise<void> {
    const previous = await this.get(run.id);
    // A delayed progress write cannot resurrect a terminal run or undo cancel.
    if (previous && terminalRun(previous.state)) return;
    if (previous && (previous.rootRunId !== run.rootRunId || previous.projectId !== run.projectId || previous.parentRunId !== run.parentRunId))
      throw new AppError('CONFLICT', '运行归属不能修改。');
    if (previous?.state === 'cancelling') {
      if (!terminalRun(run.state)) run.state = 'cancelling';
      else if (run.state === 'completed') run.state = 'cancelled';
    }
    run.revision = (previous?.revision ?? 0) + 1;
    const entries = [{ bucket: runsBucket, id: run.id, value: run }, ...await this.indexes(run), await this.activeIndex(run)];
    if (launch) entries.push({ bucket: 'run-launches', id: launch.id, value: launch });
    if (trace) entries.push({ bucket: 'run-traces', id: run.id, value: trace });
    await this.batch(entries);
  }
  save(run: RunRecord, launch?: LaunchSnapshot, trace?: TraceItem[]): Promise<void> {
    const frozen = copy(run); const frozenLaunch = launch && copy(launch); const frozenTrace = trace && copy(trace);
    return this.exclusive(() => this.write(frozen, frozenLaunch, frozenTrace));
  }
  saveTask(task: TaskRecord): Promise<void> {
    const { trace, ...fields } = copy(task);
    return this.exclusive(async () => {
      const previous = await this.get(task.id);
      if (!previous) throw new AppError('STORAGE', '运行记录不存在。');
      await this.write({ ...previous, ...fields, inputSnapshotRef: fields.baseSnapshot ?? previous.inputSnapshotRef }, undefined, trace);
    });
  }
  cancel(id: string): Promise<void> {
    return this.exclusive(async () => {
      const run = await this.get(id);
      if (run && !terminalRun(run.state)) await this.write({ ...run, state: run.state === 'queued' ? 'cancelled' : 'cancelling' });
    });
  }
  execution(): RunPersistence {
    return { saveTask: (task) => this.saveTask(task), saveTranscript: (id, transcript) => this.saveTranscript(id, transcript),
      history: async (q) => {
        const tasks: TaskRecord[] = []; let cursor: string | undefined;
        do {
          const page = await this.list(q.projectId, q.conversationId, cursor, 50);
          for (const run of page.runs) if (run.mode === q.mode && terminalRun(run.state)) tasks.push(run);
          cursor = page.cursor;
        } while (cursor && tasks.length < q.count);
        return historyEntries(tasks.reverse(), q.count, q.characters);
      } };
  }
  async view(id: string): Promise<TaskRecord | undefined> {
    const run = await this.get(id); if (!run) return;
    return { ...run, trace: run.legacyTraceMissing ? undefined : await this.trace(id) };
  }
  async views(projectId: string, conversationId?: string): Promise<TaskRecord[]> {
    const tasks: TaskRecord[] = []; let cursor: string | undefined;
    do {
      const page = await this.list(projectId, conversationId, cursor, 100);
      for (const run of page.runs) tasks.push({ ...run, trace: run.legacyTraceMissing ? undefined : await this.trace(run.id) });
      cursor = page.cursor;
    } while (cursor);
    return tasks;
  }
  async active(): Promise<RunRecord[]> {
    const index = await this.store.get<RunIndex>('run-indexes', 'active') ?? { ids: [] };
    const runs: RunRecord[] = [];
    for (const id of index.ids) { const run = await this.get(id); if (run && !terminalRun(run.state)) runs.push(run); }
    return runs;
  }
  async initialize(): Promise<void> {
    const legacy = (await this.store.all<TaskRecord>('tasks')).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const task of legacy) await this.exclusive(async () => {
      if (await this.get(task.id)) return;
      const { trace, ...fields } = task;
      const run: RunRecord = { ...fields, conversationId: task.conversationId ?? mainSessionId(task.projectId), schemaVersion: 2, rootRunId: task.id, kind: 'root', depth: 0,
        agentDefinitionId: 'legacy-main', agentDefinitionRevision: 0, launchSnapshotRef: task.id, inputSnapshotRef: task.baseSnapshot, legacyTraceMissing: trace === undefined };
      const launch: LaunchSnapshot = { id: task.id, legacy: true, settings: task.agentSettingsSnapshot, model: task.modelSnapshot, mcp: task.mcpSnapshot, skills: task.skillsSnapshot };
      const entries: MetadataEntry[] = [{ bucket: runsBucket, id: run.id, value: run }, { bucket: 'run-launches', id: launch.id, value: launch },
        { bucket: 'run-traces', id: run.id, value: trace ?? [] }, { bucket: 'run-migrations', id: run.id, value: { source: 'tasks', state: 'recorded' } }, ...await this.indexes(run), await this.activeIndex(run)];
      const transcript = await this.store.get<unknown>('transcripts', task.id);
      if (transcript) entries.push({ bucket: 'run-transcripts', id: run.id, value: transcript });
      await this.batch(entries);
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
        { bucket: 'run-delegations', id: receipt.id, value: receipt }, ...await this.indexes(child), await this.activeIndex(child)]);
      return child.id;
    });
  }
  trace(id: string) { return this.store.get<TraceItem[]>('run-traces', id).then((value) => value ?? []); }
  saveTrace(id: string, trace: TraceItem[]) { const value = copy(trace); return this.exclusive(() => this.store.put('run-traces', id, value)); }
  transcript(id: string) { return this.store.get<unknown>('run-transcripts', id); }
  saveTranscript(id: string, transcript: unknown) { const value = copy(transcript); return this.exclusive(() => this.store.put('run-transcripts', id, value)); }
}
