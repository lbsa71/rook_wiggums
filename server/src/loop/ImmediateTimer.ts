import { ITimer } from "./ITimer";

export class ImmediateTimer implements ITimer {
  private calls: number[] = [];

  async delay(ms: number): Promise<void> {
    this.calls.push(ms);
  }

  getCalls(): number[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls = [];
  }

  wake(): void {
    // No-op — delays resolve instantly in tests
  }
}
