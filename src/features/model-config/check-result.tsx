import type { DiagnosticResult } from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { T } from '@/shared/ui/primitives';
import { View } from 'react-native';

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
  return result ? (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderLeftWidth: 2,
        borderLeftColor:
          result.status === 'passed'
            ? theme.success
            : result.status === 'failed'
              ? theme.danger
              : theme.border,
        backgroundColor:
          result.status === 'passed'
            ? theme.successSoft
            : result.status === 'failed'
              ? theme.dangerSoft
              : theme.inset,
      }}
    >
      <T
        variant="caption"
        style={{
          color:
            result.status === 'passed'
              ? theme.success
              : result.status === 'failed'
                ? theme.danger
                : theme.secondary,
        }}
      >
        {result.message}
      </T>
      <T tone="muted" variant="meta">
        {{ web: '浏览器', native: '原生', android: 'Android', ios: 'iOS' }[result.platform]} ·{' '}
        {new Date(result.at).toLocaleString()} · {result.requests ?? 0} 次请求
        {result.totalTokens ? ' · ' + result.totalTokens + ' tokens' : ''}
      </T>
    </View>
  ) : (
    <T tone="muted" variant="meta">
      尚未检测
    </T>
  );
}
