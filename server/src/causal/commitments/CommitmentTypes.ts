import type {
  ActionId,
  ActorRef,
  CausalRecordId,
  CommitmentId,
  EvidenceRef,
  ReceiptId,
  RecordVersion,
  TransitionId,
} from "../Identifiers";

export type ShadowProjectedState =
  | "proposed"
  | "endorsed"
  | "committed"
  | "deferred"
  | "suspended"
  | "vetoed"
  | "expired"
  | "revoked";

export type ObservedAuthorityPath =
  | "id"
  | "superego"
  | "plan"
  | "loop_dispatch"
  | "tool"
  | "governed_proposal";

export interface ShadowCommitmentTransition {
  kind: "shadow_commitment_transition";
  schemaVersion: 1;
  transitionId: TransitionId;
  commitmentId: CommitmentId;
  expectedVersion: RecordVersion;
  resultingVersion: RecordVersion;
  from: ShadowProjectedState | null;
  to: ShadowProjectedState;
  owner: ActorRef;
  observedActor: ActorRef;
  observedAuthorityPath: ObservedAuthorityPath;
  grounds: EvidenceRef[];
  revisionAuthority: ActorRef[];
  expiryAt?: string;
  observedAt: string;
  provenance: CausalRecordId[];
  shadowOnly: true;
}

export type ShadowEffectPhase =
  | "execution_observed"
  | "effect_observed"
  | "receipt_linked"
  | "effect_failed"
  | "effect_ambiguous";

export interface ShadowEffectObservation {
  kind: "shadow_effect_observation";
  schemaVersion: 1;
  observationId: CausalRecordId;
  commitmentId?: CommitmentId;
  actionId?: ActionId;
  receiptId?: ReceiptId;
  phase: ShadowEffectPhase;
  observedAt: string;
  observedAuthorityPath: ObservedAuthorityPath;
  parametersHash?: string;
  preimageHash?: string;
  postimageHash?: string;
  evidence: EvidenceRef[];
  provenance: CausalRecordId[];
  shadowOnly: true;
}

export type ShadowLedgerEvent = ShadowCommitmentTransition | ShadowEffectObservation;

export type ShadowDiagnosticCode =
  | "invalid_transition"
  | "version_conflict"
  | "actor_violation"
  | "duplicate_conflict"
  | "orphan_evidence"
  | "bypass_observation"
  | "temporal_ambiguity"
  | "corrupt_store"
  | "write_failed";

export interface ShadowDiagnostic {
  code: ShadowDiagnosticCode;
  eventId: string;
  commitmentId?: CommitmentId;
  detail: string;
}

export interface ShadowCommitmentSnapshot {
  commitmentId: CommitmentId;
  version: RecordVersion;
  shadowProjectedState: ShadowProjectedState;
  owner: ActorRef;
  lastTransitionId: TransitionId;
  executionObserved: boolean;
}

export interface ShadowReplayResult {
  commitments: Map<CommitmentId, ShadowCommitmentSnapshot>;
  diagnostics: ShadowDiagnostic[];
  eventPayloads: Map<string, string>;
}

export interface ShadowLedgerHealth {
  schemaVersion: 1;
  authority: "none-shadow-only";
  totalEvents: number;
  commitmentsByState: Partial<Record<ShadowProjectedState, number>>;
  diagnosticsByCode: Partial<Record<ShadowDiagnosticCode, number>>;
  lastValidEventId: string | null;
  lastValidEventAt: string | null;
  derivedStateChecksum: string;
}
