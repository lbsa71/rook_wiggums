import { createHash } from "node:crypto";
import { recordVersion } from "../Identifiers";
import type {
  ShadowCommitmentSnapshot,
  ShadowCommitmentTransition,
  ShadowDiagnostic,
  ShadowEffectObservation,
  ShadowLedgerEvent,
  ShadowLedgerHealth,
  ShadowProjectedState,
  ShadowReplayResult,
} from "./CommitmentTypes";

const allowedTransitions: Record<"absent" | ShadowProjectedState, ReadonlySet<ShadowProjectedState>> = {
  absent: new Set(["proposed"]),
  proposed: new Set(["endorsed", "committed", "deferred", "vetoed", "expired", "revoked"]),
  endorsed: new Set(["committed", "deferred", "suspended", "vetoed", "expired", "revoked"]),
  committed: new Set(["suspended", "expired", "revoked"]),
  deferred: new Set(["proposed", "endorsed", "committed", "expired", "revoked"]),
  suspended: new Set(["committed", "expired", "revoked"]),
  vetoed: new Set(["proposed"]),
  expired: new Set(["proposed"]),
  revoked: new Set(),
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function canonicalShadowEvent(event: ShadowLedgerEvent): string {
  return JSON.stringify(canonicalValue(event));
}

function eventId(event: ShadowLedgerEvent): string {
  return event.kind === "shadow_commitment_transition"
    ? event.transitionId
    : event.observationId;
}

function diagnose(
  diagnostics: ShadowDiagnostic[],
  event: ShadowLedgerEvent,
  code: ShadowDiagnostic["code"],
  detail: string,
): void {
  diagnostics.push({
    code,
    eventId: eventId(event),
    ...(event.commitmentId ? { commitmentId: event.commitmentId } : {}),
    detail,
  });
}

function applyTransition(result: ShadowReplayResult, event: ShadowCommitmentTransition): void {
  const current = result.commitments.get(event.commitmentId);
  const currentState = current?.shadowProjectedState ?? null;
  const currentVersion = current?.version ?? recordVersion(0);

  if (event.from !== currentState || !allowedTransitions[currentState ?? "absent"].has(event.to)) {
    diagnose(result.diagnostics, event, "invalid_transition", `${currentState ?? "absent"}->${event.to}`);
    return;
  }
  if (event.expectedVersion !== currentVersion
    || event.resultingVersion !== event.expectedVersion + 1) {
    diagnose(result.diagnostics, event, "version_conflict", `${event.expectedVersion}->${event.resultingVersion}`);
    return;
  }
  if (!event.revisionAuthority.includes(event.observedActor)) {
    diagnose(result.diagnostics, event, "actor_violation", event.observedActor);
    return;
  }
  if (currentState === "revoked") {
    diagnose(result.diagnostics, event, "invalid_transition", "revoked commitments never reopen");
    return;
  }

  result.commitments.set(event.commitmentId, {
    commitmentId: event.commitmentId,
    version: event.resultingVersion,
    shadowProjectedState: event.to,
    owner: event.owner,
    lastTransitionId: event.transitionId,
    executionObserved: current?.executionObserved ?? false,
  });
}

function applyEffect(result: ShadowReplayResult, event: ShadowEffectObservation): void {
  if (!event.commitmentId) {
    diagnose(result.diagnostics, event, "bypass_observation", "effect has no commitment reference");
    return;
  }
  const current = result.commitments.get(event.commitmentId);
  if (!current) {
    diagnose(result.diagnostics, event, "bypass_observation", "effect precedes any projected commitment");
    return;
  }
  if (event.phase === "execution_observed") {
    result.commitments.set(event.commitmentId, { ...current, executionObserved: true });
  }
}

export function replayShadowLedger(events: readonly ShadowLedgerEvent[]): ShadowReplayResult {
  const result: ShadowReplayResult = {
    commitments: new Map(),
    diagnostics: [],
    eventPayloads: new Map(),
  };

  for (const event of events) {
    const id = eventId(event);
    const payload = canonicalShadowEvent(event);
    const existingPayload = result.eventPayloads.get(id);
    if (existingPayload !== undefined) {
      if (existingPayload !== payload) diagnose(result.diagnostics, event, "duplicate_conflict", id);
      continue;
    }
    result.eventPayloads.set(id, payload);
    if (event.kind === "shadow_commitment_transition") applyTransition(result, event);
    else applyEffect(result, event);
  }
  return result;
}

export function shadowLedgerHealth(events: readonly ShadowLedgerEvent[]): ShadowLedgerHealth {
  const replay = replayShadowLedger(events);
  const commitmentsByState: ShadowLedgerHealth["commitmentsByState"] = {};
  for (const commitment of replay.commitments.values()) {
    commitmentsByState[commitment.shadowProjectedState] =
      (commitmentsByState[commitment.shadowProjectedState] ?? 0) + 1;
  }
  const diagnosticsByCode: ShadowLedgerHealth["diagnosticsByCode"] = {};
  for (const diagnostic of replay.diagnostics) {
    diagnosticsByCode[diagnostic.code] = (diagnosticsByCode[diagnostic.code] ?? 0) + 1;
  }
  const last = events.at(-1);
  const derived = [...replay.commitments.values()]
    .sort((a, b) => a.commitmentId.localeCompare(b.commitmentId));
  return {
    schemaVersion: 1,
    authority: "none-shadow-only",
    totalEvents: events.length,
    commitmentsByState,
    diagnosticsByCode,
    lastValidEventId: last ? eventId(last) : null,
    lastValidEventAt: last?.observedAt ?? null,
    derivedStateChecksum: createHash("sha256").update(JSON.stringify(derived)).digest("hex"),
  };
}

export function withExecutionObserved(
  snapshot: ShadowCommitmentSnapshot,
): ShadowCommitmentSnapshot {
  return { ...snapshot, executionObserved: true };
}
