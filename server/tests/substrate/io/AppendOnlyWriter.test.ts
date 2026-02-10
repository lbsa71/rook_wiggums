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

  describe("secret detection", () => {
    it("rejects entries containing API keys", async () => {
      const entry = '[SUBCONSCIOUS] Progress update: api_key: "abcdef1234567890abcdef1234567890abcdef12"';

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).rejects.toThrow("potential secrets detected");
    });

    it("rejects entries containing tokens", async () => {
      const entry = '[ID] Generated goal with auth_token: "my-secret-token-12345678901234567890"';

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).rejects.toThrow("potential secrets detected");
    });

    it("rejects entries containing AWS credentials", async () => {
      const entry = "[EGO] Task result: AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).rejects.toThrow("potential secrets detected");
    });

    it("rejects entries containing private keys", async () => {
      const entry = "[SUPEREGO] Audit finding: -----BEGIN PRIVATE KEY-----";

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).rejects.toThrow("potential secrets detected");
    });

    it("rejects entries containing database connection strings", async () => {
      const entry = "[SUBCONSCIOUS] Database connected: postgres://user:password@localhost:5432/db";

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).rejects.toThrow("potential secrets detected");
    });

    it("accepts entries without secrets", async () => {
      const entry = "[SUBCONSCIOUS] I learned about API key security today. Always use environment variables!";

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).resolves.not.toThrow();

      const content = await fs.readFile("/substrate/PROGRESS.md");
      expect(content).toContain(entry);
    });

    it("provides informative error messages", async () => {
      const entry = 'Progress: api_key: "abcdef1234567890abcdef1234567890abcdef12"';

      await expect(
        writer.append(SubstrateFileType.PROGRESS, entry)
      ).rejects.toThrow(/Generic API Key.*line.*column/);
    });
  });
});
