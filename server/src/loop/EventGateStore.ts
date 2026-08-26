import { createHash } from "node:crypto";
import * as path from "node:path";
import type { IFileSystem } from "../substrate/abstractions/IFileSystem";

export type EventGateObservationMode = "existence" | "metadata" | "content";

export interface EventGateDependency {
  /** Absolute path under one of the configured event-gate roots. */
  path: string;
  observation: EventGateObservationMode;
}

export interface EventGateRequest {
  releaseCondition: {
    type: "dependency_fingerprint_changed";
    dependencies: EventGateDependency[];
  };
}

export interface EventGateRecord {
  taskId: string;
  taskDescriptionFingerprint: string;
  observedConditionFingerprint: string;
  releaseCondition: EventGateRequest["releaseCondition"];
  createdAt: string;
  /** Measured latency of the dispatch that established the unchanged condition. */
  baselineDispatchLatencyMs: number;
  /** Durable human-status bytes emitted by the establishing dispatch. */
  baselineStatusBytes: number;
  /** Set only after the single human-readable status write succeeds. */
  statusEntryWritten: boolean;
}

interface EventGateState {
  version: 1;
  gates: EventGateRecord[];
}

export type EventGateEvaluation =
  | { eligible: true; reason: "no_gate" | "dependency_changed" | "task_changed" | "inspection_failed" | "status_unconfirmed" }
  | { eligible: false; reason: "unchanged"; record: EventGateRecord };

const MAX_DEPENDENCIES = 8;
const MAX_CONTENT_OBSERVATION_BYTES = 1024 * 1024;

/**
 * Durable event-gate state. The store persists one replace-in-place record per
 * blocked task; unchanged checks never append status history. Corrupt or
 * unreadable state fails open so an efficiency feature cannot starve work.
 */
export class EventGateStore {
  private readonly tempPath: string;
  private readonly allowedRoots: string[];

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly statePath: string,
    allowedRoots: string[],
    private readonly warn: (message: string) => void,
  ) {
    this.tempPath = `${statePath}.tmp`;
    this.allowedRoots = [...new Set(
      allowedRoots
        .filter((root) => typeof root === "string" && root.length > 0)
        .map((root) => path.resolve(root)),
    )];
  }

  async arm(
    taskId: string,
    taskDescription: string,
    request: EventGateRequest,
    createdAt: string,
    baselineDispatchLatencyMs: number,
    baselineStatusBytes: number,
  ): Promise<EventGateRecord> {
    const releaseCondition = this.normalizeReleaseCondition(request.releaseCondition);
    const observedConditionFingerprint = await this.fingerprint(releaseCondition.dependencies);
    const record: EventGateRecord = {
      taskId,
      taskDescriptionFingerprint: hash(taskDescription),
      observedConditionFingerprint,
      releaseCondition,
      createdAt,
      baselineDispatchLatencyMs: Math.max(0, Math.round(baselineDispatchLatencyMs)),
      baselineStatusBytes: Math.max(0, Math.round(baselineStatusBytes)),
      statusEntryWritten: false,
    };
    const state = await this.loadState();
    const gates = [...state.gates.filter((gate) => gate.taskId !== taskId), record];
    await this.write({ version: 1, gates });
    return record;
  }

  async evaluate(taskId: string, taskDescription: string): Promise<EventGateEvaluation> {
    const state = await this.loadState();
    const record = state.gates.find((gate) => gate.taskId === taskId);
    if (!record) return { eligible: true, reason: "no_gate" };

    // A crash after gate persistence but before its one status write must not
    // silently suppress the task forever.
    if (!record.statusEntryWritten) {
      await this.removeFromState(state, taskId);
      return { eligible: true, reason: "status_unconfirmed" };
    }

    if (record.taskDescriptionFingerprint !== hash(taskDescription)) {
      await this.removeFromState(state, taskId);
      return { eligible: true, reason: "task_changed" };
    }

    try {
      // Re-validate persisted paths on every load so manual state-file edits
      // cannot expand the configured read boundary.
      const releaseCondition = this.normalizeReleaseCondition(record.releaseCondition);
      const currentFingerprint = await this.fingerprint(releaseCondition.dependencies);
      if (currentFingerprint === record.observedConditionFingerprint) {
        return { eligible: false, reason: "unchanged", record };
      }
      await this.removeFromState(state, taskId);
      return { eligible: true, reason: "dependency_changed" };
    } catch (error) {
      this.warn(`event-gate dependency inspection failed for ${taskId}; failing open: ${error instanceof Error ? error.message : String(error)}`);
      await this.removeFromState(state, taskId).catch(() => undefined);
      return { eligible: true, reason: "inspection_failed" };
    }
  }

  async load(): Promise<EventGateRecord[]> {
    return (await this.loadState()).gates;
  }

  async clear(taskId: string): Promise<void> {
    const state = await this.loadState();
    await this.removeFromState(state, taskId);
  }

  async confirmStatusWritten(taskId: string): Promise<void> {
    const state = await this.loadState();
    const record = state.gates.find((gate) => gate.taskId === taskId);
    if (!record) throw new Error(`cannot confirm missing event gate: ${taskId}`);
    if (record.statusEntryWritten) return;
    await this.write({
      version: 1,
      gates: state.gates.map((gate) => gate.taskId === taskId
        ? { ...gate, statusEntryWritten: true }
        : gate),
    });
  }

  private normalizeReleaseCondition(
    condition: EventGateRequest["releaseCondition"],
  ): EventGateRequest["releaseCondition"] {
    if (!condition || condition.type !== "dependency_fingerprint_changed") {
      throw new Error("event gate requires releaseCondition.type=dependency_fingerprint_changed");
    }
    if (!Array.isArray(condition.dependencies)
      || condition.dependencies.length === 0
      || condition.dependencies.length > MAX_DEPENDENCIES) {
      throw new Error(`event gate requires 1-${MAX_DEPENDENCIES} dependencies`);
    }

    const dependencies = condition.dependencies.map((dependency) => {
      if (!dependency || typeof dependency.path !== "string" || !path.isAbsolute(dependency.path)) {
        throw new Error("event-gate dependency paths must be absolute");
      }
      if (!["existence", "metadata", "content"].includes(dependency.observation)) {
        throw new Error("event-gate dependency observation must be existence, metadata, or content");
      }
      const resolved = path.resolve(dependency.path);
      if (!this.allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
        throw new Error(`event-gate dependency is outside configured roots: ${resolved}`);
      }
      return { path: resolved, observation: dependency.observation };
    });

    dependencies.sort((a, b) => `${a.path}\0${a.observation}`.localeCompare(`${b.path}\0${b.observation}`));
    return { type: "dependency_fingerprint_changed", dependencies };
  }

  private async fingerprint(dependencies: EventGateDependency[]): Promise<string> {
    const observations: string[] = [];
    for (const dependency of dependencies) {
      const exists = await this.fileSystem.exists(dependency.path);
      if (!exists) {
        observations.push(JSON.stringify([dependency.path, dependency.observation, "missing"]));
        continue;
      }
      if (dependency.observation === "existence") {
        observations.push(JSON.stringify([dependency.path, dependency.observation, "present"]));
        continue;
      }
      const stat = await this.fileSystem.stat(dependency.path);
      if (dependency.observation === "metadata") {
        observations.push(JSON.stringify([
          dependency.path,
          dependency.observation,
          stat.isFile,
          stat.isDirectory,
          stat.size,
          stat.mtimeMs,
        ]));
        continue;
      }
      if (!stat.isFile) throw new Error(`content observation requires a file: ${dependency.path}`);
      if (stat.size > MAX_CONTENT_OBSERVATION_BYTES) {
        throw new Error(`content observation exceeds ${MAX_CONTENT_OBSERVATION_BYTES} bytes: ${dependency.path}`);
      }
      observations.push(JSON.stringify([
        dependency.path,
        dependency.observation,
        hash(await this.fileSystem.readFile(dependency.path)),
      ]));
    }
    return hash(observations.join("\n"));
  }

  private async loadState(): Promise<EventGateState> {
    try {
      if (!await this.fileSystem.exists(this.statePath)) return { version: 1, gates: [] };
      const parsed = JSON.parse(await this.fileSystem.readFile(this.statePath)) as unknown;
      if (!isEventGateState(parsed)) throw new Error("state does not match version 1 schema");
      return parsed;
    } catch (error) {
      this.warn(`corrupt event-gate state at ${this.statePath}; failing open: ${error instanceof Error ? error.message : String(error)}`);
      try {
        if (await this.fileSystem.exists(this.statePath)) await this.fileSystem.unlink(this.statePath);
      } catch (cleanupError) {
        this.warn(`failed to remove corrupt event-gate state at ${this.statePath}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
      return { version: 1, gates: [] };
    }
  }

  private async removeFromState(state: EventGateState, taskId: string): Promise<void> {
    const gates = state.gates.filter((gate) => gate.taskId !== taskId);
    if (gates.length === state.gates.length) return;
    if (gates.length === 0) {
      if (await this.fileSystem.exists(this.statePath)) await this.fileSystem.unlink(this.statePath);
      return;
    }
    await this.write({ version: 1, gates });
  }

  private async write(state: EventGateState): Promise<void> {
    await this.fileSystem.mkdir(path.dirname(this.statePath), { recursive: true });
    await this.fileSystem.writeFile(this.tempPath, `${JSON.stringify(state, null, 2)}\n`);
    await this.fileSystem.rename(this.tempPath, this.statePath);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isEventGateState(value: unknown): value is EventGateState {
  if (!value || typeof value !== "object") return false;
  const state = value as { version?: unknown; gates?: unknown };
  return state.version === 1
    && Array.isArray(state.gates)
    && state.gates.every(isEventGateRecord);
}

function isEventGateRecord(value: unknown): value is EventGateRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const condition = record.releaseCondition as Record<string, unknown> | undefined;
  return typeof record.taskId === "string"
    && typeof record.taskDescriptionFingerprint === "string"
    && typeof record.observedConditionFingerprint === "string"
    && typeof record.createdAt === "string"
    && typeof record.baselineDispatchLatencyMs === "number"
    && typeof record.baselineStatusBytes === "number"
    && typeof record.statusEntryWritten === "boolean"
    && condition?.type === "dependency_fingerprint_changed"
    && Array.isArray(condition.dependencies)
    && condition.dependencies.every((dependency) => {
      if (!dependency || typeof dependency !== "object") return false;
      const candidate = dependency as Record<string, unknown>;
      return typeof candidate.path === "string"
        && ["existence", "metadata", "content"].includes(candidate.observation as string);
    });
}
