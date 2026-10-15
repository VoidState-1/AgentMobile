import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, TextInput, View, useWindowDimensions, type ViewToken } from 'react-native';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, FileText, Image as ImageIcon,
  Layers, Paperclip, PenLine, Sparkles, Square, X,
} from '@/shared/ui/icons';
import type { RunView, RunSummary } from '@/core/runs/queries';
import { terminalRun } from '@/core/runs/records';
import { contentLimits } from '@/core/agent/settings';
import type { ConversationCapability } from './use-workbench';
import { Brand, Button, IconButton, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { TaskTrace } from './trace';
import { dateLabel, fileName } from '@/shared/format';
import { traceView } from './trace-view';

interface ExchangeRow { id: string; summary?: RunSummary; live?: RunView }
function Exchange({ row, visible, controller }: { row: ExchangeRow; visible: boolean; controller: ConversationCapability }) {
  const [loaded, setLoaded] = useState<RunView>();
  const [error, setError] = useState('');
  const task = row.live ?? loaded;
  const theme = useWorkbenchTheme();
  useEffect(() => {
    if (!visible || row.live || !controller.runsApi) return;
    let current = true; const api = controller.runsApi;
    void Promise.all([api.getDetail(row.id), api.listTrace(row.id), api.listChildren(row.id)]).then(([detail, trace, children]) => {
      if (!current) return;
      const childViews: RunView[] = children.runs.reverse().map(child => ({ id: child.id, projectId: child.projectId, conversationId: child.conversationId,
        kind: 'child', state: child.state, mode: child.mode, prompt: child.promptPreview, response: '', createdAt: child.createdAt,
        modelName: child.modelName, connectionName: child.connectionName, error: child.error, proposalId: child.proposalId }));
      setLoaded({ ...detail, trace: trace.nodes.map(traceView), traceCursor: trace.cursor, children: childViews });
    }).catch(() => { if (current) setError('运行详情读取失败，请重新打开对话。'); });
    return () => { current = false; };
  }, [visible, row.id, row.live, row.summary?.revision, controller.runsApi]);
  if (!task) return <View style={{ paddingVertical: 15, gap: 12 }}>
    <T style={{ fontSize: 14, lineHeight: 23 }}>{row.summary?.promptPreview}</T>
    <T tone={error ? 'danger' : 'muted'} style={{ fontSize: 12 }}>{error || '正在读取对话…'}</T>
  </View>;
  const paths = controller.changedPaths(task);
  return <View style={{ gap: 22, marginBottom: 32 }}>
    <View style={{ alignItems: 'flex-end', gap: 5 }}>
      <View style={{ backgroundColor: theme.inset, borderRadius: 13, borderTopRightRadius: 4, paddingHorizontal: 15, paddingVertical: 12, maxWidth: '92%' }}>
        <T selectable style={{ fontSize: 14, lineHeight: 23 }}>{task.prompt}</T>
      </View>
      <T tone="muted" style={{ fontSize: 10 }}>{dateLabel(task.createdAt)}</T>
    </View>
    <View style={{ flexDirection: 'row', gap: 11 }}>
      <View style={{ width: 29, height: 29, borderRadius: 9, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Sparkles size={16} color={theme.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T style={{ fontWeight: '600', fontSize: 13 }}>Agent</T>
          <T tone={task.state === 'failed' ? 'danger' : task.state === 'completed' ? 'muted' : 'secondary'} style={{ fontSize: 11 }}>
            {{ queued: '等待启动', running: '执行中', waiting_children: '等待子任务', cancelling: '正在停止', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '已中断' }[task.state]}
          </T>
        </View>
        <T tone="muted" style={{ fontSize: 10, marginTop: 3 }}>{task.mode === 'demo' ? '演示模式' : task.modelName ?
          task.connectionName + ' · ' + task.modelName : '模型未记录'}</T>
        <TaskTrace task={task} inspectProposal={(id) => { void controller.reviewProposal(task.id, id); }}
          runsApi={controller.runsApi}
          cancelChild={(id) => { controller.cancelChild(id); }} />
        {!!task.error && <View style={{ backgroundColor: theme.dangerSoft, borderRadius: 8, padding: 12, marginTop: 8 }}>
          <T tone="danger" style={{ fontSize: 12 }}>{task.error.message}</T></View>}
        {terminalRun(task.state) && <Pressable accessibilityRole="button" accessibilityLabel="查看变化" disabled={controller.busy}
          onPress={() => { void controller.reviewTask(task); }} style={({ pressed }) => ({
            marginTop: 13, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12,
            backgroundColor: pressed ? theme.inset : theme.surface, flexDirection: 'row', alignItems: 'center', gap: 10,
          })}>
          <View style={{ padding: 8, borderRadius: 7, backgroundColor: theme.accentSoft }}><FileText size={16} color={theme.accent} /></View>
          <View style={{ flex: 1 }}><T style={{ fontSize: 12, fontWeight: '500' }}>{paths.length ? paths.length + ' 个文件已更新' : '查看任务结果'}</T>
            <T tone="muted" style={{ fontSize: 11 }} numberOfLines={1}>{paths.length ? paths.slice(0, 2).map(fileName).join(' · ') : '文件变化与恢复选项'}</T>
            {!!task.uncommittedPaths?.length && <T tone="warning" style={{ fontSize: 10 }}>任务结束时 {task.uncommittedPaths.length} 个文件待提交</T>}</View>
          <ChevronRight size={16} color={theme.muted} />
        </Pressable>}
      </View>
    </View>
  </View>;
}

const suggestions = [
  { title: '整理资料', detail: '把零散笔记变成清晰文档', icon: Layers, prompt: '请阅读项目中的文字资料，整理成一份结构清晰的笔记，保存为 documents/summary.md。' },
  { title: '改写润色', detail: '让表达更清晰、更自然', icon: PenLine, prompt: '请阅读项目中的笔记，保留原意，改写成清晰自然的文字，保存为一份新文档。' },
  { title: '看图写文', detail: '根据图片整理图文内容', icon: ImageIcon, prompt: '请阅读项目中的图片与文字，整理成一份图文资料，保留原始文件。' },
  { title: '自由创作', detail: '从一个想法开始写作', icon: Sparkles, prompt: '请帮我起草一份新文档，主题是：' },
];

export const Conversation = memo(function Conversation({ controller }: { controller: ConversationCapability }) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 700;
  const scroll = useRef<FlatList<ExchangeRow>>(null);
  const input = useRef<TextInput>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [inputHeight, setInputHeight] = useState(54);
  const tasks: ExchangeRow[] = controller.tasks.filter(task => task.id !== controller.conversationActive?.id).map(summary => ({ id: summary.id, summary }));
  if (controller.conversationActive) tasks.unshift({ id: controller.conversationActive.id, live: controller.conversationActive });
  const latestTaskId = tasks[0]?.id;
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const viewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<ExchangeRow>[] }) => setVisible(new Set(viewableItems.map(item => item.item.id))), []);
  useEffect(() => {
    stick.current = true;
    const frame = requestAnimationFrame(() => scroll.current?.scrollToOffset({ offset: 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [controller.conversationId, latestTaskId]);
  const otherTask = !!controller.active && !controller.conversationActive;
  const sendDisabled = !controller.selectedConversation || !controller.prompt.trim() || controller.busy || !!controller.conversationActive || controller.projectLoading;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.surface }}>
    <FlatList ref={scroll} testID="conversation-scroll" style={{ flex: 1 }} inverted={!!tasks.length} data={tasks} keyExtractor={row => row.id}
      initialNumToRender={3} maxToRenderPerBatch={3} windowSize={5} extraData={visible} onViewableItemsChanged={viewable}
      renderItem={({ item }) => <Exchange row={item} visible={visible.has(item.id)} controller={controller} />}
      contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: mobile ? 18 : 30, paddingTop: 22, paddingBottom: 22 }}
      keyboardShouldPersistTaps="handled" scrollEventThrottle={100}
      onScroll={(event) => {
        const { contentOffset } = event.nativeEvent;
        const bottom = contentOffset.y < 100;
        stick.current = bottom; setAtBottom(bottom);
      }}
      onContentSizeChange={() => { if (stick.current && tasks.length) scroll.current?.scrollToOffset({ offset: 0, animated: false }); }}
      ListFooterComponent={controller.taskCursor ? <Button label="加载更早对话" variant="ghost" busy={controller.historyBusy} onPress={() => { void controller.loadOlderRuns(); }} /> : null}
      ListEmptyComponent={controller.projectLoading ? <ActivityIndicator color={theme.accent} style={{ marginTop: 60 }} /> :
        <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 28, maxWidth: 580, width: '100%', alignSelf: 'center' }}>
          <Brand />
          <T accessibilityRole="header" style={{ fontSize: mobile ? 25 : 29, lineHeight: 39, fontWeight: '600', marginTop: 21, marginBottom: 8 }}>今天，想完成什么？</T>
          <T tone="secondary" style={{ fontSize: 13, lineHeight: 23, marginBottom: 25 }}>围绕当前项目整理文字、处理资料，{mobile ? '\n' : ''}让每一次修改都能回看。</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {suggestions.map(({ title, detail, icon: Icon, prompt }) => <Pressable key={title} accessibilityRole="button"
              accessibilityLabel={title} onPress={() => { controller.setPrompt(prompt); input.current?.focus(); }}
              style={({ pressed }) => ({ width: '48%', flexGrow: 1, padding: mobile ? 13 : 16, borderRadius: 10, gap: 7,
                borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.inset : theme.surface })}>
              <Icon size={18} color={theme.secondary} strokeWidth={1.6} />
              <T style={{ fontSize: 13, fontWeight: '500' }}>{title}</T>
              <T tone="muted" style={{ fontSize: 11, lineHeight: 18 }}>{detail}</T>
            </Pressable>)}
          </View>
          {controller.settings.mode === 'demo' && <T tone="muted" style={{ fontSize: 11, lineHeight: 19, marginTop: 18 }}>
            演示模式使用预设流程。连接模型服务后可进行真实创作。
          </T>}
        </View>} />
    {!atBottom && tasks.length > 0 && <View style={{ position: 'absolute', bottom: 150, alignSelf: 'center', backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border, borderRadius: 22 }}>
      <IconButton icon={ArrowDown} label="回到最新消息" onPress={() => { stick.current = true; scroll.current?.scrollToOffset({ offset: 0, animated: true }); }} />
    </View>}
    <View testID="composer" style={{ paddingHorizontal: mobile ? 14 : 25, paddingTop: 10, paddingBottom: mobile ? 9 : 16,
      width: '100%', maxWidth: 830, alignSelf: 'center', backgroundColor: theme.surface }}>
      {otherTask && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
        <T tone="secondary" style={{ flex: 1, fontSize: 11 }}>{controller.projectActive ? '另一个对话的任务仍在运行，发送后将排队。' : '另一个项目的任务仍在运行，可并行发送任务。'}</T>
        <Button label="返回运行中的对话" compact variant="ghost" disabled={controller.busy} onPress={() => controller.returnToActiveConversation()} />
      </View>}
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 13, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 8,
        backgroundColor: theme.background }}>
        {!!controller.attachment && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.accentSoft,
          borderRadius: 7, paddingLeft: 9, marginBottom: 5, alignSelf: 'flex-start', maxWidth: '100%' }}>
          <FileText size={13} color={theme.accent} /><T numberOfLines={1} tone="accent" style={{ fontSize: 11, maxWidth: 230 }}>{fileName(controller.attachment)}</T>
          <IconButton icon={X} size={30} label="移除参考文件" onPress={() => controller.setAttachment(undefined)} />
        </View>}
        <TextInput ref={input} accessibilityLabel="任务目标" testID="task-prompt" value={controller.prompt} onChangeText={controller.setPrompt}
          multiline maxLength={contentLimits.promptCharacters} placeholder="描述你的任务，或选择一份资料开始…" placeholderTextColor={theme.muted}
          editable={!controller.conversationActive && !controller.busy && !!controller.selectedConversation} textAlignVertical="top"
          onContentSizeChange={(event) => setInputHeight(Math.max(54, Math.min(130, event.nativeEvent.contentSize.height)))}
          onKeyPress={(event) => {
            if (Platform.OS === 'web' && event.nativeEvent.key === 'Enter' && !(event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey) {
              event.preventDefault(); if (!sendDisabled) { stick.current = true; void controller.submit(); }
            }
          }}
          style={{ height: inputHeight, color: theme.text, fontSize: 14, lineHeight: 23, paddingVertical: 5 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <IconButton icon={Paperclip} label="添加参考资料" disabled={!!controller.conversationActive || controller.busy} size={36} onPress={() => controller.setSheet('attach')} />
          <IconButton icon={Sparkles} label="选择技能" disabled={!!controller.conversationActive || controller.busy} size={36} onPress={() => controller.setSheet('skills')} />
          <Pressable accessibilityRole="button" accessibilityLabel="模型设置" onPress={controller.openModels}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, minHeight: 36 }}>
            <T tone="secondary" numberOfLines={1} style={{ fontSize: 11 }}>{controller.modelLabel}</T>
            <ChevronDown size={12} color={theme.muted} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={controller.conversationActive ? controller.conversationActive.state === 'queued' ? '取消排队' : '停止任务' : '发送任务'}
            hitSlop={4}
            disabled={!controller.conversationActive && sendDisabled}
            onPress={() => { if (controller.conversationActive) controller.stop(); else { stick.current = true; void controller.submit(); } }}
            style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: controller.conversationActive || !sendDisabled ? theme.accent : theme.border, opacity: pressed ? 0.75 : 1 })}>
            {controller.conversationActive ? <Square size={14} fill={theme.accentText} color={theme.accentText} /> :
              <ArrowUp size={20} color={sendDisabled ? theme.muted : theme.accentText} strokeWidth={2.3} />}
          </Pressable>
        </View>
      </View>
      <T tone="muted" style={{ fontSize: 10, textAlign: 'center', marginTop: 7, lineHeight: 15 }}>
        {(controller.prompt || controller.attachment) ? (controller.draftSaving ? '正在保存草稿…' : controller.draftSaved ? '草稿已保存' : '草稿未保存') + ' · ' : ''}
        {controller.settings.mode === 'remote' ? '任务相关资料将发送到已配置的模型服务' : '资料保存在本地 · 每次修改可恢复'}
      </T>
    </View>
  </View>;
});
