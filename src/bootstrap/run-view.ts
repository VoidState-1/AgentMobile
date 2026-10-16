import type { ExecutionView } from '@/core/runs/types';
import type { RunView } from '@/core/runs/queries';

/** Only public display fields leave the kernel; frozen tools/config stay private. */
export function runView(value: ExecutionView): RunView {
  if (!value.conversationId) throw new Error('Execution conversation missing');
  const reason = value.stopReason;
  const code =
    reason?.kind === 'engine_error'
      ? reason.error.code
      : reason?.kind === 'deadline' || reason?.kind === 'budget_exhausted'
        ? 'LIMIT'
        : 'UNKNOWN';
  return {
    id: value.id,
    projectId: value.projectId,
    conversationId: value.conversationId,
    kind: value.kind ?? 'root',
    state: value.state,

    prompt: value.prompt,
    response: value.response,
    createdAt: value.createdAt,
    modelName: value.modelSnapshot?.modelName,
    connectionName: value.modelSnapshot?.connectionName,
    error: value.error ? { code, message: value.error } : undefined,
    stopReason: value.stopReason,
    proposalId: value.proposalId,
    baseCommit: value.baseCommit,
    finalCommit: value.finalCommit,
    baseSnapshot: value.baseSnapshot,
    finalSnapshot: value.finalSnapshot,
    baseIndexSnapshot: value.baseIndexSnapshot,
    finalIndexSnapshot: value.finalIndexSnapshot,
    changedPaths: value.changedPaths,
    uncommittedPaths: value.uncommittedPaths,
    trace: value.trace,
    children: value.children?.map(runView),
  };
}
