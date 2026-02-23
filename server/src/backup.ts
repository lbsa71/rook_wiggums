import * as path from "node:path";
import type { IFileSystem } from "./substrate/abstractions/IFileSystem";
import type { IProcessRunner } from "./agents/claude/IProcessRunner";
import type { IClock } from "./substrate/abstractions/IClock";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

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
    .filter((f) => f.startsWith("substrate-backup-") && f.endsWith(".tar.gz"))
    .sort();

  if (backups.length === 0) return null;
  return toPosix(path.join(backupDir, backups[backups.length - 1]));
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

export interface RemoteBackupOptions {
  fs: IFileSystem;
  runner: IProcessRunner;
  clock: IClock;
  remoteSource: string;
  outputDir: string;
  identity?: string;
}

export async function createRemoteBackup(options: RemoteBackupOptions): Promise<BackupResult> {
  const { fs, runner, clock, remoteSource, outputDir, identity } = options;

  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = clock.now().toISOString().replace(/:/g, "-");
  const filename = `substrate-backup-${timestamp}.tar.gz`;
  const outputPath = path.join(outputDir, filename);
  const tempDir = path.join(outputDir, `.tmp-backup-${timestamp}`);

  await fs.mkdir(tempDir, { recursive: true });

  try {
    // Step 1: rsync remote substrate to temp dir
    const rsyncArgs = ["-a", "--mkpath"];
    if (identity) {
      rsyncArgs.push("-e", `ssh -i ${identity}`);
    }
    rsyncArgs.push(`${remoteSource}/`, `${tempDir}/`);

    const rsyncResult = await runner.run("rsync", rsyncArgs);
    if (rsyncResult.exitCode !== 0) {
      return { success: false, error: rsyncResult.stderr };
    }

    // Step 2: tar the temp dir into the archive
    const tarResult = await runner.run("tar", ["-czf", outputPath, "-C", tempDir, "."]);
    if (tarResult.exitCode !== 0) {
      return { success: false, outputPath, error: tarResult.stderr };
    }

    return { success: true, outputPath };
  } finally {
    // Step 3: cleanup temp dir
    await runner.run("rm", ["-rf", tempDir]);
  }
}

export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const { fs, runner, clock, substratePath, outputDir } = options;

  if (!(await fs.exists(substratePath))) {
    return { success: false, error: "Substrate directory not found" };
  }

  const outDir = toPosix(outputDir);
  const subPath = toPosix(substratePath);
  await fs.mkdir(outDir, { recursive: true });

  const timestamp = clock.now().toISOString().replace(/:/g, "-");
  const filename = `substrate-backup-${timestamp}.tar.gz`;
  const outputPath = path.posix.join(outDir, filename);

  // Use -C for relative paths so archives are portable across agent spaces
  const result = await runner.run("tar", ["-czf", outputPath, "-C", subPath, "."]);

  if (result.exitCode !== 0) {
    return { success: false, outputPath, error: result.stderr };
  }

  return { success: true, outputPath };
}
