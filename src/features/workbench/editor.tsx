import { isMarkdown } from '@/core/workspace/path';
import { sizeLabel } from '@/shared/format';
import { useWorkbenchTheme } from '@/shared/theme';
import { ArrowLeft, Download, FileText, Image as ImageIcon, Trash2, X } from '@/shared/ui/icons';
import { IconButton, Input, T, Toolbar, ToolbarAction } from '@/shared/ui/primitives';
import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Linking, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DocumentHost } from '@/features/document/document-host';
import { resolveProjectPath } from '@/features/document/image-path';
import { externalLink } from '@/features/document/resources';
import { stateOfEditor, withEditorState } from './editor-model';
import type { EditorCapability } from './use-workbench';

export const Editor = memo(function Editor({
  controller,
  mobile,
}: {
  controller: EditorCapability;
  mobile: boolean;
}) {
  const theme = useWorkbenchTheme();
  const reduceMotion = useReducedMotion();
  const [nameFocused, setNameFocused] = useState(false);
  const document = controller.editor!;
  const { preview } = controller;
  const readonly = controller.projectActive || !!document.saveUncertain;
  const imageVersions = controller.files
    .filter(file => file.kind === 'image')
    .map(file => file.path + ':' + file.revision)
    .join('|');
  const loadImage = useCallback(
    async (target: string) => {
      const path = resolveProjectPath(document.path, target);
      if (!imageVersions || !preview) throw new Error('图片不可用');
      const value = await preview(document.projectId, path);
      if (value.kind !== 'image' || value.unavailableReason) throw new Error('图片不可用');
      return value.content;
    },
    [document.path, document.projectId, preview, imageVersions],
  );
  const update = (patch: Partial<typeof document>) =>
    controller.setEditor(value => (value ? { ...value, ...patch } : value));
  const body = (
    <KeyboardAvoidingView
      behavior={
        Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
      }
      style={{ flex: 1, backgroundColor: theme.surface }}
    >
      <Toolbar
        leading={
          <IconButton
            icon={mobile ? ArrowLeft : X}
            label="关闭文件"
            onPress={controller.closeEditor}
            disabled={controller.busy}
          />
        }
        trailing={
          document.kind === 'text' && !document.unavailableReason ? (
            <ToolbarAction
              label="保存文件"
              text="保存"
              primary
              disabled={readonly || (!controller.dirty && !document.editState.regions.length)}
              busy={controller.busy}
              onPress={() => {
                void controller.saveEditor();
              }}
            />
          ) : undefined
        }
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重命名文件"
            disabled={document.fresh || controller.busy || readonly || controller.dirty}
            hitSlop={{ top: 8, bottom: 8 }}
            onPress={() => controller.setSheet('rename')}
          >
            <T numberOfLines={1} variant="title" style={{ fontWeight: '600' }}>
              {document.fresh ? '新建文字资料' : document.name}
            </T>
          </Pressable>
          <T tone={controller.dirty ? 'warning' : 'muted'} variant="meta">
            {controller.dirty
              ? '未保存的修改'
              : document.unavailableReason
                ? '文件已保存'
                : document.kind === 'image'
                  ? '图片预览'
                  : '所有修改已保存'}
          </T>
        </View>
      </Toolbar>
      {!!controller.error && (
        <View
          style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.dangerSoft }}
        >
          <T tone="danger" variant="caption">
            {controller.error}
          </T>
        </View>
      )}
      {controller.projectActive && (
        <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
          <T tone="secondary" variant="caption">
            Agent 正在修改项目。你可以阅读，完成后再编辑。
          </T>
        </View>
      )}
      {document.saveUncertain && (
        <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
          <T tone="warning">保存结果暂时无法核对，草稿与操作凭据已保留。</T>
          <ToolbarAction
            label="重试保存"
            text="重试保存"
            busy={controller.busy}
            onPress={() => {
              void controller.retryEditorSave();
            }}
          />
        </View>
      )}
      {document.externalChanged && (
        <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
          <T tone="secondary" variant="caption">
            {document.fresh
              ? '目标文件已有其他内容，请更名后保存。'
              : '文件已有新的版本。当前编辑已保留，保存前请核对变化。'}
          </T>
          {!document.fresh && (
            <ToolbarAction label="重新载入文件" text="重新载入" onPress={controller.reloadEditor} />
          )}
        </View>
      )}
      {document.fresh && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 5 }}>
          <T tone="secondary" variant="caption">
            文件名称
          </T>
          <Input
            accessibilityLabel="文件名称"
            value={document.name}
            editable={!readonly && !controller.busy && !document.pendingSave}
            onChangeText={name => update({ name })}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            style={{
              borderWidth: 1,
              borderColor: nameFocused ? theme.accent : theme.border,
              borderRadius: 8,
              color: theme.text,
              paddingHorizontal: 10,
              height: 42,
              fontSize: 14,
              backgroundColor: theme.inset,
            }}
          />
        </View>
      )}
      {document.unavailableReason ? (
        <View
          testID="file-unavailable-preview"
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 }}
        >
          <FileText size={28} color={theme.muted} />
          <T>{document.name}</T>
          <T tone="muted">{sizeLabel(document.size)}</T>
          <T tone="secondary" style={{ textAlign: 'center' }}>
            {document.unavailableReason}
          </T>
        </View>
      ) : document.kind === 'image' ? (
        <View
          style={{
            flex: 1,
            backgroundColor: theme.background,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
        >
          <Image
            source={{ uri: document.text }}
            accessibilityLabel={document.name}
            contentFit="contain"
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      ) : (
        <DocumentHost
          key={document.identity}
          ref={controller.editorPort}
          state={stateOfEditor(document)}
          language={isMarkdown(document.name) ? 'markdown' : 'plain'}
          readonly={readonly}
          inputLocked={controller.busy}
          imageVersion={imageVersions}
          loadImage={loadImage}
          onChange={state =>
            controller.setEditor(current =>
              current?.identity === document.identity && current.savedText === state.base
                ? withEditorState(current, state)
                : current,
            )
          }
          onSave={(text, state, next) =>
            controller.commitEditor(document.identity, text, state, next)
          }
          onModeRequest={controller.requestEditorMode}
          onLink={url => {
            if (externalLink(url)) void Linking.openURL(url);
            else {
              try {
                const path = resolveProjectPath(document.path, url.split('#')[0]);
                const file = controller.files.find(file => file.path === path);
                if (file) void controller.openFile(file);
              } catch {}
            }
          }}
        />
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 8,
          paddingVertical: 0,
          borderTopWidth: 1,
          borderColor: theme.border,
        }}
      >
        {document.kind === 'image' ? (
          <ImageIcon size={14} color={theme.muted} />
        ) : (
          <FileText size={14} color={theme.muted} />
        )}
        <T tone="muted" variant="meta" style={{ flex: 1 }} numberOfLines={1}>
          {document.fresh ? '文字资料' : document.path}
        </T>
        {!document.fresh && (
          <>
            <IconButton
              icon={Download}
              label="导出文件"
              disabled={controller.busy || controller.dirty}
              onPress={() => {
                void controller.exportEditor();
              }}
            />
            <IconButton
              icon={Trash2}
              label="删除文件"
              disabled={controller.busy || readonly}
              onPress={controller.deleteEditor}
            />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
  return mobile ? (
    <Modal
      visible
      animationType={Platform.OS === 'web' || reduceMotion ? 'none' : 'slide'}
      onRequestClose={controller.closeEditor}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }} edges={['top', 'bottom']}>
        {body}
      </SafeAreaView>
    </Modal>
  ) : (
    <View
      style={{
        width: 410,
        borderLeftWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
      }}
    >
      {body}
    </View>
  );
});
