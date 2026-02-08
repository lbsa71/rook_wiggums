import { SubstrateBackup } from "../../../src/substrate/initialization/SubstrateBackup";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";
import { SubstrateConfig } from "../../../src/substrate/config";
import { SubstrateFileType } from "../../../src/substrate/types";

describe("SubstrateBackup", () => {
  let fs: InMemoryFileSystem;
  let clock: FixedClock;
  let config: SubstrateConfig;
  let backup: SubstrateBackup;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    clock = new FixedClock(new Date("2025-06-15T10:30:00Z"));
    config = new SubstrateConfig("/substrate");
    backup = new SubstrateBackup(fs, clock, config);

    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Goal\n\nOriginal");
  });

  it("copies file to backup directory with timestamp", async () => {
    const backupPath = await backup.backup(SubstrateFileType.PLAN);

    expect(backupPath).toBe(
      "/substrate/backups/PLAN.md.2025-06-15T10-30-00-000Z.bak"
    );
    const content = await fs.readFile(backupPath);
    expect(content).toBe("# Plan\n\n## Goal\n\nOriginal");
  });

  it("creates the backup directory if it does not exist", async () => {
    await backup.backup(SubstrateFileType.PLAN);
    expect(await fs.exists("/substrate/backups")).toBe(true);
  });

  it("uses the injected clock for the timestamp", async () => {
    clock.setNow(new Date("2026-01-01T00:00:00Z"));
    const backupPath = await backup.backup(SubstrateFileType.PLAN);
    expect(backupPath).toContain("2026-01-01T00-00-00-000Z");
  });

  it("throws when source file does not exist", async () => {
    await expect(backup.backup(SubstrateFileType.MEMORY)).rejects.toThrow();
  });
});
