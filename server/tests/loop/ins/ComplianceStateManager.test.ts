import { ComplianceStateManager } from "../../../src/loop/ins/ComplianceStateManager";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { InMemoryLogger } from "../../../src/logging";
import { InsAcknowledgment } from "../../../src/loop/ins/types";

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
    expect(state.patterns).toEqual([]);
    expect(state.lastUpdatedCycle).toBe(0);
  });

  it("loads from existing Phase 3 compliance.json", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, JSON.stringify({
      patterns: [
        {
          patternId: "consecutive-partial::task-1",
          role: "Subconscious",
          patternText: "waiting for approval",
          cyclesCount: 2,
          firstSeenCycle: 10,
          lastSeenCycle: 12,
          taskId: "task-1",
        },
      ],
      lastUpdatedCycle: 12,
    }));

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const pattern = mgr.findPattern("consecutive-partial::task-1");
    expect(pattern).toBeDefined();
    expect(pattern!.cyclesCount).toBe(2);
  });

  it("migrates Phase 1 compliance.json to fresh state", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, JSON.stringify({
      partials: {
        "waiting for approval": { count: 2, firstCycle: 10, lastCycle: 12 },
      },
      lastUpdatedCycle: 12,
    }));

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const state = mgr.getState();
    // Migrated to fresh state — no patterns
    expect(state.patterns).toHaveLength(0);
  });

  it("handles corrupted JSON gracefully — starts fresh", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, "not valid json{{{");

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const state = mgr.getState();
    expect(state.patterns).toHaveLength(0);
  });

  it("recordOrUpdatePattern creates new pattern", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const pattern = mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "blocked by API", 5, "task-1");
    expect(pattern.cyclesCount).toBe(1);
    expect(pattern.firstSeenCycle).toBe(5);
    expect(pattern.lastSeenCycle).toBe(5);
    expect(pattern.role).toBe("Subconscious");
    expect(mgr.isDirty()).toBe(true);
  });

  it("recordOrUpdatePattern increments existing pattern", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "blocked by API", 5, "task-1");
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "blocked by API", 6, "task-1");
    const pattern = mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "blocked by API", 7, "task-1");
    expect(pattern.cyclesCount).toBe(3);
    expect(pattern.firstSeenCycle).toBe(5);
    expect(pattern.lastSeenCycle).toBe(7);
  });

  it("tracks different patternIds independently", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordOrUpdatePattern("consecutive-partial::task-A", "Subconscious", "blocked by A", 1, "task-A");
    mgr.recordOrUpdatePattern("consecutive-partial::task-B", "Subconscious", "blocked by B", 2, "task-B");
    mgr.recordOrUpdatePattern("consecutive-partial::task-A", "Subconscious", "blocked by A", 3, "task-A");

    const patternA = mgr.findPattern("consecutive-partial::task-A");
    const patternB = mgr.findPattern("consecutive-partial::task-B");
    expect(patternA!.cyclesCount).toBe(2);
    expect(patternB!.cyclesCount).toBe(1);
  });

  it("clearPattern removes a specific pattern", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "waiting for Stefan", 1, "task-1");
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "waiting for Stefan", 2, "task-1");
    expect(mgr.findPattern("consecutive-partial::task-1")).toBeDefined();

    mgr.clearPattern("consecutive-partial::task-1");
    expect(mgr.findPattern("consecutive-partial::task-1")).toBeUndefined();
  });

  it("clearAll removes all tracked patterns", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordOrUpdatePattern("consecutive-partial::a", "Subconscious", "a", 1);
    mgr.recordOrUpdatePattern("consecutive-partial::b", "Subconscious", "b", 2);
    mgr.clearAll();
    expect(mgr.findPattern("consecutive-partial::a")).toBeUndefined();
    expect(mgr.findPattern("consecutive-partial::b")).toBeUndefined();
    expect(mgr.getState().patterns).toHaveLength(0);
  });

  it("saves to disk when dirty", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "test", 1, "task-1");
    expect(mgr.isDirty()).toBe(true);

    await mgr.save();
    expect(mgr.isDirty()).toBe(false);

    const raw = await fs.readFile(`${statePath}/compliance.json`);
    const saved = JSON.parse(raw);
    expect(saved.patterns[0].patternId).toBe("consecutive-partial::task-1");
    expect(saved.patterns[0].cyclesCount).toBe(1);
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
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "test", 1);
    await mgr.save();

    const exists = await fs.exists(`${statePath}/compliance.json`);
    expect(exists).toBe(true);
  });

  it("survives restart — loads persisted Phase 3 state", async () => {
    const mgr1 = await ComplianceStateManager.load(statePath, fs, logger);
    mgr1.recordOrUpdatePattern("consecutive-partial::task-review", "Subconscious", "blocked by review", 10, "task-review");
    mgr1.recordOrUpdatePattern("consecutive-partial::task-review", "Subconscious", "blocked by review", 11, "task-review");
    await mgr1.save();

    const mgr2 = await ComplianceStateManager.load(statePath, fs, logger);
    const pattern = mgr2.findPattern("consecutive-partial::task-review");
    expect(pattern).toBeDefined();
    expect(pattern!.cyclesCount).toBe(2);
  });

  it("applyAcknowledgment sets acknowledgment fields with 7-day TTL", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    mgr.recordOrUpdatePattern("consecutive-partial::task-1", "Subconscious", "blocked", 1, "task-1");

    const now = new Date("2026-03-01T12:00:00.000Z");
    const ack: InsAcknowledgment = { patternId: "consecutive-partial::task-1", verdict: "real_constraint", taskStatus: "deferred" };
    mgr.applyAcknowledgment("consecutive-partial::task-1", ack, now);

    const pattern = mgr.findPattern("consecutive-partial::task-1");
    expect(pattern!.acknowledged).toBe(true);
    expect(pattern!.acknowledgedVerdict).toBe("real_constraint");
    expect(pattern!.acknowledgedTaskStatus).toBe("deferred");
    // TTL should be 7 days from now
    expect(pattern!.acknowledgedTTL).toBe("2026-03-08T12:00:00.000Z");
    expect(mgr.isDirty()).toBe(true);
  });

  it("applyAcknowledgment is a no-op for unknown patternId", async () => {
    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const now = new Date("2026-03-01T12:00:00.000Z");
    const ack: InsAcknowledgment = { patternId: "nonexistent", verdict: "real_constraint" };

    // Should not throw
    mgr.applyAcknowledgment("nonexistent", ack, now);
    expect(mgr.isDirty()).toBe(false);
  });

  it("handles invalid patterns field gracefully", async () => {
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(`${statePath}/compliance.json`, JSON.stringify({
      patterns: null,
      lastUpdatedCycle: 5,
    }));

    const mgr = await ComplianceStateManager.load(statePath, fs, logger);
    const state = mgr.getState();
    expect(state.patterns).toHaveLength(0);
  });
});
