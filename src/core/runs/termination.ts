import { AppError, publicError } from '../errors';
import type { AppErrorCode } from '../errors';
import type { EngineSession } from '../agent/engine';

export interface PublicError {
  code: AppErrorCode;
  message: string;
  uncertain?: boolean;
}

type DirectStopReason =
  | { kind: 'user_cancel'; originRunId: string; at: string }
  | { kind: 'deadline'; originRunId: string; at: string; deadlineAt: string; message: string }
  | { kind: 'budget_exhausted'; originRunId: string; at: string; scope: 'run' | 'group'; resource: 'requests' | 'tools'; message: string }
  | { kind: 'engine_error'; originRunId: string; at: string; error: PublicError };

export type StopReason = DirectStopReason
  | { kind: 'ancestor_stopped'; originRunId: string; at: string; cause: DirectStopReason['kind']; message?: string }
  | { kind: 'app_interrupted'; at: string; previous?: Exclude<StopReason, { kind: 'app_interrupted' }> };

export interface RunOutcome {
  state: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stopReason?: StopReason;
  error?: string;
}

export function stoppedOutcome(reason: StopReason): RunOutcome {
  if (reason.kind === 'app_interrupted') return { state: 'interrupted', stopReason: reason };
  if (reason.kind === 'user_cancel' || (reason.kind === 'ancestor_stopped' && ['user_cancel', 'engine_error'].includes(reason.cause))) {
    return { state: 'cancelled', stopReason: reason };
  }
  const error = reason.kind === 'engine_error' ? reason.error.message : reason.message;
  return { state: 'failed', stopReason: reason, error };
}

/** One live execution's first accepted cause; AbortSignal is only its mechanism. */
export class RunStopController {
  private readonly abortController = new AbortController();
  private cause?: StopReason;

  constructor(readonly runId: string, private readonly now = () => new Date().toISOString()) {}
  get signal() { return this.abortController.signal; }
  get reason() { return this.cause; }

  request(reason: StopReason): boolean {
    if (this.cause) return false;
    this.cause = Object.freeze({ ...reason });
    this.abortController.abort();
    return true;
  }

  cancelUser() {
    this.request({ kind: 'user_cancel', originRunId: this.runId, at: this.now() });
  }

  inherit(reason: StopReason) {
    if (reason.kind === 'app_interrupted') return this.request(reason);
    const cause = reason.kind === 'ancestor_stopped' ? reason.cause : reason.kind;
    const message = reason.kind === 'engine_error' ? reason.error.message : 'message' in reason ? reason.message : undefined;
    this.request({ kind: 'ancestor_stopped', originRunId: reason.originRunId, at: this.now(), cause, message });
  }

  fail(error: unknown) {
    const safe = publicError(error);
    const limit = error instanceof AppError ? error.limit : undefined;
    if (limit?.kind === 'deadline' && limit.deadlineAt) {
      this.request({ kind: 'deadline', originRunId: this.runId, at: this.now(), deadlineAt: limit.deadlineAt, message: safe.message });
    } else if (limit?.kind === 'budget_exhausted' && limit.resource) {
      this.request({ kind: 'budget_exhausted', originRunId: this.runId, at: this.now(), scope: limit.scope, resource: limit.resource, message: safe.message });
    } else {
      this.request({ kind: 'engine_error', originRunId: this.runId, at: this.now(), error: { code: safe.code, message: safe.message, uncertain: safe.uncertain } });
    }
  }

  resolve(result: Awaited<ReturnType<EngineSession['execute']>>, outputTokens: number): RunOutcome {
    if (this.cause) return stoppedOutcome(this.cause);
    if (result.stopReason === 'stop' && !result.error) return { state: 'completed' };
    const message = result.error ?? (result.stopReason === 'length'
      ? '模型达到单轮输出上限（' + outputTokens + ' tokens），请在模型配置中提高，或让模型分段处理。已完成的修改已保留。'
      : result.stopReason === 'aborted' ? '引擎已中止，但没有宿主停止原因。已完成的修改已保留。' : '模型未完整结束，已完成的修改已保留。');
    this.fail(new AppError('REMOTE', message));
    return stoppedOutcome(this.cause!);
  }
}
