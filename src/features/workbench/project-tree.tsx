import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { DialogsCapability } from './use-workbench';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Plus,
  Search,
  X,
} from '@/shared/ui/icons';
import { Button, IconButton, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme, workbenchMetrics as metrics } from '@/shared/theme';

export function ProjectTree({
  controller,
  close,
}: {
  controller: DialogsCapability;
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
      <View
        style={{
          minHeight: metrics.header,
          paddingLeft: 12,
          paddingRight: 4,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        {searching ? (
          <TextInput
            autoFocus
            accessibilityLabel="搜索项目与对话"
            value={query}
            onChangeText={setQuery}
            placeholder="搜索"
            placeholderTextColor={theme.muted}
            style={{ flex: 1, minWidth: 0, fontSize: 16, color: theme.text, height: 44 }}
          />
        ) : (
          <T style={{ flex: 1, fontWeight: '600', fontSize: 15 }}>Agent Mobile</T>
        )}
        <IconButton
          icon={searching ? X : Search}
          label={searching ? '收起搜索' : '搜索项目与对话'}
          size={44}
          onPress={() => {
            setSearching(!searching);
            setQuery('');
          }}
        />
        {!searching && (
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
      {archived && (
        <T tone="secondary" style={{ paddingHorizontal: 12, paddingTop: 8, fontSize: 12 }}>
          已归档
        </T>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 6, paddingBottom: 12 }}
      >
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
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 4,
                  }}
                >
                  {expanded ? (
                    <ChevronDown size={13} color={theme.muted} />
                  ) : (
                    <ChevronRight size={13} color={theme.muted} />
                  )}
                  <Folder
                    size={16}
                    color={project.id === controller.projectId ? theme.accent : theme.secondary}
                  />
                  <T numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600' }}>
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
                    size={44}
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
                    paddingLeft: 9,
                    borderLeftWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  {conversations.map(item => {
                    const selected = item.id === controller.conversationId;
                    const running = controller.runs.some(run => run.conversationId === item.id);
                    return (
                      <View key={item.id}>
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
                            minHeight: 44,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 8,
                            paddingHorizontal: 8,
                            borderLeftWidth: 2,
                            borderLeftColor: selected ? theme.accent : 'transparent',
                            borderRadius: 3,
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
                            style={{
                              flex: 1,
                              fontSize: 13,
                              color: selected ? theme.accent : theme.text,
                            }}
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
                  {!conversations.length && archived && (
                    <T tone="muted" style={{ fontSize: 12, padding: 8 }}>
                      暂无归档
                    </T>
                  )}
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
        <T tone={archived ? 'accent' : 'secondary'} style={{ fontSize: 12 }}>
          {archived ? '返回对话' : '已归档'}
        </T>
      </Pressable>
    </View>
  );
}
