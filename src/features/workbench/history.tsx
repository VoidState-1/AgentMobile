import { ActionRow } from '@/shared/ui/action-row';
import type { GitFileStatus } from '@/core/git/contracts';
import { dateLabel } from '@/shared/format';
import { useWorkbenchTheme } from '@/shared/theme';
import { EmptyState } from '@/shared/ui/empty-state';
import { GitStatusBadge } from '@/shared/ui/git-status';
import { ChevronRight, GitCommitHorizontal, Plus, RotateCcw, X } from '@/shared/ui/icons';
import { Button, Field, IconButton, T } from '@/shared/ui/primitives';
import { ViewTabs } from '@/shared/ui/selection';
import { memo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { GitCapability } from './use-workbench';
import { GitRepositoryPane } from './git-repository';
import { IntegrationControls, ConflictSheet } from './git-conflicts';

export const HistoryPane = memo(function HistoryPane({
  controller,
}: {
  controller: GitCapability;
}) {
  const theme = useWorkbenchTheme();
  const [tab, setTab] = useState<'changes' | 'history' | 'repository'>('changes');
  const status = controller.gitStatus;
  const staged = status?.files.filter(file => file.staged && !file.conflict) ?? [];
  const unstaged = status?.files.filter(file => file.unstaged && !file.conflict) ?? [];
  const disabled =
    controller.busy || !!controller.projectActive || controller.dirty || controller.projectLoading;
  const mutationDisabled = disabled || status?.state !== 'none';
  const message = controller.commitDrafts[controller.projectId ?? ''] ?? '';
  const section = (files: GitFileStatus[], area: 'staged' | 'unstaged') => (
    <View style={{ gap: 2 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <T variant="caption" style={{ fontWeight: '600' }}>
          {area === 'staged' ? '已暂存' : '未暂存'} · {files.length}
        </T>
        {!!files.length && (
          <Button
            compact
            variant="ghost"
            label={area === 'staged' ? '全部取消暂存' : '全部暂存'}
            disabled={mutationDisabled}
            onPress={() => {
              void controller.changeStage(
                files.map(file => file.path),
                area === 'unstaged',
              );
            }}
          />
        )}
      </View>
      {files.length === 0 ? (
        <EmptyState compact title={'没有' + (area === 'staged' ? '已暂存' : '未暂存') + '更改'} />
      ) : (
        files.map(file => (
          <View
            key={file.path}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              minHeight: 44,
              paddingVertical: 0,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
          >
            <GitStatusBadge status={file[area]!} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                '查看' + (area === 'staged' ? '已暂存' : '未暂存') + '差异 ' + file.path
              }
              disabled={controller.busy}
              onPress={() => {
                void controller.reviewGit(area, [file.path]);
              }}
              style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}
            >
              <T numberOfLines={2} variant="label">
                {file.path}
              </T>
            </Pressable>
            {area === 'unstaged' && (
              <IconButton
                size={44}
                icon={RotateCcw}
                label={'丢弃更改 ' + file.path}
                disabled={mutationDisabled}
                onPress={() => controller.discardGit(file.path)}
              />
            )}
            <IconButton
              size={44}
              icon={area === 'staged' ? X : Plus}
              label={(area === 'staged' ? '取消暂存 ' : '暂存 ') + file.path}
              disabled={mutationDisabled}
              onPress={() => {
                void controller.changeStage([file.path], area === 'unstaged');
              }}
            />
          </View>
        ))
      )}
    </View>
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{
        padding: 12,
        gap: 10,
        maxWidth: 820,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <ViewTabs
        label="Git 视图"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'changes', label: '更改', count: status?.files.length || undefined },
          { value: 'history', label: '提交历史', count: controller.versions.length },
          { value: 'repository', label: '仓库' },
        ]}
      />
      <IntegrationControls controller={controller} />
      <ConflictSheet controller={controller} />
      {tab === 'changes' ? (
        <>
          {controller.projectActive && (
            <T tone="secondary" variant="caption">
              Agent 正在使用此项目，完成或停止后可暂存与提交。
            </T>
          )}
          {controller.dirty && (
            <T tone="warning" variant="caption">
              编辑器中有未保存的修改，请先保存。
            </T>
          )}
          {section(unstaged, 'unstaged')}
          {section(staged, 'staged')}
          {!!staged.length && status?.state === 'none' && (
            <View style={{ gap: 8, paddingTop: 4 }}>
              <Field
                label="提交说明"
                placeholder="描述这次更改的目的"
                value={message}
                maxLength={4000}
                multiline
                editable={!controller.busy}
                onChangeText={text => {
                  if (controller.projectId) controller.setCommitDraft(controller.projectId, text);
                }}
                style={{ minHeight: 76 }}
              />
              <Button
                label="提交已暂存"
                icon={GitCommitHorizontal}
                disabled={disabled || !staged.length || !message.trim()}
                onPress={() => {
                  void controller.commitGit(message);
                }}
              />
            </View>
          )}
        </>
      ) : tab === 'repository' ? (
        <GitRepositoryPane controller={controller} />
      ) : (
        controller.versions.map((version, index) => (
          <ActionRow
            key={version.oid}
            label={'查看版本 ' + version.oid.slice(0, 7)}
            disabled={controller.busy}
            onPress={() => {
              void controller.reviewVersion(version);
            }}
            title={version.message.split('\n')[0]}
            meta={
              dateLabel(version.timestamp) +
              ' · ' +
              version.oid.slice(0, 7) +
              (version.parents.length > 1 ? ' · 合并提交' : '')
            }
            leading={
              <GitCommitHorizontal size={18} color={index === 0 ? theme.accent : theme.muted} />
            }
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {index === 0 && (
                  <T tone="accent" variant="meta">
                    当前版本
                  </T>
                )}
                <ChevronRight size={16} color={theme.muted} />
              </View>
            }
          />
        ))
      )}
      {tab === 'history' && controller.versionCursor && (
        <Button
          label="加载更多提交"
          variant="ghost"
          busy={controller.versionsBusy}
          onPress={() => {
            void controller.loadOlderVersions();
          }}
        />
      )}
    </ScrollView>
  );
});
