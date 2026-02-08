import { SubstrateFileReader } from "../../../src/substrate/io/FileReader";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../../src/substrate/config";
import { SubstrateFileType } from "../../../src/substrate/types";

describe("SubstrateFileReader", () => {
  let fs: InMemoryFileSystem;
  let config: SubstrateConfig;
  let reader: SubstrateFileReader;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
  });

  it("reads a substrate file and returns content with metadata", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Goal\n\nDo stuff");

    const result = await reader.read(SubstrateFileType.PLAN);

    expect(result.rawMarkdown).toBe("# Plan\n\n## Goal\n\nDo stuff");
    expect(result.meta.fileType).toBe(SubstrateFileType.PLAN);
    expect(result.meta.filePath).toBe("/substrate/PLAN.md");
    expect(result.meta.lastModified).toBeGreaterThan(0);
    expect(result.meta.contentHash).toBeTruthy();
  });

  it("returns different hashes for different content", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## A\n\nContent A");
    const result1 = await reader.read(SubstrateFileType.PLAN);

    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## B\n\nContent B");
    const result2 = await reader.read(SubstrateFileType.PLAN);

    expect(result1.meta.contentHash).not.toBe(result2.meta.contentHash);
  });

  it("throws when file does not exist", async () => {
    await expect(reader.read(SubstrateFileType.PLAN)).rejects.toThrow();
  });
});
