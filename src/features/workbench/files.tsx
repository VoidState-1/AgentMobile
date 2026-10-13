import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight, FileText, Folder, Image as ImageIcon, Plus, Search, Upload, X } from './icons';
import type { ProjectFile } from '@/core/prototype/types';
import type { Workbench } from './use-workbench';
import { isImage } from '@/core/workspace/path';
import { Button, IconButton, T } from './ui';
import { useWorkbenchTheme } from './theme';
import { fileName, sizeLabel } from './format';

function Thumbnail({ file, controller }: { file: ProjectFile; controller: Workbench }) {
  const theme = useWorkbenchTheme();
  const [uri, setUri] = useState<string>();
  useEffect(() => {
    let current = true;
    if (controller.runtime && controller.projectId) {
      controller.runtime.workspace.preview(controller.projectId, file.path).then((value) => {
        if (current) setUri(value.content);
      }).catch(() => {});
    }
    return () => { current = false; };
  }, [controller.runtime, controller.projectId, file.path, file.revision]);
  return uri ? <Image source={{ uri }} contentFit="cover" style={{ width: '100%', height: '100%' }} /> :
    <ImageIcon size={22} color={theme.muted} />;
}

export function FilesPane({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'text' | 'image'>('all');
  const [folder, setFolder] = useState('');
  const entries = controller.files.filter((file) =>
    (!folder || file.path.startsWith(folder + '/')) &&
    (filter === 'all' || (filter === 'image') === isImage(file.path)) &&
    file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const directories = [...new Set(controller.files.map((file) => file.path.split('/').slice(0, -1).join('/')).filter(Boolean))];
  return <View style={{ flex: 1, backgroundColor: theme.surface }}>
    <View style={{ padding: compact ? 16 : 22, paddingBottom: 12, gap: 14, borderBottomWidth: 1, borderColor: theme.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View><T style={{ fontWeight: '600', fontSize: 16 }}>项目资料</T>
          <T tone="secondary" style={{ fontSize: 12, marginTop: 3 }}>{controller.files.length} 个文件 · 保存在此设备</T></View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <IconButton icon={Upload} label="导入" disabled={controller.busy || !!controller.projectActive} onPress={() => { void controller.importFile(); }} />
          <Button label="新建文件" icon={Plus} compact={!compact} disabled={controller.busy || !!controller.projectActive} onPress={controller.newFile} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 8, backgroundColor: theme.inset, paddingHorizontal: 11, gap: 8 }}>
        <Search size={16} color={theme.muted} />
        <TextInput accessibilityLabel="搜索文件" placeholder="搜索文件名称…" placeholderTextColor={theme.muted}
          value={query} onChangeText={setQuery} style={{ flex: 1, height: 40, color: theme.text, fontSize: 13 }} />
        {!!query && <IconButton size={32} icon={X} label="清除文件搜索" onPress={() => setQuery('')} />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {(['all', 'text', 'image'] as const).map((value) => <Pressable key={value} accessibilityRole="button"
          accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 7, backgroundColor: filter === value ? theme.accentSoft : 'transparent' }}>
          <T tone={filter === value ? 'accent' : 'secondary'} style={{ fontSize: 12, fontWeight: filter === value ? '600' : '400' }}>
            {{ all: '全部', text: '文字', image: '图片' }[value]}
          </T></Pressable>)}
        <View style={{ flex: 1 }} />
        <T tone="muted" style={{ fontSize: 11 }}>{entries.length} 项</T>
      </View>
    </View>
    <ScrollView contentContainerStyle={{ padding: compact ? 16 : 22, gap: 16 }} keyboardShouldPersistTaps="handled">
      {controller.projectLoading ? <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} /> : <>
        {!query && filter === 'all' && !folder && directories.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {directories.map((directory) => <Pressable key={directory} accessibilityRole="button" accessibilityLabel={'打开文件夹 ' + directory}
            onPress={() => setFolder(directory)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border,
              borderRadius: 10, padding: 13, minWidth: 140, flexGrow: 1, backgroundColor: theme.background }}>
            <Folder size={21} color={theme.accent} strokeWidth={1.6} />
            <View><T style={{ fontSize: 13, fontWeight: '500' }}>{({ documents: '文字资料', assets: '图片素材' } as Record<string, string>)[directory] ?? directory}</T>
              <T tone="muted" style={{ fontSize: 11 }}>{controller.files.filter((file) => file.path.startsWith(directory + '/')).length} 个文件</T></View>
          </Pressable>)}
        </View>}
        {folder && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Pressable accessibilityRole="button" onPress={() => setFolder('')}><T tone="accent" style={{ fontSize: 12 }}>全部资料</T></Pressable>
          <ChevronRight size={12} color={theme.muted} /><T tone="secondary" style={{ fontSize: 12 }}>{folder}</T>
        </View>}
        {filter === 'image' && entries.length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {entries.map((file) => <Pressable key={file.path} accessibilityRole="button" accessibilityLabel={'打开 ' + file.path}
            onPress={() => { void controller.openFile(file); }} style={{ width: compact ? '47%' : '30%', borderWidth: 1,
              borderColor: theme.border, borderRadius: 10, overflow: 'hidden' }}>
            <View style={{ height: 118, backgroundColor: theme.inset, alignItems: 'center', justifyContent: 'center' }}><Thumbnail file={file} controller={controller} /></View>
            <View style={{ padding: 10 }}><T numberOfLines={1} style={{ fontSize: 12, fontWeight: '500' }}>{fileName(file.path)}</T>
              <T tone="muted" style={{ fontSize: 11 }}>{sizeLabel(file.size)}</T></View>
          </Pressable>)}
        </View> : <View>
          {entries.map((file) => <Pressable key={file.path} accessibilityRole="button" accessibilityLabel={'打开 ' + file.path}
            onPress={() => { void controller.openFile(file); }} disabled={controller.busy}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8,
              borderRadius: 8, backgroundColor: controller.editor?.path === file.path ? theme.accentSoft : pressed ? theme.inset : 'transparent',
              borderBottomWidth: 1, borderBottomColor: theme.border })}>
            <View style={{ width: 36, height: 40, borderRadius: 8, backgroundColor: theme.inset, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {isImage(file.path) ? <Thumbnail file={file} controller={controller} /> : <FileText size={19} color={theme.secondary} strokeWidth={1.6} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}><T numberOfLines={1} style={{ fontSize: 13, fontWeight: '500' }}>{fileName(file.path)}</T>
              <T tone="muted" numberOfLines={1} style={{ fontSize: 11 }}>{file.path}</T></View>
            <T tone="muted" style={{ fontSize: 11 }}>{sizeLabel(file.size)}</T><ChevronRight size={16} color={theme.muted} />
          </Pressable>)}
        </View>}
        {entries.length === 0 && <View style={{ alignItems: 'center', paddingVertical: 55, gap: 12 }}>
          <Search size={28} color={theme.muted} strokeWidth={1.5} />
          <T tone="secondary">{query ? '没有找到匹配的文件' : '这里还没有资料'}</T>
          <T tone="muted" style={{ fontSize: 12 }}>{query ? '试试其他名称，或清除筛选。' : '导入文件，或新建一份文字资料。'}</T>
        </View>}
      </>}
    </ScrollView>
  </View>;
}
