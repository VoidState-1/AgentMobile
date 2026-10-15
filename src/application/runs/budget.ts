import { SerialQueue } from '@/core/serial-queue';
import type { AgentLimits } from '@/core/agent/settings';
import type { MetadataStore } from '@/core/storage/contracts';
import { AppError } from '@/core/errors';
import type { RunGroupRecord } from '@/core/runs/groups';

/** One persisted budget for the root and every descendant; reserve before dispatch. */
export class GroupBudget {
  private readonly queue = new SerialQueue();
  private state?: RunGroupRecord;
  error?: AppError;
  constructor(private readonly store: MetadataStore, readonly rootRunId: string, private readonly limits: AgentLimits, private readonly now = () => Date.now()) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> { return this.queue.run(work); }
  async start(): Promise<RunGroupRecord> {
    return this.exclusive(async () => {
      this.state = await this.store.get<RunGroupRecord>('run-groups', this.rootRunId) ?? {
        schemaVersion: 1, rootRunId: this.rootRunId, limits: { ...this.limits }, deadlineAt: new Date(this.now() + this.limits.maxRuntimeMs).toISOString(), requests: 0, tools: 0, byRun: {},
      };
      await this.store.put('run-groups', this.rootRunId, this.state); return this.snapshot();
    });
  }
  snapshot(): RunGroupRecord { if (!this.state) throw new AppError('STORAGE', '任务组预算尚未启动。'); return JSON.parse(JSON.stringify(this.state)) as RunGroupRecord; }
  remainingMs() { return Math.max(0, new Date(this.snapshot().deadlineAt).getTime() - this.now()); }
  allocate(runId: string, allocation: { requests: number; tools: number }, commit: (group: RunGroupRecord) => Promise<void>): Promise<void> {
    return this.exclusive(async () => {
      const next = this.snapshot();
      if (this.remainingMs() <= 0) throw this.timeout();
      if (!Number.isInteger(allocation.requests) || allocation.requests < 1 || !Number.isInteger(allocation.tools) || allocation.tools < 1) throw new AppError('VALIDATION', '子任务预算必须为正整数。');
      const outstanding = (resource: 'requests' | 'tools') => Object.entries(next.allocations ?? {}).reduce((sum, [id, quota]) => sum + Math.max(0, quota[resource] - (next.byRun[id]?.[resource] ?? 0)), 0);
      if (next.requests + outstanding('requests') + allocation.requests + 2 > next.limits.maxModelRounds || next.tools + outstanding('tools') + allocation.tools > next.limits.maxToolCalls)
        throw new AppError('LIMIT', '任务组剩余额度不足以分配子任务并保留父任务汇总额度。');
      next.allocations = { ...next.allocations, [runId]: { ...allocation } };
      // The child, receipt and allocation commit in one metadata transaction.
      await commit(next); this.state = next;
    });
  }
  releaseAllocation(runId: string): Promise<void> {
    return this.exclusive(async () => {
      const next = this.snapshot(); if (!next.allocations?.[runId]) return;
      delete next.allocations[runId]; await this.store.put('run-groups', this.rootRunId, next); this.state = next;
    });
  }
  reserve(runId: string, resource: 'requests' | 'tools', child = false): Promise<void> {
    return this.exclusive(async () => {
      const next = this.snapshot();
      const maximum = resource === 'requests' ? next.limits.maxModelRounds : next.limits.maxToolCalls;
      const reserve = resource === 'requests' && child ? 2 : 0;
      const allocation = next.allocations?.[runId];
      if (child && (!allocation || (next.byRun[runId]?.[resource] ?? 0) >= allocation[resource])) throw new AppError('LIMIT', '达到子任务分配的' + (resource === 'requests' ? '模型请求' : '工具调用') + '上限。', false,
        { kind: 'budget_exhausted', scope: 'run', resource });
      if (this.now() >= new Date(next.deadlineAt).getTime()) this.timeout();
      else if (next[resource] >= maximum - reserve) {
        if (child && resource === 'requests') throw new AppError('LIMIT', '任务组需保留父任务汇总额度，无法继续派发子任务请求。', false,
          { kind: 'budget_exhausted', scope: 'run', resource });
        this.error = new AppError('LIMIT', resource === 'requests' ? '达到任务组模型请求上限（' + maximum + ' 轮）。已完成的结果已保留。' :
          '达到任务组工具调用上限（' + maximum + ' 次）。已完成的修改已保留。', false, { kind: 'budget_exhausted', scope: 'group', resource });
      }
      if (this.error) throw this.error;
      next[resource]++;
      const usage = next.byRun[runId] ?? { requests: 0, tools: 0 }; usage[resource]++; next.byRun[runId] = usage;
      try { await this.store.put('run-groups', this.rootRunId, next); this.state = next; }
      catch { this.error = new AppError('STORAGE', '任务组预算保存失败，已停止派发，请重新打开应用恢复。'); throw this.error; }
    });
  }
  timeout(): AppError {
    this.error ??= new AppError('LIMIT', '达到任务组总时长上限（' + this.limits.maxRuntimeMs / 60_000 + ' 分钟）。已完成的修改已保留。', false,
      { kind: 'deadline', scope: 'group', deadlineAt: this.snapshot().deadlineAt });
    return this.error;
  }
}
