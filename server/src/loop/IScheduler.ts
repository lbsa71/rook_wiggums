/**
 * Common interface for all scheduled tasks.
 * Implementations decide when to run (shouldRun) and how to run (run).
 */
export interface IScheduler {
  shouldRun(): Promise<boolean>;
  run(): Promise<void>;
}
