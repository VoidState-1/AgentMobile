import { publicError } from '@/core/errors';
import { useCallback, useRef, useState } from 'react';

/** Shared UI command lifecycle; business revisions and transactions remain in AppServices. */
export function useAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      return true;
    } catch (reason) {
      setError(publicError(reason).message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, action };
}
