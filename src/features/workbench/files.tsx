import type { ProjectFile } from '@/core/workspace/types';
import { fileName, sizeLabel } from '@/shared/format';
import { useWorkbenchTheme } from '@/shared/theme';
import { EmptyState } from '@/shared/ui/empty-state';
import { GitStatusBadge } from '@/shared/ui/git-status';
import { Folder, FolderOpen, Image as ImageIcon } from '@/shared/ui/icons';
import { T } from '@/shared/ui/primitives';
import { ViewTabs } from '@/shared/ui/selection';
import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import type { FilesCapability } from './use-workbench';

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
  const [filter, setFilter] = useState<'all' | 'text' | 'image' | 'binary'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const entries = useMemo(
    () =>
      controller.files.filter(
        file =>
          (filter === 'all' || filter === file.kind) &&
          file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [controller.files, query, filter],
  );
  const tree = useMemo(() => fileTree(entries), [entries]);
  const changed = new Map(
    controller.gitStatus?.files.map(file => [file.path, file.unstaged ?? file.staged]) ?? [],
  );
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
      {file.kind === 'image' ? (
        <View style={{ width: 24, height: 24, borderRadius: 2, overflow: 'hidden' }}>
          <Thumbnail file={file} controller={controller} />
        </View>
      ) : (
        <T tone="muted" variant="meta" style={{ width: 24 }}>
          {file.path.split('.').at(-1)?.slice(0, 4)}
        </T>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T numberOfLines={1} variant="label">
          {fileName(file.path)}
        </T>
        {!!query && (
          <T tone="muted" numberOfLines={1} variant="meta">
            {file.path}
          </T>
        )}
      </View>
      {changed.get(file.path) && <GitStatusBadge status={changed.get(file.path)!} />}
      <T tone="muted" variant="meta">
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
              <T numberOfLines={1} variant="label" style={{ flex: 1 }}>
                {node.name}
              </T>
            </Pressable>
            {expanded && nodes(node.children, depth + 1)}
          </View>
        );
      });
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <ViewTabs
        label="文件类型"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: '全部' },
          { value: 'text', label: '文字' },
          { value: 'image', label: '图片' },
          { value: 'binary', label: '其他' },
        ]}
        trailing={
          <T tone="muted" variant="caption">
            {entries.length}
          </T>
        }
      />
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 }}>
                  <T numberOfLines={1} variant="caption" style={{ flex: 1 }}>
                    {fileName(file.path)}
                  </T>
                  {changed.get(file.path) && <GitStatusBadge status={changed.get(file.path)!} />}
                </View>
              </Pressable>
            ))}
          </View>
        ) : query ? (
          entries.map(file => fileRow(file, 0))
        ) : (
          nodes(tree, 0)
        )}
        {!controller.projectLoading && !entries.length && (
          <EmptyState compact title={query ? '没有匹配的文件' : '暂无文件'} />
        )}
      </ScrollView>
    </View>
  );
});
