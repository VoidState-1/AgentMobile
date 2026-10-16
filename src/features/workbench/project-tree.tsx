import { EmptyState } from '@/shared/ui/empty-state';
import { Archive, Folder, FolderOpen, MessageSquare, Plus, Search, X } from '@/shared/ui/icons';
import { Button, IconButton, Input, T, Toolbar } from '@/shared/ui/primitives';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import type { NavigationCapability } from './use-workbench';

import { useWorkbenchTheme } from '@/shared/theme';

export function ProjectTree({
  controller,
  close,
}: {
  controller: NavigationCapability;
  close?: () => void;
}) {
  const theme = useWorkbenchTheme();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<string>();
  const search = query.trim().toLocaleLowerCase();
  return (
    <View testID="project-tree" style={{ flex: 1, backgroundColor: theme.sidebar }}>
      <Toolbar
        trailing={
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              icon={searching ? X : Search}
              label={searching ? '收起搜索' : '搜索项目与对话'}
              size={44}
              onPress={() => {
                setSearching(!searching);
                setQuery('');
              }}
            />
            {!searching && controller.projects.length > 0 && (
              <IconButton
                icon={Plus}
                label="新建项目"
                size={44}
                disabled={controller.busy}
                onPress={controller.newProject}
              />
            )}
            {close && <IconButton icon={X} label="收起侧栏" size={44} onPress={close} />}
          </View>
        }
      >
        {searching ? (
          <Input
            autoFocus
            accessibilityLabel="搜索项目与对话"
            value={query}
            onChangeText={setQuery}
            placeholder="搜索"
            placeholderTextColor={theme.muted}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 16,
              color: theme.text,
              height: 44,
            }}
          />
        ) : (
          <T variant="title" style={{ flex: 1, fontWeight: '600' }}>
            Agent Mobile
          </T>
        )}
      </Toolbar>
      {archived && (
        <T tone="secondary" variant="caption" style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          已归档
        </T>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 6, paddingBottom: 12 }}
      >
        {!controller.projects.length && (
          <EmptyState
            compact
            title="暂无项目"
            action={
              <Button
                label="新建项目"
                icon={Plus}
                onPress={controller.newProject}
                disabled={controller.busy}
              />
            }
          />
        )}
        {controller.projects.map(project => {
          const projectMatches = project.name.toLocaleLowerCase().includes(search);
          const conversations = controller.allConversations
            .filter(
              item =>
                item.projectId === project.id &&
                !!item.archivedAt === archived &&
                (!search || projectMatches || item.title.toLocaleLowerCase().includes(search)),
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          if (search && !projectMatches && !conversations.length) return null;
          const expanded = !!search || !collapsed.has(project.id);
          return (
            <View key={project.id} testID="project-node" style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'展开项目 ' + project.name}
                  accessibilityState={{ expanded }}
                  aria-expanded={expanded}
                  onPress={() =>
                    setCollapsed(values => {
                      const next = new Set(values);
                      if (expanded) next.add(project.id);
                      else next.delete(project.id);
                      return next;
                    })
                  }
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 36,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 4,
                  }}
                >
                  {expanded ? (
                    <FolderOpen
                      size={16}
                      color={project.id === controller.projectId ? theme.accent : theme.secondary}
                    />
                  ) : (
                    <Folder
                      size={16}
                      color={project.id === controller.projectId ? theme.accent : theme.secondary}
                    />
                  )}
                  <T numberOfLines={1} variant="label" style={{ flex: 1, fontWeight: '600' }}>
                    {project.name}
                  </T>
                  {controller.runs.some(run => run.projectId === project.id) && (
                    <ActivityIndicator size={12} color={theme.accent} />
                  )}
                </Pressable>
                {!archived && (
                  <IconButton
                    icon={Plus}
                    label={'新建对话 ' + project.name}
                    size={32}
                    disabled={controller.busy}
                    onPress={() => {
                      void controller.newConversation(project.id);
                    }}
                  />
                )}
              </View>
              {expanded && (
                <View
                  style={{
                    marginLeft: 11,
                    paddingLeft: 8,
                    borderLeftWidth: 1,
                    borderColor: theme.border,
                    marginTop: 2,
                  }}
                >
                  {conversations.map(item => {
                    const selected = item.id === controller.conversationId;
                    const running = controller.runs.some(run => run.conversationId === item.id);
                    return (
                      <View key={item.id} style={{ marginBottom: 2 }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={(archived ? '恢复对话 ' : '切换对话 ') + item.title}
                          accessibilityState={{ selected }}
                          disabled={controller.busy}
                          onPress={() => {
                            setMenu(undefined);
                            void (archived
                              ? controller.restoreConversation(item)
                              : controller.selectConversation(item.id, project.id));
                          }}
                          onLongPress={() =>
                            setMenu(value => (value === item.id ? undefined : item.id))
                          }
                          accessibilityActions={[{ name: 'longpress', label: '管理对话' }]}
                          onAccessibilityAction={event => {
                            if (event.nativeEvent.actionName === 'longpress') setMenu(item.id);
                          }}
                          style={({ pressed }) => ({
                            minHeight: 34,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            backgroundColor: selected
                              ? theme.accentSoft
                              : pressed
                                ? theme.inset
                                : 'transparent',
                          })}
                        >
                          {running ? (
                            <ActivityIndicator size={13} color={theme.accent} />
                          ) : (
                            <MessageSquare
                              size={14}
                              color={selected ? theme.accent : theme.muted}
                            />
                          )}
                          <T
                            numberOfLines={1}
                            variant="label"
                            style={{ flex: 1, color: selected ? theme.accent : theme.text }}
                          >
                            {item.title}
                          </T>
                          {!!controller.conversationDrafts[item.id]?.text && (
                            <View
                              accessibilityLabel="有草稿"
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: theme.muted,
                              }}
                            />
                          )}
                        </Pressable>
                        {menu === item.id && !archived && (
                          <View
                            style={{
                              flexDirection: 'row',
                              gap: 4,
                              paddingLeft: 20,
                              backgroundColor: theme.inset,
                            }}
                          >
                            <Button
                              label="重命名"
                              accessibilityLabel={'重命名对话 ' + item.title}
                              compact
                              variant="ghost"
                              onPress={() => {
                                setMenu(undefined);
                                controller.startRenameConversation(item);
                              }}
                            />
                            <Button
                              label="归档"
                              accessibilityLabel={'归档对话 ' + item.title}
                              compact
                              variant="ghost"
                              disabled={running || controller.busy}
                              onPress={() => {
                                setMenu(undefined);
                                controller.archiveConversation(item);
                              }}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {!conversations.length && archived && <EmptyState compact title="暂无归档" />}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={archived ? '未归档' : '已归档'}
        accessibilityState={{ selected: archived }}
        onPress={() => {
          setArchived(!archived);
          setMenu(undefined);
        }}
        style={{
          minHeight: 44,
          paddingHorizontal: 14,
          borderTopWidth: 1,
          borderColor: theme.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Archive size={16} color={archived ? theme.accent : theme.secondary} />
        <T tone={archived ? 'accent' : 'secondary'} variant="caption">
          {archived ? '返回对话' : '已归档'}
        </T>
      </Pressable>
    </View>
  );
}
