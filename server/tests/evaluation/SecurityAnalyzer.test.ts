import { SecurityAnalyzer } from "../../src/evaluation/SecurityAnalyzer";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";

describe("SecurityAnalyzer", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let analyzer: SecurityAnalyzer;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    analyzer = new SecurityAnalyzer(reader);

    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\n## Constraints\n- Never execute arbitrary code\n- Always validate inputs\n- Protect user data");
  });

  it("returns clean result when security file is well-structured", async () => {
    const result = await analyzer.analyze();

    expect(result.issues).toHaveLength(0);
    expect(result.compliant).toBe(true);
  });

  it("flags missing security file", async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    analyzer = new SecurityAnalyzer(reader);
    await fs.mkdir("/substrate", { recursive: true });

    const result = await analyzer.analyze();

    expect(result.compliant).toBe(false);
    expect(result.issues.some(i => i.includes("missing"))).toBe(true);
  });

  it("flags empty security file", async () => {
    await fs.writeFile("/substrate/SECURITY.md", "");

    const result = await analyzer.analyze();

    expect(result.compliant).toBe(false);
    expect(result.issues.some(i => i.includes("empty"))).toBe(true);
  });

  it("flags security file without constraints section", async () => {
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\nJust some text");

    const result = await analyzer.analyze();

    expect(result.compliant).toBe(false);
    expect(result.issues.some(i => i.includes("constraints"))).toBe(true);
  });
});
