import type {
  ActorRef,
  CommitmentId,
  EvidenceRef,
} from "../../src/causal/Identifiers";
import {
  assessEvidenceGround,
  type EvidenceGroundCandidate,
  type EvidenceGroundUse,
} from "../../src/causal/commitments/EvidenceGroundingPolicy";

const commitmentA = "commitment:a" as CommitmentId;
const commitmentB = "commitment:b" as CommitmentId;
const evidenceA = `evidence:sha256:${"a".repeat(64)}` as EvidenceRef;
const evidenceB = `evidence:sha256:${"b".repeat(64)}` as EvidenceRef;
const attestation = `evidence:sha256:${"c".repeat(64)}` as EvidenceRef;

const use: EvidenceGroundUse = {
  commitmentId: commitmentA,
  purpose: "dispatch-task",
  evaluatedAt: "2026-07-19T12:00:00.000Z",
  maxAgeMs: 60 * 60 * 1000,
  requireProvenanceAttestation: true,
};

function candidate(overrides: Partial<EvidenceGroundCandidate> = {}): EvidenceGroundCandidate {
  return {
    ref: evidenceA,
    byteStatus: "resolved",
    provenance: {
      producer: "actor:loop" as ActorRef,
      capturedAt: "2026-07-19T11:30:00.000Z",
      attestationRef: attestation,
    },
    context: {
      commitmentId: commitmentA,
      purpose: "dispatch-task",
      form: "full_record",
    },
    contradictoryRefs: [],
    ...overrides,
  };
}

describe("Stage-2 EvidenceRef semantic boundary", () => {
  it("admits resolved, contextualized bytes only as unverified and non-authoritative", () => {
    expect(assessEvidenceGround(candidate(), use)).toEqual({
      admission: "admissible_unverified",
      byteStatus: "resolved",
      semanticValidity: "unassessed",
      truthValue: null,
      authority: "none",
      reasons: [],
    });
  });

  it("does not let self-asserted or unattested provenance turn resolution into validity", () => {
    const assessment = assessEvidenceGround(candidate({
      provenance: {
        producer: "actor:untrusted" as ActorRef,
        capturedAt: "2026-07-19T11:30:00.000Z",
      },
    }), use);

    expect(assessment.admission).toBe("withheld");
    expect(assessment.reasons).toContain("provenance_unattested");
    expect(assessment.truthValue).toBeNull();
  });

  it("treats even an attested provenance claim as structurally admissible, not proven true", () => {
    const assessment = assessEvidenceGround(candidate({
      provenance: {
        producer: "actor:untrusted" as ActorRef,
        capturedAt: "2026-07-19T11:30:00.000Z",
        attestationRef: evidenceB,
      },
    }), use);

    expect(assessment).toMatchObject({
      admission: "admissible_unverified",
      semanticValidity: "unassessed",
      truthValue: null,
      authority: "none",
    });
  });

  it("withholds context-stripped excerpts even when their bytes resolve", () => {
    const assessment = assessEvidenceGround(candidate({
      context: { commitmentId: commitmentA, purpose: "dispatch-task", form: "excerpt" },
    }), use);

    expect(assessment.admission).toBe("withheld");
    expect(assessment.reasons).toContain("context_source_missing");
  });

  it("withholds stale but resolvable evidence without calling it false", () => {
    const assessment = assessEvidenceGround(candidate({
      provenance: {
        producer: "actor:loop" as ActorRef,
        capturedAt: "2026-07-19T08:00:00.000Z",
        attestationRef: attestation,
      },
    }), use);

    expect(assessment).toMatchObject({
      admission: "withheld",
      byteStatus: "resolved",
      semanticValidity: "unassessed",
      truthValue: null,
      authority: "none",
    });
    expect(assessment.reasons).toContain("stale");
  });

  it("prevents replay across commitments and purposes", () => {
    const assessment = assessEvidenceGround(candidate({
      context: {
        commitmentId: commitmentB,
        purpose: "publish-message",
        form: "full_record",
        sourceRef: evidenceB,
      },
    }), use);

    expect(assessment.admission).toBe("withheld");
    expect(assessment.reasons).toEqual(expect.arrayContaining([
      "commitment_scope_mismatch",
      "purpose_scope_mismatch",
    ]));
  });

  it("marks mutually contradictory resolved refs disputed rather than choosing a truth", () => {
    const assessment = assessEvidenceGround(candidate({ contradictoryRefs: [evidenceB] }), use);

    expect(assessment).toMatchObject({
      admission: "disputed",
      semanticValidity: "disputed",
      truthValue: null,
      authority: "none",
    });
    expect(assessment.reasons).toEqual(["contradictory_evidence"]);
  });

  it.each(["missing", "corrupt", "unavailable", "quarantined", "tombstoned", "purged"] as const)(
    "keeps %s evidence unavailable and semantically neutral",
    (byteStatus) => {
      const assessment = assessEvidenceGround(candidate({ byteStatus }), use);
      expect(assessment).toMatchObject({
        admission: "withheld",
        byteStatus,
        semanticValidity: "unassessed",
        truthValue: null,
        authority: "none",
      });
      expect(assessment.reasons).toContain("bytes_not_resolved");
    },
  );
});
