import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import { detectSecrets } from "../substrate/validation/SecretDetector";
import type { EvidenceRef } from "./Identifiers";

export const EVIDENCE_SCHEMA_VERSION = 1 as const;
export const MAX_EVIDENCE_PAYLOAD_BYTES = 64 * 1024;
export const EVIDENCE_REF_PATTERN = /^evidence:sha256:[0-9a-f]{64}$/;

export type EvidenceMediaType = "application/json" | "text/plain;charset=utf-8";

interface StoredEvidence {
  schemaVersion: 1;
  mediaType: EvidenceMediaType;
  payloadBase64: string;
}

export type EvidenceRegistrationResult =
  | { status: "registered" | "already_registered"; ref: EvidenceRef }
  | { status: "conflict"; ref: EvidenceRef }
  | {
    status: "rejected";
    reason:
      | "rejected_media_type"
      | "rejected_payload_too_large"
      | "rejected_invalid_utf8"
      | "rejected_invalid_json"
      | "rejected_secret_detected";
  }
  | { status: "unavailable" };

export type EvidenceResolutionResult =
  | { status: "resolved"; ref: EvidenceRef; mediaType: EvidenceMediaType; payload: Buffer }
  | { status: "missing"; ref: EvidenceRef }
  | { status: "corrupt"; ref: EvidenceRef }
  | { status: "rejected"; reason: "rejected_invalid_reference" }
  | { status: "unavailable"; ref: EvidenceRef };

export interface EvidenceRegistryAuditEvent {
  operation: "register" | "resolve";
  status: EvidenceRegistrationResult["status"] | EvidenceResolutionResult["status"];
  reason?: string;
  byteCount?: number;
  correlationId?: string;
}

export interface EvidenceRegistryOptions {
  audit?: (event: EvidenceRegistryAuditEvent) => void;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function isMediaType(value: string): value is EvidenceMediaType {
  return value === "application/json" || value === "text/plain;charset=utf-8";
}

function canonicalBytes(mediaType: EvidenceMediaType, payload: Buffer): Buffer {
  const header = Buffer.from(
    `rook-evidence-v1\nmedia-type:${mediaType}\nlength:${payload.byteLength}\n\n`,
    "utf8",
  );
  return Buffer.concat([header, payload]);
}

export function computeEvidenceRef(
  mediaType: EvidenceMediaType,
  payload: Buffer,
): EvidenceRef {
  const digest = createHash("sha256").update(canonicalBytes(mediaType, payload)).digest("hex");
  return `evidence:sha256:${digest}` as EvidenceRef;
}

export function parseEvidenceRef(value: unknown): EvidenceRef | null {
  return typeof value === "string" && EVIDENCE_REF_PATTERN.test(value)
    ? value as EvidenceRef
    : null;
}

/**
 * Non-authoritative, content-addressed storage for exact evidence bytes.
 *
 * This service exposes no authorization, dispatch, truth, search, freshness,
 * or mutable-metadata API. It is deliberately not wired into a production
 * action path in Stage 1.
 */
export class EvidenceRefRegistry {
  private readonly root: string;
  private readonly audit: (event: EvidenceRegistryAuditEvent) => void;

  constructor(root: string, options: EvidenceRegistryOptions = {}) {
    this.root = path.resolve(root);
    this.audit = options.audit ?? (() => undefined);
  }

  async register(
    mediaTypeInput: string,
    payloadInput: Uint8Array,
    correlationId?: string,
  ): Promise<EvidenceRegistrationResult> {
    const byteCount = payloadInput.byteLength;
    if (!isMediaType(mediaTypeInput)) {
      return this.registrationRejection("rejected_media_type", byteCount, correlationId);
    }
    if (byteCount > MAX_EVIDENCE_PAYLOAD_BYTES) {
      return this.registrationRejection("rejected_payload_too_large", byteCount, correlationId);
    }

    // Copy only after the size gate; rejected oversize input is never copied or hashed.
    const payload = Buffer.from(payloadInput);
    let decoded: string;
    try {
      decoded = utf8Decoder.decode(payload);
    } catch {
      return this.registrationRejection("rejected_invalid_utf8", byteCount, correlationId);
    }
    if (mediaTypeInput === "application/json") {
      try {
        JSON.parse(decoded);
      } catch {
        return this.registrationRejection("rejected_invalid_json", byteCount, correlationId);
      }
    }
    if (detectSecrets(decoded).hasSecrets) {
      return this.registrationRejection("rejected_secret_detected", byteCount, correlationId);
    }

    const ref = computeEvidenceRef(mediaTypeInput, payload);
    const entryPath = this.entryPath(ref);
    const stored: StoredEvidence = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      mediaType: mediaTypeInput,
      payloadBase64: payload.toString("base64"),
    };

    try {
      await this.ensureSafeRoot();
      const existing = await this.resolve(ref);
      if (existing.status === "resolved") {
        const identical = existing.mediaType === mediaTypeInput
          && existing.payload.equals(payload);
        const result: EvidenceRegistrationResult = identical
          ? { status: "already_registered", ref }
          : { status: "conflict", ref };
        this.emit({ operation: "register", status: result.status, byteCount, correlationId });
        return result;
      }
      if (existing.status === "corrupt" || existing.status === "unavailable") {
        const result: EvidenceRegistrationResult = existing.status === "corrupt"
          ? { status: "conflict", ref }
          : { status: "unavailable" };
        this.emit({ operation: "register", status: result.status, byteCount, correlationId });
        return result;
      }

      const tempPath = `${entryPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      const serialized = `${JSON.stringify(stored)}\n`;
      try {
        // Write and sync a private temp file, then atomically publish it with
        // link(2). Unlike rename, link cannot overwrite a concurrent winner.
        const handle = await fs.open(tempPath, "wx", 0o600);
        try {
          await handle.writeFile(serialized, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.link(tempPath, entryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Another writer won. Resolve and compare instead of replacing it.
        const raced = await this.resolve(ref);
        const identical = raced.status === "resolved"
          && raced.mediaType === mediaTypeInput
          && raced.payload.equals(payload);
        const result: EvidenceRegistrationResult = identical
          ? { status: "already_registered", ref }
          : raced.status === "unavailable"
            ? { status: "unavailable" }
            : { status: "conflict", ref };
        this.emit({ operation: "register", status: result.status, byteCount, correlationId });
        return result;
      } finally {
        await fs.unlink(tempPath).catch(() => undefined);
      }

      const result: EvidenceRegistrationResult = { status: "registered", ref };
      this.emit({ operation: "register", status: result.status, byteCount, correlationId });
      return result;
    } catch {
      const result: EvidenceRegistrationResult = { status: "unavailable" };
      this.emit({ operation: "register", status: result.status, byteCount, correlationId });
      return result;
    }
  }

  async resolve(refInput: unknown): Promise<EvidenceResolutionResult> {
    const ref = parseEvidenceRef(refInput);
    if (!ref) {
      const result: EvidenceResolutionResult = {
        status: "rejected",
        reason: "rejected_invalid_reference",
      };
      this.emit({ operation: "resolve", status: result.status, reason: result.reason });
      return result;
    }

    try {
      await this.ensureSafeRoot();
      const entryPath = this.entryPath(ref);
      let entryStat;
      try {
        entryStat = await fs.lstat(entryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const result: EvidenceResolutionResult = { status: "missing", ref };
          this.emit({ operation: "resolve", status: result.status });
          return result;
        }
        throw error;
      }
      if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
        const result: EvidenceResolutionResult = { status: "corrupt", ref };
        this.emit({ operation: "resolve", status: result.status });
        return result;
      }

      const realEntry = await fs.realpath(entryPath);
      if (path.dirname(realEntry) !== await fs.realpath(this.root)) {
        const result: EvidenceResolutionResult = { status: "corrupt", ref };
        this.emit({ operation: "resolve", status: result.status });
        return result;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await fs.readFile(realEntry, "utf8"));
      } catch {
        const result: EvidenceResolutionResult = { status: "corrupt", ref };
        this.emit({ operation: "resolve", status: result.status });
        return result;
      }
      if (!this.isStoredEvidence(parsed)) {
        const result: EvidenceResolutionResult = { status: "corrupt", ref };
        this.emit({ operation: "resolve", status: result.status });
        return result;
      }
      const payload = Buffer.from(parsed.payloadBase64, "base64");
      if (payload.byteLength > MAX_EVIDENCE_PAYLOAD_BYTES
        || payload.toString("base64") !== parsed.payloadBase64
        || computeEvidenceRef(parsed.mediaType, payload) !== ref) {
        const result: EvidenceResolutionResult = { status: "corrupt", ref };
        this.emit({ operation: "resolve", status: result.status });
        return result;
      }
      try {
        const decoded = utf8Decoder.decode(payload);
        if (parsed.mediaType === "application/json") JSON.parse(decoded);
        if (detectSecrets(decoded).hasSecrets) {
          const result: EvidenceResolutionResult = { status: "corrupt", ref };
          this.emit({ operation: "resolve", status: result.status });
          return result;
        }
      } catch {
        const result: EvidenceResolutionResult = { status: "corrupt", ref };
        this.emit({ operation: "resolve", status: result.status });
        return result;
      }

      const result: EvidenceResolutionResult = {
        status: "resolved",
        ref,
        mediaType: parsed.mediaType,
        payload,
      };
      this.emit({ operation: "resolve", status: result.status, byteCount: payload.byteLength });
      return result;
    } catch {
      const result: EvidenceResolutionResult = { status: "unavailable", ref };
      this.emit({ operation: "resolve", status: result.status });
      return result;
    }
  }

  async reportOrphans(refs: readonly unknown[]): Promise<EvidenceRef[]> {
    const missing: EvidenceRef[] = [];
    for (const candidate of refs) {
      const result = await this.resolve(candidate);
      if (result.status === "missing") missing.push(result.ref);
    }
    return missing;
  }

  private async ensureSafeRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("evidence registry root must be a real directory");
    }
  }

  private entryPath(ref: EvidenceRef): string {
    const digest = ref.slice("evidence:sha256:".length);
    return path.join(this.root, `${digest}.json`);
  }

  private isStoredEvidence(value: unknown): value is StoredEvidence {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.schemaVersion === EVIDENCE_SCHEMA_VERSION
      && typeof record.mediaType === "string"
      && isMediaType(record.mediaType)
      && typeof record.payloadBase64 === "string";
  }

  private registrationRejection(
    reason: Extract<EvidenceRegistrationResult, { status: "rejected" }>["reason"],
    byteCount: number,
    correlationId?: string,
  ): EvidenceRegistrationResult {
    const result: EvidenceRegistrationResult = { status: "rejected", reason };
    this.emit({ operation: "register", status: result.status, reason, byteCount, correlationId });
    return result;
  }

  private emit(event: EvidenceRegistryAuditEvent): void {
    try {
      this.audit(event);
    } catch {
      // Observability must not become registry authority or runtime backpressure.
    }
  }
}
