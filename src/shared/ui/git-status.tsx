import { View } from 'react-native';
import type { GitFileStatus } from '@/core/git/contracts';
import { useWorkbenchTheme } from '@/shared/theme';
import { T } from './primitives';

export type FileStatus = NonNullable<GitFileStatus['staged']>;
export const fileStatusLabels = { added: '新增', modified: '修改', deleted: '删除' } as const;

export function GitStatusBadge({ status }: { status: FileStatus }) {
  const theme = useWorkbenchTheme();
  const color =
    status === 'added' ? theme.success : status === 'deleted' ? theme.danger : theme.warning;
  const backgroundColor =
    status === 'added'
      ? theme.successSoft
      : status === 'deleted'
        ? theme.dangerSoft
        : theme.warningSoft;
  return (
    <View
      accessibilityLabel={'Git ' + fileStatusLabels[status]}
      style={{
        backgroundColor,
        borderRadius: 3,
        paddingHorizontal: 5,
        paddingVertical: 1,
        alignSelf: 'center',
      }}
    >
      <T style={{ fontSize: 11, lineHeight: 18, color }}>{fileStatusLabels[status]}</T>
    </View>
  );
}

export function DiffStat({ added, removed }: { added: number; removed: number }) {
  const theme = useWorkbenchTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <T style={{ fontSize: 12, color: theme.success }}>+{added}</T>
      <T style={{ fontSize: 12, color: theme.danger }}>−{removed}</T>
    </View>
  );
}
