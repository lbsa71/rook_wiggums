import { HealthCheck } from "../../src/evaluation/HealthCheck";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";

describe("HealthCheck", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let healthCheck: HealthCheck;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    healthCheck = new HealthCheck(reader);

    await fs.mkdir("/substrate", { recursive: true });
  });

  it("returns healthy result when all files are well-formed", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nBuild authentication system\n\n## Tasks\n- [ ] Task A\n- [ ] Task B");
    await fs.writeFile("/substrate/VALUES.md", "# Values\n\nBe good");
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\n## Constraints\nStay safe");
    await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nOur mission");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nWe are building an authentication system");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nKnown: authentication, TypeScript");

    const result = await healthCheck.run();

    expect(result.overall).toBe("healthy");
    expect(result.drift.score).toBeLessThanOrEqual(0.3);
    expect(result.security.compliant).toBe(true);
    expect(result.planQuality.score).toBeGreaterThanOrEqual(0.5);
  });

  it("returns unhealthy when files have issues", async () => {
    // No files at all
    const result = await healthCheck.run();

    expect(result.overall).toBe("unhealthy");
  });

  it("includes all analyzer results", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nBuild\n\n## Tasks\n- [ ] A\n- [ ] B");
    await fs.writeFile("/substrate/VALUES.md", "# Values\n\nGood");
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\n## Constraints\nSafe");
    await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nMission");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nFacts about building");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nKnown: building, TypeScript");

    const result = await healthCheck.run();

    expect(result).toHaveProperty("drift");
    expect(result).toHaveProperty("consistency");
    expect(result).toHaveProperty("security");
    expect(result).toHaveProperty("planQuality");
    expect(result).toHaveProperty("reasoning");
    expect(result).toHaveProperty("overall");
  });
});
