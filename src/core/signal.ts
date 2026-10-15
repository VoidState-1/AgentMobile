/** View observers never own command success or storage recovery. */
export class Signal {
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Isolate synchronous observers from committed state. */
      }
    }
  }
}
