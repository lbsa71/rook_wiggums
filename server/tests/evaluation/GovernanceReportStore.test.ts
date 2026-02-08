import { GovernanceReportStore } from "../../src/evaluation/GovernanceReportStore";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";

describe("GovernanceReportStore", () => {
  let fs: InMemoryFileSystem;
  let clock: FixedClock;
  let store: GovernanceReportStore;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    clock = new FixedClock(new Date("2025-06-15T10:00:00.000Z"));
    store = new GovernanceReportStore(fs, "/substrate/reports", clock);
    await fs.mkdir("/substrate/reports", { recursive: true });
  });

  it("saves a report as timestamped JSON", async () => {
    const report = {
      findings: [{ severity: "info" as const, message: "All good" }],
      proposalEvaluations: [],
      summary: "Clean audit",
    };

    await store.save(report);

    const content = await fs.readFile("/substrate/reports/2025-06-15T10-00-00.000Z.json");
    const parsed = JSON.parse(content);
    expect(parsed.summary).toBe("Clean audit");
    expect(parsed.timestamp).toBe("2025-06-15T10:00:00.000Z");
  });

  it("lists reports in reverse chronological order", async () => {
    clock.setNow(new Date("2025-06-15T10:00:00.000Z"));
    await store.save({ findings: [], proposalEvaluations: [], summary: "First" });

    clock.setNow(new Date("2025-06-15T11:00:00.000Z"));
    await store.save({ findings: [], proposalEvaluations: [], summary: "Second" });

    const reports = await store.list();

    expect(reports).toHaveLength(2);
    expect(reports[0].summary).toBe("Second");
    expect(reports[1].summary).toBe("First");
  });

  it("returns the latest report", async () => {
    clock.setNow(new Date("2025-06-15T10:00:00.000Z"));
    await store.save({ findings: [], proposalEvaluations: [], summary: "First" });

    clock.setNow(new Date("2025-06-15T11:00:00.000Z"));
    await store.save({ findings: [], proposalEvaluations: [], summary: "Latest" });

    const latest = await store.latest();

    expect(latest).not.toBeNull();
    expect(latest!.summary).toBe("Latest");
  });

  it("returns null when no reports exist", async () => {
    const latest = await store.latest();
    expect(latest).toBeNull();
  });

  it("returns empty list when no reports exist", async () => {
    const reports = await store.list();
    expect(reports).toHaveLength(0);
  });

  it("includes drift, consistency, and security analysis in saved report", async () => {
    const report = {
      findings: [{ severity: "warning" as const, message: "Drift detected" }],
      proposalEvaluations: [],
      summary: "Issues found",
      driftScore: 0.7,
      consistencyIssues: ["PLAN vs SKILLS mismatch"],
      securityCompliant: false,
    };

    await store.save(report);

    const content = await fs.readFile("/substrate/reports/2025-06-15T10-00-00.000Z.json");
    const parsed = JSON.parse(content);
    expect(parsed.driftScore).toBe(0.7);
    expect(parsed.consistencyIssues).toEqual(["PLAN vs SKILLS mismatch"]);
    expect(parsed.securityCompliant).toBe(false);
  });
});
