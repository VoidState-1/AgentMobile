import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, FileText, Image as ImageIcon,
  Layers, Paperclip, PenLine, Sparkles, Square, X,
} from './icons';
import type { TaskRecord } from '@/core/prototype/types';
import { contentLimits } from '@/core/agent/settings';
import type { Workbench } from './use-workbench';
import { Brand, Button, IconButton, T } from './ui';
import { useWorkbenchTheme } from './theme';
import { TaskTrace } from './trace';
import { dateLabel, fileName } from './format';

function Exchange({ task, controller }: { task: TaskRecord; controller: Workbench }) {
  const theme = useWorkbenchTheme();
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
            {{ completed: '已完成', running: '执行中', failed: '执行失败', cancelled: '已停止', interrupted: '已中断' }[task.state]}
          </T>
        </View>
        <T tone="muted" style={{ fontSize: 10, marginTop: 3 }}>{task.mode === 'demo' ? '演示模式' : task.modelSnapshot ?
          task.modelSnapshot.connectionName + ' · ' + task.modelSnapshot.modelName : '历史模型未知'}</T>
        <TaskTrace task={task} />
        {!!task.error && <View style={{ backgroundColor: theme.dangerSoft, borderRadius: 8, padding: 12, marginTop: 8 }}>
          <T tone="danger" style={{ fontSize: 12 }}>{task.error}</T></View>}
        {task.state !== 'running' && <Pressable accessibilityRole="button" accessibilityLabel="查看变化" disabled={controller.busy}
          onPress={() => { void controller.reviewTask(task); }} style={({ pressed }) => ({
            marginTop: 13, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12,
            backgroundColor: pressed ? theme.inset : theme.surface, flexDirection: 'row', alignItems: 'center', gap: 10,
          })}>
          <View style={{ padding: 8, borderRadius: 7, backgroundColor: theme.accentSoft }}><FileText size={16} color={theme.accent} /></View>
          <View style={{ flex: 1 }}><T style={{ fontSize: 12, fontWeight: '500' }}>{paths.length ? paths.length + ' 个文件已更新' : '查看任务结果'}</T>
            <T tone="muted" style={{ fontSize: 11 }} numberOfLines={1}>{paths.length ? paths.slice(0, 2).map(fileName).join(' · ') : '文件变化与恢复选项'}</T></View>
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

export function Conversation({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 700;
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [inputHeight, setInputHeight] = useState(54);
  const tasks = [...controller.tasks.filter((task) => task.id !== controller.conversationActive?.id)].reverse();
  if (controller.conversationActive) tasks.push(controller.conversationActive);
  const latestTaskId = tasks[tasks.length - 1]?.id;
  useEffect(() => {
    stick.current = true;
    const frame = requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [controller.conversationId, latestTaskId]);
  const otherTask = !!controller.active && !controller.conversationActive;
  const sendDisabled = !controller.selectedConversation || !controller.prompt.trim() || controller.busy || !!controller.active || controller.projectLoading;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.surface }}>
    <ScrollView ref={scroll} testID="conversation-scroll" style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: mobile ? 18 : 30, paddingTop: 22, paddingBottom: 22 }}
      keyboardShouldPersistTaps="handled" scrollEventThrottle={100}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const bottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
        stick.current = bottom; setAtBottom(bottom);
      }}
      onContentSizeChange={() => { if (stick.current && tasks.length) scroll.current?.scrollToEnd({ animated: false }); }}>
      {controller.projectLoading ? <ActivityIndicator color={theme.accent} style={{ marginTop: 60 }} /> : tasks.length ? tasks.map((task) =>
        <Exchange key={task.id} task={task} controller={controller} />) :
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
        </View>}
    </ScrollView>
    {!atBottom && tasks.length > 0 && <View style={{ position: 'absolute', bottom: 150, alignSelf: 'center', backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border, borderRadius: 22 }}>
      <IconButton icon={ArrowDown} label="回到最新消息" onPress={() => { stick.current = true; scroll.current?.scrollToEnd({ animated: true }); }} />
    </View>}
    <View testID="composer" style={{ paddingHorizontal: mobile ? 14 : 25, paddingTop: 10, paddingBottom: mobile ? 9 : 16,
      width: '100%', maxWidth: 830, alignSelf: 'center', backgroundColor: theme.surface }}>
      {otherTask && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
        <T tone="secondary" style={{ flex: 1, fontSize: 11 }}>{controller.active?.projectId === controller.projectId ? '另一个对话的任务仍在运行' : '另一个项目的任务仍在运行'}，可继续准备草稿。</T>
        <Button label="返回运行中的对话" compact variant="ghost" disabled={controller.busy} onPress={controller.returnToActiveConversation} />
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
          <Pressable accessibilityRole="button" accessibilityLabel="模型设置" onPress={controller.openModels}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, minHeight: 36 }}>
            <T tone="secondary" numberOfLines={1} style={{ fontSize: 11 }}>{controller.modelLabel}</T>
            <ChevronDown size={12} color={theme.muted} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={controller.conversationActive ? '停止任务' : '发送任务'}
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
}
