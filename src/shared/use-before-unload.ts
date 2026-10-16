import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
}
