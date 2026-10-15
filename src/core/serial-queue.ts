/** Exclusive commands recover after failure; each caller owns its own result. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
