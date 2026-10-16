import { useCallback, useState, useSyncExternalStore } from 'react';

interface SnapshotSource<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export function useServiceSnapshot<T>(source: SnapshotSource<T> | undefined, empty: () => T): T {
  const [initial] = useState(empty);
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? (() => {}),
    [source],
  );
  const read = useCallback(() => source?.getSnapshot() ?? initial, [source, initial]);
  return useSyncExternalStore(subscribe, read, read);
}
