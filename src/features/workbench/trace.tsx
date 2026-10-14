import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { TaskRecord } from '@/core/runs/types';
import type { ContentTrace, ToolTrace } from '@/core/trace';
import { Brain, Check, ChevronDown, ChevronRight, CircleAlert, FileText, Image, Search } from '@/shared/ui/icons';
import { T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme/use-theme';
import { Markdown } from './markdown';
import { toolLabels } from '@/shared/format';

const duration = (ms: number) => ms < 1000 ? '<1 秒' : ms < 60000 ? Math.floor(ms / 1000) + ' 秒' : Math.floor(ms / 60000) + ' 分 ' + Math.floor(ms % 60000 / 1000) + ' 秒';
function Reasoning({ item }: { item: ContentTrace }) {
  const theme = useWorkbenchTheme(); const [expanded, setExpanded] = useState(false);
  const label = item.visibility === 'summary' ? '推理摘要' : item.visibility === 'unavailable' ? '推理内容未公开' : '思考过程';
  const running = item.state === 'running';
  const elapsed = new Date(item.endedAt ?? item.startedAt).getTime() - new Date(item.startedAt).getTime();
  return <View testID="trace-reasoning" style={{ paddingVertical: 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={'展开' + label} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34 }}>
      {running ? <ActivityIndicator size={14} color={theme.accent} /> : <Brain size={15} color={theme.secondary} />}
      <T tone="secondary" style={{ fontSize: 12, fontWeight: '500', flex: 1 }}>{label}{running ? ' · 生成中' : ''}</T>
      {!running && <T tone="muted" style={{ fontSize: 10 }}>{duration(Math.max(0, elapsed))}</T>}
      {expanded ? <ChevronDown size={13} color={theme.muted} /> : <ChevronRight size={13} color={theme.muted} />}
    </Pressable>
    {!expanded && !!item.text && <T tone="muted" numberOfLines={1} style={{ fontSize: 11, lineHeight: 18, paddingLeft: 22 }}>{item.text.replace(/\s+/g, ' ')}</T>}
    {expanded && <View style={{ borderLeftWidth: 2, borderLeftColor: theme.border, paddingLeft: 12, marginLeft: 6, paddingVertical: 7, gap: 6 }}>
      <T tone="muted" style={{ fontSize: 10 }}>服务返回的{item.visibility === 'summary' ? '摘要' : '公开内容'}{item.state === 'cancelled' || item.state === 'interrupted' || item.state === 'error' ? ' · 未完整结束' : ''}</T>
      {item.text ? <Markdown content={item.text} /> : <T tone="secondary" style={{ fontSize: 12 }}>{item.visibility === 'unavailable' ? '服务保留了推理签名，但未公开可展示内容。' : running ? '等待推理内容…' : '服务未返回可展示的推理内容。'}</T>}
    </View>}
  </View>;
}
function ToolStep({ item, childRuns, cancelChild }: { item: ToolTrace; childRuns?: TaskRecord[]; cancelChild?: (id: string) => void }) {
  const theme = useWorkbenchTheme(); const [expanded, setExpanded] = useState(false);
  const label = item.label ?? toolLabels[item.tool] ?? item.tool; const running = item.state === 'running';
  const Icon = item.tool === 'inspect_image' ? Image : item.tool === 'search_text' ? Search : FileText;
  const failed = ['error', 'cancelled', 'interrupted', 'unknown'].includes(item.state);
  return <View testID="trace-tool" style={{ paddingVertical: 5 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={'查看工具详情 ' + label + (item.target ? ' ' + item.target : '')}
      accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 7 }}>
      {running ? <ActivityIndicator size={14} color={theme.accent} /> : failed ? <CircleAlert size={15} color={theme.warning} /> : <Icon size={15} color={theme.secondary} />}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <T tone={failed ? 'warning' : 'secondary'} style={{ fontSize: 12 }}>{label}{running ? ' · 执行中' : failed ? ' · ' + ({ error: '失败', cancelled: '已停止', interrupted: '已中断', unknown: '远端结果未知' }[item.state as 'error' | 'cancelled' | 'interrupted' | 'unknown']) : ''}</T>
        {!!item.target && <T tone="muted" numberOfLines={1} style={{ fontSize: 10 }}>{item.target}</T>}
      </View>
      {item.state === 'completed' && <Check size={12} color={theme.success} />}
      {expanded ? <ChevronDown size={13} color={theme.muted} /> : <ChevronRight size={13} color={theme.muted} />}
    </Pressable>
    {!!item.childRunIds?.length && <View style={{ marginLeft: 22, borderLeftWidth: 1, borderLeftColor: theme.border, paddingLeft: 12, gap: 8 }}>
      {childRuns?.filter((child) => item.childRunIds!.includes(child.id)).map((child) => <ChildTrace key={child.id} task={child} cancel={cancelChild} />)}
    </View>}
    {expanded && <View style={{ backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: 8, padding: 10, gap: 7, marginTop: 4 }}>
      <T tone="muted" style={{ fontSize: 10 }}>第 {item.round} 轮 · {item.tool}{item.durationMs !== undefined ? ' · ' + duration(item.durationMs) : ''}</T>
      <T tone="secondary" style={{ fontSize: 11, fontWeight: '600' }}>输入</T>
      <T selectable style={{ fontSize: 11, lineHeight: 18 }}>{item.input || '{}'}</T>
      <T tone="secondary" style={{ fontSize: 11, fontWeight: '600' }}>结果</T>
      <T selectable tone={item.state === 'error' ? 'danger' : 'secondary'} style={{ fontSize: 11, lineHeight: 18 }}>{item.output || (running ? '等待工具结果…' : failed ? '操作未完整结束，已完成的文件修改仍保留。' : '操作成功。')}</T>
      {item.state === 'unknown' && <T tone="warning" style={{ fontSize: 11 }}>远端可能已执行。请到 MCP 设置核对服务状态后，再解除重试限制。</T>}
      {(item.input.length >= 6000 || (item.output?.length ?? 0) >= 6000) && <T tone="muted" style={{ fontSize: 10 }}>详情仅显示前 6,000 字符。</T>}
    </View>}
  </View>;
}
function ChildTrace({ task, cancel }: { task: TaskRecord; cancel?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false); const theme = useWorkbenchTheme();
  return <View testID="child-trace">
    <Pressable accessibilityRole="button" accessibilityLabel={'展开子 Agent ' + task.prompt} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={{ gap: 4, paddingVertical: 7 }}>
      <T tone="secondary" style={{ fontSize: 12 }}>子 Agent · {{ queued: '等待启动', running: '执行中', waiting_children: '等待中', cancelling: '正在停止', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '已中断' }[task.state]}</T>
      <T tone="muted" numberOfLines={expanded ? undefined : 2} style={{ fontSize: 11 }}>{task.prompt}</T>
    </Pressable>
    {cancel && ['queued', 'running'].includes(task.state) && <Pressable accessibilityRole="button" accessibilityLabel={'停止子 Agent ' + task.prompt}
      onPress={() => cancel(task.id)} style={{ paddingVertical: 6, alignSelf: 'flex-start' }}><T tone="muted" style={{ fontSize: 11 }}>停止此子任务</T></Pressable>}
    {expanded && <View style={{ padding: 10, backgroundColor: theme.background, borderRadius: 8 }}><TaskTrace task={task} />{!!task.error && <T tone="warning" style={{ fontSize: 11 }}>{task.error}</T>}</View>}
  </View>;
}
export function TaskTrace({ task, cancelChild }: { task: TaskRecord; cancelChild?: (id: string) => void }) {
  const theme = useWorkbenchTheme(); const [expanded, setExpanded] = useState(true);
  if (!task.trace) return <View style={{ gap: 8, marginTop: 14 }}>
    {!!task.events.length && <T tone="muted" style={{ fontSize: 10 }}>历史步骤 · 旧任务未保存文字与工具的交错顺序</T>}
    {task.events.map((event, i) => <T key={i} tone="secondary" style={{ fontSize: 12 }}>{toolLabels[event.tool] ?? event.tool} · {event.description}</T>)}
    {!!task.response && <Markdown content={task.response} />}
  </View>;
  const operations = task.trace.filter((item) => item.kind === 'tool').length;
  const end = task.trace.reduce((time, item) => Math.max(time, new Date(item.endedAt ?? item.startedAt).getTime()), new Date(task.createdAt).getTime());
  const hasReasoning = task.trace.some((item) => item.kind === 'reasoning');
  return <View testID="task-trace" style={{ marginTop: 10 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="查看工作轨迹" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, marginBottom: 5 }}>
      <T tone="muted" style={{ fontSize: 10, flex: 1 }}>工作轨迹 · {operations} 个操作{task.state !== 'running' ? ' · ' + duration(end - new Date(task.createdAt).getTime()) : ''}</T>
      {expanded ? <ChevronDown size={12} color={theme.muted} /> : <ChevronRight size={12} color={theme.muted} />}
    </Pressable>
    {expanded && <View style={{ gap: 9 }}>
      {task.trace.map((item) => item.kind === 'tool' ? <ToolStep key={item.id} item={item} childRuns={task.children} cancelChild={cancelChild} /> : item.kind === 'reasoning' ? <Reasoning key={item.id} item={item} /> :
        item.text ? <View testID="trace-text" key={item.id} style={{ paddingVertical: 3 }}><Markdown content={item.text} /></View> : null)}
      {['running', 'waiting_children'].includes(task.state) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7 }}>
        <ActivityIndicator size={12} color={theme.accent} /><T tone="muted" style={{ fontSize: 11 }}>{task.state === 'waiting_children' ? '等待子 Agent 收束…' : 'Agent 正在处理…'}</T>
      </View>}
      {!hasReasoning && task.mode === 'remote' && task.state !== 'running' && <T tone="muted" style={{ fontSize: 10 }}>服务未返回可展示的推理内容</T>}
    </View>}
    {!expanded && !!task.response && <Markdown content={task.response} />}
  </View>;
}
