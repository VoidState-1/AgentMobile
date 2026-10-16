import { isImage, isMarkdown } from '@/core/workspace/path';
import { useWorkbenchTheme } from '@/shared/theme';
import { ArrowLeft, Download, FileText, Image as ImageIcon, Trash2, X } from '@/shared/ui/icons';
import { IconButton, Input, T, Toolbar, ToolbarAction } from '@/shared/ui/primitives';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Markdown, resolveImagePath } from './markdown';
import type { EditorCapability } from './use-workbench';

export const Editor = memo(function Editor({
  controller,
  mobile,
}: {
  controller: EditorCapability;
  mobile: boolean;
}) {
  const theme = useWorkbenchTheme();
  const [nameFocused, setNameFocused] = useState(false);
  const document = controller.editor!;
  const { preview } = controller;
  const readonly = controller.projectActive;
  const imageVersions = controller.files
    .filter(file => isImage(file.path))
    .map(file => file.path + ':' + file.revision)
    .join('|');
  const loadImage = useCallback(
    async (target: string) => {
      const path = resolveImagePath(document.path, target);
      if (!imageVersions || !isImage(path) || !preview) throw new Error('图片不可用');
      return (await preview(document.projectId, path)).content;
    },
    [document.path, document.projectId, preview, imageVersions],
  );
  const update = (patch: Partial<typeof document>) =>
    controller.setEditor(value => (value ? { ...value, ...patch } : value));
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handle = (event: KeyboardEvent) => {
      if (controller.sheet || controller.review || controller.confirmation) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (controller.dirty && !controller.busy && !readonly) void controller.saveEditor();
      }
    };
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [controller, readonly]);
  const body = (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
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
          !document.image ? (
            <ToolbarAction
              label={document.reading ? '编辑' : controller.dirty ? '保存' : '完成编辑'}
              text={document.reading ? '编辑' : controller.dirty ? '保存' : '完成'}
              primary
              disabled={readonly}
              busy={controller.busy}
              onPress={() => {
                if (document.reading) update({ reading: false });
                else if (!controller.dirty) update({ reading: true });
                else
                  void controller.saveEditor().then(saved => {
                    if (saved)
                      controller.setEditor(current =>
                        current?.identity === document.identity &&
                        current.text === current.savedText &&
                        current.name === current.savedName
                          ? { ...current, reading: true }
                          : current,
                      );
                  });
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
            {controller.dirty ? '未保存的修改' : document.image ? '图片预览' : '所有修改已保存'}
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
      {readonly && (
        <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
          <T tone="secondary" variant="caption">
            Agent 正在修改项目。你可以阅读，完成后再编辑。
          </T>
        </View>
      )}
      {document.externalChanged && (
        <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
          <T tone="secondary" variant="caption">
            文件已有新的版本。当前编辑已保留，保存前请核对变化。
          </T>
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
      {document.image ? (
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
      ) : document.reading ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
          {isMarkdown(document.path) ? (
            <Markdown content={document.text} loadImage={loadImage} />
          ) : (
            <T
              selectable
              testID="file-plain-preview"
              style={{
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                fontSize: 14,
                lineHeight: 24,
              }}
            >
              {document.text}
            </T>
          )}
        </ScrollView>
      ) : (
        <Input
          accessibilityLabel="正文"
          testID="file-content"
          multiline
          value={document.text}
          onChangeText={text => update({ text })}
          editable={!readonly}
          autoCorrect={false}
          autoCapitalize="none"
          scrollEnabled
          textAlignVertical="top"
          placeholder="从第一行开始…"
          placeholderTextColor={theme.muted}
          style={{
            flex: 1,
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 30,
            color: theme.text,
            fontSize: 14,
            lineHeight: 24,
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
        {document.image ? (
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
              disabled={controller.busy}
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
    <Modal visible animationType="none" onRequestClose={controller.closeEditor}>
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
