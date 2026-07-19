import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  computeEvidenceRef,
  EvidenceRefRegistry,
  type EvidenceMediaType,
} from "../src/causal/EvidenceRefRegistry";
import type { EvidenceRef } from "../src/causal/Identifiers";

interface WorkloadClass {
  name: string;
  payloadBytes: number;
  share: number;
}

const PROFILE: readonly WorkloadClass[] = [
  { name: "dispatch-observation", payloadBytes: 256, share: 0.40 },
  { name: "bounded-structured-note", payloadBytes: 1_024, share: 0.30 },
  { name: "decision-context", payloadBytes: 4_096, share: 0.20 },
  { name: "large-receipt", payloadBytes: 16_384, share: 0.08 },
  { name: "near-limit-artifact", payloadBytes: 49_152, share: 0.02 },
] as const;

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function fixedPayload(index: number, size: number): Buffer {
  const metadata = JSON.stringify({
    kind: "synthetic_evidence_pressure",
    index,
    observedAt: "2026-07-19T00:00:00.000Z",
  });
  const fillerLength = Math.max(0, size - Buffer.byteLength(metadata) - 24);
  const payload = Buffer.from(
    JSON.stringify({ metadata: JSON.parse(metadata), body: "x".repeat(fillerLength) }),
    "utf8",
  );
  if (payload.byteLength > size) return payload.subarray(0, size);
  return Buffer.concat([payload, Buffer.alloc(size - payload.byteLength, 0x20)]);
}

async function storageBytes(root: string): Promise<{ serializedBytes: number; allocatedBytes: number }> {
  const entries = await fs.readdir(root);
  const stats = await Promise.all(entries.map(async (entry) => fs.stat(path.join(root, entry))));
  return {
    serializedBytes: stats.reduce((sum, stat) => sum + stat.size, 0),
    allocatedBytes: stats.reduce((sum, stat) => sum + stat.blocks * 512, 0),
  };
}

async function main(): Promise<void> {
  const uniqueCount = Number.parseInt(process.argv[2] ?? "2000", 10);
  const duplicateRate = Number.parseFloat(process.argv[3] ?? "0.25");
  const orphanRate = Number.parseFloat(process.argv[4] ?? "0.05");
  if (!Number.isSafeInteger(uniqueCount) || uniqueCount < 1) throw new Error("uniqueCount must be positive");
  if (duplicateRate < 0 || duplicateRate > 1 || orphanRate < 0 || orphanRate > 1) {
    throw new Error("rates must be between 0 and 1");
  }

  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "rook-evidence-pressure-"));
  const root = path.join(parent, "registry");
  const registry = new EvidenceRefRegistry(root);
  const refs: EvidenceRef[] = [];
  const payloads: Buffer[] = [];
  let logicalPayloadBytes = 0;

  try {
    const registrationStart = performance.now();
    for (let index = 0; index < uniqueCount; index += 1) {
      const position = (index + 0.5) / uniqueCount;
      let cumulative = 0;
      const workload = PROFILE.find((item) => {
        cumulative += item.share;
        return position <= cumulative;
      }) ?? PROFILE[PROFILE.length - 1];
      const payload = fixedPayload(index, workload.payloadBytes);
      logicalPayloadBytes += payload.byteLength;
      const result = await registry.register("application/json", payload);
      if (result.status !== "registered") throw new Error(`unexpected registration status: ${result.status}`);
      refs.push(result.ref);
      payloads.push(payload);
    }
    const registrationMs = performance.now() - registrationStart;

    const duplicateAttempts = Math.round(uniqueCount * duplicateRate);
    let duplicates = 0;
    const duplicateStart = performance.now();
    for (let index = 0; index < duplicateAttempts; index += 1) {
      const workloadIndex = index % refs.length;
      const result = await registry.register("application/json", payloads[workloadIndex]);
      if (result.status === "already_registered") duplicates += 1;
    }
    const duplicateMs = performance.now() - duplicateStart;

    const resolutionLatenciesMs: number[] = [];
    for (const ref of refs) {
      const started = performance.now();
      const result = await registry.resolve(ref);
      resolutionLatenciesMs.push(performance.now() - started);
      if (result.status !== "resolved") throw new Error(`unexpected resolution status: ${result.status}`);
    }
    resolutionLatenciesMs.sort((a, b) => a - b);

    const missingCount = Math.max(1, Math.round(uniqueCount * orphanRate));
    const inventory = refs.slice();
    for (let index = 0; index < missingCount; index += 1) {
      inventory.push(computeEvidenceRef(
        "text/plain;charset=utf-8" satisfies EvidenceMediaType,
        Buffer.from(`synthetic-missing-${index}`, "utf8"),
      ));
    }
    const orphanStarted = performance.now();
    const orphans = await registry.reportOrphans(inventory);
    const orphanScanMs = performance.now() - orphanStarted;
    const storedBytes = await storageBytes(root);
    const entryCount = (await fs.readdir(root)).length;
    const output = {
      schemaVersion: 1,
      workload: {
        uniqueCount,
        duplicateAttemptRate: duplicateRate,
        syntheticMissingRateOfStored: orphanRate,
        profile: PROFILE,
      },
      results: {
        registered: refs.length,
        entryCount,
        logicalPayloadBytes,
        serializedBytes: storedBytes.serializedBytes,
        allocatedBytes: storedBytes.allocatedBytes,
        serializedAmplification: storedBytes.serializedBytes / logicalPayloadBytes,
        allocatedAmplification: storedBytes.allocatedBytes / logicalPayloadBytes,
        duplicateAttempts,
        duplicatesCoalesced: duplicates,
        duplicateCoalescingRate: duplicateAttempts === 0 ? 0 : duplicates / duplicateAttempts,
        orphanInventorySize: inventory.length,
        orphanCount: orphans.length,
        orphanRate: orphans.length / inventory.length,
        registration: { totalMs: registrationMs, entriesPerSecond: uniqueCount / (registrationMs / 1000) },
        duplicateRegistration: { totalMs: duplicateMs },
        resolutionLatencyMs: {
          p50: percentile(resolutionLatenciesMs, 0.50),
          p95: percentile(resolutionLatenciesMs, 0.95),
          p99: percentile(resolutionLatenciesMs, 0.99),
          max: resolutionLatenciesMs.at(-1) ?? 0,
        },
        orphanScan: { totalMs: orphanScanMs, refsPerSecond: inventory.length / (orphanScanMs / 1000) },
      },
      reproducibility: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        profileSha256: createHash("sha256").update(JSON.stringify(PROFILE)).digest("hex"),
      },
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

await main();
