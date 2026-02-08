import { PlanQualityEvaluator } from "../../src/evaluation/PlanQualityEvaluator";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";

describe("PlanQualityEvaluator", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let evaluator: PlanQualityEvaluator;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    evaluator = new PlanQualityEvaluator(reader);

    await fs.mkdir("/substrate", { recursive: true });
  });

  it("returns high quality score for a well-structured plan", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Current Goal\nBuild the system\n\n## Tasks\n- [ ] Task A\n- [ ] Task B\n- [x] Task C"
    );

    const result = await evaluator.evaluate();

    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.findings).toHaveLength(0);
  });

  it("reports missing Current Goal section", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Tasks\n- [ ] Task A"
    );

    const result = await evaluator.evaluate();

    expect(result.score).toBeLessThan(0.8);
    expect(result.findings.some((f) => f.message.includes("Current Goal"))).toBe(true);
  });

  it("reports missing Tasks section", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Current Goal\nBuild things\n\nSome random text"
    );

    const result = await evaluator.evaluate();

    expect(result.score).toBeLessThan(0.8);
    expect(result.findings.some((f) => f.message.includes("Tasks"))).toBe(true);
  });

  it("reports when all tasks are complete", async () => {
    await fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Current Goal\nDone\n\n## Tasks\n- [x] Task A\n- [x] Task B"
    );

    const result = await evaluator.evaluate();

    expect(result.findings.some((f) => f.message.includes("pending"))).toBe(true);
  });

  it("handles missing plan file gracefully", async () => {
    // No PLAN.md written
    const result = await evaluator.evaluate();

    expect(result.score).toBe(0);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].message).toContain("could not be read");
  });
});
