import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { Workbench } from '@/features/workbench/use-workbench';
import { Button, Field, IconButton, Sheet, T } from '@/features/workbench/ui';
import { Check, MessageSquare, Pencil, Plus, RotateCcw } from '@/features/workbench/icons';
import { useWorkbenchTheme } from '@/features/workbench/theme';
import { dateLabel } from '@/features/workbench/format';

export function ConversationsPanel({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme(); const [search, setSearch] = useState(''); const [archived, setArchived] = useState(false);
  const items = controller.conversations.filter((item) => !!item.archivedAt === archived && item.title.toLowerCase().includes(search.toLowerCase()));
  return <>
    <Sheet visible={controller.sheet === 'conversations'} title="项目对话" subtitle={controller.selectedProject?.name + ' · 对话历史独立，项目资料共享'}
      onClose={() => controller.setSheet(undefined)} busy={controller.busy} footer={<Button label="新建对话" icon={Plus} disabled={controller.busy}
        onPress={() => { void controller.newConversation(); }} />}>
      <Field label="搜索对话" value={search} onChangeText={setSearch} placeholder="搜索对话名称" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="未归档" variant={archived ? 'secondary' : 'primary'} compact onPress={() => setArchived(false)} />
        <Button label="已归档" variant={archived ? 'primary' : 'secondary'} compact onPress={() => setArchived(true)} />
      </View>
      {!items.length && <T tone="muted" style={{ fontSize: 12 }}>{archived ? '暂无已归档对话' : '没有匹配的对话'}</T>}
      {items.map((item) => <View key={item.id} style={{ borderRadius: 9, borderWidth: 1, borderColor: theme.border,
        backgroundColor: item.id === controller.conversationId ? theme.accentSoft : theme.surface, paddingHorizontal: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={(archived ? '恢复对话 ' : '切换对话 ') + item.title} disabled={controller.busy}
            onPress={() => { void (archived ? controller.restoreConversation(item) : controller.selectConversation(item.id)); }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 6 }}>
            {controller.active?.conversationId === item.id ? <ActivityIndicator size={16} color={theme.accent} /> : <MessageSquare size={17} color={theme.secondary} />}
            <View style={{ flex: 1 }}><T numberOfLines={1} style={{ fontWeight: '500', fontSize: 13 }}>{item.title}</T>
              <T tone="muted" style={{ fontSize: 10 }}>{dateLabel(item.updatedAt)}{controller.active?.conversationId === item.id ? ' · 任务运行中' : ''}</T></View>
            {item.id === controller.conversationId && <Check size={15} color={theme.accent} />}
          </Pressable>
          {!archived && <IconButton icon={Pencil} label={'重命名对话 ' + item.title} disabled={controller.busy} onPress={() => controller.startRenameConversation(item)} />}
          {archived && <IconButton icon={RotateCcw} label={'恢复对话 ' + item.title} disabled={controller.busy} onPress={() => { void controller.restoreConversation(item); }} />}
        </View>
        {!archived && <Button label={'归档对话 ' + item.title} compact variant="ghost" disabled={controller.busy || controller.active?.conversationId === item.id}
          style={{ alignSelf: 'flex-end' }} onPress={() => controller.archiveConversation(item)} />}
      </View>)}
      {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    </Sheet>
    <Sheet visible={controller.sheet === 'conversation-name'} title="重命名对话" onClose={() => controller.setSheet(undefined)} busy={controller.busy}
      footer={<Button label="保存对话名称" disabled={!controller.conversationName.trim()} busy={controller.busy} onPress={() => { void controller.renameConversation(); }} />}>
      <Field label="对话名称" value={controller.conversationName} onChangeText={controller.setConversationName} maxLength={60} autoFocus />
      {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    </Sheet>
  </>;
}
