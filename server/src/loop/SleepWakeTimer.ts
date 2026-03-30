import type { ILogger } from "../logging";
import type { IClock } from "../substrate/abstractions/IClock";

/**
 * Schedules a single wake callback at a future time.
 * Used by the orchestrator to wake from SLEEPING when the next
 * HEARTBEAT entry is due.
 *
 * Only one timer is active at a time — setting a new one clears any existing.
 */
export interface ISleepWakeTimer {
  /** Schedule `onWake` to be called at `wakeAt`. Clears any existing timer. */
  set(wakeAt: Date, onWake: () => void): void;
  /** Cancel the current timer, if any. */
  clear(): void;
}

export class SleepWakeTimer implements ISleepWakeTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly clock: IClock,
  ) {}

  set(wakeAt: Date, onWake: () => void): void {
    this.clear();
    const delayMs = Math.max(0, wakeAt.getTime() - this.clock.now().getTime());
    this.logger.debug(
      `[SLEEP-WAKE] Timer set: wake at ${wakeAt.toISOString()} (${Math.round(delayMs / 1000)}s from now)`,
    );
    this.handle = setTimeout(() => {
      this.handle = null;
      this.logger.debug("[SLEEP-WAKE] Timer fired — waking loop");
      onWake();
    }, delayMs);
    // Don't hold the process open for this timer
    if (this.handle && typeof this.handle === "object" && "unref" in this.handle) {
      this.handle.unref();
    }
  }

  clear(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}

/**
 * In-memory implementation for testing — records set/clear calls
 * and allows manual firing.
 */
export class InMemorySleepWakeTimer implements ISleepWakeTimer {
  public scheduledAt: Date | null = null;
  public onWake: (() => void) | null = null;
  public clearCount = 0;

  set(wakeAt: Date, onWake: () => void): void {
    this.scheduledAt = wakeAt;
    this.onWake = onWake;
  }

  clear(): void {
    this.scheduledAt = null;
    this.onWake = null;
    this.clearCount++;
  }

  /** Simulate the timer firing. */
  fire(): void {
    const cb = this.onWake;
    this.scheduledAt = null;
    this.onWake = null;
    cb?.();
  }
}
