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

interface NonBlockingStage0Run {
  outcomeBytes: Buffer[];
  observations: Array<Promise<unknown>>;
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

function runStage0WithNonBlockingObserver(
  stage1: EvidenceRefRegistry,
  observationBytes: readonly Buffer[] = checkedInStage0OutcomeBytes(),
): NonBlockingStage0Run {
  const outcomeBytes = checkedInStage0OutcomeBytes();
  const observations = observationBytes.map((bytes) =>
    stage1.register("application/json", bytes));

  // The production-side contract for the Stage-1 observer: scheduling is
  // synchronous, but neither dispatch nor returned bytes await storage.
  return { outcomeBytes, observations };
}

function expectByteEquivalent(actual: readonly Buffer[], expected: readonly Buffer[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(Buffer.compare(actual[index], expected[index])).toBe(0);
  }
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

    expectByteEquivalent(withStage1.outcomeBytes, withoutStage1.outcomeBytes);
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

  it("does not await a slow concrete-registry write on the production outcome path", async () => {
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    class SlowConcreteRegistry extends EvidenceRefRegistry {
      override async register(
        mediaType: string,
        payload: Uint8Array,
        correlationId?: string,
      ) {
        await writeGate;
        return super.register(mediaType, payload, correlationId);
      }
    }
    const registry = new SlowConcreteRegistry(root);

    const baselineRun = await runStage0();
    const attacked = runStage0WithNonBlockingObserver(
      registry,
      [checkedInStage0OutcomeBytes()[0]],
    );

    expectByteEquivalent(attacked.outcomeBytes, baselineRun.outcomeBytes);
    const stateBeforeRelease = await Promise.race([
      Promise.all(attacked.observations).then(() => "settled"),
      new Promise<string>((resolve) => setImmediate(() => resolve("pending"))),
    ]);
    expect(stateBeforeRelease).toBe("pending");

    releaseWrite?.();
    await expect(Promise.all(attacked.observations)).resolves.toHaveLength(1);
  });

  it("keeps concrete-registry rejection and unavailability outside production outcomes", async () => {
    const baselineRun = await runStage0();
    const secret = Buffer.from(
      JSON.stringify({ api_secret: "super-secret-value-12345678901234567890" }),
      "utf8",
    );
    const unsafeTarget = path.join(root, "unsafe-target");
    const unavailableRoot = path.join(root, "unavailable-root");
    const writeDeniedRoot = path.join(root, "write-denied-root");
    await fs.mkdir(unsafeTarget, { recursive: true });
    await fs.mkdir(writeDeniedRoot, { recursive: true, mode: 0o500 });
    await fs.symlink(unsafeTarget, unavailableRoot);

    const rejected = runStage0WithNonBlockingObserver(
      new EvidenceRefRegistry(path.join(root, "rejected")),
      [secret],
    );
    const unavailable = runStage0WithNonBlockingObserver(
      new EvidenceRefRegistry(unavailableRoot),
      [checkedInStage0OutcomeBytes()[0]],
    );
    const writeDenied = runStage0WithNonBlockingObserver(
      new EvidenceRefRegistry(writeDeniedRoot),
      [checkedInStage0OutcomeBytes()[0]],
    );

    expectByteEquivalent(rejected.outcomeBytes, baselineRun.outcomeBytes);
    expectByteEquivalent(unavailable.outcomeBytes, baselineRun.outcomeBytes);
    expectByteEquivalent(writeDenied.outcomeBytes, baselineRun.outcomeBytes);
    await expect(Promise.all(rejected.observations)).resolves.toEqual([
      { status: "rejected", reason: "rejected_secret_detected" },
    ]);
    await expect(Promise.all(unavailable.observations)).resolves.toEqual([
      { status: "unavailable" },
    ]);
    await expect(Promise.all(writeDenied.observations)).resolves.toEqual([
      { status: "unavailable" },
    ]);
  });

  it("keeps corrupt, unresolved, duplicate-hash, and concurrent registry states observational", async () => {
    const registry = new EvidenceRefRegistry(root);
    const baselineRun = await runStage0();
    const bytes = checkedInStage0OutcomeBytes()[0];
    const first = await registry.register("application/json", bytes);
    expect(first.status).toBe("registered");
    if (first.status !== "registered") throw new Error("fixture registration failed");

    const digest = first.ref.slice("evidence:sha256:".length);
    const entryPath = path.join(root, `${digest}.json`);
    await fs.writeFile(entryPath, "{corrupt", "utf8");
    const corrupt = runStage0WithNonBlockingObserver(registry, [bytes]);
    expectByteEquivalent(corrupt.outcomeBytes, baselineRun.outcomeBytes);
    await expect(Promise.all(corrupt.observations)).resolves.toEqual([
      { status: "conflict", ref: first.ref },
    ]);

    const missing = await registry.resolve(evidenceFixture.missing.ref);
    expect(missing.status).toBe("missing");
    expectByteEquivalent(corrupt.outcomeBytes, baselineRun.outcomeBytes);

    await fs.rm(entryPath);
    const concurrent = Array.from({ length: 8 }, () =>
      runStage0WithNonBlockingObserver(registry, [bytes]));
    for (const run of concurrent) expectByteEquivalent(run.outcomeBytes, baselineRun.outcomeBytes);
    const settlements = await Promise.all(concurrent.flatMap((run) => run.observations));
    expect(settlements.filter((result) =>
      (result as { status: string }).status === "registered")).toHaveLength(1);
    expect(settlements.filter((result) =>
      (result as { status: string }).status === "already_registered")).toHaveLength(7);
  });
});
