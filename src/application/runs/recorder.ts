import type { EngineEvent } from '@/core/agent/engine';
import type { TaskRecord } from '@/core/runs/types';
import type { RunPersistence } from './persistence';
import { finishTool, recordContent, settleTrace } from '@/core/trace';

export class RunRecorder {
  private writes: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private readonly indexes = new Map<string, number>();
  constructor(private readonly task: TaskRecord, private readonly store: RunPersistence, private readonly update: (task: TaskRecord) => void,
    private readonly sanitize: <T>(value: T) => T = (value) => value, private readonly label: (tool: string) => string | undefined = () => undefined) { task.trace ??= []; }
  snapshot = (): TaskRecord => ({ ...this.task, events: this.task.events.map((item) => ({ ...item })), trace: this.task.trace!.map((item) => ({ ...item })), skillActivations: this.task.skillActivations?.map((item) => ({ ...item })) });
  publish() { this.update(this.snapshot()); }
  persist(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const copy = this.snapshot(); this.writes = this.writes.then(() => this.store.saveTask(copy));
    void this.writes.catch(() => {}); return this.writes as Promise<void>;
  }
  private schedule() { this.timer ??= setTimeout(() => { this.timer = undefined; void this.persist(); }, 200); }
  private preview(value: unknown) { return JSON.stringify(this.sanitize(value), (key, part) => /token|secret|password|authorization|api.?key/i.test(key) ? '[已隐藏]' : part, 2)?.slice(0, 6000) ?? ''; }
  receive = (event: EngineEvent) => {
    const task = this.task; const now = new Date().toISOString(); const prefix = task.id + ':' + event.round;
    if (event.type === 'assistant_start') { task.response = ''; this.publish(); }
    if (event.type === 'content') {
      recordContent(task.trace!, { id: prefix + ':' + event.index, round: event.round, contentIndex: event.index, kind: event.kind,
        text: event.text, visibility: event.visibility }, now, event.ended);
      task.response = event.response; this.publish(); this.schedule();
    }
    if (event.type === 'tool_start') {
      this.indexes.set(event.round + ':' + event.callId, task.events.length); task.events.push({ tool: event.tool, state: 'started', description: '执行中' });
      const args = event.args as Record<string, unknown>;
      const target = typeof args?.path === 'string' ? args.path : typeof args?.from === 'string' ? args.from + ' → ' + args.to : typeof args?.query === 'string' ? args.query : typeof args?.name === 'string' ? args.name : undefined;
      task.trace!.push({ id: prefix + ':tool:' + event.callId, round: event.round, kind: 'tool', callId: event.callId, tool: event.tool,
        label: this.label(event.tool), target: this.sanitize(target), input: this.preview(args), state: 'running', startedAt: now });
      this.publish(); void this.persist();
    }
    if (event.type === 'tool_update') {
      const item = task.trace!.find((item) => item.kind === 'tool' && item.round === event.round && item.callId === event.callId);
      if (item?.kind === 'tool') item.output = event.output; this.publish(); this.schedule();
    }
    if (event.type === 'tool_end') {
      const index = this.indexes.get(event.round + ':' + event.callId); const item = index === undefined ? undefined : task.events[index];
      if (item) { item.state = event.error ? 'error' : 'done'; item.description = event.error ? '工具执行失败' : '已完成'; }
      finishTool(task.trace!, event.round, event.callId, event.output, event.error, now, event.durationMs);
      if (event.unknown) { const trace = task.trace!.find((value) => value.kind === 'tool' && value.round === event.round && value.callId === event.callId);
        if (trace) trace.state = 'unknown'; if (item) item.description = '远端结果未知'; }
      this.publish(); void this.persist();
    }
    if (event.type === 'assistant_end') {
      task.response = event.response; const transcript = event.transcript;
      this.writes = this.writes.then(() => this.store.saveTranscript(task.id, transcript));
      void this.writes.catch(() => {});
      this.publish(); void this.persist();
    }
  };
  async finish(publish = true) {
    this.task.trace = settleTrace(this.task.trace, this.task.state === 'failed' ? 'error' : ['queued', 'running', 'waiting_children', 'cancelling'].includes(this.task.state) ? 'interrupted' : this.task.state as 'completed' | 'cancelled' | 'interrupted', new Date().toISOString());
    await this.persist(); if (publish) this.publish();
  }
}
