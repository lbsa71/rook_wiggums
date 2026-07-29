import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EvidenceRefRegistry } from "../../src/causal/EvidenceRefRegistry";
import type {
  ActionId,
  ActorRef,
  EvidenceRef,
  OpaqueCapabilityRef,
} from "../../src/causal/Identifiers";
import {
  COMPARATOR_S_EFFECT_CLASS,
  COMPARATOR_S_TARGET,
  ComparatorSAtomicReplaceTarget,
  ComparatorSAtomicReplaceWorker,
  sha256Bytes,
  type AtomicReplaceIntent,
  type CapabilityCheck,
  type ComparatorSCapabilityVerifier,
  type ComparatorSFaultInjector,
} from "../../src/causal/effects/ComparatorS";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";

const PREIMAGE = Buffer.from("low-criticality canary: before\n", "utf8");
const POSTIMAGE = Buffer.from("low-criticality canary: after\n", "utf8");
const THIRD_IMAGE = Buffer.from("concurrent third-party write\n", "utf8");

class MutableCapabilityVerifier implements ComparatorSCapabilityVerifier {
  result: CapabilityCheck = { ok: true };
  calls = 0;

  async verify(): Promise<CapabilityCheck> {
    this.calls += 1;
    return this.result;
  }
}

interface Harness {
  root: string;
  targetPath: string;
  walPath: string;
  receiptPath: string;
  registry: EvidenceRefRegistry;
  verifier: MutableCapabilityVerifier;
  intent: AtomicReplaceIntent;
  worker: ComparatorSAtomicReplaceWorker;
  cleanup(): Promise<void>;
}

async function createHarness(
  suffix = "a",
  faults: ComparatorSFaultInjector = {},
  registryFactory?: (root: string) => EvidenceRefRegistry,
): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "comparator-s-"));
  const targetPath = path.join(root, "atomic-replace-canary.txt");
  const walPath = path.join(root, "state", "effect-wal.json");
  const receiptPath = path.join(root, "state", "receipts.json");
  await fs.writeFile(targetPath, PREIMAGE);
  const registry = registryFactory?.(path.join(root, "evidence"))
    ?? new EvidenceRefRegistry(path.join(root, "evidence"));
  const registration = await registry.register("text/plain;charset=utf-8", POSTIMAGE);
  if (registration.status !== "registered") throw new Error(`registration failed: ${registration.status}`);
  const verifier = new MutableCapabilityVerifier();
  const intent: AtomicReplaceIntent = {
    schemaVersion: 1,
    actionId: `action:${suffix}` as ActionId,
    effectClass: COMPARATOR_S_EFFECT_CLASS,
    target: COMPARATOR_S_TARGET,
    expectedPreimageSha256: sha256Bytes(PREIMAGE),
    desiredPostimageSha256: sha256Bytes(POSTIMAGE),
    payloadRef: registration.ref,
    payloadByteLength: POSTIMAGE.byteLength,
    capabilityRef: `capability:${suffix}` as OpaqueCapabilityRef,
    capabilityEpoch: 7,
    requestedBy: "actor:test" as ActorRef,
    preparedAt: "2026-07-29T06:30:00.000Z",
  };
  const worker = new ComparatorSAtomicReplaceWorker(
    walPath,
    receiptPath,
    new ComparatorSAtomicReplaceTarget(targetPath),
    registry,
    verifier,
    new FixedClock(new Date("2026-07-29T06:30:00.000Z")),
    { enabled: true, faultInjector: faults },
  );
  return {
    root,
    targetPath,
    walPath,
    receiptPath,
    registry,
    verifier,
    intent,
    worker,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

function crashOnce(point: keyof ComparatorSFaultInjector): ComparatorSFaultInjector {
  let fired = false;
  return {
    [point]: async () => {
      if (!fired) {
        fired = true;
        throw new Error(`simulated crash at ${point}`);
      }
    },
  };
}

async function targetBytes(harness: Harness): Promise<Buffer> {
  return fs.readFile(harness.targetPath);
}

describe("Comparator S frozen S00-S20 contract", () => {
  it("S00 applies one atomic replacement with the ordered four-phase trace", async () => {
    const h = await createHarness("s00");
    try {
      const result = await h.worker.execute(h.intent);
      expect(result.status).toBe("applied");
      expect(await targetBytes(h)).toEqual(POSTIMAGE);
      expect((await h.worker.readTrace(h.intent.actionId)).map((entry) => entry.phase))
        .toEqual(["prepared", "effect_started", "effect_observed", "receipted"]);
    } finally {
      await h.cleanup();
    }
  });

  it("S01 recovers after durable prepared and rechecks capability", async () => {
    const h = await createHarness("s01", crashOnce("afterPrepared"));
    try {
      await expect(h.worker.execute(h.intent)).rejects.toThrow("simulated crash");
      expect(await targetBytes(h)).toEqual(PREIMAGE);
      const recovered = await h.worker.recover(h.intent.actionId);
      expect(recovered?.status).toBe("applied");
      expect(h.verifier.calls).toBe(2);
    } finally {
      await h.cleanup();
    }
  });

  it("S02 records not_started when capability is revoked before effect_started", async () => {
    let h: Harness;
    h = await createHarness("s02", {
      afterPrepared: async () => {
        h.verifier.result = { ok: false, reason: "capability_revoked" };
      },
    });
    try {
      const result = await h.worker.execute(h.intent);
      expect(result.status).toBe("not_started");
      if (result.status === "not_started") expect(result.receipt.refusalCode).toBe("capability_revoked");
      expect(await targetBytes(h)).toEqual(PREIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it.each([
    ["S03", "afterEffectStarted"],
    ["S04", "afterTempFlushed"],
    ["S05", "afterRename"],
    ["S06", "afterEffectObserved"],
    ["S07", "afterReceiptPersisted"],
  ] as const)("%s reconciles a crash at %s without a second effect", async (_id, point) => {
    const h = await createHarness(_id.toLowerCase(), crashOnce(point));
    try {
      await expect(h.worker.execute(h.intent)).rejects.toThrow("simulated crash");
      const recovered = await h.worker.recover(h.intent.actionId);
      expect(["applied", "duplicate"]).toContain(recovered?.status);
      expect(await targetBytes(h)).toEqual(POSTIMAGE);
      const trace = await h.worker.readTrace(h.intent.actionId);
      expect(trace.filter((entry) => entry.phase === "effect_started")).toHaveLength(1);
      expect(trace.filter((entry) => entry.phase === "receipted")).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  it("S08 ignores post-start revocation for the already-started effect", async () => {
    let h: Harness;
    h = await createHarness("s08", {
      afterEffectStarted: async () => {
        h.verifier.result = { ok: false, reason: "capability_revoked" };
      },
    });
    try {
      expect((await h.worker.execute(h.intent)).status).toBe("applied");
      expect(h.verifier.calls).toBe(2);
      expect(await targetBytes(h)).toEqual(POSTIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S09 refuses when the preimage changes before the start CAS", async () => {
    let h: Harness;
    h = await createHarness("s09", {
      afterPrepared: async () => {
        await fs.writeFile(h.targetPath, THIRD_IMAGE);
      },
    });
    try {
      const result = await h.worker.execute(h.intent);
      expect(result.status).toBe("not_started");
      if (result.status === "not_started") expect(result.receipt.refusalCode).toBe("precondition_mismatch");
      expect(await targetBytes(h)).toEqual(THIRD_IMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S10 preserves a third hash introduced after start and records ambiguous", async () => {
    let h: Harness;
    h = await createHarness("s10", {
      afterEffectStarted: async () => {
        await fs.writeFile(h.targetPath, THIRD_IMAGE);
      },
    });
    try {
      const result = await h.worker.execute(h.intent);
      expect(result.status).toBe("ambiguous");
      expect(await targetBytes(h)).toEqual(THIRD_IMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S11 treats unavailable post-start payload as ambiguous", async () => {
    class VanishingRegistry extends EvidenceRefRegistry {
      resolves = 0;
      override async resolve(ref: unknown) {
        this.resolves += 1;
        // register() resolves once to detect a concurrent winner; admission is
        // the second resolution and the post-start read is the third.
        if (this.resolves > 2) {
          return { status: "missing" as const, ref: ref as EvidenceRef };
        }
        return super.resolve(ref);
      }
    }
    const h = await createHarness("s11", {}, (root) => new VanishingRegistry(root));
    try {
      expect((await h.worker.execute(h.intent)).status).toBe("ambiguous");
      expect(await targetBytes(h)).toEqual(PREIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S12 coalesces the same action and intent before and after restart", async () => {
    const h = await createHarness("s12");
    try {
      const first = await h.worker.execute(h.intent);
      const secondWorker = new ComparatorSAtomicReplaceWorker(
        h.walPath,
        h.receiptPath,
        new ComparatorSAtomicReplaceTarget(h.targetPath),
        h.registry,
        h.verifier,
        new FixedClock(new Date("2026-07-29T06:31:00.000Z")),
        { enabled: true },
      );
      const duplicate = await secondWorker.execute(h.intent);
      expect(first.status).toBe("applied");
      expect(duplicate.status).toBe("duplicate");
      expect(await targetBytes(h)).toEqual(POSTIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S13 rejects same ActionId with a different canonical intent", async () => {
    const h = await createHarness("s13");
    try {
      await h.worker.execute(h.intent);
      const conflict = await h.worker.execute({ ...h.intent, requestedBy: "actor:other" as ActorRef });
      expect(conflict).toEqual({ status: "conflict", reason: "action_id_conflict" });
    } finally {
      await h.cleanup();
    }
  });

  it("S14 serializes two actions so only one can pass the same preimage CAS", async () => {
    const h = await createHarness("s14-a");
    try {
      const second = {
        ...h.intent,
        actionId: "action:s14-b" as ActionId,
        capabilityRef: "capability:s14-b" as OpaqueCapabilityRef,
      };
      const [a, b] = await Promise.all([h.worker.execute(h.intent), h.worker.execute(second)]);
      expect([a.status, b.status].sort()).toEqual(["applied", "not_started"]);
      expect(await targetBytes(h)).toEqual(POSTIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S15 skips receipted action one while reconciling action two", async () => {
    const h = await createHarness("s15-a");
    try {
      expect((await h.worker.execute(h.intent)).status).toBe("applied");
      await fs.writeFile(h.targetPath, PREIMAGE);
      const second = {
        ...h.intent,
        actionId: "action:s15-b" as ActionId,
        capabilityRef: "capability:s15-b" as OpaqueCapabilityRef,
      };
      const crashing = new ComparatorSAtomicReplaceWorker(
        h.walPath,
        h.receiptPath,
        new ComparatorSAtomicReplaceTarget(h.targetPath),
        h.registry,
        h.verifier,
        new FixedClock(new Date("2026-07-29T06:31:00.000Z")),
        { enabled: true, faultInjector: crashOnce("afterEffectStarted") },
      );
      await expect(crashing.execute(second)).rejects.toThrow("simulated crash");
      expect((await crashing.execute(h.intent)).status).toBe("duplicate");
      expect((await crashing.recover(second.actionId))?.status).toBe("applied");
      expect((await crashing.readTrace(h.intent.actionId))
        .filter((entry) => entry.phase === "effect_started")).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  it("S16 inhibits only Comparator S when its WAL is corrupt", async () => {
    const h = await createHarness("s16");
    try {
      await fs.mkdir(path.dirname(h.walPath), { recursive: true });
      await fs.writeFile(h.walPath, "{broken");
      expect(await h.worker.execute(h.intent)).toEqual({ status: "unavailable", reason: "wal_unavailable" });
      expect(await targetBytes(h)).toEqual(PREIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S17 cannot report completion until the observed effect has a durable receipt", async () => {
    const h = await createHarness("s17");
    try {
      await fs.mkdir(path.dirname(h.receiptPath), { recursive: true });
      await fs.writeFile(h.receiptPath, "{broken");
      expect(await h.worker.execute(h.intent)).toEqual({
        status: "unavailable",
        reason: "receipt_unavailable",
      });
      expect(await targetBytes(h)).toEqual(POSTIMAGE);
      await fs.unlink(h.receiptPath);
      expect((await h.worker.recover(h.intent.actionId))?.status).toBe("applied");
    } finally {
      await h.cleanup();
    }
  });

  it("S18 preserves reconciliation across worker replacement", async () => {
    const h = await createHarness("s18", crashOnce("afterEffectStarted"));
    try {
      await expect(h.worker.execute(h.intent)).rejects.toThrow("simulated crash");
      const replacement = new ComparatorSAtomicReplaceWorker(
        h.walPath,
        h.receiptPath,
        new ComparatorSAtomicReplaceTarget(h.targetPath),
        h.registry,
        h.verifier,
        new FixedClock(new Date("2026-07-29T06:32:00.000Z")),
        { enabled: true },
      );
      expect((await replacement.recover(h.intent.actionId))?.status).toBe("applied");
    } finally {
      await h.cleanup();
    }
  });

  it("S19 rejects matching attribution without an effective capability", async () => {
    const h = await createHarness("s19");
    h.verifier.result = { ok: false, reason: "capability_denied" };
    try {
      const result = await h.worker.execute(h.intent);
      expect(result.status).toBe("not_started");
      if (result.status === "not_started") expect(result.receipt.refusalCode).toBe("capability_denied");
      expect(await targetBytes(h)).toEqual(PREIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("S20 leaves the original receipt immutable and requires a new action for compensation", async () => {
    const h = await createHarness("s20");
    try {
      const original = await h.worker.execute(h.intent);
      expect(original.status).toBe("applied");
      await fs.writeFile(h.targetPath, POSTIMAGE);
      const compensationPayload = PREIMAGE;
      const registration = await h.registry.register("text/plain;charset=utf-8", compensationPayload);
      if (registration.status !== "registered") throw new Error("compensation registration failed");
      const compensation: AtomicReplaceIntent = {
        ...h.intent,
        actionId: "action:s20-compensation" as ActionId,
        expectedPreimageSha256: sha256Bytes(POSTIMAGE),
        desiredPostimageSha256: sha256Bytes(PREIMAGE),
        payloadRef: registration.ref,
        payloadByteLength: PREIMAGE.byteLength,
        capabilityRef: "capability:s20-compensation" as OpaqueCapabilityRef,
      };
      expect((await h.worker.execute(compensation)).status).toBe("applied");
      expect((await h.worker.execute(h.intent)).status).toBe("duplicate");
      expect(await targetBytes(h)).toEqual(PREIMAGE);
    } finally {
      await h.cleanup();
    }
  });

  it("is default-off and rejects symlink targets without mutating their referent", async () => {
    const h = await createHarness("boundary");
    try {
      const disabled = new ComparatorSAtomicReplaceWorker(
        h.walPath,
        h.receiptPath,
        new ComparatorSAtomicReplaceTarget(h.targetPath),
        h.registry,
        h.verifier,
        new FixedClock(new Date("2026-07-29T06:30:00.000Z")),
      );
      expect(await disabled.execute(h.intent)).toEqual({
        status: "unavailable",
        reason: "wal_unavailable",
      });
      const referent = path.join(h.root, "referent.txt");
      await fs.writeFile(referent, PREIMAGE);
      await fs.unlink(h.targetPath);
      await fs.symlink(referent, h.targetPath);
      const rejected = await h.worker.execute({
        ...h.intent,
        actionId: "action:symlink" as ActionId,
      });
      expect(rejected.status).toBe("not_started");
      expect(await fs.readFile(referent)).toEqual(PREIMAGE);
    } finally {
      await h.cleanup();
    }
  });
});
