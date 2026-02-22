import type { IFileSystem } from "./IFileSystem";
import type { IClock } from "./IClock";

/**
 * Abstraction over environment resources so tests can mock them.
 * All environment settings, file system, and current time go through this interface.
 */
export interface IEnvironment {
  readonly fs: IFileSystem;
  readonly clock: IClock;
  getEnv(key: string): string | undefined;
  getPlatform(): string;
  getHomedir(): string;
}
