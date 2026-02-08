import { DriftAnalyzer } from "../../src/evaluation/DriftAnalyzer";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";

describe("DriftAnalyzer", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let analyzer: DriftAnalyzer;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    analyzer = new DriftAnalyzer(reader);

    await fs.mkdir("/substrate", { recursive: true });
  });

  it("returns low drift score when files have proper headings", async () => {
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nBuild things\n\n## Tasks\n- [ ] Do stuff");
    await fs.writeFile("/substrate/VALUES.md", "# Values\n\n## Core Principles\n- Be good");
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\n## Constraints\n- Stay safe");
    await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nOur mission");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nFacts");

    const result = await analyzer.analyze();

    expect(result.score).toBeLessThanOrEqual(0.3);
    expect(result.findings).toHaveLength(0);
  });

  it("returns high drift score when required headings are missing", async () => {
    await fs.writeFile("/substrate/PLAN.md", "Just some random text with no structure");

    const result = await analyzer.analyze();

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].message).toContain("PLAN");
  });

  it("detects empty files as drift", async () => {
    await fs.writeFile("/substrate/VALUES.md", "");

    const result = await analyzer.analyze();

    expect(result.findings.some(f => f.message.includes("VALUES"))).toBe(true);
  });

  it("handles missing files gracefully", async () => {
    // No files written — all reads will fail
    const result = await analyzer.analyze();

    expect(result.score).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
