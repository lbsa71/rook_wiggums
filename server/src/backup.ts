import * as path from "node:path";
import type { IFileSystem } from "./substrate/abstractions/IFileSystem";
import type { IProcessRunner } from "./agents/claude/IProcessRunner";
import type { IClock } from "./substrate/abstractions/IClock";

export interface BackupOptions {
  fs: IFileSystem;
  runner: IProcessRunner;
  clock: IClock;
  substratePath: string;
  outputDir: string;
}

export interface BackupResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface RestoreOptions {
  fs: IFileSystem;
  runner: IProcessRunner;
  substratePath: string;
  inputPath?: string;
  backupDir?: string;
}

export interface RestoreResult {
  success: boolean;
  restoredFrom?: string;
  error?: string;
}

export async function findLatestBackup(
  fs: IFileSystem,
  backupDir: string
): Promise<string | null> {
  if (!(await fs.exists(backupDir))) return null;

  const entries = await fs.readdir(backupDir);
  const backups = entries
    .filter((f) => f.startsWith("rook-wiggums-backup-") && f.endsWith(".tar.gz"))
    .sort();

  if (backups.length === 0) return null;
  return path.join(backupDir, backups[backups.length - 1]);
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const { fs, runner, substratePath } = options;

  const archivePath = options.inputPath
    ?? (options.backupDir ? await findLatestBackup(fs, options.backupDir) : null);

  if (!archivePath) {
    return { success: false, error: "No backup file specified and no backups found" };
  }

  if (!(await fs.exists(archivePath))) {
    return { success: false, error: `Backup file not found: ${archivePath}` };
  }

  await fs.mkdir(substratePath, { recursive: true });

  const result = await runner.run("tar", ["-xzf", archivePath, "-C", substratePath]);

  if (result.exitCode !== 0) {
    return { success: false, restoredFrom: archivePath, error: result.stderr };
  }

  return { success: true, restoredFrom: archivePath };
}

export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const { fs, runner, clock, substratePath, outputDir } = options;

  if (!(await fs.exists(substratePath))) {
    return { success: false, error: "Substrate directory not found" };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = clock.now().toISOString().replace(/:/g, "-");
  const filename = `rook-wiggums-backup-${timestamp}.tar.gz`;
  const outputPath = path.join(outputDir, filename);

  // Use -C for relative paths so archives are portable across agent spaces
  const result = await runner.run("tar", ["-czf", outputPath, "-C", substratePath, "."]);

  if (result.exitCode !== 0) {
    return { success: false, outputPath, error: result.stderr };
  }

  return { success: true, outputPath };
}
