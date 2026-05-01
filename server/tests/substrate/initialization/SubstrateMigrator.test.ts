import { SubstrateMigrator } from "../../../src/substrate/initialization/SubstrateMigrator";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";
import { SubstrateConfig } from "../../../src/substrate/config";

describe("SubstrateMigrator", () => {
  let fs: InMemoryFileSystem;
  let config: SubstrateConfig;
  let migrator: SubstrateMigrator;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    config = new SubstrateConfig("/substrate");
    migrator = new SubstrateMigrator(fs, config, new FixedClock(new Date("2026-05-01T06:00:00.000Z")));
    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/HABITS.md", "# Habits\n\nExisting lived habit.");
    await fs.writeFile("/substrate/PROGRESS.md", "# Progress\n\n");
  });

  it("applies additive migration guidance and metadata", async () => {
    const report = await migrator.migrate();

    expect(report.applied).toEqual(["conversation-operating-context-v1"]);
    expect(await fs.exists("/substrate/OPERATING_CONTEXT.md")).toBe(true);

    const habits = await fs.readFile("/substrate/HABITS.md");
    expect(habits).toContain("Existing lived habit.");
    expect(habits).toContain("## Agora Marker Cleanup");
    expect(habits).toContain("`**[UNPROCESSED ...]**`");

    const progress = await fs.readFile("/substrate/PROGRESS.md");
    expect(progress).toContain("[2026-05-01T06:00:00.000Z] [SYSTEM] Migration conversation-operating-context-v1 applied");

    const state = JSON.parse(await fs.readFile("/substrate/.substrate-migrations.json"));
    expect(state.applied).toEqual(["conversation-operating-context-v1"]);
  });

  it("is idempotent", async () => {
    await migrator.migrate();
    const habitsAfterFirst = await fs.readFile("/substrate/HABITS.md");
    const progressAfterFirst = await fs.readFile("/substrate/PROGRESS.md");

    const second = await migrator.migrate();

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["conversation-operating-context-v1"]);
    expect(await fs.readFile("/substrate/HABITS.md")).toBe(habitsAfterFirst);
    expect(await fs.readFile("/substrate/PROGRESS.md")).toBe(progressAfterFirst);
  });
});
