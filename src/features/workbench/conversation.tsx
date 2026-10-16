import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  TextInput,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  GitCommitHorizontal,
  Plus,
  Square,
  X,
} from '@/shared/ui/icons';
import type { RunView, RunSummary } from '@/core/runs/queries';
import { terminalRun } from '@/core/runs/records';
import { contentLimits } from '@/core/agent/settings';
import type { ConversationCapability } from './use-workbench';
import { Button, IconButton, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme, workbenchMetrics as metrics } from '@/shared/theme';
import { TaskTrace } from './trace';
import { dateLabel, fileName } from '@/shared/format';
import { traceView } from './trace-view';

interface ExchangeRow {
  id: string;
  summary?: RunSummary;
  live?: RunView;
}
// Route transitions can mount the initial cells before viewability reports them.
const initialRows = 3;
function Exchange({
  row,
  visible,
  controller,
}: {
  row: ExchangeRow;
  visible: boolean;
  controller: ConversationCapability;
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
          mode: child.mode,
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
        <T tone={error ? 'danger' : 'muted'} style={{ fontSize: 12 }}>
          {error || '读取中…'}
        </T>
      </View>
    );
  const paths = controller.changedPaths(task);
  const firstFile = controller.files.find(file => file.path === paths[0]);
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
          style={{ fontSize: 11 }}
        >
          {
            {
              queued: '等待启动',
              running: '执行中',
              waiting_children: '等待子任务',
              cancelling: '正在停止',
              completed: '已完成',
              failed: '执行失败',
              cancelled: '已停止',
              interrupted: '已中断',
            }[task.state]
          }
        </T>
        <T tone="muted" numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
          {task.mode === 'demo' ? '演示模式' : (task.modelName ?? '模型未记录')}
        </T>
        <T tone="muted" style={{ fontSize: 11 }}>
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
          <T tone="danger" style={{ fontSize: 13 }}>
            {task.error.message}
          </T>
        </View>
      )}
      {terminalRun(task.state) && paths.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: theme.border,
            minHeight: 44,
          }}
        >
          <FileText size={16} color={theme.accent} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'打开产物 ' + paths[0]}
            disabled={!firstFile || controller.busy}
            onPress={() => {
              if (firstFile) void controller.openFile(firstFile);
            }}
            style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}
          >
            <T numberOfLines={1} style={{ fontSize: 13, fontWeight: '500' }}>
              {fileName(paths[0])}
              {paths.length > 1 ? ' +' + (paths.length - 1) : ''}
            </T>
          </Pressable>
          <IconButton
            icon={GitCommitHorizontal}
            label="查看变化"
            size={44}
            disabled={controller.busy}
            onPress={() => {
              void controller.reviewTask(task);
            }}
          />
        </View>
      )}
    </View>
  );
}

const suggestions = [
  {
    title: '整理资料',
    prompt: '请阅读项目中的文字资料，整理成一份结构清晰的笔记，保存为 documents/summary.md。',
  },
  {
    title: '改写润色',
    prompt: '请阅读项目中的笔记，保留原意，改写成清晰自然的文字，保存为一份新文档。',
  },
  { title: '看图写文', prompt: '请阅读项目中的图片与文字，整理成一份图文资料，保留原始文件。' },
  { title: '自由创作', prompt: '请帮我起草一份新文档，主题是：' },
];

export const Conversation = memo(function Conversation({
  controller,
}: {
  controller: ConversationCapability;
}) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 700;
  const scroll = useRef<FlatList<ExchangeRow>>(null);
  const input = useRef<TextInput>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [inputHeight, setInputHeight] = useState(38);
  const [focused, setFocused] = useState(false);
  const [adding, setAdding] = useState(false);
  const tasks: ExchangeRow[] = controller.tasks
    .filter(task => task.id !== controller.conversationActive?.id)
    .map(summary => ({ id: summary.id, summary }));
  if (controller.conversationActive)
    tasks.unshift({ id: controller.conversationActive.id, live: controller.conversationActive });
  const latestTaskId = tasks[0]?.id;
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const viewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ExchangeRow>[] }) =>
      setVisible(new Set(viewableItems.map(item => item.item.id))),
    [],
  );
  useEffect(() => {
    stick.current = true;
    const frame = requestAnimationFrame(() =>
      scroll.current?.scrollToOffset({ offset: 0, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [controller.conversationId, latestTaskId]);
  const sendDisabled =
    !controller.selectedConversation ||
    !controller.prompt.trim() ||
    controller.busy ||
    !!controller.conversationActive ||
    controller.projectLoading;
  const send = () => {
    stick.current = true;
    void controller.submit();
  };
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.surface }}>
      <FlatList
        ref={scroll}
        testID="conversation-scroll"
        style={{ flex: 1 }}
        inverted={!!tasks.length}
        data={tasks}
        keyExtractor={row => row.id}
        initialNumToRender={initialRows}
        maxToRenderPerBatch={3}
        windowSize={5}
        extraData={visible}
        onViewableItemsChanged={viewable}
        renderItem={({ item, index }) => (
          <Exchange
            row={item}
            visible={index < initialRows || visible.has(item.id)}
            controller={controller}
          />
        )}
        contentContainerStyle={{
          flexGrow: 1,
          width: '100%',
          maxWidth: 800,
          alignSelf: 'center',
          paddingHorizontal: mobile ? metrics.gutter : 24,
          paddingTop: 12,
          paddingBottom: 8,
        }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={event => {
          const bottom = event.nativeEvent.contentOffset.y < 100;
          stick.current = bottom;
          setAtBottom(bottom);
        }}
        onContentSizeChange={() => {
          if (stick.current && tasks.length)
            scroll.current?.scrollToOffset({ offset: 0, animated: false });
        }}
        ListFooterComponent={
          controller.taskCursor ? (
            <Button
              label="加载更早对话"
              variant="ghost"
              compact
              busy={controller.historyBusy}
              onPress={() => {
                void controller.loadOlderRuns();
              }}
            />
          ) : null
        }
        ListEmptyComponent={
          controller.projectLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} />
          ) : (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                alignSelf: 'center',
                width: '100%',
                maxWidth: 580,
                gap: 12,
                paddingVertical: 16,
              }}
            >
              <T style={{ fontSize: 18, fontWeight: '600' }}>从一个目标开始</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {suggestions.map(({ title, prompt }) => (
                  <Button
                    key={title}
                    label={title}
                    compact
                    variant="secondary"
                    onPress={() => {
                      controller.setPrompt(prompt);
                      input.current?.focus();
                    }}
                  />
                ))}
              </View>
            </View>
          )
        }
      />
      {!atBottom && tasks.length > 0 && (
        <View
          style={{
            position: 'absolute',
            bottom: 124,
            alignSelf: 'center',
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 6,
          }}
        >
          <IconButton
            icon={ArrowDown}
            label="回到最新消息"
            size={44}
            onPress={() => {
              stick.current = true;
              scroll.current?.scrollToOffset({ offset: 0, animated: true });
            }}
          />
        </View>
      )}
      <View
        testID="composer"
        style={{
          paddingHorizontal: mobile ? 8 : 20,
          paddingVertical: 6,
          width: '100%',
          maxWidth: 820,
          alignSelf: 'center',
        }}
      >
        {!!controller.active && !controller.conversationActive && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <T tone="secondary" style={{ flex: 1, fontSize: 12 }}>
              {controller.projectActive
                ? '此项目有任务执行中，发送后排队。'
                : '其他项目有任务执行中。'}
            </T>
            <IconButton
              icon={ArrowUp}
              label="返回运行中的对话"
              size={44}
              onPress={() => controller.returnToActiveConversation()}
            />
          </View>
        )}
        <View
          style={{
            borderWidth: 1,
            borderColor: focused ? theme.accent : theme.border,
            borderRadius: metrics.composerRadius,
            paddingHorizontal: 6,
            paddingTop: 3,
            paddingBottom: 3,
            backgroundColor: theme.background,
          }}
        >
          {!!controller.attachment && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 4 }}>
              <FileText size={14} color={theme.accent} />
              <T numberOfLines={1} style={{ fontSize: 12, color: theme.accent, flex: 1 }}>
                {fileName(controller.attachment)}
              </T>
              <IconButton
                icon={X}
                label="移除参考文件"
                size={44}
                onPress={() => controller.setAttachment(undefined)}
              />
            </View>
          )}
          <TextInput
            ref={input}
            accessibilityLabel="任务目标"
            placeholder="消息…"
            placeholderTextColor={theme.muted}
            multiline
            value={controller.prompt}
            onChangeText={controller.setPrompt}
            maxLength={contentLimits.promptCharacters}
            editable={
              !controller.conversationActive &&
              !controller.busy &&
              !!controller.selectedConversation
            }
            textAlignVertical="top"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onContentSizeChange={event =>
              setInputHeight(Math.max(38, Math.min(112, event.nativeEvent.contentSize.height)))
            }
            onKeyPress={event => {
              if (
                Platform.OS === 'web' &&
                event.nativeEvent.key === 'Enter' &&
                !(event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey
              ) {
                event.preventDefault();
                if (!sendDisabled) send();
              }
            }}
            style={{
              height: inputHeight,
              fontSize: 16,
              lineHeight: 24,
              paddingHorizontal: 4,
              paddingVertical: 5,
              color: theme.text,
              ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as object) : {}),
            }}
          />
          {adding && (
            <View
              style={{ flexDirection: 'row', gap: 6, borderTopWidth: 1, borderColor: theme.border }}
            >
              <Button
                compact
                label="添加参考资料"
                variant="ghost"
                onPress={() => {
                  setAdding(false);
                  controller.setSheet('attach');
                }}
              />
              <Button
                compact
                label="选择技能"
                variant="ghost"
                onPress={() => {
                  setAdding(false);
                  controller.setSheet('skills');
                }}
              />
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton
              icon={Plus}
              label="添加"
              size={44}
              disabled={!!controller.conversationActive || controller.busy}
              selected={adding}
              onPress={() => setAdding(!adding)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="模型设置"
              onPress={controller.openModels}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                flex: 1,
                minWidth: 0,
                minHeight: 44,
              }}
            >
              <T
                tone={controller.settings.mode === 'demo' ? 'warning' : 'secondary'}
                numberOfLines={1}
                style={{ fontSize: 12, flexShrink: 1 }}
              >
                {controller.modelLabel}
              </T>
              <ChevronDown size={12} color={theme.muted} />
            </Pressable>
            {!!(controller.prompt || controller.attachment) && (
              <View
                accessibilityLabel={
                  controller.draftSaving
                    ? '正在保存草稿'
                    : controller.draftSaved
                      ? '草稿已保存'
                      : '草稿未保存'
                }
                style={{ width: 16 }}
              >
                {controller.draftSaving ? (
                  <ActivityIndicator size={12} color={theme.muted} />
                ) : (
                  <Check size={12} color={controller.draftSaved ? theme.success : theme.warning} />
                )}
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                controller.conversationActive
                  ? controller.conversationActive.state === 'queued'
                    ? '取消排队'
                    : '停止任务'
                  : '发送任务'
              }
              disabled={!controller.conversationActive && sendDisabled}
              onPress={() => (controller.conversationActive ? controller.stop() : send())}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: metrics.radius,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  controller.conversationActive || !sendDisabled ? theme.accent : theme.inset,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {controller.conversationActive ? (
                <Square size={14} fill={theme.accentText} color={theme.accentText} />
              ) : (
                <ArrowUp size={20} color={sendDisabled ? theme.muted : theme.accentText} />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
});
