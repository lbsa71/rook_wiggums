import { ITimer } from "./ITimer";

export class NodeTimer implements ITimer {
  private resolver: (() => void) | null = null;
  private handle: ReturnType<typeof setTimeout> | null = null;

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.handle = setTimeout(() => {
        this.resolver = null;
        this.handle = null;
        resolve();
      }, ms);
    });
  }

  wake(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve();
    }
  }
}
