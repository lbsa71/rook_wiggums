/**
 * INS (Involuntary Nervous System) type definitions.
 *
 * Phase 1: Rule layer only — deterministic trigger detection, no model calls.
 * INS runs as a pre-cycle hook in LoopOrchestrator, after substrate reads
 * and before Ego.decide(). It produces an ephemeral INSResult that is
 * injected into the cycle context via pendingMessages.
 */

export interface INSResult {
  noop: boolean;
  actions: INSAction[];
}

export interface INSAction {
  type: "compaction" | "archive_tag" | "compliance_flag";
  target: string;
  detail: string;
  linesRemoved?: number;
  flaggedPattern?: string;
}

export interface INSConfig {
  /** CONVERSATION.md line threshold for compaction flag (default: 80) */
  conversationLineThreshold: number;
  /** PROGRESS.md line threshold for compaction flag (default: 200) */
  progressLineThreshold: number;
  /** MEMORY.md character threshold for summary flag (default: 120000 ≈ 30K tokens) */
  memoryCharThreshold: number;
  /** Consecutive partial results with same precondition before flagging (default: 3) */
  consecutivePartialThreshold: number;
  /** Days since last modified before a SUPERSEDED file is archive-eligible (default: 30) */
  archiveAgeDays: number;
  /** Path to compliance state directory */
  statePath: string;
  /** Path to memory directory for archive scanning */
  memoryPath: string;
}

export function defaultINSConfig(substratePath: string): INSConfig {
  return {
    conversationLineThreshold: 80,
    progressLineThreshold: 200,
    memoryCharThreshold: 120_000, // ~30K tokens at 4 chars/token
    consecutivePartialThreshold: 3,
    archiveAgeDays: 30,
    statePath: `${substratePath}/../.ins/state`,
    memoryPath: `${substratePath}/memory`,
  };
}

/** Persisted compliance state for consecutive-partial detection */
export interface ComplianceState {
  partials: Record<
    string,
    {
      count: number;
      firstCycle: number;
      lastCycle: number;
    }
  >;
  lastUpdatedCycle: number;
}

export function emptyComplianceState(): ComplianceState {
  return { partials: {}, lastUpdatedCycle: 0 };
}
