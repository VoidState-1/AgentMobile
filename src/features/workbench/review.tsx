import { fileName, sizeLabel } from '@/shared/format';
import { useWorkbenchTheme } from '@/shared/theme';
import { EmptyState } from '@/shared/ui/empty-state';
import { GitStatusBadge } from '@/shared/ui/git-status';
import { ArrowLeftRight, RotateCcw } from '@/shared/ui/icons';
import { Button, T } from '@/shared/ui/primitives';
import { ViewTabs } from '@/shared/ui/selection';
import { Sheet } from '@/shared/ui/sheets';
import { diffLines } from 'diff';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { GitCapability } from './use-workbench';

export const ReviewSheet = memo(function ReviewSheet({
  controller,
}: {
  controller: GitCapability;
}) {
  const theme = useWorkbenchTheme();
  const value = controller.review!;
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      value.files.findIndex(file => file.path === value.initialPath),
    ),
  );
  const file = value.files[index] ?? value.files[0];
  const lines = useMemo(() => {
    if (!file || file.kind !== 'text' || file.unavailableReason) return [];
    let before = 0;
    let after = 0;
    return diffLines(file.before.slice(0, 12000), file.after.slice(0, 12000)).flatMap(part => {
      const entries = part.value.split('\n');
      if (entries[entries.length - 1] === '') entries.pop();
      return entries.map(text => {
        if (!part.added) before++;
        if (!part.removed) after++;
        return {
          text,
          before: part.added ? '' : String(before),
          after: part.removed ? '' : String(after),
          kind: part.added ? 'added' : part.removed ? 'removed' : 'context',
        };
      });
    });
  }, [file]);
  return (
    <Sheet
      visible
      title={value.title}
      subtitle={
        value.files.length +
        ' 个文件 · ' +
        (value.description ??
          (value.task
            ? '任务开始前与结束后'
            : value.area === 'staged'
              ? 'HEAD 与暂存区'
              : value.area === 'unstaged'
                ? '暂存区与工作区'
                : '父提交与所选提交'))
      }
      onClose={() => controller.setReview(undefined)}
      wide
      busy={controller.busy}
      footer={
        value.restoreRef ? (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {controller.dirty && (
              <T tone="warning" variant="caption" style={{ flex: 1 }}>
                请先保存编辑器中的修改。
              </T>
            )}
            {value.restoreRef && (
              <Button
                label={value.task ? '撤销修改' : '恢复此版本'}
                icon={RotateCcw}
                disabled={!!controller.projectActive || controller.busy || controller.dirty}
                onPress={controller.confirmRestore}
              />
            )}
          </View>
        ) : undefined
      }
    >
      {!!controller.error && (
        <T tone="danger" variant="caption">
          {controller.error}
        </T>
      )}
      {value.files.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 16, gap: 8 }}>
          <ArrowLeftRight size={28} color={theme.muted} />
          <EmptyState compact title="没有文件变化" />
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 4 }}
          >
            <ViewTabs
              label="差异文件"
              value={file.path}
              onChange={path => setIndex(value.files.findIndex(entry => entry.path === path))}
              options={value.files.map(entry => ({
                value: entry.path,
                label: fileName(entry.path),
                accessibilityLabel: '查看变化 ' + entry.path,
              }))}
            />
          </ScrollView>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              {file && (
                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <GitStatusBadge status={file.status} />
                  <T numberOfLines={1} variant="caption" style={{ flex: 1 }}>
                    {file.stagedOnly ? '暂存 · ' : ''}
                    {file.path}
                  </T>
                </View>
              )}
              <T tone="muted" variant="meta">
                {file?.unavailableReason
                  ? '文件变化'
                  : file?.kind === 'image'
                    ? '图片对比'
                    : '逐行变化'}
              </T>
            </View>
            {file?.unavailableReason ? (
              <View style={{ padding: 14, gap: 8 }}>
                <T tone="secondary">{file.unavailableReason}</T>
                <T tone="muted">
                  修改前：{file.beforeSize === null ? '不存在' : sizeLabel(file.beforeSize)} ·
                  修改后：{file.afterSize === null ? '不存在' : sizeLabel(file.afterSize)}
                </T>
              </View>
            ) : file?.kind === 'image' ? (
              <View style={{ gap: 8 }}>
                {[
                  { label: '修改前', uri: file.before },
                  { label: '修改后', uri: file.after },
                ].map(entry => (
                  <View key={entry.label} style={{ gap: 7 }}>
                    <T tone="secondary" variant="caption">
                      {entry.label}
                    </T>
                    {entry.uri ? (
                      <Image
                        source={{ uri: entry.uri }}
                        contentFit="contain"
                        style={{ height: 210, backgroundColor: theme.inset, borderRadius: 4 }}
                      />
                    ) : (
                      <T tone="muted" variant="caption">
                        没有图片
                      </T>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
                  <View style={{ flexGrow: 1 }}>
                    {lines.map((line, lineIndex) => (
                      <View
                        key={lineIndex}
                        style={{
                          flexDirection: 'row',
                          backgroundColor:
                            line.kind === 'added'
                              ? theme.added
                              : line.kind === 'removed'
                                ? theme.removed
                                : theme.code,
                        }}
                      >
                        <T
                          tone="muted"
                          variant="meta"
                          style={{ width: 33, textAlign: 'right', paddingRight: 6 }}
                        >
                          {line.before}
                        </T>
                        <T
                          tone="muted"
                          variant="meta"
                          style={{ width: 33, textAlign: 'right', paddingRight: 6 }}
                        >
                          {line.after}
                        </T>
                        <T
                          variant="caption"
                          style={{
                            width: 19,
                            color:
                              line.kind === 'added'
                                ? theme.success
                                : line.kind === 'removed'
                                  ? theme.danger
                                  : theme.muted,
                          }}
                        >
                          {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                        </T>
                        <T
                          selectable
                          style={{
                            paddingRight: 14,
                            fontFamily: 'monospace',
                            fontSize: 12,
                            lineHeight: 23,
                          }}
                        >
                          {line.text || ' '}
                        </T>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}
            {file && (file.before.length > 12000 || file.after.length > 12000) && (
              <T tone="muted" variant="meta">
                较长内容仅预览前 12,000 字符，完整内容可在文件中查看。
              </T>
            )}
          </View>
        </>
      )}
    </Sheet>
  );
});
