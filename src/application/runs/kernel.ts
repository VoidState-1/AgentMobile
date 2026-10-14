import { Signal } from '@/core/events/signal';
import { AppError, publicError } from '@/core/errors';
import { builtinAgents } from '@/core/agents/types';
import { contentLimits, defaultAgentSettings, validateAgentSettings } from '@/core/agent/settings';
import { mainSessionId } from '@/core/models/rules';
import type { TaskRecord } from '@/core/runs/types';
import { terminalRun, type RunRecord } from '@/core/runs/records';
import { defaultSchedulerLimits, type SchedulerLimits } from '@/core/runs/scheduling';
import type { WorkspaceApplication } from '@/application/workspace/service';
import type { ConversationService } from '@/application/conversations/service';
import type { AgentSettingsService } from '@/application/settings/agent';
import { startRun } from './controller';
import { GroupBudget } from './budget';
import { RunRepository } from './repository';
import { RequestScheduler, type RequestPermit } from './request-scheduler';
import type { PreparedRun, RunResourceFactory } from './resources';
import { DelegationSession } from './delegation';

export interface RunKernelSnapshot { active?: TaskRecord; completed?: TaskRecord; runs: readonly TaskRecord[]; error?: string; starting: boolean }
interface Entry {
  record: RunRecord; view: TaskRecord; abort: AbortController; admitted: boolean; executing: boolean;
  prepared?: PreparedRun; conversation?: { release(): void }; cleanup?: Promise<void>;
  delegation?: DelegationSession;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Application-owned queue and lifecycle. UI subscriptions never own execution. */
export class RunKernel {
  private readonly entries = new Map<string, Entry>();
  private readonly signal = new Signal();
  private commandQueue: Promise<unknown> = Promise.resolve();
  private foreground = true;
  private halted = false;
  private completed?: TaskRecord;
  private error?: string;
  private snapshot: RunKernelSnapshot = Object.freeze({ runs: [], starting: false });
  readonly requests: RequestScheduler;
  constructor(private readonly workspace: WorkspaceApplication, readonly repository: RunRepository, private readonly factory: RunResourceFactory,
    private readonly conversations: ConversationService, private readonly settings: AgentSettingsService, private readonly id: () => string,
    private readonly limits: SchedulerLimits = { ...defaultSchedulerLimits }) {
    this.requests = new RequestScheduler(limits.modelRequests, limits.connectionRequests);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => this.signal.subscribe(listener);
  private exclusive<T>(work: () => Promise<T>): Promise<T> { const next = this.commandQueue.catch(() => {}).then(work); this.commandQueue = next; return next; }
  private publish() {
    const entries = [...this.entries.values()]; const runs = entries.filter((entry) => entry.admitted).map((entry) => entry.view);
    this.snapshot = freeze(clone({ active: runs.find((run) => run.state !== 'queued') ?? runs[0], runs, completed: this.completed, error: this.error, starting: entries.some((entry) => !entry.admitted) }));
    this.signal.publish();
  }
  private cleanup(entry: Entry): Promise<void> {
    return entry.cleanup ??= (async () => { try { await entry.prepared?.release(); } finally { entry.conversation?.release(); } })();
  }
  private async halt() {
    this.halted = true; this.error = '任务状态保存失败，请重新打开应用恢复。';
    for (const entry of this.entries.values()) entry.abort.abort();
    // Preparing entries clean up after their factory resolves; active engines
    // finish their critical sections. Queued leases have no engine owner.
    for (const entry of this.entries.values()) if (entry.admitted && !entry.executing) {
      await this.cleanup(entry).catch(() => {}); this.entries.delete(entry.record.id);
    }
    this.publish();
  }
  async start(projectId: string, prompt: string, imageAttached = false, conversationId = mainSessionId(projectId), draftRevision?: number): Promise<void> {
    if (!prompt.trim() || prompt.length > contentLimits.promptCharacters + 300) throw new AppError('VALIDATION', '任务目标最多 16,000 字符。');
    if (this.halted) throw new AppError('STORAGE', '任务状态保存失败，请重新打开应用恢复。');
    // Reserve admission synchronously so two callers cannot race preparation.
    const pending = [...this.entries.values()].filter((entry) => !entry.executing);
    if (pending.length >= this.limits.queuedRoots || pending.filter((entry) => entry.record.projectId === projectId).length >= this.limits.queuedPerProject)
      throw new AppError('LIMIT', '待启动任务队列已满，请等待；草稿已保留。');
    if ([...this.entries.values()].some((entry) => entry.record.conversationId === conversationId)) throw new AppError('CONFLICT', '此对话已有待启动或运行中的任务。');
    const runId = this.id(); const settings = clone(this.settings.getSnapshot() ?? defaultAgentSettings()); validateAgentSettings(settings);
    const record: RunRecord = { schemaVersion: 2, id: runId, rootRunId: runId, kind: 'root', depth: 0, agentDefinitionId: 'main', agentDefinitionRevision: 1,
      launchSnapshotRef: runId, projectId, conversationId, draftRevision, prompt, mode: 'demo', agentSettingsSnapshot: settings,
      state: 'queued', response: '', events: [], createdAt: new Date().toISOString() };
    const entry: Entry = { record, view: { ...record, trace: [] }, abort: new AbortController(), admitted: false, executing: false };
    this.entries.set(runId, entry); this.error = undefined; this.publish();
    return this.exclusive(async () => {
      try {
        await this.conversations.ensureProject(projectId);
        entry.conversation = await this.conversations.acquireRun(conversationId, projectId, prompt.split('\n\n参考文件：')[0]);
        entry.prepared = await this.factory.prepare({ projectId, conversationId, prompt, imageAttached, settings });
        if (entry.abort.signal.aborted) throw new AppError('CANCELLED', '任务已取消，草稿已保留。');
        Object.assign(record, { mode: entry.prepared.launch.mode, modelSnapshot: entry.prepared.launch.modelSnapshot,
          mcpSnapshot: entry.prepared.resources.mcp?.snapshots, skillsSnapshot: entry.prepared.resources.skills?.snapshots });
        await this.repository.save(record, { id: runId, agent: builtinAgents[0], settings, model: record.modelSnapshot, mcp: record.mcpSnapshot, skills: record.skillsSnapshot }, []);
        entry.admitted = true; entry.view = { ...record, trace: [] }; this.publish();
        await this.conversations.acknowledgeSubmission(conversationId, draftRevision).catch(() => {
          this.error = '任务已入队，草稿清理尚未完成；重开时将根据运行记录修复。'; this.publish();
        });
        this.pump();
      } catch (error) {
        try { await this.cleanup(entry); } finally { this.entries.delete(runId); this.publish(); }
        throw error;
      }
    });
  }
  cancel = async (runId?: string): Promise<void> => {
    const entry = runId ? this.entries.get(runId) : [...this.entries.values()].find((entry) => entry.admitted) ?? [...this.entries.values()][0];
    if (!entry) {
      for (const root of this.entries.values()) if (runId && root.delegation?.owns(runId)) { await root.delegation.cancel(runId); return; }
      return;
    }
    entry.abort.abort();
    if (!entry.admitted) return;
    // executing includes baseline/resource preparation, before a Pi instance exists.
    await this.repository.cancel(entry.record.id).catch(async (error) => { await this.halt(); throw error; });
    if (entry.executing) { entry.view = { ...entry.view, state: 'cancelling' }; this.publish(); return; }
    try {
      const task = await this.repository.view(entry.record.id); await this.cleanup(entry);
      this.entries.delete(entry.record.id); this.completed = task; this.publish(); this.pump();
    } catch { await this.halt(); }
  };
  setForeground(foreground: boolean) {
    this.foreground = foreground; this.requests.setForeground(foreground);
    // Enqueued writes form a barrier before any later dispatch.
    if (!foreground) for (const entry of this.entries.values()) if (entry.admitted && entry.executing && !terminalRun(entry.view.state))
      void this.repository.saveTask(entry.view).catch(() => this.halt());
    if (foreground) this.pump();
  }
  private pump() {
    if (!this.foreground || this.halted) return;
    const running = [...this.entries.values()].filter((entry) => entry.executing);
    const projects = new Set(running.map((entry) => entry.record.projectId)); let slots = this.limits.activeRoots - running.length;
    for (const entry of this.entries.values()) {
      if (!slots) break;
      if (!entry.admitted || entry.executing || entry.abort.signal.aborted || projects.has(entry.record.projectId)) continue;
      entry.executing = true; projects.add(entry.record.projectId); slots--;
      void this.execute(entry);
    }
  }
  private async execute(entry: Entry) {
    const record = entry.record; const prepared = entry.prepared!;
    const budget = new GroupBudget(this.workspace.metadata, record.rootRunId, record.agentSettingsSnapshot!.limits);
    let groupSequence = 0; const nextGroupSequence = () => ++groupSequence;
    let permit: RequestPermit | undefined;
    const releaseRequest = () => { permit?.release(); permit = undefined; };
    try {
      const group = await budget.start();
      record.deadlineAt = group.deadlineAt; await this.repository.save(record);
      entry.delegation = prepared.createChild ? new DelegationSession(record, prepared, this.workspace, this.repository, budget, this.requests, this.limits, entry.abort, this.id, nextGroupSequence) : undefined;
      const started = await startRun(this.workspace, { ...prepared.launch, runId: record.id, projectId: record.projectId, conversationId: record.conversationId!, prompt: record.prompt,
        agentSettings: record.agentSettingsSnapshot!, draftRevision: record.draftRevision, createdAt: record.createdAt }, prepared.engine,
      { ...prepared.resources, execution: { persistence: this.repository.execution(), signal: entry.abort.signal, delegation: entry.delegation,
        traceIdentity: { runId: record.id, rootRunId: record.rootRunId, nextGroupSequence },
        remainingMs: () => budget.remainingMs(), error: () => budget.error, timeout: () => { budget.timeout(); entry.abort.abort(); },
        controls: { beforeRequest: async (signal) => {
          if (entry.abort.signal.aborted) throw new AppError('CANCELLED', '任务已取消。');
          permit = await this.requests.acquire(record.rootRunId, record.modelSnapshot?.connectionId ?? 'demo', signal ?? entry.abort.signal);
          try { if (entry.abort.signal.aborted) throw new AppError('CANCELLED', '任务已取消。'); await budget.reserve(record.id, 'requests'); }
          catch (error) { releaseRequest(); throw error; }
        }, afterRequest: releaseRequest, beforeTool: async () => {
          if (entry.abort.signal.aborted) return { block: true, reason: '任务已取消。', terminate: true };
          try { await budget.reserve(record.id, 'tools'); return; }
          catch (error) { return { block: true, reason: publicError(error).message, terminate: true }; }
        } } } }, (task) => {
        if (terminalRun(task.state)) return;
        entry.view = { ...task, state: entry.abort.signal.aborted ? 'cancelling' : task.state }; this.publish();
      });
      await started.done; await this.cleanup(entry);
      this.completed = await this.repository.view(record.id);
      this.entries.delete(record.id); this.publish();
    } catch (error) {
      // No engine / baseline yet: failure is still a durable terminal run.
      const stored = await this.repository.get(record.id).catch(() => undefined);
      if (stored?.state === 'cancelled' && !stored.baseSnapshot) {
        try { await this.cleanup(entry); this.completed = await this.repository.view(record.id); this.entries.delete(record.id); this.publish(); }
        catch { await this.halt(); }
      } else if (stored?.state === 'queued' || (stored?.state === 'cancelling' && !stored.baseSnapshot)) {
        try {
          await this.repository.save({ ...stored, state: entry.abort.signal.aborted ? 'cancelled' : 'failed', error: entry.abort.signal.aborted ? undefined : publicError(error).message });
          await this.cleanup(entry); this.completed = await this.repository.view(record.id); this.entries.delete(record.id); this.publish();
        } catch { await this.halt(); }
      } else { await this.halt(); }
      if (this.halted) { await this.cleanup(entry).catch(() => {}); this.entries.delete(record.id); this.publish(); }
    } finally { releaseRequest(); this.pump(); }
  }
}
