import { AppendOnlyWriter } from "../../../src/substrate/io/AppendOnlyWriter";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";
import { SubstrateConfig } from "../../../src/substrate/config";
import { FileLock } from "../../../src/substrate/io/FileLock";
import { SubstrateFileType } from "../../../src/substrate/types";

describe("AppendOnlyWriter", () => {
  let fs: InMemoryFileSystem;
  let clock: FixedClock;
  let config: SubstrateConfig;
  let lock: FileLock;
  let writer: AppendOnlyWriter;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    clock = new FixedClock(new Date("2025-06-15T10:30:00Z"));
    config = new SubstrateConfig("/substrate");
    lock = new FileLock();
    writer = new AppendOnlyWriter(fs, config, lock, clock);

    // Pre-create the append-mode files
    await fs.writeFile("/substrate/PROGRESS.md", "# Progress\n\n");
    await fs.writeFile("/substrate/CONVERSATION.md", "# Conversation\n\n");
  });

  it("appends a timestamped entry to PROGRESS", async () => {
    await writer.append(SubstrateFileType.PROGRESS, "First entry");
    const content = await fs.readFile("/substrate/PROGRESS.md");
    expect(content).toContain("[2025-06-15T10:30:00.000Z]");
    expect(content).toContain("First entry");
  });

  it("appends a timestamped entry to CONVERSATION", async () => {
    await writer.append(SubstrateFileType.CONVERSATION, "Hello world");
    const content = await fs.readFile("/substrate/CONVERSATION.md");
    expect(content).toContain("[2025-06-15T10:30:00.000Z]");
    expect(content).toContain("Hello world");
  });

  it("appends multiple entries in order", async () => {
    await writer.append(SubstrateFileType.PROGRESS, "Entry 1");
    clock.setNow(new Date("2025-06-15T10:31:00Z"));
    await writer.append(SubstrateFileType.PROGRESS, "Entry 2");

    const content = await fs.readFile("/substrate/PROGRESS.md");
    const idx1 = content.indexOf("Entry 1");
    const idx2 = content.indexOf("Entry 2");
    expect(idx1).toBeLessThan(idx2);
    expect(content).toContain("[2025-06-15T10:30:00.000Z]");
    expect(content).toContain("[2025-06-15T10:31:00.000Z]");
  });

  it("rejects OVERWRITE-mode file types", async () => {
    await expect(
      writer.append(SubstrateFileType.PLAN, "Some text")
    ).rejects.toThrow("Cannot use AppendOnlyWriter for OVERWRITE-mode");
  });

  it("rejects MEMORY (OVERWRITE-mode)", async () => {
    await expect(
      writer.append(SubstrateFileType.MEMORY, "Some text")
    ).rejects.toThrow("Cannot use AppendOnlyWriter for OVERWRITE-mode");
  });
});
