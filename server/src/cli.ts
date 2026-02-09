import { NodeFileSystem } from "./substrate/abstractions/NodeFileSystem";
import { SystemClock } from "./substrate/abstractions/SystemClock";
import { NodeProcessRunner } from "./agents/claude/NodeProcessRunner";
import { getAppPaths } from "./paths";
import { resolveConfig } from "./config";
import { initWorkspace } from "./init";
import { startServer } from "./startup";
import { createBackup, restoreBackup } from "./backup";

export interface ParsedArgs {
  command: "init" | "start" | "backup" | "restore";
  configPath?: string;
  model?: string;
  outputDir?: string;
  inputPath?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command: "init" | "start" | "backup" | "restore" = "start";
  let configPath: string | undefined;
  let model: string | undefined;
  let outputDir: string | undefined;
  let inputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "init" || arg === "start" || arg === "backup" || arg === "restore") {
      command = arg;
    } else if (arg === "--config" && i + 1 < args.length) {
      configPath = args[++i];
    } else if (arg === "--model" && i + 1 < args.length) {
      model = args[++i];
    } else if (arg === "--output" && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (arg === "--input" && i + 1 < args.length) {
      inputPath = args[++i];
    }
  }

  return { command, configPath, model, outputDir, inputPath };
}

async function main(): Promise<void> {
  const { command, configPath, model, outputDir } = parseArgs(process.argv);
  const fs = new NodeFileSystem();
  const appPaths = getAppPaths();

  const config = await resolveConfig(fs, {
    appPaths,
    configPath,
    cwd: process.cwd(),
    env: process.env,
  });

  // CLI --model overrides config file
  if (model) {
    config.model = model;
  }

  if (command === "init") {
    await initWorkspace(fs, config, appPaths);
    console.log("Workspace initialized successfully.");
  } else if (command === "backup") {
    const result = await createBackup({
      fs,
      runner: new NodeProcessRunner(),
      clock: new SystemClock(),
      substratePath: config.substratePath,
      outputDir: outputDir ?? config.backupPath,
    });
    if (result.success) {
      console.log(`Backup created: ${result.outputPath}`);
    } else {
      console.error(`Backup failed: ${result.error}`);
      process.exit(1);
    }
  } else if (command === "restore") {
    const result = await restoreBackup({
      fs,
      runner: new NodeProcessRunner(),
      substratePath: config.substratePath,
      inputPath,
      backupDir: config.backupPath,
    });
    if (result.success) {
      console.log(`Restored from: ${result.restoredFrom}`);
    } else {
      console.error(`Restore failed: ${result.error}`);
      process.exit(1);
    }
  } else {
    await startServer(config);
  }
}

// Only run when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
