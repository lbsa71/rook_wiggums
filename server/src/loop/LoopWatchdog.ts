import { IClock } from "../substrate/abstractions/IClock";
import { ILogger } from "../logging";

export interface LoopWatchdogConfig {
  clock: IClock;
  logger: ILogger;
  injectMessage: (message: string) => void;
  stallThresholdMs: number;
}

const STALL_REMINDER =
  `[Watchdog] It's been a while since any progress was logged. ` +
  `This is a gentle reminder: revisit your PLAN.md for pending tasks, ` +
  `and your VALUES.md and ID.md for your drives and goals. ` +
  `If you're blocked, consider updating PLAN.md with what's blocking you ` +
  `and look for an alternative path forward.`;

export class LoopWatchdog {
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly injectMessage: (message: string) => void;
  private readonly stallThresholdMs: number;

  private lastActivityTime: Date | null = null;
  private reminderSent = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(config: LoopWatchdogConfig) {
    this.clock = config.clock;
    this.logger = config.logger;
    this.injectMessage = config.injectMessage;
    this.stallThresholdMs = config.stallThresholdMs;
  }

  recordActivity(): void {
    this.lastActivityTime = this.clock.now();
    this.reminderSent = false;
  }

  check(): void {
    if (!this.lastActivityTime || this.reminderSent) {
      return;
    }

    const elapsed = this.clock.now().getTime() - this.lastActivityTime.getTime();
    if (elapsed >= this.stallThresholdMs) {
      this.logger.debug(
        `watchdog: no activity for ${Math.round(elapsed / 1000)}s (threshold: ${Math.round(this.stallThresholdMs / 1000)}s) — injecting stall reminder`,
      );
      this.injectMessage(STALL_REMINDER);
      this.reminderSent = true;
    }
  }

  start(checkIntervalMs: number): void {
    this.stop();
    this.intervalHandle = setInterval(() => this.check(), checkIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  isRunning(): boolean {
    return this.intervalHandle !== null;
  }
}
