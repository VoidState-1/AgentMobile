import { expect, it } from 'vitest';
import { AppError } from '../src/core/errors';
import { RunStopController, stoppedOutcome } from '../src/core/runs/termination';

it('首次明确原因锁定，用户停止不会被随后到期的预算改为失败', () => {
  const stop = new RunStopController('root', () => '2026-10-14T00:00:00Z');
  stop.cancelUser();
  stop.fail(
    new AppError('LIMIT', '到期', false, {
      kind: 'deadline',
      scope: 'group',
      deadlineAt: '2026-10-14T00:00:00Z',
    }),
  );
  expect(stop.signal.aborted).toBe(true);
  expect(stop.resolve({ stopReason: 'aborted' }, 4096)).toMatchObject({
    state: 'cancelled',
    stopReason: { kind: 'user_cancel', originRunId: 'root' },
  });
});

it('截止和子配额通过结构化信息分类，修改文案不改变状态或额度范围', () => {
  const deadline = new RunStopController('root');
  deadline.fail(
    new AppError('LIMIT', '任意宿主文案', false, {
      kind: 'deadline',
      scope: 'group',
      deadlineAt: '2026-10-14T00:01:00Z',
    }),
  );
  expect(deadline.resolve({ stopReason: 'aborted' }, 4096)).toMatchObject({
    state: 'failed',
    error: '任意宿主文案',
    stopReason: { kind: 'deadline' },
  });
  const child = new RunStopController('child');
  child.fail(
    new AppError('LIMIT', 'quota', false, {
      kind: 'budget_exhausted',
      scope: 'run',
      resource: 'tools',
    }),
  );
  expect(child.resolve({ stopReason: 'stop' }, 4096)).toMatchObject({
    state: 'failed',
    stopReason: { kind: 'budget_exhausted', scope: 'run', resource: 'tools' },
  });
});

it('祖先用户停止与截止保持来源；无宿主原因的 aborted 不能声称用户取消', () => {
  const parent = new RunStopController('root');
  parent.cancelUser();
  const child = new RunStopController('child');
  child.inherit(parent.reason!);
  expect(child.resolve({ stopReason: 'aborted' }, 4096)).toMatchObject({
    state: 'cancelled',
    stopReason: { kind: 'ancestor_stopped', cause: 'user_cancel', originRunId: 'root' },
  });
  expect(
    stoppedOutcome({
      kind: 'ancestor_stopped',
      originRunId: 'root',
      cause: 'deadline',
      at: 'now',
      message: '到期',
    }),
  ).toMatchObject({ state: 'failed', error: '到期' });
  const engineAborted = new RunStopController('other');
  expect(engineAborted.resolve({ stopReason: 'aborted' }, 4096)).toMatchObject({
    state: 'failed',
    stopReason: { kind: 'engine_error' },
  });
});
