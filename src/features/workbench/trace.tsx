import { runStateLabels, toolLabels } from '@/shared/format';
import type { RunsApi } from '@/application/services';
import type { DisplayTrace, RunView } from '@/core/runs/queries';
import { terminalRun } from '@/core/runs/records';
import { textEnd, traceLimits } from '@/core/runs/trace-storage';
import type { ContentTrace, ToolTrace } from '@/core/trace';
import { useWorkbenchTheme } from '@/shared/theme';
import { DisclosureRow } from '@/shared/ui/disclosure-row';
import {
  Brain,
  Check,
  CircleAlert,
  FileText,
  GitCommitHorizontal,
  Image,
  Layers,
  Pencil,
  Plug,
  Search,
  Users,
} from '@/shared/ui/icons';
import { Button, T } from '@/shared/ui/primitives';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { MarkdownReader } from '@/features/document/reader';
import { groupTrace, toolCategory, toolCategoryNames, type ToolCategory } from './trace-groups';
import { traceView } from './trace-view';

const categoryIcons = {
  read: FileText,
  search: Search,
  image: Image,
  write: Pencil,
  git: GitCommitHorizontal,
  skill: Layers,
  remote: Plug,
  agent: Users,
};

function FinalResponse({ text }: { text: string }) {
  const [characters, setCharacters] = useState<number>(traceLimits.textCharacters);
  const end = textEnd(text, 0, characters);
  return (
    <View testID="trace-text" style={{ gap: 8, marginTop: 14 }}>
      <View testID="run-response">
        <MarkdownReader content={text.slice(0, end)} />
      </View>
      {end < text.length && (
        <Button
          label="展开更多回答"
          compact
          variant="ghost"
          onPress={() => setCharacters(value => value + traceLimits.textCharacters)}
        />
      )}
    </View>
  );
}

function TraceText({
  item,
  runsApi,
}: {
  item: ContentTrace & { textCharacters?: number };
  runsApi?: RunsApi;
}) {
  const [loaded, setLoaded] = useState<{ text: string; next?: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!runsApi || item.textCharacters === undefined) return;
    let current = true;
    void runsApi
      .readTraceText(item.id)
      .then(page => {
        if (current) setLoaded({ text: page.text, next: page.nextOffset });
      })
      .catch(() => {
        if (current) setError('轨迹正文读取失败。');
      });
    return () => {
      current = false;
    };
  }, [item.id, item.textCharacters, runsApi]);
  const more = async () => {
    if (!runsApi || loaded?.next === undefined || busy) return;
    setBusy(true);
    try {
      const page = await runsApi.readTraceText(item.id, loaded.next);
      setLoaded({ text: loaded.text + page.text, next: page.nextOffset });
    } catch {
      setError('轨迹正文读取失败。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 7 }}>
      <MarkdownReader content={loaded?.text ?? item.text} tone="secondary" />
      {loaded?.next !== undefined && (
        <Button
          label="展开更多正文"
          compact
          variant="ghost"
          busy={busy}
          onPress={() => {
            void more();
          }}
        />
      )}
      {!!error && <T tone="warning">{error}</T>}
    </View>
  );
}

const duration = (ms: number) =>
  ms < 1000
    ? '<1 秒'
    : ms < 60000
      ? Math.floor(ms / 1000) + ' 秒'
      : Math.floor(ms / 60000) + ' 分 ' + Math.floor((ms % 60000) / 1000) + ' 秒';
function Reasoning({
  item,
  runsApi,
}: {
  item: ContentTrace & { textCharacters?: number };
  runsApi?: RunsApi;
}) {
  const theme = useWorkbenchTheme();
  const [expanded, setExpanded] = useState(false);
  const label =
    item.visibility === 'summary'
      ? '推理摘要'
      : item.visibility === 'unavailable'
        ? '推理内容未公开'
        : '思考过程';
  const running = item.state === 'running';
  const elapsed =
    new Date(item.endedAt ?? item.startedAt).getTime() - new Date(item.startedAt).getTime();
  return (
    <View testID="trace-reasoning" style={{ paddingVertical: 6 }}>
      <DisclosureRow
        label={'展开' + label}
        expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        leading={
          running ? (
            <ActivityIndicator size={14} color={theme.accent} />
          ) : (
            <Brain size={15} color={theme.secondary} />
          )
        }
        trailing={
          !running && (
            <T tone="muted" variant="meta">
              {duration(Math.max(0, elapsed))}
            </T>
          )
        }
      >
        <T tone="secondary" variant="caption" style={{ fontWeight: '500', flex: 1 }}>
          {label}
          {running ? ' · 生成中' : ''}
        </T>
      </DisclosureRow>
      {!expanded && !!item.text && (
        <T tone="muted" numberOfLines={1} variant="meta" style={{ paddingLeft: 22 }}>
          {item.text.replace(/\s+/g, ' ')}
        </T>
      )}
      {expanded && (
        <View
          style={{
            borderLeftWidth: 2,
            borderLeftColor: theme.border,
            paddingLeft: 12,
            marginLeft: 6,
            paddingVertical: 7,
            gap: 6,
          }}
        >
          {(item.state === 'cancelled' ||
            item.state === 'interrupted' ||
            item.state === 'error') && (
            <T tone="warning" variant="caption">
              未完整结束
            </T>
          )}
          {item.text ? (
            <TraceText item={item} runsApi={runsApi} />
          ) : (
            <T tone="secondary" variant="caption">
              {item.visibility === 'unavailable'
                ? '服务保留了推理签名，但未公开可展示内容。'
                : running
                  ? '等待推理内容…'
                  : '服务未返回可展示的推理内容。'}
            </T>
          )}
        </View>
      )}
    </View>
  );
}
function ToolStep({
  item,
  childRuns,
  cancelChild,
  inspectProposal,
  runsApi,
}: {
  item: ToolTrace;
  childRuns?: RunView[];
  cancelChild?: (id: string) => void;
  inspectProposal?: (id: string) => void;
  runsApi?: RunsApi;
}) {
  const theme = useWorkbenchTheme();
  const [expanded, setExpanded] = useState(false);
  const label = item.label ?? toolLabels[item.tool] ?? item.tool;
  const running = item.state === 'running';
  const Icon = categoryIcons[toolCategory(item.tool)];
  const failed = ['error', 'cancelled', 'interrupted', 'unknown'].includes(item.state);
  return (
    <View testID="trace-tool" style={{ paddingVertical: 1 }}>
      <DisclosureRow
        label={'查看工具详情 ' + label + (item.target ? ' ' + item.target : '')}
        expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        leading={
          running ? (
            <ActivityIndicator size={14} color={theme.accent} />
          ) : failed ? (
            <CircleAlert size={15} color={theme.warning} />
          ) : (
            <Icon size={15} color={theme.secondary} />
          )
        }
        trailing={item.state === 'completed' && <Check size={12} color={theme.success} />}
      >
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <T tone={failed ? 'warning' : 'secondary'} variant="caption">
            {label}
            {running
              ? ' · 执行中'
              : failed
                ? ' · ' +
                  {
                    error: '失败',
                    cancelled: '已停止',
                    interrupted: '已中断',
                    unknown: '远端结果未知',
                  }[item.state as 'error' | 'cancelled' | 'interrupted' | 'unknown']
                : ''}
          </T>
          {!!item.target && (
            <T tone="muted" numberOfLines={1} variant="meta">
              {item.target}
            </T>
          )}
        </View>
      </DisclosureRow>
      {!!item.childRunIds?.length && (
        <View
          style={{
            marginLeft: 22,
            borderLeftWidth: 1,
            borderLeftColor: theme.border,
            paddingLeft: 12,
            gap: 8,
          }}
        >
          {childRuns
            ?.filter(child => item.childRunIds!.includes(child.id))
            .map(child => (
              <ChildTrace
                key={child.id}
                task={child}
                cancel={cancelChild}
                inspectProposal={inspectProposal}
                runsApi={runsApi}
              />
            ))}
        </View>
      )}
      {expanded && (
        <View
          style={{
            backgroundColor: theme.background,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
            gap: 7,
            marginTop: 4,
          }}
        >
          <T tone="muted" variant="meta">
            第 {item.round} 轮 · {item.tool}
            {item.durationMs !== undefined ? ' · ' + duration(item.durationMs) : ''}
          </T>
          <T tone="secondary" variant="meta" style={{ fontWeight: '600' }}>
            输入
          </T>
          <T selectable variant="meta">
            {item.input || '{}'}
          </T>
          <T tone="secondary" variant="meta" style={{ fontWeight: '600' }}>
            结果
          </T>
          <T selectable tone={item.state === 'error' ? 'danger' : 'secondary'} variant="meta">
            {item.output ||
              (running
                ? '等待工具结果…'
                : failed
                  ? '操作未完整结束，已完成的文件修改仍保留。'
                  : '操作成功。')}
          </T>
          {item.state === 'unknown' && (
            <T tone="warning" variant="meta">
              远端可能已执行。请到 MCP 设置核对服务状态后，再解除重试限制。
            </T>
          )}
          {(item.input.length >= 6000 || (item.output?.length ?? 0) >= 6000) && (
            <T tone="muted" variant="meta">
              详情仅显示前 6,000 字符。
            </T>
          )}
        </View>
      )}
    </View>
  );
}
function ToolGroup({
  items,
  ...rest
}: Omit<Parameters<typeof ToolStep>[0], 'item'> & { items: ToolTrace[] }) {
  const theme = useWorkbenchTheme();
  const [expanded, setExpanded] = useState<boolean>();
  const failed = items.some(item =>
    ['error', 'unknown', 'cancelled', 'interrupted'].includes(item.state),
  );
  const running = items.some(item => item.state === 'running');
  const shown = expanded ?? (failed || items.some(item => !!item.childRunIds?.length));
  if (items.length === 1) return <ToolStep item={items[0]} {...rest} />;
  const categories = new Map<ToolCategory, number>();
  for (const item of items) {
    const category = toolCategory(item.tool);
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  return (
    <View testID="trace-tool-group">
      <DisclosureRow
        label={(shown ? '收起' : '展开') + '连续工具调用 ' + items.length + ' 次'}
        expanded={shown}
        onPress={() => setExpanded(!shown)}
        trailing={running && <ActivityIndicator size={12} color={theme.accent} />}
      >
        <View
          style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center' }}
        >
          {[...categories].map(([category, count]) => {
            const Icon = categoryIcons[category];
            return (
              <View key={category} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon size={15} color={failed ? theme.warning : theme.secondary} />
                <T tone={failed ? 'warning' : 'secondary'} variant="caption">
                  {toolCategoryNames[category]}
                  {count > 1 ? ' ×' + count : ''}
                </T>
              </View>
            );
          })}
          {failed && (
            <T tone="warning" variant="caption">
              {items.some(item => item.state === 'unknown') ? '远端结果未知' : '含未完成操作'}
            </T>
          )}
        </View>
      </DisclosureRow>
      {shown && (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={{
            marginLeft: 6,
            maxHeight: 280,
            paddingLeft: 12,
            borderLeftWidth: 1,
            borderColor: theme.border,
          }}
        >
          {items.map(item => (
            <ToolStep key={item.id} item={item} {...rest} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ChildTrace({
  task,
  cancel,
  inspectProposal,
  runsApi,
}: {
  task: RunView;
  cancel?: (id: string) => void;
  inspectProposal?: (id: string) => void;
  runsApi?: RunsApi;
}) {
  const [expanded, setExpanded] = useState(false);
  const theme = useWorkbenchTheme();
  const [detail, setDetail] = useState<RunView>();
  const [readError, setReadError] = useState('');
  useEffect(() => {
    if (!expanded || task.trace || !runsApi) return;
    let current = true;
    void Promise.all([runsApi.getDetail(task.id), runsApi.listTrace(task.id)])
      .then(([value, trace]) => {
        if (current)
          setDetail({ ...value, trace: trace.nodes.map(traceView), traceCursor: trace.cursor });
      })
      .catch(() => {
        if (current) setReadError('子任务详情读取失败。');
      });
    return () => {
      current = false;
    };
  }, [expanded, task.id, task.state, task.trace, runsApi]);
  return (
    <View testID="child-trace">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'展开子 Agent ' + task.prompt}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ gap: 4, paddingVertical: 7 }}
      >
        <T tone="secondary" variant="caption">
          {task.proposalId ? '隔离写作' : '子 Agent'} · {runStateLabels[task.state]}
        </T>
        <T tone="muted" numberOfLines={expanded ? undefined : 2} variant="meta">
          {task.prompt}
        </T>
      </Pressable>
      {cancel && ['queued', 'running'].includes(task.state) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'停止子 Agent ' + task.prompt}
          onPress={() => cancel(task.id)}
          style={{ paddingVertical: 6, alignSelf: 'flex-start' }}
        >
          <T tone="muted" variant="meta">
            停止此子任务
          </T>
        </Pressable>
      )}
      {task.proposalId && inspectProposal && task.state !== 'queued' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'查看隔离提案 ' + task.prompt}
          onPress={() => inspectProposal(task.proposalId!)}
          style={{ paddingVertical: 6, alignSelf: 'flex-start' }}
        >
          <T tone="accent" variant="meta">
            查看候选变化
          </T>
        </Pressable>
      )}
      {expanded && (
        <View style={{ padding: 10, backgroundColor: theme.background, borderRadius: 8 }}>
          <TaskTrace task={task.trace ? task : (detail ?? task)} runsApi={runsApi} />
          {!!readError && <T tone="warning">{readError}</T>}
          {!!task.error && (
            <T tone="warning" variant="meta">
              {task.error.message}
            </T>
          )}
        </View>
      )}
    </View>
  );
}
export function TaskTrace({
  task,
  cancelChild,
  inspectProposal,
  runsApi,
}: {
  task: RunView;
  cancelChild?: (id: string) => void;
  inspectProposal?: (id: string) => void;
  runsApi?: RunsApi;
}) {
  const theme = useWorkbenchTheme();
  const [older, setOlder] = useState<DisplayTrace[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = cursor ?? task.traceCursor;
  const more = async () => {
    if (!runsApi || !next || busy) return;
    setBusy(true);
    try {
      const page = await runsApi.listTrace(task.id, next);
      setOlder(values => [...values, ...page.nodes.map(traceView)]);
      setCursor(page.cursor ?? '');
    } catch {
      setError('轨迹步骤读取失败。');
    } finally {
      setBusy(false);
    }
  };
  const completed = terminalRun(task.state);
  const items = [...(task.trace ?? []), ...older];
  const finalNode =
    completed && !!task.response && !next
      ? items.filter(item => item.kind === 'text').at(-1)?.id
      : undefined;
  return (
    <View testID="task-trace" style={{ marginTop: 4 }}>
      <View
        testID="run-process"
        style={{ borderLeftWidth: 1, borderColor: theme.border, paddingLeft: 12, marginLeft: 4 }}
      >
        {groupTrace(items.filter(item => item.id !== finalNode)).map(group => {
          if (group.kind === 'tools')
            return (
              <ToolGroup
                key={group.id}
                items={group.items}
                childRuns={task.children}
                cancelChild={cancelChild}
                inspectProposal={inspectProposal}
                runsApi={runsApi}
              />
            );
          const item = group.item;
          return item.kind === 'reasoning' ? (
            <Reasoning key={item.id} item={item} runsApi={runsApi} />
          ) : item.kind === 'text' && item.text ? (
            <View key={item.id} testID="trace-text" style={{ paddingVertical: 3 }}>
              <TraceText item={item} runsApi={runsApi} />
            </View>
          ) : null;
        })}
        {!!next && (
          <Button
            label="加载更多工作步骤"
            compact
            variant="ghost"
            busy={busy}
            onPress={() => {
              void more();
            }}
          />
        )}
        {!!error && <T tone="warning">{error}</T>}
        {['running', 'waiting_children'].includes(task.state) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6 }}>
            <ActivityIndicator size={12} color={theme.accent} />
            <T tone="muted" variant="caption">
              {task.state === 'waiting_children' ? '等待子 Agent' : '处理中…'}
            </T>
          </View>
        )}
      </View>
      {completed && !!task.response && <FinalResponse text={task.response} />}
    </View>
  );
}
