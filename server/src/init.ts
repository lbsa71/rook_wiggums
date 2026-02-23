import * as path from "node:path";
import type { IFileSystem } from "./substrate/abstractions/IFileSystem";
import type { AppConfig } from "./config";
import type { AppPaths } from "./paths";
import { initializeSubstrate } from "./startup";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function initWorkspace(
  fs: IFileSystem,
  config: AppConfig,
  appPaths: AppPaths
): Promise<void> {
  const configDir = toPosix(appPaths.config);
  const workingDir = toPosix(config.workingDirectory);
  const substrateDir = toPosix(config.substratePath);

  // Create working directory
  await fs.mkdir(workingDir, { recursive: true });

  // Create config directory
  await fs.mkdir(configDir, { recursive: true });

  // Write config.json if it doesn't exist
  const configFilePath = path.posix.join(configDir, "config.json");
  if (!(await fs.exists(configFilePath))) {
    await fs.writeFile(configFilePath, JSON.stringify(config, null, 2));
  }

  // Initialize substrate files
  await initializeSubstrate(fs, substrateDir);
}
