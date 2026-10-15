import type { EngineEvent, NotificationScheduler } from '@/core/agent/engine';
import type { ExecutionView } from '@/core/runs/types';
import type { RunPersistence } from './persistence';
import { finishTool, recordContent, settleTrace, type TraceItem } from '@/core/trace';
import type { TranscriptFrame } from '@/core/runs/trace-storage';
export interface TraceIdentitySource {
  runId: string;
  rootRunId: string;
  parentRunId?: string;
  nextGroupSequence(): number;
}
export class RunRecorder {
  private writes: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private cancelNotification?: () => void;
  private runSequence = 0;
  private dirty = new Set<string>();
  private frames: TranscriptFrame[] = [];
  private lastFrame = -1;
  private resultRevision = 0;
  private savedResultRevision = 0;
  private closing = false;
  constructor(
    private readonly task: ExecutionView,
    private readonly store: RunPersistence,
    private readonly update: (task: ExecutionView) => void,
    private readonly notifications: NotificationScheduler,
    private readonly sanitize: <T>(value: T) => T = value => value,
    private readonly label: (tool: string) => string | undefined = () => undefined,
    private readonly identity?: TraceIdentitySource,
  ) {
    task.trace ??= [];
    task.trace.forEach(item => this.dirty.add(item.id));
  }
  snapshot = (): ExecutionView => {
    if (this.identity)
      for (const item of this.task.trace!)
        if (item.runSequence === undefined)
          Object.assign(item, {
            runId: this.identity.runId,
            rootRunId: this.identity.rootRunId,
            parentRunId: this.identity.parentRunId,
            runSequence: ++this.runSequence,
            groupSequence: this.identity.nextGroupSequence(),
          });
    return {
      ...this.task,
      trace: this.task.trace!.map(item => ({ ...item })),
      children: this.task.children?.map(
        child => JSON.parse(JSON.stringify(child)) as ExecutionView,
      ),
      skillActivations: this.task.skillActivations?.map(item => ({ ...item })),
    };
  };
  publish(immediate = false) {
    if (immediate) {
      this.cancelNotification?.();
      this.cancelNotification = undefined;
      this.update(this.snapshot());
      return;
    }
    if (!this.cancelNotification)
      this.cancelNotification = this.notifications.schedule(() => {
        this.cancelNotification = undefined;
        this.update(this.snapshot());
      });
  }
  persist(saveResult = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (saveResult) this.resultRevision++;
    const copy = this.snapshot();
    const dirty = this.dirty;
    this.dirty = new Set();
    const changes = copy.trace!.filter(item => dirty.has(item.id));
    const frames = [...this.frames];
    const revision = this.resultRevision;
    this.writes = this.writes.then(async () => {
      const fresh = frames.filter(frame => frame.ordinal > this.lastFrame);
      await this.store.saveCheckpoint(copy, changes, fresh, revision > this.savedResultRevision);
      this.savedResultRevision = revision;
      this.lastFrame = fresh.at(-1)?.ordinal ?? this.lastFrame;
      this.frames = this.frames.filter(frame => frame.ordinal > this.lastFrame);
    });
    void this.writes.catch(() => {});
    return this.writes as Promise<void>;
  }
  beginFinalization() {
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.cancelNotification?.();
    this.cancelNotification = undefined;
  }
  private schedule() {
    if (!this.closing)
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.persist();
      }, 200);
  }
  private preview(value: unknown) {
    return (
      JSON.stringify(
        this.sanitize(value),
        (key, part) =>
          /token|secret|password|authorization|api.?key/i.test(key) ? '[已隐藏]' : part,
        2,
      )?.slice(0, 6000) ?? ''
    );
  }
  receive = (event: EngineEvent) => {
    const task = this.task;
    const now = new Date().toISOString();
    if (event.type === 'transcript_frame') {
      this.frames.push({
        runId: task.id,
        ordinal: event.ordinal,
        schemaVersion: event.schemaVersion,
        payload: event.payload,
      });
      this.schedule();
      return;
    }
    const prefix = task.id + ':' + event.round;
    if (event.type === 'assistant_start') {
      task.response = '';
      this.publish();
    }
    if (event.type === 'content') {
      recordContent(
        task.trace!,
        {
          id: prefix + ':' + event.index,
          round: event.round,
          contentIndex: event.index,
          kind: event.kind,
          text: event.text,
          visibility: event.visibility,
        },
        now,
        event.ended,
      );
      this.dirty.add(prefix + ':' + event.index);
      task.response = event.response;
      this.publish();
      this.schedule();
    }
    if (event.type === 'tool_start') {
      const args = event.args as Record<string, unknown>;
      const target =
        typeof args?.path === 'string'
          ? args.path
          : typeof args?.from === 'string'
            ? args.from + ' → ' + args.to
            : typeof args?.query === 'string'
              ? args.query
              : typeof args?.name === 'string'
                ? args.name
                : undefined;
      const item: TraceItem = {
        id: prefix + ':tool:' + event.callId,
        round: event.round,
        kind: 'tool',
        callId: event.callId,
        tool: event.tool,
        label: this.label(event.tool),
        target: this.sanitize(target),
        input: this.preview(args),
        state: 'running',
        startedAt: now,
      };
      task.trace!.push(item);
      this.dirty.add(item.id);
      this.publish(true);
      void this.persist();
    }
    if (event.type === 'tool_update' || event.type === 'tool_end') {
      const item = task.trace!.find(
        item => item.kind === 'tool' && item.round === event.round && item.callId === event.callId,
      );
      if (item?.kind === 'tool') {
        if (event.type === 'tool_update') item.output = event.output;
        else {
          finishTool(
            task.trace!,
            event.round,
            event.callId,
            event.output,
            event.error,
            now,
            event.durationMs,
          );
          if (event.unknown) item.state = 'unknown';
        }
        this.dirty.add(item.id);
      }
      if (event.type === 'tool_end') {
        this.publish(true);
        void this.persist(true);
      } else {
        this.publish();
        this.schedule();
      }
    }
    if (event.type === 'assistant_end') {
      task.response = event.response;
      this.publish();
      void this.persist(true);
    }
  };
  async finish(publish = true) {
    this.beginFinalization();
    this.task.trace = settleTrace(
      this.task.trace,
      this.task.state === 'failed'
        ? 'error'
        : ['queued', 'running', 'waiting_children', 'cancelling'].includes(this.task.state)
          ? 'interrupted'
          : (this.task.state as 'completed' | 'cancelled' | 'interrupted'),
      new Date().toISOString(),
    );
    this.task.trace?.forEach(item => this.dirty.add(item.id));
    await this.persist(true);
    if (publish) this.publish(true);
  }
}
