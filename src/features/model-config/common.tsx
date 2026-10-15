import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { getAppServices as getRuntime } from '@/bootstrap';
import type { AppServices as Runtime } from '@/application/services';
import { emptyModelConfiguration, type DiagnosticResult } from '@/core/models/types';
import { T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
export { useDraftGuard, ConfigPage, FormScroll, Section, Toggle, Choices, Loading } from '@/shared/ui/forms';

export function useConfiguration() {
  const [runtime, setRuntime] = useState<Runtime>(); const [config, setConfig] = useState(emptyModelConfiguration());
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const working = useRef(false);
  useEffect(() => {
    let current = true; let unsubscribe: (() => void) | undefined;
    getRuntime().then((value) => {
      if (!current) return; setRuntime(value); setConfig(value.models.getSnapshot());
      unsubscribe = value.models.subscribe(() => setConfig(value.models.getSnapshot()));
    }).catch(() => { if (current) setError('本地配置读取失败，请保留数据并重开应用。'); });
    return () => { current = false; unsubscribe?.(); };
  }, []);
  const action = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); }
    finally { working.current = false; setBusy(false); }
  }, []);
  return { runtime, config, error, setError, busy, action };
}

export type ConfigurationController = ReturnType<typeof useConfiguration>;

export function CheckResult({ result, history }: { result?: DiagnosticResult; history?: DiagnosticResult[] }) {
  const theme = useWorkbenchTheme();
  if (history?.length && history.length > 1) return <View style={{ gap: 6 }}>{history.map((item) => <CheckResult key={item.platform} result={item} />)}</View>;
  return result ? <View style={{ padding: 10, borderRadius: 8, backgroundColor: result.status === 'passed' ? theme.successSoft : theme.inset }}>
    <T style={{ fontSize: 12, color: result.status === 'passed' ? theme.success : result.status === 'failed' ? theme.danger : theme.secondary }}>{result.message}</T>
    <T tone="muted" style={{ fontSize: 10 }}>{{ web: '浏览器', native: '原生', android: 'Android', ios: 'iOS' }[result.platform]} · {new Date(result.at).toLocaleString()} · {result.requests ?? 0} 次请求{result.totalTokens ? ' · ' + result.totalTokens + ' tokens' : ''}</T>
  </View> : <T tone="muted" style={{ fontSize: 11 }}>尚未检测</T>;
}
