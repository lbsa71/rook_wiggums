import { DelegationTracker } from "../../src/evaluation/DelegationTracker";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";

describe("DelegationTracker", () => {
  let fs: InMemoryFileSystem;
  let clock: FixedClock;
  let tracker: DelegationTracker;

  const substratePath = "/substrate";

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    clock = new FixedClock(new Date("2026-06-21T12:00:00Z"));
    tracker = new DelegationTracker(fs, clock, substratePath);
  });

  it("records provider-neutral delegated issue counts", async () => {
    await tracker.recordDelegationRatio(8, 10, "pi");

    const latest = await tracker.getLatestEntry();
    expect(latest).not.toBeNull();
    expect(latest!.delegated_issues).toBe(8);
    expect(latest!.delegate_label).toBe("pi");
    expect(latest!.delegation_ratio).toBe(0.8);

    const status = await tracker.getDelegationStatus();
    expect(status).toMatchObject({
      ratio: 0.8,
      delegated_issues: 8,
      total_issues: 10,
      delegate_label: "pi",
      target_ratio: 0.8,
      status: "OK",
    });
  });

  it("normalizes legacy copilot_issues metric rows without losing compatibility", async () => {
    await fs.mkdir(`${substratePath}/.metrics`, { recursive: true });
    await fs.writeFile(
      `${substratePath}/.metrics/delegation_ratio.jsonl`,
      JSON.stringify({
        timestamp: "2026-06-21T12:00:00.000Z",
        copilot_issues: 3,
        total_coding_issues: 10,
        delegation_ratio: 0.3,
        week_start: "2026-06-15T00:00:00.000Z",
      }) + "\n"
    );

    const latest = await tracker.getLatestEntry();
    expect(latest).not.toBeNull();
    expect(latest!.delegated_issues).toBe(3);
    expect(latest!.copilot_issues).toBe(3);
    expect(latest!.delegate_label).toBe("copilot_legacy");

    const status = await tracker.getDelegationStatus();
    expect(status?.delegated_issues).toBe(3);
    expect(status?.copilot_issues).toBe(3);
    expect(status?.status).toBe("CRITICAL");
  });
});
