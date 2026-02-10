import { BackupScheduler } from "../../src/loop/BackupScheduler";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";
import { InMemoryLogger } from "../../src/logging";
import { InMemoryProcessRunner } from "../../src/agents/claude/InMemoryProcessRunner";

describe("BackupScheduler", () => {
  let fs: InMemoryFileSystem;
  let runner: InMemoryProcessRunner;
  let clock: FixedClock;
  let logger: InMemoryLogger;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    runner = new InMemoryProcessRunner();
    clock = new FixedClock(new Date("2026-02-10T00:00:00.000Z"));
    logger = new InMemoryLogger();
  });

  describe("shouldRunBackup", () => {
    it("should return true on first backup", () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000, // 24 hours
        retentionCount: 7,
        verifyBackups: true,
      });

      expect(scheduler.shouldRunBackup()).toBe(true);
    });

    it("should return false before interval elapsed", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 3600000, // 1 hour
        retentionCount: 7,
        verifyBackups: false,
      });

      // Setup substrate files
      await fs.mkdir("/substrate", { recursive: true });
      await fs.writeFile("/substrate/PLAN.md", "# Plan\nTest content");

      // Mock tar
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });

      // Run first backup
      await scheduler.runBackup();

      // Advance clock by 30 minutes
      clock.setNow(new Date(clock.now().getTime() + 1800000));

      expect(scheduler.shouldRunBackup()).toBe(false);
    });

    it("should return true after interval elapsed", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 3600000, // 1 hour
        retentionCount: 7,
        verifyBackups: false,
      });

      // Setup substrate files
      await fs.mkdir("/substrate", { recursive: true });
      await fs.writeFile("/substrate/PLAN.md", "# Plan\nTest content");

      // Mock tar
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });

      // Run first backup
      await scheduler.runBackup();

      // Advance clock by 65 minutes
      clock.setNow(new Date(clock.now().getTime() + 3900000));

      expect(scheduler.shouldRunBackup()).toBe(true);
    });
  });

  describe("runBackup", () => {
    it("should create backup successfully", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: false, // Disable verification for simple test
      });

      // Setup substrate files
      await fs.mkdir("/substrate", { recursive: true });
      await fs.writeFile("/substrate/PLAN.md", "# Plan\nTest content");
      await fs.writeFile("/substrate/MEMORY.md", "# Memory\nTest memory");

      // Mock tar command
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });

      const result = await scheduler.runBackup();

      expect(result.success).toBe(true);
      expect(result.backupPath).toContain("/backups/rook-wiggums-backup-");
      expect(result.error).toBeUndefined();
    });

    it("should verify backup when enabled", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: true,
      });

      // Setup substrate files
      await fs.mkdir("/substrate", { recursive: true });
      await fs.writeFile("/substrate/PLAN.md", "# Plan");

      const backupPath = "/backups/rook-wiggums-backup-2026-02-10T00-00-00.000Z.tar.gz";

      // Mock tar commands - create backup, then verify
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });
      runner.enqueue({ exitCode: 0, stdout: "PLAN.md\nMEMORY.md\n", stderr: "" });

      // Create mock backup file for verification
      await fs.mkdir("/backups", { recursive: true });
      await fs.writeFile(backupPath, "mock backup content");

      const result = await scheduler.runBackup();

      expect(result.success).toBe(true);
      expect(result.verification?.valid).toBe(true);
      expect(result.verification?.checksum).toBeDefined();
      expect(result.verification?.sizeBytes).toBeGreaterThan(0);
    });

    it("should fail if backup directory does not exist", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/nonexistent",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: false,
      });

      const result = await scheduler.runBackup();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Substrate directory not found");
    });

    it("should cleanup old backups beyond retention count", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 3600000, // 1 hour
        retentionCount: 3,
        verifyBackups: false,
      });

      // Setup substrate
      await fs.mkdir("/substrate", { recursive: true });
      await fs.writeFile("/substrate/PLAN.md", "# Plan");

      // Create old backups
      await fs.mkdir("/backups", { recursive: true });
      await fs.writeFile("/backups/rook-wiggums-backup-2026-02-01T00-00-00.000Z.tar.gz", "old1");
      await fs.writeFile("/backups/rook-wiggums-backup-2026-02-02T00-00-00.000Z.tar.gz", "old2");
      await fs.writeFile("/backups/rook-wiggums-backup-2026-02-03T00-00-00.000Z.tar.gz", "old3");

      // Mock tar commands for 2 new backups
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });

      // Create 2 new backups (total 5, retention is 3)
      await scheduler.runBackup();
      clock.setNow(new Date(clock.now().getTime() + 3600000));
      await scheduler.runBackup();

      // Check that oldest backups were deleted
      const files = await fs.readdir("/backups");
      const backupFiles = files.filter(f => f.startsWith("rook-wiggums-backup-"));
      expect(backupFiles.length).toBe(3); // Only 3 should remain
    });
  });

  describe("verifyBackup", () => {
    it("should validate backup with checksum", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: true,
      });

      const backupPath = "/backups/test-backup.tar.gz";
      await fs.mkdir("/backups", { recursive: true });
      await fs.writeFile(backupPath, "backup content");

      // Mock tar verification
      runner.enqueue({ exitCode: 0, stdout: "file1.md\nfile2.md\n", stderr: "" });

      const result = await scheduler.verifyBackup(backupPath);

      expect(result.valid).toBe(true);
      expect(result.checksum).toBeDefined();
      expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it("should fail if backup file does not exist", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: true,
      });

      const result = await scheduler.verifyBackup("/nonexistent/backup.tar.gz");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail if backup is empty", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: true,
      });

      const backupPath = "/backups/empty-backup.tar.gz";
      await fs.mkdir("/backups", { recursive: true });
      await fs.writeFile(backupPath, "");

      const result = await scheduler.verifyBackup(backupPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should fail if tar verification fails", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: true,
      });

      const backupPath = "/backups/corrupt-backup.tar.gz";
      await fs.mkdir("/backups", { recursive: true });
      await fs.writeFile(backupPath, "corrupt data");

      // Mock tar failure
      runner.enqueue({ exitCode: 1, stdout: "", stderr: "tar: This does not look like a tar archive" });

      const result = await scheduler.verifyBackup(backupPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("tar verification failed");
    });
  });

  describe("getStatus", () => {
    it("should return initial status", () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 86400000,
        retentionCount: 7,
        verifyBackups: true,
      });

      const status = scheduler.getStatus();

      expect(status.lastBackupTime).toBeNull();
      expect(status.backupCount).toBe(0);
      expect(status.nextBackupDue).toEqual(clock.now());
    });

    it("should update status after backup", async () => {
      const scheduler = new BackupScheduler(fs, runner, clock, logger, {
        substratePath: "/substrate",
        backupDir: "/backups",
        backupIntervalMs: 3600000, // 1 hour
        retentionCount: 7,
        verifyBackups: false,
      });

      // Setup substrate
      await fs.mkdir("/substrate", { recursive: true });
      await fs.writeFile("/substrate/PLAN.md", "# Plan");

      // Mock tar
      runner.enqueue({ exitCode: 0, stdout: "", stderr: "" });

      await scheduler.runBackup();

      const status = scheduler.getStatus();

      expect(status.lastBackupTime).toEqual(clock.now());
      expect(status.backupCount).toBe(1);
      expect(status.nextBackupDue).toEqual(new Date(clock.now().getTime() + 3600000));
    });
  });
});
