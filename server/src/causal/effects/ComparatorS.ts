import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IClock } from "../../substrate/abstractions/IClock";
import type { EvidenceRefRegistry } from "../EvidenceRefRegistry";
import type {
  ActionId,
  ActorRef,
  EvidenceRef,
  OpaqueCapabilityRef,
  ReceiptId,
} from "../Identifiers";

export const COMPARATOR_S_EFFECT_CLASS = "comparator_s.atomic_replace.v1" as const;
export const COMPARATOR_S_TARGET = "comparator-s://canary/atomic-replace-v1" as const;
export const COMPARATOR_S_SCHEMA_VERSION = 1 as const;
export const MAX_COMPARATOR_S_PAYLOAD_BYTES = 64 * 1024;

export type ComparatorSEffectPhase =
  | "prepared"
  | "effect_started"
  | "effect_observed"
  | "receipted"
  | "ambiguous";

export type ComparatorSFailureCode =
  | "action_id_conflict"
  | "capability_denied"
  | "capability_expired"
  | "capability_revoked"
  | "invalid_intent"
  | "payload_unavailable"
  | "payload_mismatch"
  | "precondition_mismatch"
  | "target_denied"
  | "wal_unavailable"
  | "receipt_unavailable"
  | "ambiguous_target";

export interface AtomicReplaceIntent {
  schemaVersion: 1;
  actionId: ActionId;
  effectClass: typeof COMPARATOR_S_EFFECT_CLASS;
  target: typeof COMPARATOR_S_TARGET;
  expectedPreimageSha256: string;
  desiredPostimageSha256: string;
  payloadRef: EvidenceRef;
  payloadByteLength: number;
  capabilityRef: OpaqueCapabilityRef;
  capabilityEpoch: number;
  requestedBy: ActorRef;
  preparedAt: string;
}

export interface EffectWalEntry {
  schemaVersion: 1;
  sequence: number;
  actionId: ActionId;
  phase: ComparatorSEffectPhase;
  intentHash: string;
  observedTargetSha256?: string;
  receiptId?: ReceiptId;
  failureCode?: ComparatorSFailureCode;
  recordedAt: string;
}

export interface AtomicReplaceReceipt {
  schemaVersion: 1;
  receiptId: ReceiptId;
  actionId: ActionId;
  effectClass: typeof COMPARATOR_S_EFFECT_CLASS;
  target: typeof COMPARATOR_S_TARGET;
  outcome: "applied" | "not_started";
  preimageSha256: string;
  postimageSha256: string;
  payloadRef: EvidenceRef;
  capabilityRef: OpaqueCapabilityRef;
  capabilityEpoch: number;
  refusalCode?: ComparatorSFailureCode;
  observedAt: string;
  walSequence: number;
}

interface WalDocument {
  schemaVersion: 1;
  intents: Record<string, AtomicReplaceIntent>;
  entries: EffectWalEntry[];
}

interface ReceiptDocument {
  schemaVersion: 1;
  receipts: Record<string, AtomicReplaceReceipt>;
}

export type CapabilityCheck =
  | { ok: true }
  | {
    ok: false;
    reason: "capability_denied" | "capability_expired" | "capability_revoked";
  };

/**
 * Capability authenticity is deliberately external to the WAL. The worker
 * consumes an effect-local verdict and never infers authority from ActorRef.
 */
export interface ComparatorSCapabilityVerifier {
  verify(
    capabilityRef: OpaqueCapabilityRef,
    intent: AtomicReplaceIntent,
    at: Date,
  ): Promise<CapabilityCheck>;
}

export interface ComparatorSFaultInjector {
  afterPrepared?(): Promise<void>;
  afterEffectStarted?(): Promise<void>;
  afterTempFlushed?(): Promise<void>;
  afterRename?(): Promise<void>;
  afterEffectObserved?(): Promise<void>;
  afterReceiptPersisted?(): Promise<void>;
}

export type ComparatorSRunResult =
  | { status: "applied" | "not_started" | "duplicate"; receipt: AtomicReplaceReceipt }
  | { status: "ambiguous"; entry: EffectWalEntry }
  | { status: "conflict"; reason: "action_id_conflict" }
  | {
    status: "unavailable";
    reason: "wal_unavailable" | "receipt_unavailable";
  };

export interface ComparatorSOptions {
  enabled?: boolean;
  audit?: (message: string) => void;
  faultInjector?: ComparatorSFaultInjector;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableIntent(intent: AtomicReplaceIntent): string {
  return JSON.stringify({
    schemaVersion: intent.schemaVersion,
    actionId: intent.actionId,
    effectClass: intent.effectClass,
    target: intent.target,
    expectedPreimageSha256: intent.expectedPreimageSha256,
    desiredPostimageSha256: intent.desiredPostimageSha256,
    payloadRef: intent.payloadRef,
    payloadByteLength: intent.payloadByteLength,
    capabilityRef: intent.capabilityRef,
    capabilityEpoch: intent.capabilityEpoch,
    requestedBy: intent.requestedBy,
    preparedAt: intent.preparedAt,
  });
}

export function comparatorSIntentHash(intent: AtomicReplaceIntent): string {
  return sha256Bytes(Buffer.from(stableIntent(intent), "utf8"));
}

function validIntent(intent: AtomicReplaceIntent): boolean {
  return intent.schemaVersion === 1
    && intent.effectClass === COMPARATOR_S_EFFECT_CLASS
    && intent.target === COMPARATOR_S_TARGET
    && typeof intent.actionId === "string"
    && intent.actionId.length > 0
    && SHA256_PATTERN.test(intent.expectedPreimageSha256)
    && SHA256_PATTERN.test(intent.desiredPostimageSha256)
    && typeof intent.payloadRef === "string"
    && Number.isSafeInteger(intent.payloadByteLength)
    && intent.payloadByteLength >= 0
    && intent.payloadByteLength <= MAX_COMPARATOR_S_PAYLOAD_BYTES
    && typeof intent.capabilityRef === "string"
    && Number.isSafeInteger(intent.capabilityEpoch)
    && intent.capabilityEpoch >= 0
    && typeof intent.requestedBy === "string"
    && Number.isFinite(Date.parse(intent.preparedAt));
}

/**
 * Resolves exactly one logical target to one fixed regular file. Callers never
 * supply a path. Symlinks, directories, and paths outside the configured
 * parent are rejected on every check.
 */
export class ComparatorSAtomicReplaceTarget {
  readonly logicalTarget = COMPARATOR_S_TARGET;
  private readonly targetPath: string;
  private readonly parentPath: string;

  constructor(targetPath: string) {
    this.targetPath = path.resolve(targetPath);
    this.parentPath = path.dirname(this.targetPath);
  }

  async read(): Promise<Buffer> {
    await this.assertAllowed();
    return fs.readFile(this.targetPath);
  }

  async assertAllowed(): Promise<void> {
    const targetStat = await fs.lstat(this.targetPath);
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new Error("Comparator S target must be a non-symlink regular file");
    }
    const realParent = await fs.realpath(this.parentPath);
    const realTarget = await fs.realpath(this.targetPath);
    if (path.dirname(realTarget) !== realParent || realTarget !== path.join(realParent, path.basename(this.targetPath))) {
      throw new Error("Comparator S target escapes its allowlisted parent");
    }
  }

  tempPath(actionId: ActionId): string {
    const safeAction = createHash("sha256").update(actionId).digest("hex").slice(0, 24);
    return path.join(this.parentPath, `.${path.basename(this.targetPath)}.${safeAction}.comparator-s.tmp`);
  }

  async writeTemp(actionId: ActionId, payload: Buffer): Promise<string> {
    await this.assertAllowed();
    const tempPath = this.tempPath(actionId);
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return tempPath;
  }

  async publishTemp(tempPath: string, afterRename?: () => Promise<void>): Promise<void> {
    if (path.dirname(path.resolve(tempPath)) !== this.parentPath) {
      throw new Error("Comparator S temp path escapes target parent");
    }
    await this.assertAllowed();
    const tempStat = await fs.lstat(tempPath);
    if (!tempStat.isFile() || tempStat.isSymbolicLink()) {
      throw new Error("Comparator S temp must be a non-symlink regular file");
    }
    await fs.rename(tempPath, this.targetPath);
    await afterRename?.();
    const directory = await fs.open(this.parentPath, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  async removeTemp(actionId: ActionId): Promise<void> {
    await fs.unlink(this.tempPath(actionId)).catch(() => undefined);
  }

  async tempHash(actionId: ActionId): Promise<string | null> {
    try {
      const tempPath = this.tempPath(actionId);
      const stat = await fs.lstat(tempPath);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      return sha256Bytes(await fs.readFile(tempPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

/**
 * Default-off typed WAL/receipt control for one atomic-replace canary.
 *
 * This class is intentionally not wired into LoopOrchestrator or any existing
 * write path. A live target and capability issuer remain separately governed.
 */
export class ComparatorSAtomicReplaceWorker {
  private serial: Promise<void> = Promise.resolve();
  private tempCounter = 0;
  private readonly enabled: boolean;
  private readonly audit: (message: string) => void;
  private readonly faults: ComparatorSFaultInjector;

  constructor(
    private readonly walPath: string,
    private readonly receiptPath: string,
    private readonly target: ComparatorSAtomicReplaceTarget,
    private readonly evidence: EvidenceRefRegistry,
    private readonly capabilities: ComparatorSCapabilityVerifier,
    private readonly clock: IClock,
    options: ComparatorSOptions = {},
  ) {
    this.enabled = options.enabled ?? false;
    this.audit = options.audit ?? (() => undefined);
    this.faults = options.faultInjector ?? {};
  }

  execute(intent: AtomicReplaceIntent): Promise<ComparatorSRunResult> {
    return this.serialize(() => this.executeSerialized(intent));
  }

  recover(actionId: ActionId): Promise<ComparatorSRunResult | null> {
    return this.serialize(() => this.recoverSerialized(actionId));
  }

  async readTrace(actionId: ActionId): Promise<EffectWalEntry[]> {
    const wal = await this.loadWal();
    if (wal.status !== "ok") return [];
    return wal.document.entries.filter((entry) => entry.actionId === actionId);
  }

  private async executeSerialized(intent: AtomicReplaceIntent): Promise<ComparatorSRunResult> {
    if (!this.enabled) return { status: "unavailable", reason: "wal_unavailable" };
    if (!validIntent(intent)) {
      return this.notStartedWithoutPrepare(intent, "invalid_intent");
    }

    const wal = await this.loadWal();
    if (wal.status !== "ok") return { status: "unavailable", reason: "wal_unavailable" };
    const existing = wal.document.intents[intent.actionId];
    if (existing) {
      if (stableIntent(existing) !== stableIntent(intent)) {
        return { status: "conflict", reason: "action_id_conflict" };
      }
      const recovered = await this.recoverFromDocuments(intent, wal.document);
      return recovered ?? { status: "unavailable", reason: "wal_unavailable" };
    }

    const admission = await this.admissionCheck(intent);
    if (!admission.ok) return this.notStartedWithoutPrepare(intent, admission.reason);

    wal.document.intents[intent.actionId] = intent;
    const prepared = this.nextEntry(wal.document, intent, "prepared");
    wal.document.entries.push(prepared);
    if (!await this.persistWal(wal.document)) {
      return { status: "unavailable", reason: "wal_unavailable" };
    }
    await this.faults.afterPrepared?.();
    return this.startAndApply(intent, wal.document);
  }

  private async recoverSerialized(actionId: ActionId): Promise<ComparatorSRunResult | null> {
    if (!this.enabled) return { status: "unavailable", reason: "wal_unavailable" };
    const wal = await this.loadWal();
    if (wal.status !== "ok") return { status: "unavailable", reason: "wal_unavailable" };
    const intent = wal.document.intents[actionId];
    if (!intent) return null;
    return this.recoverFromDocuments(intent, wal.document);
  }

  private async recoverFromDocuments(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
  ): Promise<ComparatorSRunResult | null> {
    const entries = wal.entries.filter((entry) => entry.actionId === intent.actionId);
    const last = entries.at(-1);
    if (!last) return null;
    const terminalReceipt = await this.receiptFor(intent.actionId);
    if (terminalReceipt.status === "unavailable") {
      return { status: "unavailable", reason: "receipt_unavailable" };
    }
    if (terminalReceipt.receipt) {
      if (last.phase !== "receipted") {
        wal.entries.push(this.nextEntry(wal, intent, "receipted", {
          receiptId: terminalReceipt.receipt.receiptId,
        }));
        if (!await this.persistWal(wal)) {
          return { status: "unavailable", reason: "wal_unavailable" };
        }
      }
      return { status: "duplicate", receipt: terminalReceipt.receipt };
    }

    if (last.phase === "ambiguous") return { status: "ambiguous", entry: last };
    if (last.phase === "receipted") {
      return { status: "unavailable", reason: "receipt_unavailable" };
    }
    if (last.phase === "prepared") {
      const start = await this.startCheck(intent);
      if (!start.ok) return this.persistNotStarted(intent, wal, start.reason);
      return this.startAndApply(intent, wal, true);
    }

    const targetHash = await this.currentTargetHash();
    if (last.phase === "effect_observed") {
      if (targetHash !== last.observedTargetSha256) {
        return this.persistAmbiguous(intent, wal, "ambiguous_target", targetHash);
      }
      return this.persistAppliedReceipt(intent, wal, targetHash);
    }

    if (last.phase === "effect_started") {
      if (targetHash === intent.desiredPostimageSha256) {
        return this.observeAndReceipt(intent, wal, targetHash);
      }
      if (targetHash !== intent.expectedPreimageSha256) {
        return this.persistAmbiguous(intent, wal, "ambiguous_target", targetHash);
      }
      const payload = await this.resolvePayload(intent);
      if (!payload.ok) return this.persistAmbiguous(intent, wal, payload.reason, targetHash);
      const tempHash = await this.target.tempHash(intent.actionId);
      if (tempHash !== null && tempHash !== intent.desiredPostimageSha256) {
        return this.persistAmbiguous(intent, wal, "payload_mismatch", targetHash);
      }
      return this.applyAfterStart(intent, wal, payload.payload, tempHash !== null);
    }
    return null;
  }

  private async startAndApply(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
    alreadyChecked = false,
  ): Promise<ComparatorSRunResult> {
    if (!alreadyChecked) {
      const start = await this.startCheck(intent);
      if (!start.ok) return this.persistNotStarted(intent, wal, start.reason);
    }
    const started = this.nextEntry(wal, intent, "effect_started");
    wal.entries.push(started);
    if (!await this.persistWal(wal)) return { status: "unavailable", reason: "wal_unavailable" };
    await this.faults.afterEffectStarted?.();
    const payload = await this.resolvePayload(intent);
    if (!payload.ok) return this.persistAmbiguous(intent, wal, payload.reason);
    return this.applyAfterStart(intent, wal, payload.payload, false);
  }

  private async applyAfterStart(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
    payload: Buffer,
    existingTemp: boolean,
  ): Promise<ComparatorSRunResult> {
    let tempPath = this.target.tempPath(intent.actionId);
    try {
      if (!existingTemp) tempPath = await this.target.writeTemp(intent.actionId, payload);
      await this.faults.afterTempFlushed?.();
      if (await this.currentTargetHash() !== intent.expectedPreimageSha256) {
        await this.target.removeTemp(intent.actionId);
        return this.persistAmbiguous(
          intent,
          wal,
          "ambiguous_target",
          await this.currentTargetHash(),
        );
      }
      await this.target.publishTemp(tempPath, this.faults.afterRename);
      const observed = await this.currentTargetHash();
      if (observed !== intent.desiredPostimageSha256) {
        return this.persistAmbiguous(intent, wal, "ambiguous_target", observed);
      }
      return this.observeAndReceipt(intent, wal, observed);
    } catch (error) {
      this.audit(`Comparator S effect interrupted: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async observeAndReceipt(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
    observed: string,
  ): Promise<ComparatorSRunResult> {
    const entry = this.nextEntry(wal, intent, "effect_observed", { observedTargetSha256: observed });
    wal.entries.push(entry);
    if (!await this.persistWal(wal)) return { status: "unavailable", reason: "wal_unavailable" };
    await this.faults.afterEffectObserved?.();
    return this.persistAppliedReceipt(intent, wal, observed);
  }

  private async persistAppliedReceipt(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
    observed: string,
  ): Promise<ComparatorSRunResult> {
    const receipt = this.makeReceipt(intent, "applied", observed, wal.entries.length + 1);
    if (!await this.persistReceipt(receipt)) {
      return { status: "unavailable", reason: "receipt_unavailable" };
    }
    const entry = this.nextEntry(wal, intent, "receipted", { receiptId: receipt.receiptId });
    wal.entries.push(entry);
    if (!await this.persistWal(wal)) return { status: "unavailable", reason: "wal_unavailable" };
    await this.faults.afterReceiptPersisted?.();
    return { status: "applied", receipt };
  }

  private async persistNotStarted(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
    reason: ComparatorSFailureCode,
  ): Promise<ComparatorSRunResult> {
    const targetHash = await this.currentTargetHash().catch(() => intent.expectedPreimageSha256);
    const receipt = this.makeReceipt(intent, "not_started", targetHash, wal.entries.length + 1, reason);
    if (!await this.persistReceipt(receipt)) {
      return { status: "unavailable", reason: "receipt_unavailable" };
    }
    const entry = this.nextEntry(wal, intent, "receipted", {
      receiptId: receipt.receiptId,
      failureCode: reason,
    });
    wal.entries.push(entry);
    if (!await this.persistWal(wal)) return { status: "unavailable", reason: "wal_unavailable" };
    return { status: "not_started", receipt };
  }

  private async notStartedWithoutPrepare(
    intent: AtomicReplaceIntent,
    reason: ComparatorSFailureCode,
  ): Promise<ComparatorSRunResult> {
    const wal = await this.loadWal();
    if (wal.status !== "ok") return { status: "unavailable", reason: "wal_unavailable" };
    wal.document.intents[intent.actionId] = intent;
    return this.persistNotStarted(intent, wal.document, reason);
  }

  private async persistAmbiguous(
    intent: AtomicReplaceIntent,
    wal: WalDocument,
    reason: ComparatorSFailureCode,
    observedTargetSha256?: string,
  ): Promise<ComparatorSRunResult> {
    const entry = this.nextEntry(wal, intent, "ambiguous", {
      failureCode: reason,
      observedTargetSha256,
    });
    wal.entries.push(entry);
    if (!await this.persistWal(wal)) return { status: "unavailable", reason: "wal_unavailable" };
    return { status: "ambiguous", entry };
  }

  private async admissionCheck(intent: AtomicReplaceIntent): Promise<
    | { ok: true }
    | { ok: false; reason: ComparatorSFailureCode }
  > {
    const capability = await this.capabilities.verify(intent.capabilityRef, intent, this.clock.now());
    if (!capability.ok) return capability;
    try {
      await this.target.assertAllowed();
    } catch {
      return { ok: false, reason: "target_denied" };
    }
    const payload = await this.resolvePayload(intent);
    if (!payload.ok) return payload;
    if (await this.currentTargetHash() !== intent.expectedPreimageSha256) {
      return { ok: false, reason: "precondition_mismatch" };
    }
    return { ok: true };
  }

  private async startCheck(intent: AtomicReplaceIntent): Promise<
    | { ok: true }
    | { ok: false; reason: ComparatorSFailureCode }
  > {
    const capability = await this.capabilities.verify(intent.capabilityRef, intent, this.clock.now());
    if (!capability.ok) return capability;
    try {
      await this.target.assertAllowed();
    } catch {
      return { ok: false, reason: "target_denied" };
    }
    if (await this.currentTargetHash() !== intent.expectedPreimageSha256) {
      return { ok: false, reason: "precondition_mismatch" };
    }
    return { ok: true };
  }

  private async resolvePayload(intent: AtomicReplaceIntent): Promise<
    | { ok: true; payload: Buffer }
    | { ok: false; reason: "payload_unavailable" | "payload_mismatch" }
  > {
    const resolved = await this.evidence.resolve(intent.payloadRef);
    if (resolved.status !== "resolved") return { ok: false, reason: "payload_unavailable" };
    if (resolved.payload.byteLength !== intent.payloadByteLength
      || sha256Bytes(resolved.payload) !== intent.desiredPostimageSha256) {
      return { ok: false, reason: "payload_mismatch" };
    }
    return { ok: true, payload: resolved.payload };
  }

  private async currentTargetHash(): Promise<string> {
    return sha256Bytes(await this.target.read());
  }

  private nextEntry(
    wal: WalDocument,
    intent: AtomicReplaceIntent,
    phase: ComparatorSEffectPhase,
    extra: Partial<EffectWalEntry> = {},
  ): EffectWalEntry {
    return {
      schemaVersion: 1,
      sequence: wal.entries.length + 1,
      actionId: intent.actionId,
      phase,
      intentHash: comparatorSIntentHash(intent),
      recordedAt: this.clock.now().toISOString(),
      ...extra,
    };
  }

  private makeReceipt(
    intent: AtomicReplaceIntent,
    outcome: "applied" | "not_started",
    postimageSha256: string,
    walSequence: number,
    refusalCode?: ComparatorSFailureCode,
  ): AtomicReplaceReceipt {
    const digest = createHash("sha256")
      .update(`${intent.actionId}\n${comparatorSIntentHash(intent)}\n${outcome}\n${postimageSha256}`)
      .digest("hex");
    return {
      schemaVersion: 1,
      receiptId: `receipt:${digest}` as ReceiptId,
      actionId: intent.actionId,
      effectClass: COMPARATOR_S_EFFECT_CLASS,
      target: COMPARATOR_S_TARGET,
      outcome,
      preimageSha256: intent.expectedPreimageSha256,
      postimageSha256,
      payloadRef: intent.payloadRef,
      capabilityRef: intent.capabilityRef,
      capabilityEpoch: intent.capabilityEpoch,
      ...(refusalCode ? { refusalCode } : {}),
      observedAt: this.clock.now().toISOString(),
      walSequence,
    };
  }

  private async loadWal(): Promise<
    | { status: "ok"; document: WalDocument }
    | { status: "unavailable" }
  > {
    try {
      const raw = await fs.readFile(this.walPath, "utf8");
      const parsed = JSON.parse(raw) as WalDocument;
      if (parsed.schemaVersion !== 1 || !parsed.intents || !Array.isArray(parsed.entries)) {
        throw new Error("invalid WAL shape");
      }
      for (let index = 0; index < parsed.entries.length; index += 1) {
        const entry = parsed.entries[index];
        if (entry.sequence !== index + 1 || parsed.intents[entry.actionId] === undefined
          || comparatorSIntentHash(parsed.intents[entry.actionId]) !== entry.intentHash) {
          throw new Error("non-prefix or conflicting WAL");
        }
      }
      return { status: "ok", document: parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "ok", document: { schemaVersion: 1, intents: {}, entries: [] } };
      }
      this.audit(`Comparator S WAL unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "unavailable" };
    }
  }

  private async persistWal(document: WalDocument): Promise<boolean> {
    try {
      await this.atomicPersist(this.walPath, document);
      return true;
    } catch (error) {
      this.audit(`Comparator S WAL write failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async receiptFor(actionId: ActionId): Promise<
    { receipt: AtomicReplaceReceipt | null; status: "ok" | "unavailable" }
  > {
    const loaded = await this.loadReceipts();
    return loaded.status === "ok"
      ? { status: "ok", receipt: loaded.document.receipts[actionId] ?? null }
      : { status: "unavailable", receipt: null };
  }

  private async loadReceipts(): Promise<
    | { status: "ok"; document: ReceiptDocument }
    | { status: "unavailable" }
  > {
    try {
      const raw = await fs.readFile(this.receiptPath, "utf8");
      const parsed = JSON.parse(raw) as ReceiptDocument;
      if (parsed.schemaVersion !== 1 || !parsed.receipts || typeof parsed.receipts !== "object") {
        throw new Error("invalid receipt shape");
      }
      return { status: "ok", document: parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "ok", document: { schemaVersion: 1, receipts: {} } };
      }
      this.audit(`Comparator S receipts unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "unavailable" };
    }
  }

  private async persistReceipt(receipt: AtomicReplaceReceipt): Promise<boolean> {
    const loaded = await this.loadReceipts();
    if (loaded.status !== "ok") return false;
    const existing = loaded.document.receipts[receipt.actionId];
    if (existing) return JSON.stringify(existing) === JSON.stringify(receipt);
    loaded.document.receipts[receipt.actionId] = receipt;
    try {
      await this.atomicPersist(this.receiptPath, loaded.document);
      return true;
    } catch (error) {
      this.audit(`Comparator S receipt write failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async atomicPersist(targetPath: string, document: unknown): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    const tempPath = `${targetPath}.${process.pid}.${this.tempCounter += 1}.tmp`;
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, targetPath);
      const directory = await fs.open(path.dirname(targetPath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }
}
