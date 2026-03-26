import { parseRejections, buildRejectionConstraints } from "../../../src/agents/parsers/ProgressRejectionReader";

describe("parseRejections", () => {
  it("extracts a single rejection entry from PROGRESS.md content", () => {
    const raw = "[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Violates core values";
    const entries = parseRejections(raw);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      timestamp: "2026-03-26T08:00:00.000Z",
      target: "HABITS",
      reason: "Violates core values",
    });
  });

  it("extracts multiple rejection entries", () => {
    const raw = [
      "[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Violates core values",
      "[2026-03-26T09:00:00.000Z] [SUPEREGO] Proposal for SECURITY rejected: Bypasses permission check",
    ].join("\n");

    const entries = parseRejections(raw);

    expect(entries).toHaveLength(2);
    expect(entries[0].target).toBe("SECURITY");
    expect(entries[1].target).toBe("HABITS");
    expect(entries[0].reason).toBe("Bypasses permission check");
  });

  it("ignores non-rejection SUPEREGO entries", () => {
    const raw = [
      "[2026-03-26T08:00:00.000Z] [SUPEREGO] Audit complete: all checks passed",
      "[2026-03-26T08:01:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Bad content",
    ].join("\n");

    const entries = parseRejections(raw);

    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe("HABITS");
  });

  it("ignores entries from other agents", () => {
    const raw = [
      "[2026-03-26T08:00:00.000Z] [SUBCONSCIOUS] Proposal for HABITS rejected: something",
      "[2026-03-26T08:01:00.000Z] [EGO] Proposal for SECURITY rejected: something",
    ].join("\n");

    const entries = parseRejections(raw);

    expect(entries).toHaveLength(0);
  });

  it("ignores header and blank lines", () => {
    const raw = "# Progress\n\n[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Bad";
    const entries = parseRejections(raw);

    expect(entries).toHaveLength(1);
  });

  it("returns empty array when PROGRESS.md has no rejections", () => {
    const raw = "# Progress\n\n[2026-03-26T08:00:00.000Z] [EGO] Completed task successfully";
    expect(parseRejections(raw)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(parseRejections("")).toHaveLength(0);
  });

  it("returns only the N most recent entries when limit is set", () => {
    const raw = [
      "[2026-03-26T07:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Old reason",
      "[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for SECURITY rejected: Mid reason",
      "[2026-03-26T09:00:00.000Z] [SUPEREGO] Proposal for PRIVACY rejected: New reason",
    ].join("\n");

    const entries = parseRejections(raw, { limit: 2 });

    expect(entries).toHaveLength(2);
    expect(entries[0].target).toBe("PRIVACY");
    expect(entries[1].target).toBe("SECURITY");
  });

  it("excludes older entries beyond the limit", () => {
    const raw = [
      "[2026-03-26T07:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Old reason",
      "[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for SECURITY rejected: Mid reason",
      "[2026-03-26T09:00:00.000Z] [SUPEREGO] Proposal for PRIVACY rejected: New reason",
    ].join("\n");

    const entries = parseRejections(raw, { limit: 2 });

    expect(entries.map((e) => e.target)).not.toContain("HABITS");
  });

  it("respects a configurable limit value", () => {
    const targets = ["HABITS", "SECURITY", "PRIVACY", "MEMORY", "SKILLS", "FINANCE", "HEALTH", "SOCIAL", "FOCUS", "GOALS"];
    const lines = targets.map((t, i) =>
      `[2026-03-26T0${i}:00:00.000Z] [SUPEREGO] Proposal for ${t} rejected: Reason ${i}`
    );
    const entries = parseRejections(lines.join("\n"), { limit: 3 });

    expect(entries).toHaveLength(3);
  });

  it("returns all entries when fewer exist than the limit", () => {
    const raw = "[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Some reason";
    const entries = parseRejections(raw, { limit: 5 });

    expect(entries).toHaveLength(1);
  });

  it("returns entries sorted by timestamp descending when no limit is set", () => {
    const raw = [
      "[2026-03-26T07:00:00.000Z] [SUPEREGO] Proposal for HABITS rejected: Old",
      "[2026-03-26T09:00:00.000Z] [SUPEREGO] Proposal for PRIVACY rejected: New",
      "[2026-03-26T08:00:00.000Z] [SUPEREGO] Proposal for SECURITY rejected: Mid",
    ].join("\n");

    const entries = parseRejections(raw);

    expect(entries[0].target).toBe("PRIVACY");
    expect(entries[1].target).toBe("SECURITY");
    expect(entries[2].target).toBe("HABITS");
  });
});

describe("buildRejectionConstraints", () => {
  it("returns empty string for empty rejections array", () => {
    expect(buildRejectionConstraints([])).toBe("");
  });

  it("builds a constraint block for a single rejection", () => {
    const result = buildRejectionConstraints([
      { timestamp: "2026-03-26T08:00:00.000Z", target: "HABITS", reason: "Violates core values" },
    ]);

    expect(result).toContain("[PRIOR REJECTION CONSTRAINTS]");
    expect(result).toContain("HABITS: Violates core values");
    expect(result).toContain("Do not repeat these patterns");
  });

  it("lists all rejections in the constraint block", () => {
    const result = buildRejectionConstraints([
      { timestamp: "2026-03-26T08:00:00.000Z", target: "HABITS", reason: "Reason A" },
      { timestamp: "2026-03-26T09:00:00.000Z", target: "SECURITY", reason: "Reason B" },
    ]);

    expect(result).toContain("- HABITS: Reason A");
    expect(result).toContain("- SECURITY: Reason B");
  });
});
