import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppServices as getRuntime } from '@/bootstrap';
import type { AppServices as Runtime } from '@/application/services';
import { publicError } from '@/core/errors';
import { emptyMcpConfiguration } from '@/core/mcp/types';

export function useMcpConfiguration() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [config, setConfig] = useState(emptyMcpConfiguration());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  useEffect(() => {
    let current = true;
    let unsubscribe: (() => void) | undefined;
    void getRuntime()
      .then(value => {
        if (!current) return;
        setRuntime(value);
        setConfig(value.mcp.configuration.getSnapshot());
        unsubscribe = value.mcp.configuration.subscribe(() =>
          setConfig(value.mcp.configuration.getSnapshot()),
        );
      })
      .catch(() => {
        if (current) setError('本地配置读取失败，请保留数据并重开应用。');
      });
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, []);
  const action = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      setError(publicError(reason).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);
  return { runtime, config, error, busy, action };
}
