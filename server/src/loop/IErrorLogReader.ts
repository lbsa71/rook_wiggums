/**
 * Reads error-level log entries to determine if any errors occurred in a given window.
 * Used by HealthCheckScheduler to decide whether a fast-path skip is safe.
 */
export interface IErrorLogReader {
  /** Returns true if any error-level entries were recorded since the given timestamp. */
  hasErrorsSince(since: Date): boolean;
}
