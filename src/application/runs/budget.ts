import type { AgentLimits } from '@/core/agent/settings';
import type { MetadataStore } from '@/core/storage/contracts';
import { AppError } from '@/core/errors';
import type { RunGroupRecord } from '@/core/runs/groups';

/** One persisted budget for the root and every descendant; reserve before dispatch. */
export class GroupBudget {
  private queue: Promise<unknown> = Promise.resolve();
  private state?: RunGroupRecord;
  error?: string;
  constructor(private readonly store: MetadataStore, readonly rootRunId: string, private readonly limits: AgentLimits, private readonly now = () => Date.now()) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.catch(() => {}).then(work); this.queue = next; return next; }
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
  reserve(runId: string, resource: 'requests' | 'tools', child = false): Promise<void> {
    return this.exclusive(async () => {
      const next = this.snapshot();
      const maximum = resource === 'requests' ? next.limits.maxModelRounds : next.limits.maxToolCalls;
      const reserve = resource === 'requests' && child ? 2 : 0;
      if (this.now() >= new Date(next.deadlineAt).getTime()) this.timeout();
      else if (next[resource] >= maximum - reserve) {
        if (child && resource === 'requests') throw new AppError('LIMIT', '任务组需保留父任务汇总额度，无法继续派发子任务请求。');
        this.error = resource === 'requests' ? '达到任务组模型请求上限（' + maximum + ' 轮）。已完成的结果已保留。' :
          '达到任务组工具调用上限（' + maximum + ' 次）。已完成的修改已保留。';
      }
      if (this.error) throw new AppError('LIMIT', this.error);
      next[resource]++;
      const usage = next.byRun[runId] ?? { requests: 0, tools: 0 }; usage[resource]++; next.byRun[runId] = usage;
      try { await this.store.put('run-groups', this.rootRunId, next); this.state = next; }
      catch { this.error = '任务组预算保存失败，已停止派发，请重新打开应用恢复。'; throw new AppError('STORAGE', this.error); }
    });
  }
  timeout() { this.error = '达到任务组总时长上限（' + this.limits.maxRuntimeMs / 60_000 + ' 分钟）。已完成的修改已保留。'; }
}
