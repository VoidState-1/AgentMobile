import type { RunsApi } from '@/application/services';
import type { RunSummary, RunView } from '@/core/runs/queries';
import { traceView } from './trace-view';

const capacity = 50;
const views = new Map<string, Promise<RunView>>();

export function loadRunView(api: RunsApi, summary: RunSummary): Promise<RunView> {
  const key = summary.id + ':' + summary.revision;
  const cached = views.get(key);
  if (cached) {
    views.delete(key);
    views.set(key, cached);
    return cached;
  }
  const request = Promise.all([
    api.getDetail(summary.id),
    api.listTrace(summary.id),
    api.listChildren(summary.id),
  ]).then(([detail, trace, children]) => ({
    ...detail,
    trace: trace.nodes.map(traceView),
    traceCursor: trace.cursor,
    children: children.runs.reverse().map(child => ({
      id: child.id,
      projectId: child.projectId,
      conversationId: child.conversationId,
      kind: 'child' as const,
      state: child.state,
      prompt: child.promptPreview,
      response: '',
      createdAt: child.createdAt,
      modelName: child.modelName,
      connectionName: child.connectionName,
      error: child.error,
      proposalId: child.proposalId,
    })),
  }));
  views.set(key, request);
  while (views.size > capacity) views.delete(views.keys().next().value!);
  void request.catch(() => {
    if (views.get(key) === request) views.delete(key);
  });
  return request;
}

export function clearRunViewCache(): void {
  views.clear();
}
