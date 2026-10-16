import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Folder,
  FolderOpen,
  Image as ImageIcon,
} from '@/shared/ui/icons';
import type { ProjectFile } from '@/core/workspace/types';
import type { FilesCapability } from './use-workbench';
import { isImage } from '@/core/workspace/path';
import { T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { fileName, sizeLabel } from '@/shared/format';

function Thumbnail({ file, controller }: { file: ProjectFile; controller: FilesCapability }) {
  const { preview, projectId } = controller;
  const theme = useWorkbenchTheme();
  const [loaded, setLoaded] = useState<{ key: string; uri: string }>();
  const key = projectId + ':' + file.path + ':' + file.revision;
  const uri = loaded?.key === key ? loaded.uri : undefined;
  useEffect(() => {
    let current = true;
    if (preview && projectId)
      void preview(projectId, file.path)
        .then(value => {
          if (current) setLoaded({ key, uri: value.content });
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [preview, projectId, file.path, key]);
  return uri ? (
    <Image source={{ uri }} contentFit="cover" style={{ width: '100%', height: '100%' }} />
  ) : (
    <ImageIcon size={18} color={theme.muted} />
  );
}
interface FileNode {
  path: string;
  name: string;
  file?: ProjectFile;
  children: Map<string, FileNode>;
}
function fileTree(files: ProjectFile[]) {
  const root = new Map<string, FileNode>();
  for (const file of files) {
    let nodes = root;
    const parts = file.path.split('/');
    parts.forEach((name, index) => {
      let node = nodes.get(name);
      if (!node) {
        node = { name, path: parts.slice(0, index + 1).join('/'), children: new Map() };
        nodes.set(name, node);
      }
      if (index === parts.length - 1) node.file = file;
      nodes = node.children;
    });
  }
  return root;
}

export const FilesPane = memo(function FilesPane({
  controller,
  query = '',
}: {
  controller: FilesCapability;
  query?: string;
}) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const [filter, setFilter] = useState<'all' | 'text' | 'image'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const entries = useMemo(
    () =>
      controller.files.filter(
        file =>
          (filter === 'all' || (filter === 'image') === isImage(file.path)) &&
          file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [controller.files, query, filter],
  );
  const tree = useMemo(() => fileTree(entries), [entries]);
  const changed = new Map(
    controller.gitStatus?.files.map(file => [file.path, file.unstaged ?? file.staged]) ?? [],
  );
  const marker = (path: string) =>
    changed.get(path)
      ? ({ added: 'A', modified: 'M', deleted: 'D' } as const)[changed.get(path)!]
      : '';
  const fileRow = (file: ProjectFile, depth: number) => (
    <Pressable
      key={file.path}
      accessibilityRole="button"
      accessibilityLabel={'打开 ' + file.path}
      disabled={controller.busy}
      onPress={() => {
        void controller.openFile(file);
      }}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 5 + Math.min(depth, 5) * 14,
        paddingRight: 5,
        borderBottomWidth: 1,
        borderColor: theme.border,
        backgroundColor:
          controller.openPath === file.path
            ? theme.accentSoft
            : pressed
              ? theme.inset
              : 'transparent',
      })}
    >
      {isImage(file.path) ? (
        <View style={{ width: 24, height: 24, borderRadius: 2, overflow: 'hidden' }}>
          <Thumbnail file={file} controller={controller} />
        </View>
      ) : (
        <T tone="muted" style={{ width: 24, fontSize: 10 }}>
          {file.path.split('.').at(-1)?.slice(0, 4)}
        </T>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T numberOfLines={1} style={{ fontSize: 13 }}>
          {fileName(file.path)}
        </T>
        {!!query && (
          <T tone="muted" numberOfLines={1} style={{ fontSize: 11 }}>
            {file.path}
          </T>
        )}
      </View>
      {!!marker(file.path) && (
        <T tone="warning" accessibilityLabel={'Git ' + marker(file.path)} style={{ fontSize: 12 }}>
          {marker(file.path)}
        </T>
      )}
      <T tone="muted" style={{ fontSize: 11 }}>
        {sizeLabel(file.size)}
      </T>
    </Pressable>
  );
  const nodes = (values: Map<string, FileNode>, depth: number): ReactNode =>
    [...values.values()]
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
      .map(node => {
        if (node.file) return fileRow(node.file, depth);
        const expanded = !collapsed.has(node.path);
        return (
          <View key={node.path}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'打开文件夹 ' + node.path}
              accessibilityState={{ expanded }}
              onPress={() =>
                setCollapsed(previous => {
                  const next = new Set(previous);
                  if (expanded) next.add(node.path);
                  else next.delete(node.path);
                  return next;
                })
              }
              style={{
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 4 + Math.min(depth, 5) * 14,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              {expanded ? (
                <FolderOpen size={16} color={theme.accent} />
              ) : (
                <Folder size={16} color={theme.accent} />
              )}
              <T numberOfLines={1} style={{ fontSize: 13, flex: 1 }}>
                {node.name}
              </T>
            </Pressable>
            {expanded && nodes(node.children, depth + 1)}
          </View>
        );
      });
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <View style={{ paddingHorizontal: 8, borderBottomWidth: 1, borderColor: theme.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {(['all', 'text', 'image'] as const).map(value => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={{ all: '全部', text: '文字', image: '图片' }[value]}
              accessibilityState={{ selected: filter === value }}
              onPress={() => setFilter(value)}
              style={{
                minHeight: 40,
                paddingHorizontal: 10,
                justifyContent: 'center',
                borderBottomWidth: 2,
                borderBottomColor: filter === value ? theme.accent : 'transparent',
              }}
            >
              <T tone={filter === value ? 'accent' : 'secondary'} style={{ fontSize: 12 }}>
                {{ all: '全部', text: '文字', image: '图片' }[value]}
              </T>
            </Pressable>
          ))}
          <T tone="muted" style={{ flex: 1, textAlign: 'right', fontSize: 11, paddingRight: 4 }}>
            {entries.length}
          </T>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12 }}
      >
        {controller.projectLoading ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />
        ) : filter === 'image' && entries.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 }}>
            {entries.map(file => (
              <Pressable
                key={file.path}
                accessibilityRole="button"
                accessibilityLabel={'打开 ' + file.path}
                onPress={() => {
                  void controller.openFile(file);
                }}
                style={{
                  width: compact ? '48%' : '31%',
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <View style={{ height: 100, backgroundColor: theme.inset }}>
                  <Thumbnail file={file} controller={controller} />
                </View>
                <T numberOfLines={1} style={{ fontSize: 12, padding: 6 }}>
                  {fileName(file.path)}
                </T>
              </Pressable>
            ))}
          </View>
        ) : query ? (
          entries.map(file => fileRow(file, 0))
        ) : (
          nodes(tree, 0)
        )}
        {!controller.projectLoading && !entries.length && (
          <T tone="muted" style={{ paddingVertical: 24, fontSize: 13 }}>
            {query ? '没有匹配的文件' : '暂无文件'}
          </T>
        )}
      </ScrollView>
    </View>
  );
});
