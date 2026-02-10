import { IClock } from "../substrate/abstractions/IClock";
import { ILogger } from "../logging";
import { HealthCheck, HealthCheckResult } from "../evaluation/HealthCheck";

export interface HealthCheckSchedulerConfig {
  checkIntervalMs: number; // How often to run health checks
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

  constructor(
    private readonly healthCheck: HealthCheck,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly config: HealthCheckSchedulerConfig
  ) {}

  shouldRunCheck(): boolean {
    if (this.lastCheckTime === null) {
      return true; // Run first check immediately
    }

    const now = this.clock.now();
    const msSinceLastCheck = now.getTime() - this.lastCheckTime.getTime();
    return msSinceLastCheck >= this.config.checkIntervalMs;
  }

  async runCheck(): Promise<{ success: boolean; result?: HealthCheckResult; error?: string }> {
    const now = this.clock.now();
    this.logger.debug(`HealthCheckScheduler: running check (check #${this.checksRun + 1})`);

    try {
      const result = await this.healthCheck.run();
      this.lastCheckTime = now;
      this.lastResult = result;
      this.checksRun++;

      this.logger.debug(`HealthCheckScheduler: check complete — overall: ${result.overall}`);
      return { success: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`HealthCheckScheduler: check failed — ${errorMsg}`);
      this.lastCheckTime = now;
      this.checksRun++;
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
