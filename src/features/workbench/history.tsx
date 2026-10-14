import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight, GitCommitHorizontal, Plus, RotateCcw, X } from './icons';
import type { Workbench } from './use-workbench';
import type { GitFileStatus } from '@/core/git/contracts';
import { Button, Field, IconButton, T } from './ui';
import { useWorkbenchTheme } from './theme';
import { dateLabel } from './format';

const statusLabel = { added: '新增', modified: '修改', deleted: '删除' };

export function HistoryPane({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme();
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const status = controller.gitStatus;
  const staged = status?.files.filter((file) => file.staged) ?? [];
  const unstaged = status?.files.filter((file) => file.unstaged) ?? [];
  const disabled = controller.busy || !!controller.projectActive || controller.dirty || controller.projectLoading;
  const message = controller.commitDrafts[controller.projectId ?? ''] ?? '';
  const section = (files: GitFileStatus[], area: 'staged' | 'unstaged') => <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <T style={{ fontSize: 12, fontWeight: '600' }}>{area === 'staged' ? '已暂存' : '未暂存'} · {files.length}</T>
      {!!files.length && <Button compact variant="ghost" label={area === 'staged' ? '全部取消暂存' : '全部暂存'} disabled={disabled}
        onPress={() => { void controller.changeStage(files.map((file) => file.path), area === 'unstaged'); }} />}
    </View>
    {files.length === 0 ? <T tone="muted" style={{ fontSize: 12, paddingVertical: 8 }}>没有{area === 'staged' ? '已暂存' : '未暂存'}更改</T> :
      files.map((file) => <View key={file.path} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, borderBottomWidth: 1, borderColor: theme.border }}>
        <T style={{ width: 30, fontSize: 10, color: file[area] === 'deleted' ? theme.danger : theme.success }}>{statusLabel[file[area]!]}</T>
        <Pressable accessibilityRole="button" accessibilityLabel={'查看' + (area === 'staged' ? '已暂存' : '未暂存') + '差异 ' + file.path}
          disabled={controller.busy} onPress={() => { void controller.reviewGit(area, [file.path]); }} style={{ flex: 1, minWidth: 0, paddingVertical: 8 }}>
          <T numberOfLines={2} style={{ fontSize: 12 }}>{file.path}</T>
        </Pressable>
        {area === 'unstaged' && <IconButton size={36} icon={RotateCcw} label={'丢弃更改 ' + file.path} disabled={disabled} onPress={() => controller.discardGit(file.path)} />}
        <IconButton size={36} icon={area === 'staged' ? X : Plus} label={(area === 'staged' ? '取消暂存 ' : '暂存 ') + file.path} disabled={disabled}
          onPress={() => { void controller.changeStage([file.path], area === 'unstaged'); }} />
      </View>)}
  </View>;
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: theme.surface }}
    contentContainerStyle={{ padding: 20, gap: 18, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <GitCommitHorizontal size={19} color={theme.secondary} /><T style={{ fontSize: 16, fontWeight: '600' }}>Git</T>
      <T tone="muted" style={{ fontSize: 11 }}>main · {status?.head.slice(0, 7) ?? '…'}</T>
    </View>
    <View style={{ flexDirection: 'row', gap: 6, borderBottomWidth: 1, borderColor: theme.border, paddingBottom: 10 }}>
      <Button compact label={'更改' + (status?.files.length ? ' · ' + status.files.length : '')} variant={tab === 'changes' ? 'primary' : 'ghost'} onPress={() => setTab('changes')} />
      <Button compact label={'提交历史 · ' + controller.versions.length} variant={tab === 'history' ? 'primary' : 'ghost'} onPress={() => setTab('history')} />
    </View>
    {tab === 'changes' ? <>
      {controller.projectActive && <T tone="secondary" style={{ fontSize: 12 }}>Agent 正在使用此项目，完成或停止后可暂存与提交。</T>}
      {controller.dirty && <T tone="warning" style={{ fontSize: 12 }}>编辑器中有未保存的修改，请先保存。</T>}
      {section(unstaged, 'unstaged')}
      {section(staged, 'staged')}
      <View style={{ gap: 12, paddingTop: 6 }}>
        <Field label="提交说明" placeholder="描述这次更改的目的" value={message} maxLength={4000} multiline
          editable={!controller.busy} onChangeText={(text) => { if (controller.projectId) controller.setCommitDraft(controller.projectId, text); }} style={{ minHeight: 76 }} />
        <Button label="提交已暂存" icon={GitCommitHorizontal} disabled={disabled || !staged.length || !message.trim()} onPress={() => { void controller.commitGit(message); }} />
        <T tone="muted" style={{ fontSize: 11 }}>提交使用暂存时的内容。之后的编辑保留为未暂存更改。</T>
      </View>
    </> : controller.versions.map((version, index) => <Pressable key={version.oid} accessibilityRole="button"
      accessibilityLabel={'查看版本 ' + version.oid.slice(0, 7)} disabled={controller.busy}
      onPress={() => { void controller.reviewVersion(version); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14, paddingHorizontal: 6,
        borderBottomWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.inset : 'transparent', borderRadius: 8 })}>
      <GitCommitHorizontal size={18} color={index === 0 ? theme.accent : theme.muted} style={{ marginTop: 3 }} />
      <View style={{ flex: 1, gap: 4 }}><T style={{ fontSize: 13, fontWeight: '500' }}>{version.message.split('\n')[0]}</T>
        <T tone="muted" style={{ fontSize: 11 }}>{dateLabel(version.timestamp)} · {version.oid.slice(0, 7)}</T>
        {index === 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Check size={12} color={theme.success} />
          <T style={{ fontSize: 11, color: theme.success }}>当前版本</T></View>}
      </View>
      <ChevronRight size={16} color={theme.muted} style={{ marginTop: 7 }} />
    </Pressable>)}
  </ScrollView>;
}
