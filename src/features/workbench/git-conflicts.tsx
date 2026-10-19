import { useState } from 'react';
import { Image, View } from 'react-native';
import { Button, T } from '@/shared/ui/primitives';
import { Sheet } from '@/shared/ui/sheets';
import { ViewTabs } from '@/shared/ui/selection';
import { gitModes } from '@/core/git/objects';
import type { GitCapability } from './use-workbench';

export function IntegrationControls({ controller }: { controller: GitCapability }) {
  return controller.repository?.rebase ? (
    <RebaseControls controller={controller} />
  ) : (
    <MergeControls controller={controller} />
  );
}
function RebaseControls({ controller }: { controller: GitCapability }) {
  const info = controller.repository!,
    rebase = info.rebase!;
  const disabled =
    controller.busy || controller.projectActive || controller.dirty || controller.projectLoading;
  return (
    <View style={{ gap: 8 }}>
      <T tone="warning">
        正在变基至 {rebase.ontoName} · {Math.min(rebase.position + 1, rebase.total)}/{rebase.total}
      </T>
      {rebase.current && (
        <T variant="caption" tone="secondary" numberOfLines={2}>
          {rebase.current.oid.slice(0, 7)} · {rebase.current.message}
        </T>
      )}
      {info.conflicts.map(conflict => (
        <Button
          key={conflict.path}
          label={'处理冲突 ' + conflict.path}
          variant="secondary"
          disabled={disabled}
          onPress={() => {
            void controller.reviewConflict(conflict.path);
          }}
        />
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button
          label="继续变基"
          disabled={disabled || !!info.conflicts.length}
          onPress={() => {
            void controller.continueRebase();
          }}
        />
        <Button
          label="跳过当前提交"
          variant="secondary"
          disabled={disabled || rebase.phase !== 'conflicts'}
          onPress={controller.confirmSkipRebase}
        />
        <Button
          label="中止变基"
          variant="ghost"
          disabled={disabled}
          onPress={controller.confirmAbortRebase}
        />
      </View>
    </View>
  );
}
function MergeControls({ controller }: { controller: GitCapability }) {
  const info = controller.repository;
  if (!info?.merge) return null;
  const disabled =
    controller.busy || controller.projectActive || controller.dirty || controller.projectLoading;
  return (
    <View style={{ gap: 8 }}>
      <T tone="warning">
        正在合并 {info.merge.sourceName} ·{' '}
        {info.conflicts.length ? `${info.conflicts.length} 项冲突` : '冲突已清零'}
      </T>
      {info.conflicts.map(conflict => (
        <Button
          key={conflict.path}
          label={'处理冲突 ' + conflict.path}
          variant="secondary"
          disabled={disabled}
          onPress={() => {
            void controller.reviewConflict(conflict.path);
          }}
        />
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button
          label="继续合并"
          disabled={disabled || !!info.conflicts.length}
          onPress={() => {
            void controller.continueMerge();
          }}
        />
        <Button
          label="中止合并"
          variant="ghost"
          disabled={disabled}
          onPress={controller.confirmAbortMerge}
        />
      </View>
    </View>
  );
}
export function ConflictSheet({ controller }: { controller: GitCapability }) {
  const review = controller.conflictReview;
  return review ? <ConflictView key={review.path} controller={controller} /> : null;
}
function ConflictView({ controller }: { controller: GitCapability }) {
  const review = controller.conflictReview!;
  const rebase = !!controller.repository?.rebase;
  const [side, setSide] = useState<'base' | 'ours' | 'theirs' | 'working'>('working');
  const value = review[side];
  const canEdit =
    review.working?.kind === 'text' &&
    review.working.size <= 1024 * 1024 &&
    (review.working.mode === gitModes.file || review.working.mode === gitModes.executable);
  return (
    <Sheet
      visible
      title={'解决冲突 · ' + review.path}
      onClose={controller.closeConflict}
      busy={controller.busy}
      wide
      footer={
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button
              label="采用当前版本"
              variant="secondary"
              disabled={controller.busy}
              onPress={() => {
                void controller.resolveConflict('ours');
              }}
            />
            <Button
              label="采用传入版本"
              variant="secondary"
              disabled={controller.busy}
              onPress={() => {
                void controller.resolveConflict('theirs');
              }}
            />
            <Button
              label="采用基础版本"
              variant="ghost"
              disabled={controller.busy}
              onPress={() => {
                void controller.resolveConflict('base');
              }}
            />
            <Button
              label="删除此路径"
              variant="ghost"
              disabled={controller.busy}
              onPress={() => {
                void controller.resolveConflict('delete');
              }}
            />
          </View>
          <Button
            label="标记工作区结果已解决"
            disabled={controller.busy}
            onPress={() => {
              void controller.resolveConflict('working');
            }}
          />
        </View>
      }
    >
      <ViewTabs
        label="冲突版本"
        value={side}
        onChange={setSide}
        options={[
          { value: 'base', label: '基础' },
          { value: 'ours', label: '当前' },
          { value: 'theirs', label: '传入' },
          { value: 'working', label: '结果' },
        ]}
      />
      {rebase && (
        <T variant="caption" tone="secondary">
          当前：目标分支及已重放结果。传入：正在重放的原提交。
        </T>
      )}
      {review.relatedPaths.length > 1 && (
        <T variant="caption" tone="warning">
          结构冲突会同时处理相关路径：{review.relatedPaths.join('、')}
        </T>
      )}
      {!value ? (
        <T tone="secondary">此侧不存在文件，或此路径为目录。</T>
      ) : value.kind === 'image' && value.content ? (
        <Image
          source={{ uri: value.content }}
          style={{ height: 240, width: '100%' }}
          resizeMode="contain"
        />
      ) : (
        <T selectable style={{ fontFamily: 'monospace' }}>
          {value.content || value.unavailableReason || '空文件'}
        </T>
      )}
      {value?.mode === gitModes.symlink && (
        <T variant="caption" tone="secondary">
          符号链接：显示的是链接目标文本。
        </T>
      )}
      {canEdit && (
        <Button
          label={rebase ? '编辑变基结果' : '编辑合并结果'}
          variant="secondary"
          disabled={controller.busy}
          onPress={() => {
            void controller.editConflict();
          }}
        />
      )}
      <Button
        label="重新读取冲突"
        variant="ghost"
        disabled={controller.busy}
        onPress={() => {
          void controller.reviewConflict(review.path);
        }}
      />
      {!!controller.error && <T tone="danger">{controller.error}</T>}
    </Sheet>
  );
}
