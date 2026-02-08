import { ReasoningValidator } from "../../src/evaluation/ReasoningValidator";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";

describe("ReasoningValidator", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let validator: ReasoningValidator;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    validator = new ReasoningValidator(reader);

    await fs.mkdir("/substrate", { recursive: true });
  });

  it("returns valid when plan keywords overlap with memory and skills", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Current Goal\nBuild authentication system\n\n## Tasks\n- [ ] Implement login"
    );
    await fs.writeFile(
      "/substrate/MEMORY.md",
      "# Memory\n\nWe are building an authentication system for users."
    );
    await fs.writeFile(
      "/substrate/SKILLS.md",
      "# Skills\n\nKnown: authentication, TypeScript, REST APIs"
    );

    const result = await validator.validate();

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports when plan goal has no overlap with memory", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Current Goal\nBuild quantum teleportation\n\n## Tasks\n- [ ] Teleport"
    );
    await fs.writeFile(
      "/substrate/MEMORY.md",
      "# Memory\n\nWe sell pizza and deliver to customers."
    );
    await fs.writeFile(
      "/substrate/SKILLS.md",
      "# Skills\n\nKnown: pizza, delivery, customer service"
    );

    const result = await validator.validate();

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("MEMORY"))).toBe(true);
  });

  it("handles missing files gracefully", async () => {
    // No files at all
    const result = await validator.validate();

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("PLAN"))).toBe(true);
  });

  it("handles empty plan gracefully", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nSome stuff");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nSome skills");

    const result = await validator.validate();

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("goal"))).toBe(true);
  });

  it("is valid when plan overlaps with skills but not memory", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Current Goal\nBuild TypeScript compiler\n\n## Tasks\n- [ ] Parse code"
    );
    await fs.writeFile(
      "/substrate/MEMORY.md",
      "# Memory\n\nGeneral notes about the project."
    );
    await fs.writeFile(
      "/substrate/SKILLS.md",
      "# Skills\n\nKnown: TypeScript, compilers, parsing"
    );

    const result = await validator.validate();

    expect(result.valid).toBe(true);
  });
});
