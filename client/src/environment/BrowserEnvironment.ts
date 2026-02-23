import type { IEnvironment } from "./IEnvironment";

/**
 * Production browser environment: real time, Vite env.
 */
export function createBrowserEnvironment(): IEnvironment {
  return {
    now(): number {
      return Date.now();
    },
    getEnv(key: string): string | undefined {
      const meta = import.meta as unknown as { env?: Record<string, unknown> };
      return meta.env?.[key] != null ? String(meta.env[key]) : undefined;
    },
  };
}
