/**
 * Abstraction over environment resources so tests can mock them.
 * Time and env are injected; tests can use known static values.
 */
export interface IEnvironment {
  /** Current time in ms (same contract as Date.now()). Injected so tests can use static timestamps. */
  now(): number;
  /** Environment variable / config (e.g. import.meta.env in Vite). */
  getEnv(key: string): string | undefined;
}
