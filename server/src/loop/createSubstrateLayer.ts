import * as path from "path";
import { NodeFileSystem } from "../substrate/abstractions/NodeFileSystem";
import { SystemClock } from "../substrate/abstractions/SystemClock";
import type { IFileSystem } from "../substrate/abstractions/IFileSystem";
import type { IClock } from "../substrate/abstractions/IClock";
import type { ILogger } from "../logging";
import { SubstrateConfig } from "../substrate/config";
import { SubstrateFileReader } from "../substrate/io/FileReader";
import { SubstrateFileWriter } from "../substrate/io/FileWriter";
import { AppendOnlyWriter } from "../substrate/io/AppendOnlyWriter";
import { FileLock } from "../substrate/io/FileLock";
import { FileLogger, type LogLevel } from "../logging";
import { SuperegoFindingTracker } from "../agents/roles/SuperegoFindingTracker";
import { MetaManager } from "../substrate/MetaManager";

export interface SubstrateLayerResult {
  fs: IFileSystem;
  clock: IClock;
  substrateConfig: SubstrateConfig;
  reader: SubstrateFileReader;
  writer: SubstrateFileWriter;
  appendWriter: AppendOnlyWriter;
  lock: FileLock;
  logger: ILogger;
  logPath: string;
  metaManager: MetaManager;
  findingTracker: SuperegoFindingTracker;
  findingTrackerSave: () => Promise<void>;
}

export interface SubstrateLayerOverrides {
  fs?: IFileSystem;
  clock?: IClock;
  logger?: ILogger;
}

/**
 * Creates and initialises all substrate-level I/O primitives:
 * filesystem, clock, config, readers/writers, logger, MetaManager
 * and the SuperegoFindingTracker.
 *
 * Pass `overrides` to inject test doubles for fs, clock, and logger.
 */
export async function createSubstrateLayer(
  substratePath: string,
  logLevel?: LogLevel,
  enableFileReadCache = true,
  progressMaxBytes?: number,
  overrides?: SubstrateLayerOverrides,
): Promise<SubstrateLayerResult> {
  const fs = overrides?.fs ?? new NodeFileSystem();
  const clock = overrides?.clock ?? new SystemClock();
  const substrateConfig = new SubstrateConfig(substratePath);
  const reader = new SubstrateFileReader(fs, substrateConfig, enableFileReadCache);
  const lock = new FileLock();

  // Logger — created early so all layers can use it
  const logPath = path.resolve(substratePath, "..", "debug.log");
  const logger = overrides?.logger ?? new FileLogger(logPath, undefined, logLevel ?? "info");

  const writer = new SubstrateFileWriter(fs, substrateConfig, lock, reader, logger);
  const appendWriter = new AppendOnlyWriter(fs, substrateConfig, lock, clock, reader, progressMaxBytes);

  // Meta — session identity (name, fullName, birthdate) stored in meta.json
  const metaManager = new MetaManager(fs, clock, substratePath);
  await metaManager.initialize();

  // Finding tracker — loaded from disk for durable escalation across restarts
  const trackerStatePath = path.resolve(substratePath, "..", ".superego-tracker.json");
  const findingTracker = await SuperegoFindingTracker.load(trackerStatePath, fs, logger);
  const findingTrackerSave = () => findingTracker.save(trackerStatePath, fs);

  return {
    fs, clock, substrateConfig, reader, writer, appendWriter, lock,
    logger, logPath, metaManager, findingTracker, findingTrackerSave,
  };
}
