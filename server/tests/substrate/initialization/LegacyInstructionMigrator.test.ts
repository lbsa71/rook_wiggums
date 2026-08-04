import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../../src/substrate/config";
import { LegacyInstructionMigrator } from "../../../src/substrate/initialization/LegacyInstructionMigrator";

describe("LegacyInstructionMigrator", () => {
  let fs: InMemoryFileSystem;
  let migrator: LegacyInstructionMigrator;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.mkdir("/substrate", { recursive: true });
    migrator = new LegacyInstructionMigrator(fs, new SubstrateConfig("/substrate"));
  });

  it("copies legacy CLAUDE.md guidance when AGENTS.md is absent", async () => {
    const legacy = "# Claude\n\nLived instructions.\n";
    await fs.writeFile("/substrate/CLAUDE.md", legacy);

    await expect(migrator.migrate()).resolves.toEqual({ copiedFromLegacy: true });

    expect(await fs.readFile("/substrate/AGENTS.md")).toBe(legacy);
    expect(await fs.readFile("/substrate/CLAUDE.md")).toBe(legacy);
  });

  it("keeps canonical AGENTS.md when both files exist", async () => {
    await fs.writeFile("/substrate/AGENTS.md", "# Agents\n\nCanonical.\n");
    await fs.writeFile("/substrate/CLAUDE.md", "# Claude\n\nLegacy.\n");

    await expect(migrator.migrate()).resolves.toEqual({ copiedFromLegacy: false });

    expect(await fs.readFile("/substrate/AGENTS.md")).toContain("Canonical");
  });

  it("is a no-op when neither instruction file exists", async () => {
    await expect(migrator.migrate()).resolves.toEqual({ copiedFromLegacy: false });
    expect(await fs.exists("/substrate/AGENTS.md")).toBe(false);
  });
});
