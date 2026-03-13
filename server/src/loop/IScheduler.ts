/**
 * Common interface for all scheduled tasks.
 * Implementations decide when to run (shouldRun) and how to run (run).
 *
 * Set `urgent = false` on non-critical schedulers (e.g. Metrics, Validation, Health)
 * so they are deferred when pending messages are waiting for the agent to process.
 */
export interface IScheduler {
  shouldRun(): Promise<boolean>;
  run(): Promise<void>;
  /** When false, this scheduler is skipped if pending messages are waiting. Default: true. */
  readonly urgent?: boolean;
}
