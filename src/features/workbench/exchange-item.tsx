import { runStateLabels, dateLabel } from '@/shared/format';
import type { RunSummary, RunView } from '@/core/runs/queries';
import { terminalRun } from '@/core/runs/records';
import { workbenchMetrics as metrics, useWorkbenchTheme } from '@/shared/theme';
import { T } from '@/shared/ui/primitives';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Artifacts, type ArtifactController } from './artifacts';
import { TaskTrace } from './trace';
import { traceView } from './trace-view';
import type { ConversationCapability } from './use-workbench';

export interface ExchangeRow {
  id: string;
  summary?: RunSummary;
  live?: RunView;
}
export function Exchange({
  row,
  visible,
  controller,
}: {
  row: ExchangeRow;
  visible: boolean;
  controller: ArtifactController &
    Pick<ConversationCapability, 'cancelChild' | 'reviewProposal' | 'runsApi'>;
}) {
  const [loaded, setLoaded] = useState<RunView>();
  const [error, setError] = useState('');
  const task = row.live ?? loaded;
  const theme = useWorkbenchTheme();
  useEffect(() => {
    if (!visible || row.live || !controller.runsApi) return;
    let current = true;
    const api = controller.runsApi;
    void Promise.all([api.getDetail(row.id), api.listTrace(row.id), api.listChildren(row.id)])
      .then(([detail, trace, children]) => {
        if (!current) return;
        const childViews: RunView[] = children.runs.reverse().map(child => ({
          id: child.id,
          projectId: child.projectId,
          conversationId: child.conversationId,
          kind: 'child',
          state: child.state,

          prompt: child.promptPreview,
          response: '',
          createdAt: child.createdAt,
          modelName: child.modelName,
          connectionName: child.connectionName,
          error: child.error,
          proposalId: child.proposalId,
        }));
        setLoaded({
          ...detail,
          trace: trace.nodes.map(traceView),
          traceCursor: trace.cursor,
          children: childViews,
        });
      })
      .catch(() => {
        if (current) setError('运行详情读取失败，请重新打开对话。');
      });
    return () => {
      current = false;
    };
  }, [visible, row.id, row.live, row.summary?.revision, controller.runsApi]);
  if (!task)
    return (
      <View style={{ paddingVertical: 12, gap: 6 }}>
        <T>{row.summary?.promptPreview}</T>
        <T tone={error ? 'danger' : 'muted'} variant="caption">
          {error || '读取中…'}
        </T>
      </View>
    );
  const paths = controller.changedPaths(task);
  return (
    <View style={{ gap: 10, marginBottom: 18 }}>
      <View style={{ alignItems: 'flex-end' }}>
        <View
          style={{
            backgroundColor: theme.inset,
            borderRadius: metrics.radius,
            paddingHorizontal: 10,
            paddingVertical: 7,
            maxWidth: '92%',
          }}
        >
          <T selectable style={{ fontSize: metrics.body, lineHeight: 23 }}>
            {task.prompt}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <T
          tone={
            task.state === 'failed' ? 'danger' : task.state === 'completed' ? 'muted' : 'accent'
          }
          variant="meta"
        >
          {runStateLabels[task.state]}
        </T>
        <T tone="muted" numberOfLines={1} variant="meta" style={{ flex: 1 }}>
          {task.modelName ?? '模型未记录'}
        </T>
        <T tone="muted" variant="meta">
          {dateLabel(task.createdAt)}
        </T>
      </View>
      <TaskTrace
        task={task}
        inspectProposal={id => {
          void controller.reviewProposal(task.id, id);
        }}
        runsApi={controller.runsApi}
        cancelChild={controller.cancelChild}
      />
      {!!task.error && (
        <View
          style={{ backgroundColor: theme.dangerSoft, borderRadius: metrics.radius, padding: 10 }}
        >
          <T tone="danger" variant="label">
            {task.error.message}
          </T>
        </View>
      )}
      {terminalRun(task.state) && paths.length > 0 && (
        <Artifacts task={task} controller={controller} />
      )}
    </View>
  );
}
