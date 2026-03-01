import { ComplianceStateManager } from "../../../src/loop/ins/ComplianceStateManager";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { InMemoryLogger } from "../../../src/logging";

describe("ComplianceStateManager", () => {
  let fs: InMemoryFileSystem;
  let logger: InMemoryLogger;
  const statePath = "/substrate/.ins/state";

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    logger = new InMemoryLogger();
  });

  it("starts fresh when file does not exist", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const state = mgr.getState();
    expect(state.partials).toEqual({});
    expect(state.lastUpdatedCycle).toBe(0);
  });

  it("loads from existing compliance.json", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, JSON.stringify({
      partials: {
        "waiting for approval": { count: 2, firstCycle: 10, lastCycle: 12 },
      },
      lastUpdatedCycle: 12,
    }));

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    expect(mgr.getPartialCount("waiting for approval")).toBe(2);
  });

  it("handles corrupted JSON gracefully — starts fresh", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, "not valid json{{{");

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    expect(mgr.getPartialCount("anything")).toBe(0);
  });

  it("records partial and increments count", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordPartial("blocked by API", 5);
    expect(mgr.getPartialCount("blocked by API")).toBe(1);

    mgr.recordPartial("blocked by API", 6);
    expect(mgr.getPartialCount("blocked by API")).toBe(2);

    mgr.recordPartial("blocked by API", 7);
    expect(mgr.getPartialCount("blocked by API")).toBe(3);
  });

  it("tracks different preconditions independently", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordPartial("blocked by A", 1);
    mgr.recordPartial("blocked by B", 2);
    mgr.recordPartial("blocked by A", 3);

    expect(mgr.getPartialCount("blocked by A")).toBe(2);
    expect(mgr.getPartialCount("blocked by B")).toBe(1);
  });

  it("clears partial counter", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordPartial("waiting for Stefan", 1);
    mgr.recordPartial("waiting for Stefan", 2);
    expect(mgr.getPartialCount("waiting for Stefan")).toBe(2);

    mgr.clearPartial("waiting for Stefan");
    expect(mgr.getPartialCount("waiting for Stefan")).toBe(0);
  });

  it("clearAll removes all tracked partials", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordPartial("a", 1);
    mgr.recordPartial("b", 2);
    mgr.clearAll();
    expect(mgr.getPartialCount("a")).toBe(0);
    expect(mgr.getPartialCount("b")).toBe(0);
  });

  it("saves to disk when dirty", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordPartial("test", 1);
    expect(mgr.isDirty()).toBe(true);

    await mgr.save();
    expect(mgr.isDirty()).toBe(false);

    const raw = await fs.readFile(`${statePath}/compliance.json`);
    const saved = JSON.parse(raw);
    expect(saved.partials["test"].count).toBe(1);
  });

  it("does not write when not dirty", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    await mgr.save(); // Should be a no-op

    // File should not exist since nothing was written
    const exists = await fs.exists(`${statePath}/compliance.json`);
    expect(exists).toBe(false);
  });

  it("creates directory structure on first save", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordPartial("test", 1);
    await mgr.save();

    const exists = await fs.exists(`${statePath}/compliance.json`);
    expect(exists).toBe(true);
  });

  it("survives restart — loads persisted state", async () => {
    // Write state
    const mgr1 = await ComplianceStateManager.load(statePath, fs, logger);
    mgr1.recordPartial("blocked by review", 10);
    mgr1.recordPartial("blocked by review", 11);
    await mgr1.save();

    // Load state in new manager (simulating restart)
    const mgr2 = await ComplianceStateManager.load(statePath, fs, logger);
    expect(mgr2.getPartialCount("blocked by review")).toBe(2);
  });

  it("handles invalid partials field gracefully", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, JSON.stringify({
      partials: null,
      lastUpdatedCycle: 5,
    }));

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    expect(mgr.getPartialCount("anything")).toBe(0);
  });
});
