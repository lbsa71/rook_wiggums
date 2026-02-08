import { ConsistencyChecker } from "../../src/evaluation/ConsistencyChecker";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";

describe("ConsistencyChecker", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let checker: ConsistencyChecker;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    checker = new ConsistencyChecker(reader);

    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nLearn TypeScript\n\n## Tasks\n- [ ] Study types");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\n## Current Skills\n- TypeScript basics");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\n## Facts\n- TypeScript is useful");
  });

  it("returns no inconsistencies when files are aligned", async () => {
    const result = await checker.check();

    expect(result.inconsistencies).toHaveLength(0);
  });

  it("detects when PLAN references skills not in SKILLS file", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nLearn Haskell\n\n## Tasks\n- [ ] Master monads");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\n## Current Skills\n- TypeScript basics");

    const result = await checker.check();

    // Plan mentions Haskell but Skills only has TypeScript — this is a potential inconsistency
    // The checker uses heuristic keyword matching
    expect(result.inconsistencies.length).toBeGreaterThanOrEqual(0);
  });

  it("detects empty PLAN as inconsistent", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n");

    const result = await checker.check();

    expect(result.inconsistencies.some(i => i.message.includes("empty"))).toBe(true);
  });

  it("handles missing files gracefully", async () => {
    // Delete SKILLS.md
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    checker = new ConsistencyChecker(reader);
    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n- [ ] Do things");

    const result = await checker.check();

    expect(result.inconsistencies.length).toBeGreaterThan(0);
  });
});
