import { useEffect, useState } from 'react';
import { getAppServices } from '@/bootstrap';
import type { AppServices } from '@/application/services';

export function useAppServices() {
  const [runtime, setRuntime] = useState<AppServices>();
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    void getAppServices().then((value) => { if (mounted) setRuntime(value); })
      .catch(() => { if (mounted) setError('本地资料读取失败，请保留数据并重新打开应用。'); });
    return () => { mounted = false; };
  }, []);
  return { runtime, error };
}
