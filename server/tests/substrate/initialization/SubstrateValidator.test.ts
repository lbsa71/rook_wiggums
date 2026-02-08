import { SubstrateValidator } from "../../../src/substrate/initialization/SubstrateValidator";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../../src/substrate/config";
import { SubstrateFileType } from "../../../src/substrate/types";
import { getTemplate } from "../../../src/substrate/templates/index";

describe("SubstrateValidator", () => {
  let fs: InMemoryFileSystem;
  let config: SubstrateConfig;
  let validator: SubstrateValidator;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    config = new SubstrateConfig("/substrate");
    validator = new SubstrateValidator(fs, config);

    await fs.mkdir("/substrate", { recursive: true });
  });

  async function createAllFiles(): Promise<void> {
    for (const type of Object.values(SubstrateFileType)) {
      const path = config.getFilePath(type);
      await fs.writeFile(path, getTemplate(type));
    }
  }

  it("returns valid when all files exist and are valid", async () => {
    await createAllFiles();
    const result = await validator.validate();
    expect(result.valid).toBe(true);
    expect(result.missingFiles).toHaveLength(0);
    expect(result.invalidFiles).toHaveLength(0);
  });

  it("reports missing files", async () => {
    // Create all except PLAN
    for (const type of Object.values(SubstrateFileType)) {
      if (type !== SubstrateFileType.PLAN) {
        await fs.writeFile(config.getFilePath(type), getTemplate(type));
      }
    }

    const result = await validator.validate();
    expect(result.valid).toBe(false);
    expect(result.missingFiles).toContain(SubstrateFileType.PLAN);
  });

  it("reports invalid files (bad content)", async () => {
    await createAllFiles();
    // Corrupt MEMORY file
    await fs.writeFile(config.getFilePath(SubstrateFileType.MEMORY), "no heading");

    const result = await validator.validate();
    expect(result.valid).toBe(false);
    expect(result.invalidFiles).toContainEqual(
      expect.objectContaining({ fileType: SubstrateFileType.MEMORY })
    );
  });

  it("reports both missing and invalid files", async () => {
    // Create all except PLAN, and corrupt MEMORY
    for (const type of Object.values(SubstrateFileType)) {
      if (type === SubstrateFileType.PLAN) continue;
      await fs.writeFile(config.getFilePath(type), getTemplate(type));
    }
    await fs.writeFile(
      config.getFilePath(SubstrateFileType.MEMORY),
      "no heading here"
    );

    const result = await validator.validate();
    expect(result.valid).toBe(false);
    expect(result.missingFiles).toContain(SubstrateFileType.PLAN);
    expect(result.invalidFiles).toContainEqual(
      expect.objectContaining({ fileType: SubstrateFileType.MEMORY })
    );
  });

  it("returns valid=false when no files exist", async () => {
    const result = await validator.validate();
    expect(result.valid).toBe(false);
    expect(result.missingFiles).toHaveLength(12);
  });
});
