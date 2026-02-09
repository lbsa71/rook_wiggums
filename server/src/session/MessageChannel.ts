export class MessageChannel<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private closed = false;
  private waiter: (() => void) | null = null;

  push(item: T): void {
    if (this.closed) {
      throw new Error("Cannot push to a closed MessageChannel");
    }
    this.buffer.push(item);
    if (this.waiter) {
      const wake = this.waiter;
      this.waiter = null;
      wake();
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const wake = this.waiter;
      this.waiter = null;
      wake();
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        while (true) {
          if (this.buffer.length > 0) {
            return { value: this.buffer.shift()!, done: false };
          }
          if (this.closed) {
            return { value: undefined as unknown as T, done: true };
          }
          await new Promise<void>((resolve) => {
            this.waiter = resolve;
          });
        }
      },
    };
  }
}
