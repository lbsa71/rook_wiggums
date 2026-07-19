import type {
  ActorRef,
  CommitmentId,
  EvidenceRef,
} from "../Identifiers";

/**
 * Byte availability is deliberately separate from evidentiary admissibility.
 * The lifecycle-only states are specified here before the registry implements
 * quarantine/tombstone handling so consumers cannot collapse them into false.
 */
export type EvidenceByteStatus =
  | "resolved"
  | "missing"
  | "corrupt"
  | "rejected"
  | "unavailable"
  | "quarantined"
  | "tombstoned"
  | "purged";

export interface EvidenceProvenanceClaim {
  producer: ActorRef;
  capturedAt: string;
  /** A separate attestation may authenticate provenance; possession of it does not prove truth. */
  attestationRef?: EvidenceRef;
}

export interface EvidenceContextBinding {
  commitmentId: CommitmentId;
  purpose: string;
  form: "full_record" | "excerpt";
  /** Required for excerpts so context stripping remains visible. */
  sourceRef?: EvidenceRef;
}

export interface EvidenceGroundCandidate {
  ref: EvidenceRef;
  byteStatus: EvidenceByteStatus;
  provenance: EvidenceProvenanceClaim | null;
  context: EvidenceContextBinding | null;
  /** Declared contradictions are set-level evidence, never registry truth judgments. */
  contradictoryRefs: readonly EvidenceRef[];
}

export interface EvidenceGroundUse {
  commitmentId: CommitmentId;
  purpose: string;
  evaluatedAt: string;
  maxAgeMs: number;
  requireProvenanceAttestation: boolean;
}

export type EvidenceGroundingReason =
  | "bytes_not_resolved"
  | "provenance_missing"
  | "provenance_unattested"
  | "invalid_capture_time"
  | "context_missing"
  | "context_source_missing"
  | "commitment_scope_mismatch"
  | "purpose_scope_mismatch"
  | "stale"
  | "contradictory_evidence";

export interface EvidenceGroundingAssessment {
  admission: "admissible_unverified" | "disputed" | "withheld";
  byteStatus: EvidenceByteStatus;
  semanticValidity: "unassessed" | "disputed";
  truthValue: null;
  authority: "none";
  reasons: EvidenceGroundingReason[];
}

/**
 * Consumer-side structural admission policy for shadow-ledger grounds.
 *
 * This function never inspects or interprets payload meaning and cannot return
 * truth, confidence, authorization, or an execution decision. It merely stops
 * `resolved` from being treated as synonymous with valid evidence-for-this-use.
 */
export function assessEvidenceGround(
  candidate: EvidenceGroundCandidate,
  use: EvidenceGroundUse,
): EvidenceGroundingAssessment {
  const reasons: EvidenceGroundingReason[] = [];

  if (candidate.byteStatus !== "resolved") reasons.push("bytes_not_resolved");
  if (!candidate.provenance) {
    reasons.push("provenance_missing");
  } else {
    if (use.requireProvenanceAttestation && !candidate.provenance.attestationRef) {
      reasons.push("provenance_unattested");
    }
    const capturedAt = Date.parse(candidate.provenance.capturedAt);
    const evaluatedAt = Date.parse(use.evaluatedAt);
    if (!Number.isFinite(capturedAt) || !Number.isFinite(evaluatedAt)) {
      reasons.push("invalid_capture_time");
    } else if (evaluatedAt - capturedAt > use.maxAgeMs) {
      reasons.push("stale");
    }
  }

  if (!candidate.context) {
    reasons.push("context_missing");
  } else {
    if (candidate.context.form === "excerpt" && !candidate.context.sourceRef) {
      reasons.push("context_source_missing");
    }
    if (candidate.context.commitmentId !== use.commitmentId) {
      reasons.push("commitment_scope_mismatch");
    }
    if (candidate.context.purpose !== use.purpose) reasons.push("purpose_scope_mismatch");
  }

  if (candidate.contradictoryRefs.length > 0) reasons.push("contradictory_evidence");

  const disputed = reasons.includes("contradictory_evidence");
  const blockingReasons = reasons.filter((reason) => reason !== "contradictory_evidence");
  return {
    admission: blockingReasons.length > 0 ? "withheld" : disputed ? "disputed" : "admissible_unverified",
    byteStatus: candidate.byteStatus,
    semanticValidity: disputed ? "disputed" : "unassessed",
    truthValue: null,
    authority: "none",
    reasons,
  };
}
