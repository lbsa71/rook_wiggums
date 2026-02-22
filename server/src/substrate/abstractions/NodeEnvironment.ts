import * as os from "node:os";
import type { IEnvironment } from "./IEnvironment";
import type { IFileSystem } from "./IFileSystem";
import type { IClock } from "./IClock";
import { NodeFileSystem } from "./NodeFileSystem";
import { SystemClock } from "./SystemClock";

/**
 * Production environment: real file system, system clock, process.env, os.
 */
export class NodeEnvironment implements IEnvironment {
  readonly fs: IFileSystem = new NodeFileSystem();
  readonly clock: IClock = new SystemClock();

  getEnv(key: string): string | undefined {
    return process.env[key];
  }

  getPlatform(): string {
    return process.platform;
  }

  getHomedir(): string {
    return os.homedir();
  }
}
