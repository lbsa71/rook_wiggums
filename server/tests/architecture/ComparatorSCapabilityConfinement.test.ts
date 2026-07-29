import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EvidenceRefRegistry } from "../../src/causal/EvidenceRefRegistry";
import type {
  ActionId,
  ActorRef,
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

const PREIMAGE = Buffer.from("capability audit: before\n", "utf8");
const POSTIMAGE = Buffer.from("capability audit: after\n", "utf8");
const THIRD_IMAGE = Buffer.from("capability audit: third-party write\n", "utf8");

class MutableVerifier implements ComparatorSCapabilityVerifier {
  result: CapabilityCheck = { ok: true };

  async verify(): Promise<CapabilityCheck> {
    return this.result;
  }
}

interface AuditHarness {
  root: string;
  targetPath: string;
  walPath: string;
  receiptPath: string;
  registry: EvidenceRefRegistry;
  verifier: ComparatorSCapabilityVerifier;
  target: ComparatorSAtomicReplaceTarget;
  intent: AtomicReplaceIntent;
  worker: ComparatorSAtomicReplaceWorker;
  cleanup(): Promise<void>;
}

async function createAuditHarness(options: {
  suffix: string;
  root?: string;
  targetPath?: string;
  target?: ComparatorSAtomicReplaceTarget;
  verifier?: ComparatorSCapabilityVerifier;
  faults?: ComparatorSFaultInjector;
}): Promise<AuditHarness> {
  const root = options.root ?? await fs.mkdtemp(path.join(os.tmpdir(), "comparator-s-confinement-"));
  const targetPath = options.targetPath ?? path.join(root, "atomic-replace-canary.txt");
  const walPath = path.join(root, "state", "effect-wal.json");
  const receiptPath = path.join(root, "state", "receipts.json");
  const target = options.target ?? new ComparatorSAtomicReplaceTarget(targetPath);
  const verifier = options.verifier ?? new MutableVerifier();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, PREIMAGE);
  const registry = new EvidenceRefRegistry(path.join(root, "evidence"));
  const registration = await registry.register("text/plain;charset=utf-8", POSTIMAGE);
  if (registration.status !== "registered") {
    throw new Error(`registration failed: ${registration.status}`);
  }
  const intent: AtomicReplaceIntent = {
    schemaVersion: 1,
    actionId: `action:${options.suffix}` as ActionId,
    effectClass: COMPARATOR_S_EFFECT_CLASS,
    target: COMPARATOR_S_TARGET,
    expectedPreimageSha256: sha256Bytes(PREIMAGE),
    desiredPostimageSha256: sha256Bytes(POSTIMAGE),
    payloadRef: registration.ref,
    payloadByteLength: POSTIMAGE.byteLength,
    capabilityRef: `capability:${options.suffix}` as OpaqueCapabilityRef,
    capabilityEpoch: 1,
    requestedBy: "actor:confinement-audit" as ActorRef,
    preparedAt: "2026-07-29T15:00:00.000Z",
  };
  const worker = new ComparatorSAtomicReplaceWorker(
    walPath,
    receiptPath,
    target,
    registry,
    verifier,
    new FixedClock(new Date("2026-07-29T15:00:00.000Z")),
    { enabled: true, faultInjector: options.faults },
  );
  return {
    root,
    targetPath,
    walPath,
    receiptPath,
    registry,
    verifier,
    target,
    intent,
    worker,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("Comparator S effective-capability confinement audit", () => {
  it("resists lexical path aliases and a direct symlink target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "comparator-s-alias-"));
    try {
      const targetPath = path.join(root, "nested", "..", "target.txt");
      const resolvedTargetPath = path.join(root, "target.txt");
      const referentPath = path.join(root, "referent.txt");
      await fs.writeFile(resolvedTargetPath, PREIMAGE);
      await fs.writeFile(referentPath, PREIMAGE);

      const target = new ComparatorSAtomicReplaceTarget(targetPath);
      expect(await target.read()).toEqual(PREIMAGE);

      await fs.unlink(resolvedTargetPath);
      await fs.symlink(referentPath, resolvedTargetPath);
      await expect(target.assertAllowed()).rejects.toThrow("non-symlink regular file");
      expect(await fs.readFile(referentPath)).toEqual(PREIMAGE);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("FALSIFIES stable target identity when a symlinked parent is swapped between checks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "comparator-s-parent-race-"));
    const parentAlias = path.join(root, "allowlisted-parent");
    const originalParent = path.join(root, "original-parent");
    const alternateParent = path.join(root, "alternate-parent");
    const targetPath = path.join(parentAlias, "target.txt");
    await fs.mkdir(originalParent);
    await fs.mkdir(alternateParent);
    await fs.symlink(originalParent, parentAlias);
    await fs.writeFile(path.join(originalParent, "target.txt"), PREIMAGE);
    await fs.writeFile(path.join(alternateParent, "target.txt"), PREIMAGE);

    const target = new ComparatorSAtomicReplaceTarget(targetPath);
    let harness: AuditHarness;
    harness = await createAuditHarness({
      suffix: "parent-race",
      root,
      targetPath,
      target,
      faults: {
        afterTempFlushed: async () => {
          const alternateTemp = path.join(alternateParent, path.basename(target.tempPath(harness.intent.actionId)));
          await fs.writeFile(alternateTemp, POSTIMAGE, { mode: 0o600 });
          await fs.unlink(parentAlias);
          await fs.symlink(alternateParent, parentAlias);
        },
      },
    });

    try {
      expect((await harness.worker.execute(harness.intent)).status).toBe("applied");
      expect(await fs.readFile(path.join(originalParent, "target.txt"))).toEqual(PREIMAGE);
      expect(await fs.readFile(path.join(alternateParent, "target.txt"))).toEqual(POSTIMAGE);
    } finally {
      await harness.cleanup();
    }
  });

  it("FALSIFIES inode isolation when the flushed temp is replaced by a hard link", async () => {
    let harness: AuditHarness;
    const outsidePathHolder: { path?: string } = {};
    harness = await createAuditHarness({
      suffix: "hard-link",
      faults: {
        afterTempFlushed: async () => {
          const outsidePath = path.join(harness.root, "outside-payload.txt");
          outsidePathHolder.path = outsidePath;
          await fs.writeFile(outsidePath, POSTIMAGE);
          await fs.unlink(harness.target.tempPath(harness.intent.actionId));
          await fs.link(outsidePath, harness.target.tempPath(harness.intent.actionId));
        },
      },
    });

    try {
      expect((await harness.worker.execute(harness.intent)).status).toBe("applied");
      const outsidePath = outsidePathHolder.path;
      if (!outsidePath) throw new Error("outside path not initialized");
      await fs.writeFile(outsidePath, THIRD_IMAGE);
      expect(await fs.readFile(harness.targetPath)).toEqual(THIRD_IMAGE);
      expect((await fs.stat(harness.targetPath)).nlink).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("FALSIFIES atomic compare-and-swap under a rename race after the final hash check", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "comparator-s-rename-race-"));
    const targetPath = path.join(root, "target.txt");
    const target = new ComparatorSAtomicReplaceTarget(targetPath);
    const publish = target.publishTemp.bind(target);
    target.publishTemp = async (tempPath, afterRename) => {
      await fs.writeFile(targetPath, THIRD_IMAGE);
      await publish(tempPath, afterRename);
    };
    const harness = await createAuditHarness({
      suffix: "rename-race",
      root,
      targetPath,
      target,
    });

    try {
      expect((await harness.worker.execute(harness.intent)).status).toBe("applied");
      expect(await fs.readFile(targetPath)).toEqual(POSTIMAGE);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects a stale preimage before start but cannot detect an ABA preimage", async () => {
    let harness: AuditHarness;
    harness = await createAuditHarness({
      suffix: "stale-preimage",
      faults: {
        afterPrepared: async () => {
          await fs.writeFile(harness.targetPath, THIRD_IMAGE);
        },
      },
    });
    try {
      const stale = await harness.worker.execute(harness.intent);
      expect(stale.status).toBe("not_started");
      if (stale.status === "not_started") {
        expect(stale.receipt.refusalCode).toBe("precondition_mismatch");
      }
    } finally {
      await harness.cleanup();
    }

    let aba: AuditHarness;
    aba = await createAuditHarness({
      suffix: "aba-preimage",
      faults: {
        afterPrepared: async () => {
          await fs.writeFile(aba.targetPath, THIRD_IMAGE);
          await fs.writeFile(aba.targetPath, PREIMAGE);
        },
      },
    });
    try {
      expect((await aba.worker.execute(aba.intent)).status).toBe("applied");
    } finally {
      await aba.cleanup();
    }
  });

  it("FALSIFIES worker privilege confinement because verifier code can mutate unrelated files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "comparator-s-verifier-privilege-"));
    const unrelatedPath = path.join(root, "unrelated.txt");
    await fs.writeFile(unrelatedPath, PREIMAGE);
    const verifier: ComparatorSCapabilityVerifier = {
      verify: async () => {
        await fs.writeFile(unrelatedPath, THIRD_IMAGE);
        return { ok: false, reason: "capability_denied" };
      },
    };
    const harness = await createAuditHarness({
      suffix: "verifier-privilege",
      root,
      verifier,
    });

    try {
      expect((await harness.worker.execute(harness.intent)).status).toBe("not_started");
      expect(await fs.readFile(unrelatedPath)).toEqual(THIRD_IMAGE);
    } finally {
      await harness.cleanup();
    }
  });

  it("FALSIFIES capability single-use and payload binding under the current verifier contract", async () => {
    const harness = await createAuditHarness({ suffix: "capability-reuse" });
    try {
      expect((await harness.worker.execute(harness.intent)).status).toBe("applied");
      const reverseRegistration = await harness.registry.register(
        "text/plain;charset=utf-8",
        PREIMAGE,
      );
      if (reverseRegistration.status !== "registered") {
        throw new Error(`registration failed: ${reverseRegistration.status}`);
      }
      const reusedCapability: AtomicReplaceIntent = {
        ...harness.intent,
        actionId: "action:capability-reuse-second" as ActionId,
        expectedPreimageSha256: sha256Bytes(POSTIMAGE),
        desiredPostimageSha256: sha256Bytes(PREIMAGE),
        payloadRef: reverseRegistration.ref,
        payloadByteLength: PREIMAGE.byteLength,
      };
      expect((await harness.worker.execute(reusedCapability)).status).toBe("applied");
      expect(await fs.readFile(harness.targetPath)).toEqual(PREIMAGE);
    } finally {
      await harness.cleanup();
    }
  });

  it("FALSIFIES exclusive authority because an alternate write path bypasses WAL and receipts", async () => {
    const harness = await createAuditHarness({ suffix: "alternate-write" });
    try {
      await fs.writeFile(harness.targetPath, THIRD_IMAGE);
      expect(await fs.readFile(harness.targetPath)).toEqual(THIRD_IMAGE);
      expect(await harness.worker.readTrace(harness.intent.actionId)).toEqual([]);
      await expect(fs.readFile(harness.receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await harness.cleanup();
    }
  });
});
