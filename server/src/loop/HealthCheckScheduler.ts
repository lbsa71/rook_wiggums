import { IClock } from "../substrate/abstractions/IClock";
import { ILogger } from "../logging";
import { HealthCheck, HealthCheckResult } from "../evaluation/HealthCheck";
import { IErrorLogReader } from "./IErrorLogReader";

export interface HealthCheckSchedulerConfig {
  checkIntervalMs: number; // How often to run health checks
  /** Number of consecutive healthy cycles required before the fast-path skip is eligible. Default: 3. */
  noErrorWindowCycles?: number;
}

export interface HealthCheckStatus {
  lastCheckTime: Date | null;
  lastResult: HealthCheckResult | null;
  nextCheckDue: Date | null;
  checksRun: number;
}

export class HealthCheckScheduler {
  private lastCheckTime: Date | null = null;
  private lastResult: HealthCheckResult | null = null;
  private checksRun = 0;
  private consecutiveHealthyCount = 0;

  constructor(
    private readonly healthCheck: HealthCheck,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly config: HealthCheckSchedulerConfig,
    private readonly errorLogReader?: IErrorLogReader
  ) {}

  shouldRunCheck(): boolean {
    if (this.lastCheckTime === null) {
      return true; // Run first check immediately
    }

    const now = this.clock.now();
    const msSinceLastCheck = now.getTime() - this.lastCheckTime.getTime();
    return msSinceLastCheck >= this.config.checkIntervalMs;
  }

  private canUseFastPath(): boolean {
    const windowCycles = this.config.noErrorWindowCycles ?? 3;
    if (this.consecutiveHealthyCount < windowCycles) return false;
    if (this.lastCheckTime === null || this.lastResult === null) return false;
    if (this.errorLogReader?.hasErrorsSince(this.lastCheckTime)) return false;
    return true;
  }

  async runCheck(): Promise<{ success: boolean; result?: HealthCheckResult; error?: string }> {
    const now = this.clock.now();

    if (this.canUseFastPath()) {
      this.lastCheckTime = now;
      this.checksRun++;
      this.consecutiveHealthyCount++;
      this.logger.debug(
        `HealthCheckScheduler: fast-path skip — system healthy (${this.consecutiveHealthyCount} consecutive healthy cycles)`
      );
      return { success: true, result: this.lastResult! };
    }

    this.logger.debug(`HealthCheckScheduler: running check (check #${this.checksRun + 1})`);

    try {
      const result = await this.healthCheck.run();
      this.lastCheckTime = now;
      this.lastResult = result;
      this.checksRun++;

      if (result.overall === "healthy") {
        this.consecutiveHealthyCount++;
      } else {
        this.consecutiveHealthyCount = 0;
      }

      this.logger.debug(`HealthCheckScheduler: check complete — overall: ${result.overall}`);
      return { success: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`HealthCheckScheduler: check failed — ${errorMsg}`);
      this.lastCheckTime = now;
      this.checksRun++;
      this.consecutiveHealthyCount = 0;
      return { success: false, error: errorMsg };
    }
  }

  getStatus(): HealthCheckStatus {
    let nextCheckDue: Date | null = null;
    if (this.lastCheckTime) {
      nextCheckDue = new Date(this.lastCheckTime.getTime() + this.config.checkIntervalMs);
    }

    return {
      lastCheckTime: this.lastCheckTime,
      lastResult: this.lastResult,
      nextCheckDue,
      checksRun: this.checksRun,
    };
  }
}
