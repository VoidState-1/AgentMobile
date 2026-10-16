import type { FileChangeSummary } from '@/application/services';
import type { RunView } from '@/core/runs/queries';
import { fileName } from '@/shared/format';
import { useWorkbenchTheme } from '@/shared/theme';
import { DiffStat, GitStatusBadge } from '@/shared/ui/git-status';
import { FileText, Image } from '@/shared/ui/icons';
import { Button, T } from '@/shared/ui/primitives';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ConversationCapability } from './use-workbench';

export type ArtifactController = Pick<
  ConversationCapability,
  'busy' | 'changedPaths' | 'files' | 'openFile' | 'reviewTask' | 'taskChangeSummary'
>;

export function Artifacts({ task, controller }: { task: RunView; controller: ArtifactController }) {
  const theme = useWorkbenchTheme();
  const [summary, setSummary] = useState<FileChangeSummary[]>();
  const [expanded, setExpanded] = useState(false);
  const paths = controller.changedPaths(task);
  const load = controller.taskChangeSummary;
  useEffect(() => {
    if (!load) return;
    let current = true;
    void load(task.id)
      .then(value => {
        if (current) setSummary(value);
      })
      .catch(() => {
        if (current) setSummary(undefined);
      });
    return () => {
      current = false;
    };
  }, [load, task.id, task.finalSnapshot, task.finalIndexSnapshot, task.finalCommit, task.state]);
  const entries = summary?.map(item => item.path) ?? paths;
  return (
    <View testID="run-artifacts" style={{ borderTopWidth: 1, borderColor: theme.border }}>
      {(expanded ? entries : entries.slice(0, 3)).map(path => {
        const detail = summary?.find(item => item.path === path);
        const file = controller.files.find(item => item.path === path);
        const Icon = detail?.image ? Image : FileText;
        return (
          <View
            key={path}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              minHeight: 44,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Icon size={16} color={theme.accent} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'打开产物 ' + path}
              disabled={!file || controller.busy}
              onPress={() => {
                if (file) void controller.openFile(file);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                justifyContent: 'center',
                opacity: file ? 1 : 0.55,
              }}
            >
              <T numberOfLines={1} variant="label" style={{ fontWeight: '500' }}>
                {fileName(path)}
              </T>
            </Pressable>
            {detail && <GitStatusBadge status={detail.status} />}
            {detail?.stagedOnly && (
              <T tone="secondary" variant="meta">
                暂存
              </T>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'查看产物差异 ' + path}
              disabled={controller.busy}
              onPress={() => {
                void controller.reviewTask(task, path);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: 6,
                justifyContent: 'center',
                backgroundColor: pressed ? theme.inset : 'transparent',
              })}
            >
              {detail?.added !== undefined && detail.removed !== undefined ? (
                <DiffStat added={detail.added} removed={detail.removed} />
              ) : (
                <T tone="accent" variant="caption">
                  {detail?.image ? '图片差异' : '差异'}
                </T>
              )}
            </Pressable>
          </View>
        );
      })}
      {entries.length > 3 && (
        <Button
          label={expanded ? '收起文件' : '其余 ' + (entries.length - 3) + ' 个文件'}
          compact
          variant="ghost"
          onPress={() => setExpanded(!expanded)}
        />
      )}
    </View>
  );
}
