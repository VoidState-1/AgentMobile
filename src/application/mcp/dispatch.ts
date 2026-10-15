/** Shared in-flight barrier. Unknown receipts stay in persistent storage. */
export class RemoteDispatchCoordinator {
  private readonly active = new Set<string>();
  acquire(key: string): { release(): void } | undefined {
    if (this.active.has(key)) return;
    this.active.add(key);
    let released = false;
    return {
      release: () => {
        if (!released) {
          released = true;
          this.active.delete(key);
        }
      },
    };
  }
}
