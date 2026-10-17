import type { DiagnosticResult } from '@/core/models/types';
import { useWorkbenchTheme, workbenchMetrics } from '@/shared/theme';
import { Check, CircleAlert } from '@/shared/ui/icons';
import { T } from '@/shared/ui/primitives';
import { View } from 'react-native';

const platformNames: Record<DiagnosticResult['platform'], string> = {
  web: '浏览器',
  native: '原生',
  android: 'Android',
  ios: 'iOS',
};

export function CheckResult({
  result,
  history,
}: {
  result?: DiagnosticResult;
  history?: DiagnosticResult[];
}) {
  const theme = useWorkbenchTheme();
  if (history?.length && history.length > 1)
    return (
      <View style={{ gap: 6 }}>
        {history.map(item => (
          <CheckResult key={item.platform} result={item} />
        ))}
      </View>
    );
  if (!result)
    return (
      <T tone="muted" variant="meta">
        尚未检测
      </T>
    );
  const color =
    result.status === 'passed'
      ? theme.success
      : result.status === 'failed'
        ? theme.danger
        : theme.secondary;
  const Icon = result.status === 'passed' ? Check : CircleAlert;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 9,
        borderRadius: workbenchMetrics.radius,
        backgroundColor:
          result.status === 'passed'
            ? theme.successSoft
            : result.status === 'failed'
              ? theme.dangerSoft
              : theme.inset,
      }}
    >
      <Icon size={15} color={color} strokeWidth={2} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <T variant="caption" style={{ color }}>
          {result.message}
        </T>
        <T tone="muted" variant="meta">
          {platformNames[result.platform]} · {new Date(result.at).toLocaleString()} ·{' '}
          {result.requests ?? 0} 次请求
          {result.totalTokens ? ' · ' + result.totalTokens + ' tokens' : ''}
        </T>
      </View>
    </View>
  );
}
