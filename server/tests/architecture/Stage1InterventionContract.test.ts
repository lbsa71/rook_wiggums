import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import baseline from "./fixtures/current-runtime-causal-baseline.json";
import evidenceFixture from "./fixtures/evidence-ref-security-cases.json";
import { EvidenceRefRegistry } from "../../src/causal/EvidenceRefRegistry";
import type { EvidenceRef } from "../../src/causal/Identifiers";

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

async function runStage0(stage1?: EvidenceRefRegistry): Promise<Stage0Run> {
  const outcomeBytes = checkedInStage0OutcomeBytes();
  const evidenceRefs: EvidenceRef[] = [];
  if (stage1) {
    for (const bytes of outcomeBytes) {
      const registered = await stage1.register("application/json", bytes);
      if (registered.status !== "registered" && registered.status !== "already_registered") {
        throw new Error(`Stage-1 observation failed: ${registered.status}`);
      }
      evidenceRefs.push(registered.ref);
    }
  }

  // The sidecar receives a copy. Production outcome bytes remain the return
  // value and never depend on registration success, refs, or registry state.
  return { outcomeBytes, evidenceRefs };
}

async function acceptPlannedStage2Grounds(
  grounds: unknown,
  registry: EvidenceRefRegistry,
): Promise<EvidenceRef[]> {
  if (!Array.isArray(grounds) || grounds.length === 0) {
    throw new Error("grounds must contain at least one EvidenceRef");
  }

  const refs: EvidenceRef[] = [];
  for (const candidate of grounds) {
    if (typeof candidate !== "string") {
      throw new Error("free-form grounds are forbidden; use EvidenceRef");
    }
    const resolution = await registry.resolve(candidate);
    if (resolution.status === "rejected") {
      throw new Error("free-form grounds are forbidden; use EvidenceRef");
    }
    if (resolution.status !== "resolved") {
      throw new Error(`unresolvable EvidenceRef: ${candidate}`);
    }
    refs.push(resolution.ref);
  }
  return refs;
}

describe("Stage-1 causal-neutrality and structural-necessity intervention", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "rook-stage1-intervention-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("leaves all seven checked-in Stage-0 production outcomes byte-equivalent", async () => {
    const withoutStage1 = await runStage0();
    const registry = new EvidenceRefRegistry(root);
    const withStage1 = await runStage0(registry);

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

  it("makes resolvable EvidenceRefs necessary at the planned Stage-2 ledger boundary", async () => {
    const registry = new EvidenceRefRegistry(root);
    const { evidenceRefs } = await runStage0(registry);
    const missingRef = evidenceFixture.missing.ref;

    await expect(acceptPlannedStage2Grounds(["PLAN says this is justified"], registry))
      .rejects.toThrow("free-form grounds are forbidden");
    await expect(acceptPlannedStage2Grounds([missingRef], registry))
      .rejects.toThrow("unresolvable EvidenceRef");
    await expect(acceptPlannedStage2Grounds([evidenceRefs[0]], registry))
      .resolves.toEqual([evidenceRefs[0]]);
  });

  it("does not grant Stage 1 authority or epistemic semantics", () => {
    const registry = new EvidenceRefRegistry(root);

    expect("authorize" in registry).toBe(false);
    expect("decideTruth" in registry).toBe(false);
    expect("dispatch" in registry).toBe(false);
  });
});
