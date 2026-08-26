import {
  buildIdPortfolioAuditRecord,
  IdPortfolioAuditInput,
  IdPortfolioAuditTrail,
  PORTFOLIO_SLOTS,
} from "../../src/evaluation/IdPortfolioAuditTrail";
import { GoalCandidate } from "../../src/agents/roles/Id";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";

function candidates(): GoalCandidate[] {
  return PORTFOLIO_SLOTS.map((portfolioSlot, index) => ({
    title: `Private candidate ${index + 1}`,
    description: `Private description ${index + 1}`,
    priority: "medium",
    confidence: 80,
    portfolioSlot,
    objectDomain: portfolioSlot.startsWith("externally") ? `external-domain-${index}` : `domain-${index}`,
    beneficiary: portfolioSlot === "non_self_referential" ? "public school librarians" : `beneficiary-${index}`,
    workSurface: portfolioSlot.startsWith("externally") ? "external" : "mixed",
    novelty: index < 2 ? "continuation" : "new_trajectory",
    challengesPremise: portfolioSlot === "contrarian",
    grounding: `classification evidence ${index}`,
    correlationId: `drive-${index}`,
  }));
}

function input(overrides: Partial<IdPortfolioAuditInput> = {}): IdPortfolioAuditInput {
  const generated = candidates();
  return {
    runId: "portfolio-run-1",
    timestamp: "2026-08-26T14:00:00.000Z",
    cycle: 203,
    launcher: "codex",
    candidates: generated,
    parseErrors: 0,
    portfolioNotesPresent: true,
    evaluations: generated.map((_, index) => ({ approved: index % 2 === 0, reason: "not persisted" })),
    planOutcome: "plan_written",
    ...overrides,
  };
}

describe("IdPortfolioAuditTrail", () => {
  it("joins generated classification, schema validity, Superego disposition, and accepted outcome by stable IDs", () => {
    const record = buildIdPortfolioAuditRecord(input());

    expect(record.schema.portfolioSchemaValid).toBe(true);
    expect(record.experimentEligible).toBe(true);
    expect(record.schema.continuationOrRepeatCount).toBe(2);
    expect(record.candidates[0]).toMatchObject({
      candidateId: "drive-0",
      stableSlotId: "portfolio-run-1/slot-1",
      declaredSlot: "externally_grounded_1",
      schemaValid: true,
      superegoDisposition: "approved",
      acceptedGoalOutcome: "written_to_plan",
    });
    expect(record.candidates[1]).toMatchObject({
      superegoDisposition: "rejected",
      acceptedGoalOutcome: "rejected",
    });
  });

  it("fails the experiment closed when stage metadata is missing", () => {
    const record = buildIdPortfolioAuditRecord(input({ evaluations: undefined }));

    expect(record.schema.portfolioSchemaValid).toBe(true);
    expect(record.stages.superegoDispositionComplete).toBe(false);
    expect(record.stages.acceptedGoalOutcomeComplete).toBe(false);
    expect(record.experimentEligible).toBe(false);
  });

  it("reports schema attrition and portfolio-cap violations without repairing them", () => {
    const generated = candidates();
    generated[1].portfolioSlot = "externally_grounded_1";
    generated[2].novelty = "continuation";
    generated[3].novelty = "repeat_check";
    generated[3].challengesPremise = false;
    generated[4].workSurface = undefined;
    const record = buildIdPortfolioAuditRecord(input({ candidates: generated }));

    expect(record.schema.portfolioSchemaValid).toBe(false);
    expect(record.schema.missingSlots).toContain("externally_grounded_2");
    expect(record.schema.duplicateSlots).toEqual(["externally_grounded_1"]);
    expect(record.schema.continuationOrRepeatCount).toBe(4);
    expect(record.schema.dominantTrajectoryCapMet).toBe(false);
    expect(record.schema.contrarianChallengesPremise).toBe(false);
    expect(record.candidates[4].schemaErrors).toContain("work_surface_invalid");
  });

  it("persists a bounded append-only record set without titles, descriptions, prompts, or evaluation reasons", async () => {
    const fs = new InMemoryFileSystem();
    const trail = new IdPortfolioAuditTrail(fs, "/data/id-portfolio-audit.jsonl", 2);
    await trail.record(input({ runId: "run-1" }));
    await trail.record(input({ runId: "run-2" }));
    await trail.record(input({ runId: "run-3" }));

    const raw = await fs.readFile("/data/id-portfolio-audit.jsonl");
    const stored = raw.trim().split("\n").map((line) => JSON.parse(line) as { runId: string });
    expect(stored.map((record) => record.runId)).toEqual(["run-1", "run-2"]);
    expect(raw).not.toContain("Private candidate");
    expect(raw).not.toContain("Private description");
    expect(raw).not.toContain("not persisted");
  });

  it("preserves corrupt prior evidence so the experiment fails closed", async () => {
    const fs = new InMemoryFileSystem();
    await fs.mkdir("/data", { recursive: true });
    await fs.writeFile("/data/id-portfolio-audit.jsonl", "corrupt\n");
    const trail = new IdPortfolioAuditTrail(fs, "/data/id-portfolio-audit.jsonl", 2);

    await trail.record(input());
    const raw = await fs.readFile("/data/id-portfolio-audit.jsonl");
    expect(raw.startsWith("corrupt\n")).toBe(true);
    expect(raw.trim().split("\n")).toHaveLength(2);
  });
});
