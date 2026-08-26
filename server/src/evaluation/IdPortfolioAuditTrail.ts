import * as path from "node:path";
import { GoalCandidate } from "../agents/roles/Id";
import { ProposalEvaluation } from "../agents/roles/Superego";
import { IFileSystem } from "../substrate/abstractions/IFileSystem";

export const PORTFOLIO_SLOTS = [
  "externally_grounded_1",
  "externally_grounded_2",
  "non_self_referential",
  "contrarian",
  "open_1",
  "open_2",
] as const;

type PortfolioSlot = typeof PORTFOLIO_SLOTS[number];
type PlanOutcome = "plan_written" | "all_rejected" | "no_candidates" | "evaluation_failed" | "plan_write_failed";

export interface IdPortfolioAuditInput {
  runId: string;
  timestamp: string;
  cycle: number;
  launcher: string;
  candidates: GoalCandidate[];
  parseErrors: number;
  portfolioNotesPresent: boolean;
  evaluations?: ProposalEvaluation[];
  planOutcome: PlanOutcome;
}

export interface IdPortfolioCandidateAudit {
  candidateId: string;
  stableSlotId: string;
  declaredSlot: string | null;
  schemaValid: boolean;
  schemaErrors: string[];
  classification: {
    objectDomain: string | null;
    beneficiary: string | null;
    workSurface: string | null;
    novelty: string | null;
    challengesPremise: boolean | null;
    grounding: string | null;
  };
  superegoDisposition: "approved" | "rejected" | "missing" | "not_evaluated";
  acceptedGoalOutcome: "written_to_plan" | "rejected" | "approved_write_failed" | "not_accepted" | "unknown";
}

export interface IdPortfolioAuditRecord {
  version: 1;
  runId: string;
  timestamp: string;
  cycle: number;
  launcher: string;
  generation: {
    candidateCount: number;
    parseErrors: number;
    portfolioNotesPresent: boolean;
  };
  schema: {
    portfolioSchemaValid: boolean;
    candidateSchemaValidCount: number;
    missingSlots: PortfolioSlot[];
    duplicateSlots: string[];
    continuationOrRepeatCount: number;
    dominantTrajectoryCapMet: boolean;
    externalSlotsPresent: boolean;
    externalDomainsDistinct: boolean;
    nonSelfReferentialSlotPresent: boolean;
    contrarianSlotPresent: boolean;
    contrarianChallengesPremise: boolean;
  };
  stages: {
    generationComplete: boolean;
    schemaMetadataComplete: boolean;
    superegoDispositionComplete: boolean;
    acceptedGoalOutcomeComplete: boolean;
  };
  experimentEligible: boolean;
  planOutcome: PlanOutcome;
  candidates: IdPortfolioCandidateAudit[];
}

interface IdPortfolioAuditState {
  version: 1;
  records: IdPortfolioAuditRecord[];
}

export interface IIdPortfolioAuditTrail {
  record(input: IdPortfolioAuditInput): Promise<void>;
}

const PRIORITIES = new Set(["high", "medium", "low"]);
const WORK_SURFACES = new Set(["source", "substrate", "external", "mixed"]);
const NOVELTIES = new Set(["new_trajectory", "continuation", "repeat_check"]);
const SLOT_SET = new Set<string>(PORTFOLIO_SLOTS);
const MAX_CLASSIFICATION_CHARS = 512;

function boundedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  return normalized.slice(0, MAX_CLASSIFICATION_CHARS);
}

function candidateSchemaErrors(candidate: GoalCandidate): string[] {
  const errors: string[] = [];
  if (!boundedString(candidate.title)) errors.push("title_missing");
  if (!boundedString(candidate.description)) errors.push("description_missing");
  if (!PRIORITIES.has(candidate.priority)) errors.push("priority_invalid");
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100) {
    errors.push("confidence_invalid");
  }
  if (!candidate.portfolioSlot || !SLOT_SET.has(candidate.portfolioSlot)) errors.push("portfolio_slot_invalid");
  if (!boundedString(candidate.objectDomain)) errors.push("object_domain_missing");
  if (!boundedString(candidate.beneficiary)) errors.push("beneficiary_missing");
  if (!candidate.workSurface || !WORK_SURFACES.has(candidate.workSurface)) errors.push("work_surface_invalid");
  if (!candidate.novelty || !NOVELTIES.has(candidate.novelty)) errors.push("novelty_invalid");
  if (typeof candidate.challengesPremise !== "boolean") errors.push("challenges_premise_invalid");
  if (!boundedString(candidate.grounding)) errors.push("grounding_missing");
  return errors;
}

function dispositionFor(
  evaluation: ProposalEvaluation | undefined,
  planOutcome: PlanOutcome,
): Pick<IdPortfolioCandidateAudit, "superegoDisposition" | "acceptedGoalOutcome"> {
  if (!evaluation) {
    return {
      superegoDisposition: planOutcome === "evaluation_failed" ? "not_evaluated" : "missing",
      acceptedGoalOutcome: "unknown",
    };
  }
  if (!evaluation.approved) {
    return { superegoDisposition: "rejected", acceptedGoalOutcome: "rejected" };
  }
  if (planOutcome === "plan_written") {
    return { superegoDisposition: "approved", acceptedGoalOutcome: "written_to_plan" };
  }
  if (planOutcome === "plan_write_failed") {
    return { superegoDisposition: "approved", acceptedGoalOutcome: "approved_write_failed" };
  }
  return { superegoDisposition: "approved", acceptedGoalOutcome: "not_accepted" };
}

export function buildIdPortfolioAuditRecord(input: IdPortfolioAuditInput): IdPortfolioAuditRecord {
  const slotCounts = new Map<string, number>();
  for (const candidate of input.candidates) {
    if (candidate.portfolioSlot) {
      slotCounts.set(candidate.portfolioSlot, (slotCounts.get(candidate.portfolioSlot) ?? 0) + 1);
    }
  }

  const missingSlots = PORTFOLIO_SLOTS.filter((slot) => !slotCounts.has(slot));
  const duplicateSlots = [...slotCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([slot]) => slot)
    .sort();
  const continuationOrRepeatCount = input.candidates.filter(
    (candidate) => candidate.novelty === "continuation" || candidate.novelty === "repeat_check",
  ).length;

  const candidates = input.candidates.map((candidate, index): IdPortfolioCandidateAudit => {
    const schemaErrors = candidateSchemaErrors(candidate);
    return {
      candidateId: candidate.correlationId ?? `${input.runId}/candidate-${index + 1}`,
      stableSlotId: `${input.runId}/slot-${index + 1}`,
      declaredSlot: candidate.portfolioSlot ?? null,
      schemaValid: schemaErrors.length === 0,
      schemaErrors,
      classification: {
        objectDomain: boundedString(candidate.objectDomain),
        beneficiary: boundedString(candidate.beneficiary),
        workSurface: candidate.workSurface ?? null,
        novelty: candidate.novelty ?? null,
        challengesPremise: typeof candidate.challengesPremise === "boolean" ? candidate.challengesPremise : null,
        grounding: boundedString(candidate.grounding),
      },
      ...dispositionFor(input.evaluations?.[index], input.planOutcome),
    };
  });

  const externalOne = input.candidates.find((candidate) => candidate.portfolioSlot === "externally_grounded_1");
  const externalTwo = input.candidates.find((candidate) => candidate.portfolioSlot === "externally_grounded_2");
  const externalDomainsDistinct = Boolean(
    externalOne?.objectDomain
      && externalTwo?.objectDomain
      && externalOne.objectDomain.trim().toLowerCase() !== externalTwo.objectDomain.trim().toLowerCase(),
  );
  const contrarian = input.candidates.find((candidate) => candidate.portfolioSlot === "contrarian");
  const candidateSchemaValidCount = candidates.filter((candidate) => candidate.schemaValid).length;
  const exactSlotPortfolio = input.candidates.length === PORTFOLIO_SLOTS.length
    && missingSlots.length === 0
    && duplicateSlots.length === 0;
  const dominantTrajectoryCapMet = continuationOrRepeatCount <= 2;
  const contrarianChallengesPremise = contrarian?.challengesPremise === true;
  const portfolioSchemaValid = input.parseErrors === 0
    && exactSlotPortfolio
    && candidateSchemaValidCount === input.candidates.length
    && dominantTrajectoryCapMet
    && externalDomainsDistinct
    && contrarianChallengesPremise;

  const generationComplete = input.parseErrors === 0;
  const schemaMetadataComplete = input.candidates.length > 0
    && candidateSchemaValidCount === input.candidates.length;
  const superegoDispositionComplete = Boolean(input.evaluations)
    && input.evaluations?.length === input.candidates.length;
  const acceptedGoalOutcomeComplete = candidates.every(
    (candidate) => candidate.acceptedGoalOutcome !== "unknown",
  );

  return {
    version: 1,
    runId: input.runId,
    timestamp: input.timestamp,
    cycle: input.cycle,
    launcher: input.launcher,
    generation: {
      candidateCount: input.candidates.length,
      parseErrors: input.parseErrors,
      portfolioNotesPresent: input.portfolioNotesPresent,
    },
    schema: {
      portfolioSchemaValid,
      candidateSchemaValidCount,
      missingSlots,
      duplicateSlots,
      continuationOrRepeatCount,
      dominantTrajectoryCapMet,
      externalSlotsPresent: Boolean(externalOne && externalTwo),
      externalDomainsDistinct,
      nonSelfReferentialSlotPresent: slotCounts.has("non_self_referential"),
      contrarianSlotPresent: Boolean(contrarian),
      contrarianChallengesPremise,
    },
    stages: {
      generationComplete,
      schemaMetadataComplete,
      superegoDispositionComplete,
      acceptedGoalOutcomeComplete,
    },
    experimentEligible: generationComplete
      && schemaMetadataComplete
      && superegoDispositionComplete
      && acceptedGoalOutcomeComplete,
    planOutcome: input.planOutcome,
    candidates,
  };
}

export class IdPortfolioAuditTrail implements IIdPortfolioAuditTrail {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: IFileSystem,
    private readonly filePath: string,
    private readonly maxRecords = 200,
  ) {}

  record(input: IdPortfolioAuditInput): Promise<void> {
    const record = buildIdPortfolioAuditRecord(input);
    const write = this.writeChain.then(() => this.persist(record));
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  private async persist(record: IdPortfolioAuditRecord): Promise<void> {
    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    let state: IdPortfolioAuditState = { version: 1, records: [] };
    if (await this.fs.exists(this.filePath)) {
      const parsed = JSON.parse(await this.fs.readFile(this.filePath)) as IdPortfolioAuditState;
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error("Id portfolio audit state has an unsupported shape");
      }
      state = parsed;
    }
    state.records = [...state.records, record].slice(-this.maxRecords);
    const tempPath = `${this.filePath}.tmp`;
    await this.fs.writeFile(tempPath, JSON.stringify(state, null, 2));
    await this.fs.rename(tempPath, this.filePath);
  }
}
