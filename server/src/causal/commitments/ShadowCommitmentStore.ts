import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IClock } from "../../substrate/abstractions/IClock";
import type { EvidenceRefRegistry } from "../EvidenceRefRegistry";
import {
  canonicalShadowEvent,
  replayShadowLedger,
  shadowLedgerHealth,
} from "./CommitmentStateMachine";
import type {
  ShadowLedgerEvent,
  ShadowLedgerHealth,
} from "./CommitmentTypes";

interface StoredShadowLedger {
  schemaVersion: 1;
  epoch: string;
  events: ShadowLedgerEvent[];
  derivedStateChecksum: string;
}

export type ShadowAppendResult =
  | { status: "appended" | "duplicate"; health: ShadowLedgerHealth }
  | { status: "rejected"; reason: "unresolvable_evidence" | "invalid_event"; refs?: string[] }
  | { status: "unavailable"; reason: "corrupt_store" | "write_failed" | "wrong_schema" };

export interface ShadowCommitmentStoreOptions {
  audit?: (message: string) => void;
}

function eventId(event: ShadowLedgerEvent): string {
  return event.kind === "shadow_commitment_transition" ? event.transitionId : event.observationId;
}

function evidenceRefs(event: ShadowLedgerEvent): readonly string[] {
  return event.kind === "shadow_commitment_transition" ? event.grounds : event.evidence;
}

function isShadowLedgerEvent(value: unknown): value is ShadowLedgerEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1
    && candidate.shadowOnly === true
    && typeof candidate.observedAt === "string"
    && (candidate.kind === "shadow_commitment_transition"
      ? typeof candidate.transitionId === "string"
      : candidate.kind === "shadow_effect_observation"
        && typeof candidate.observationId === "string");
}

export class ShadowCommitmentStore {
  private serial: Promise<void> = Promise.resolve();
  private tempCounter = 0;
  private readonly audit: (message: string) => void;

  constructor(
    private readonly storePath: string,
    private readonly registry: EvidenceRefRegistry,
    private readonly clock: IClock,
    options: ShadowCommitmentStoreOptions = {},
  ) {
    this.audit = options.audit ?? (() => undefined);
  }

  async append(event: ShadowLedgerEvent): Promise<ShadowAppendResult> {
    return this.serialize(() => this.appendSerialized(event));
  }

  async readHealth(): Promise<ShadowLedgerHealth> {
    const loaded = await this.load();
    return shadowLedgerHealth(loaded.status === "ok" ? loaded.document.events : []);
  }

  private async appendSerialized(event: ShadowLedgerEvent): Promise<ShadowAppendResult> {
    if (!isShadowLedgerEvent(event)) return { status: "rejected", reason: "invalid_event" };

    const refs = evidenceRefs(event);
    if (refs.length === 0) return { status: "rejected", reason: "invalid_event" };
    const unresolved: string[] = [];
    for (const ref of refs) {
      const resolution = await this.registry.resolve(ref);
      if (resolution.status !== "resolved") unresolved.push(ref);
    }
    if (unresolved.length > 0) {
      this.audit(`shadow ledger rejected unresolvable evidence: ${unresolved.join(",")}`);
      return { status: "rejected", reason: "unresolvable_evidence", refs: unresolved };
    }

    const loaded = await this.load();
    if (loaded.status !== "ok") return { status: "unavailable", reason: loaded.reason };
    const events = loaded.document.events;
    const id = eventId(event);
    const existing = events.find((candidate) => eventId(candidate) === id);
    if (existing) {
      if (canonicalShadowEvent(existing) === canonicalShadowEvent(event)) {
        return { status: "duplicate", health: shadowLedgerHealth(events) };
      }
      return { status: "rejected", reason: "invalid_event" };
    }

    const nextEvents = [...events, event];
    const replay = replayShadowLedger(nextEvents);
    const eventDiagnostics = replay.diagnostics.filter((diagnostic) => diagnostic.eventId === id);
    if (eventDiagnostics.some((diagnostic) =>
      diagnostic.code === "invalid_transition"
      || diagnostic.code === "version_conflict"
      || diagnostic.code === "actor_violation"
      || diagnostic.code === "duplicate_conflict")) {
      return { status: "rejected", reason: "invalid_event" };
    }

    const health = shadowLedgerHealth(nextEvents);
    const document: StoredShadowLedger = {
      schemaVersion: 1,
      epoch: loaded.document.epoch,
      events: nextEvents,
      derivedStateChecksum: health.derivedStateChecksum,
    };
    try {
      await this.persist(document);
      return { status: "appended", health };
    } catch (error) {
      this.audit(`shadow ledger write failed: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "unavailable", reason: "write_failed" };
    }
  }

  private async load(): Promise<
    | { status: "ok"; document: StoredShadowLedger }
    | { status: "error"; reason: "corrupt_store" | "wrong_schema" }
  > {
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredShadowLedger>;
      if (parsed.schemaVersion !== 1) {
        this.audit("shadow ledger disabled for wrong schema");
        return { status: "error", reason: "wrong_schema" };
      }
      if (typeof parsed.epoch !== "string" || !Array.isArray(parsed.events)
        || !parsed.events.every(isShadowLedgerEvent)
        || typeof parsed.derivedStateChecksum !== "string") {
        throw new Error("invalid document shape");
      }
      const computed = shadowLedgerHealth(parsed.events).derivedStateChecksum;
      if (computed !== parsed.derivedStateChecksum) throw new Error("derived checksum mismatch");
      return { status: "ok", document: parsed as StoredShadowLedger };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          status: "ok",
          document: {
            schemaVersion: 1,
            epoch: createHash("sha256")
              .update(`${this.storePath}\n${this.clock.now().toISOString()}`)
              .digest("hex")
              .slice(0, 24),
            events: [],
            derivedStateChecksum: shadowLedgerHealth([]).derivedStateChecksum,
          },
        };
      }
      this.audit(`shadow ledger corrupt and isolated: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "error", reason: "corrupt_store" };
    }
  }

  private async persist(document: StoredShadowLedger): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.storePath}.${process.pid}.${this.tempCounter += 1}.tmp`;
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, this.storePath);
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
