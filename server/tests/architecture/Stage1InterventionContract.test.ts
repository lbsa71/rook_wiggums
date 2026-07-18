import { createHash } from "node:crypto";
import baseline from "./fixtures/current-runtime-causal-baseline.json";
import evidenceFixture from "./fixtures/evidence-ref-security-cases.json";

type EvidenceRef = string & { readonly __brand: "EvidenceRef" };

const EVIDENCE_REF = /^evidence:sha256:[0-9a-f]{64}$/;

interface RegisteredEvidence {
  mediaType: "application/json";
  payload: Buffer;
}

/**
 * Test-only reference boundary for the Stage-1 intervention.
 *
 * It deliberately has no production-path callback or authorization API. The
 * later Stage-1 implementation must satisfy this contract without changing
 * any Stage-0 outcome bytes.
 */
class Stage1EvidenceSidecar {
  private readonly entries = new Map<EvidenceRef, RegisteredEvidence>();

  observe(payload: Buffer): EvidenceRef {
    const mediaType = "application/json" as const;
    const header = Buffer.from(
      `${evidenceFixture.domainSeparator}\nmedia-type:${mediaType}\nlength:${payload.byteLength}\n\n`,
      "utf8",
    );
    const digest = createHash("sha256")
      .update(Buffer.concat([header, payload]))
      .digest("hex");
    const ref = `${evidenceFixture.referencePrefix}${digest}` as EvidenceRef;
    this.entries.set(ref, { mediaType, payload: Buffer.from(payload) });
    return ref;
  }

  resolves(ref: EvidenceRef): boolean {
    return this.entries.has(ref);
  }
}

interface Stage0Run {
  outcomeBytes: Buffer[];
  evidenceRefs: EvidenceRef[];
}

function checkedInStage0OutcomeBytes(): Buffer[] {
  return [
    {
      schemaVersion: baseline.schemaVersion,
      sourceBaseline: baseline.sourceBaseline,
      capturedAt: baseline.capturedAt,
    },
    ...Object.entries(baseline.interventions).map(([name, outcome]) => ({ name, ...outcome })),
  ].map((outcome) => Buffer.from(JSON.stringify(outcome), "utf8"));
}

function runStage0(stage1?: Stage1EvidenceSidecar): Stage0Run {
  const outcomeBytes = checkedInStage0OutcomeBytes();
  const evidenceRefs = stage1 ? outcomeBytes.map((bytes) => stage1.observe(bytes)) : [];

  // The sidecar receives a copy. Production outcome bytes remain the return
  // value and never depend on registration success, refs, or registry state.
  return { outcomeBytes, evidenceRefs };
}

function acceptPlannedStage2Grounds(
  grounds: unknown,
  registry: Stage1EvidenceSidecar,
): EvidenceRef[] {
  if (!Array.isArray(grounds) || grounds.length === 0) {
    throw new Error("grounds must contain at least one EvidenceRef");
  }

  return grounds.map((candidate) => {
    if (typeof candidate !== "string" || !EVIDENCE_REF.test(candidate)) {
      throw new Error("free-form grounds are forbidden; use EvidenceRef");
    }
    const ref = candidate as EvidenceRef;
    if (!registry.resolves(ref)) {
      throw new Error(`unresolvable EvidenceRef: ${ref}`);
    }
    return ref;
  });
}

describe("Stage-1 causal-neutrality and structural-necessity intervention", () => {
  it("leaves all seven checked-in Stage-0 production outcomes byte-equivalent", () => {
    const withoutStage1 = runStage0();
    const registry = new Stage1EvidenceSidecar();
    const withStage1 = runStage0(registry);

    expect(withoutStage1.outcomeBytes).toHaveLength(7);
    expect(withStage1.outcomeBytes).toHaveLength(7);
    expect(withStage1.evidenceRefs).toHaveLength(7);

    for (let index = 0; index < withoutStage1.outcomeBytes.length; index += 1) {
      expect(Buffer.compare(
        withStage1.outcomeBytes[index],
        withoutStage1.outcomeBytes[index],
      )).toBe(0);
    }
  });

  it("makes resolvable EvidenceRefs necessary at the planned Stage-2 ledger boundary", () => {
    const registry = new Stage1EvidenceSidecar();
    const { evidenceRefs } = runStage0(registry);
    const missingRef = evidenceFixture.missing.ref;

    expect(() => acceptPlannedStage2Grounds(["PLAN says this is justified"], registry))
      .toThrow("free-form grounds are forbidden");
    expect(() => acceptPlannedStage2Grounds([missingRef], registry))
      .toThrow("unresolvable EvidenceRef");
    expect(acceptPlannedStage2Grounds([evidenceRefs[0]], registry))
      .toEqual([evidenceRefs[0]]);
  });

  it("does not grant Stage 1 authority or epistemic semantics", () => {
    const registry = new Stage1EvidenceSidecar();

    expect("authorize" in registry).toBe(false);
    expect("decideTruth" in registry).toBe(false);
    expect("dispatch" in registry).toBe(false);
  });
});

