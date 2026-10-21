import { workbenchMetrics as metrics, useWorkbenchTheme } from '@/shared/theme';
import { EmptyState } from '@/shared/ui/empty-state';
import { ArrowDown } from '@/shared/ui/icons';
import { Button, IconButton } from '@/shared/ui/primitives';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  View,
  useWindowDimensions,
  type TextInput,
  type ViewToken,
} from 'react-native';
import type { ConversationCapability } from './use-workbench';

import { Composer } from './composer';
import { Exchange, type ExchangeRow } from './exchange-item';

// Route transitions can mount the initial cells before viewability reports them.
const initialRows = 3;
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
  const controllerRef = useRef(controller);
  useLayoutEffect(() => {
    controllerRef.current = controller;
  }, [controller]);
  const exchangeActions = useMemo(
    () => ({
      openFile: (...args: Parameters<ConversationCapability['openFile']>) =>
        controllerRef.current.openFile(...args),
      changedPaths: (...args: Parameters<ConversationCapability['changedPaths']>) =>
        controllerRef.current.changedPaths(...args),
      reviewTask: (...args: Parameters<ConversationCapability['reviewTask']>) =>
        controllerRef.current.reviewTask(...args),
      taskChangeSummary: (
        ...args: Parameters<NonNullable<ConversationCapability['taskChangeSummary']>>
      ) => controllerRef.current.taskChangeSummary!(...args),
      cancelChild: (...args: Parameters<ConversationCapability['cancelChild']>) =>
        controllerRef.current.cancelChild(...args),
      reviewProposal: (...args: Parameters<ConversationCapability['reviewProposal']>) =>
        controllerRef.current.reviewProposal(...args),
    }),
    [],
  );
  const exchangeController = {
    busy: controller.busy,
    changedPaths: exchangeActions.changedPaths,
    files: controller.files,
    openFile: exchangeActions.openFile,
    reviewTask: exchangeActions.reviewTask,
    taskChangeSummary: controller.taskChangeSummary ? exchangeActions.taskChangeSummary : undefined,
    runsApi: controller.runsApi,
    cancelChild: exchangeActions.cancelChild,
    reviewProposal: exchangeActions.reviewProposal,
  };
  const tasks: ExchangeRow[] = useMemo(() => {
    const rows: ExchangeRow[] = controller.tasks
      .filter(task => task.id !== controller.conversationActive?.id)
      .map(summary => ({ id: summary.id, summary }));
    if (controller.conversationActive)
      rows.unshift({ id: controller.conversationActive.id, live: controller.conversationActive });
    return rows;
  }, [controller.tasks, controller.conversationActive]);
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
            controller={exchangeController}
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
            <EmptyState
              title="从一个目标开始"
              action={
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
              }
            />
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
      <Composer controller={controller} inputRef={input} onSubmit={send} />
    </View>
  );
});
