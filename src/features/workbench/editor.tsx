import { useCallback, useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ArrowLeft, Download, FileText, Image as ImageIcon, Pencil, Save, Trash2, X } from '@/shared/ui/icons';
import { Button, IconButton, T } from '@/shared/ui/primitives';
import { Markdown, resolveImagePath } from './markdown';
import { useWorkbenchTheme } from '@/shared/theme/use-theme';
import type { Workbench } from './use-workbench';
import { isImage } from '@/core/workspace/path';

export function Editor({ controller, mobile }: { controller: Workbench; mobile: boolean }) {
  const theme = useWorkbenchTheme();
  const document = controller.editor!;
  const readonly = !!controller.active && controller.active.projectId === document.projectId;
  const imageVersions = controller.files.filter((file) => isImage(file.path)).map((file) => file.path + ':' + file.revision).join('|');
  const loadImage = useCallback(async (target: string) => {
    const path = resolveImagePath(document.path, target);
    if (!imageVersions || !isImage(path) || !controller.runtime) throw new Error('图片不可用');
    return (await controller.runtime.workspace.preview(document.projectId, path)).content;
  }, [document.path, document.projectId, controller.runtime, imageVersions]);
  const update = (patch: Partial<typeof document>) => controller.setEditor((value) => value ? { ...value, ...patch } : value);
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
  const body = <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ flex: 1, backgroundColor: theme.surface }}>
    <View style={{ minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8,
      borderBottomWidth: 1, borderColor: theme.border }}>
      <IconButton icon={mobile ? ArrowLeft : X} label="关闭文件" onPress={controller.closeEditor} disabled={controller.busy} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T numberOfLines={1} style={{ fontSize: 14, fontWeight: '600' }}>{document.fresh ? '新建文字资料' : document.name}</T>
        <T tone={controller.dirty ? 'warning' : 'muted'} style={{ fontSize: 11 }}>{controller.dirty ? '未保存的修改' : document.image ? '图片预览' : '所有修改已保存'}</T>
      </View>
      {!document.image && <Button label="保存" icon={Save} compact={!mobile} busy={controller.busy} disabled={!controller.dirty || readonly}
        onPress={() => { void controller.saveEditor(); }} />}
    </View>
    {!!controller.error && <View style={{ paddingHorizontal: 18, paddingVertical: 10, backgroundColor: theme.dangerSoft }}>
      <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T></View>}
    {readonly && <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
      <T tone="secondary" style={{ fontSize: 12 }}>Agent 正在修改项目。你可以阅读，完成后再编辑。</T></View>}
    {document.externalChanged && <View style={{ padding: 12, backgroundColor: theme.warningSoft }}>
      <T tone="secondary" style={{ fontSize: 12 }}>文件已有新的版本。当前编辑已保留，保存前请核对变化。</T></View>}
    {document.fresh && <View style={{ paddingHorizontal: 20, paddingTop: 15, paddingBottom: 12, gap: 6 }}>
      <T tone="secondary" style={{ fontSize: 12 }}>文件名称</T>
      <TextInput accessibilityLabel="文件名称" value={document.name} onChangeText={(name) => update({ name })} autoCapitalize="none"
        autoCorrect={false} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, color: theme.text,
          paddingHorizontal: 10, height: 42, fontSize: 14, backgroundColor: theme.inset }} />
    </View>}
    {!document.image && <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 9, gap: 5,
      borderBottomWidth: 1, borderColor: theme.border }}>
      {(['reading', 'editing'] as const).map((mode) => <Pressable key={mode} accessibilityRole="button" disabled={readonly && mode === 'editing'}
        onPress={() => update({ reading: mode === 'reading' })} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6,
          backgroundColor: document.reading === (mode === 'reading') ? theme.inset : 'transparent' }}>
        <T tone={document.reading === (mode === 'reading') ? 'text' : 'muted'} style={{ fontSize: 12 }}>
          {mode === 'reading' ? '阅读' : '编辑'}
        </T>
      </Pressable>)}
      <View style={{ flex: 1 }} /><T tone="muted" style={{ fontSize: 11 }}>{document.text.length.toLocaleString()} 字符</T>
    </View>}
    {document.image ? <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <Image source={{ uri: document.text }} accessibilityLabel={document.name} contentFit="contain" style={{ width: '100%', height: '100%' }} />
    </View> : document.reading ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22 }}>
      <Markdown content={document.text} loadImage={loadImage} />
    </ScrollView> : <TextInput accessibilityLabel="正文" testID="file-content" multiline value={document.text} onChangeText={(text) => update({ text })}
      editable={!readonly} autoCorrect={false} autoCapitalize="none" scrollEnabled textAlignVertical="top"
      placeholder="从第一行开始…" placeholderTextColor={theme.muted}
      style={{ flex: 1, paddingHorizontal: 20, paddingTop: 19, paddingBottom: 30, color: theme.text, fontSize: 14, lineHeight: 25,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }} />}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 8,
      borderTopWidth: 1, borderColor: theme.border }}>
      {document.image ? <ImageIcon size={14} color={theme.muted} /> : <FileText size={14} color={theme.muted} />}
      <T tone="muted" style={{ flex: 1, fontSize: 11 }} numberOfLines={1}>{document.fresh ? '文字资料' : document.path}</T>
      {!document.fresh && <>
        <IconButton icon={Download} label="导出文件" disabled={controller.busy} onPress={() => { void controller.exportEditor(); }} />
        <IconButton icon={Pencil} label="重命名文件" disabled={controller.busy || readonly || controller.dirty}
          onPress={() => controller.setSheet('rename')} />
        <IconButton icon={Trash2} label="删除文件" disabled={controller.busy || readonly}
          onPress={controller.deleteEditor} />
      </>}
    </View>
  </KeyboardAvoidingView>;
  return mobile ? <Modal visible animationType="none" onRequestClose={controller.closeEditor}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }} edges={['top', 'bottom']}>{body}</SafeAreaView>
  </Modal> : <View style={{ width: 410, borderLeftWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>{body}</View>;
}
