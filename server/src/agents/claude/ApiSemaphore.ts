/**
 * Counting semaphore that caps concurrent Claude API sessions.
 * Prevents rate-limit saturation when work pipeline and conversations overlap.
 */
export type Release = () => void;

export class ApiSemaphore {
  private _active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly maxConcurrent: number = 2) {}

  async acquire(): Promise<Release> {
    if (this._active < this.maxConcurrent) {
      this._active++;
      return this.createRelease();
    }

    return new Promise<Release>((resolve) => {
      this.queue.push(() => {
        this._active++;
        resolve(this.createRelease());
      });
    });
  }

  get active(): number {
    return this._active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  private createRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._active--;
      const next = this.queue.shift();
      if (next) next();
    };
  }
}
