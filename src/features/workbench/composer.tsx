import { contentLimits } from '@/core/agent/settings';
import { fileName } from '@/shared/format';
import { workbenchMetrics as metrics, useWorkbenchTheme } from '@/shared/theme';
import { ArrowUp, Check, ChevronDown, FileText, Layers, Plus, Square, X } from '@/shared/ui/icons';
import { Button, IconButton, Input, T } from '@/shared/ui/primitives';
import { useState } from 'react';
import type { TextInput } from 'react-native';
import { ActivityIndicator, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import type { ConversationCapability } from './use-workbench';

import type { RefObject } from 'react';

type ComposerController = Pick<
  ConversationCapability,
  | 'active'
  | 'attachment'
  | 'busy'
  | 'conversationActive'
  | 'draftSaved'
  | 'draftSaving'
  | 'modelLabel'
  | 'openModels'
  | 'projectActive'
  | 'projectLoading'
  | 'prompt'
  | 'returnToActiveConversation'
  | 'selectedConversation'
  | 'setAttachment'
  | 'setPrompt'
  | 'setSheet'
  | 'settings'
  | 'stop'
>;

export function Composer({
  controller,
  inputRef,
  onSubmit,
}: {
  controller: ComposerController;
  inputRef: RefObject<TextInput | null>;
  onSubmit(): void;
}) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 700;
  const [inputHeight, setInputHeight] = useState(38);
  const [focused, setFocused] = useState(false);
  const [adding, setAdding] = useState(false);
  const sendDisabled =
    !controller.selectedConversation ||
    !controller.prompt.trim() ||
    controller.busy ||
    !!controller.conversationActive ||
    controller.projectLoading;
  return (
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
          <T tone="secondary" variant="caption" style={{ flex: 1 }}>
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
            <T numberOfLines={1} variant="caption" style={{ color: theme.accent, flex: 1 }}>
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
        <Input
          ref={inputRef}
          accessibilityLabel="任务目标"
          placeholder="消息…"
          placeholderTextColor={theme.muted}
          multiline
          value={controller.prompt}
          onChangeText={controller.setPrompt}
          maxLength={contentLimits.promptCharacters}
          editable={
            !controller.conversationActive && !controller.busy && !!controller.selectedConversation
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
              if (!sendDisabled) onSubmit();
            }
          }}
          style={{
            height: inputHeight,
            fontSize: 16,
            lineHeight: 24,
            paddingHorizontal: 4,
            paddingVertical: 5,
            color: theme.text,
          }}
        />
        {adding && (
          <View
            style={{ flexDirection: 'row', gap: 6, borderTopWidth: 1, borderColor: theme.border }}
          >
            <Button
              compact
              label="添加参考资料"
              icon={FileText}
              variant="secondary"
              onPress={() => {
                setAdding(false);
                controller.setSheet('attach');
              }}
            />
            <Button
              compact
              label="选择技能"
              icon={Layers}
              variant="secondary"
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
            <T tone="secondary" numberOfLines={1} variant="caption" style={{ flexShrink: 1 }}>
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
            onPress={() => (controller.conversationActive ? controller.stop() : onSubmit())}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: metrics.radius,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                controller.conversationActive || !sendDisabled ? theme.accent : 'transparent',
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
  );
}
