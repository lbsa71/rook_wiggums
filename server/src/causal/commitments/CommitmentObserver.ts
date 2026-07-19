import { createHash } from "node:crypto";
import type { IClock } from "../../substrate/abstractions/IClock";
import type { EvidenceRefRegistry } from "../EvidenceRefRegistry";
import type {
  ActorRef,
  CausalRecordId,
  CommitmentId,
  TransitionId,
} from "../Identifiers";
import { recordVersion } from "../Identifiers";
import type { ShadowCommitmentStore } from "./ShadowCommitmentStore";

export interface ShadowDispatchObservation {
  taskId: string;
  cycleNumber: number;
  correlationId?: string;
}

export interface CommitmentObserverHealth {
  authority: "none-shadow-only";
  scheduled: number;
  completed: number;
  failed: number;
  pending: number;
}

/**
 * Fire-and-forget adapter. Its only public production method returns void and
 * exposes no authorization or inhibition result.
 */
export class CommitmentObserver {
  private scheduled = 0;
  private completed = 0;
  private failed = 0;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly registry: EvidenceRefRegistry,
    private readonly store: ShadowCommitmentStore,
    private readonly clock: IClock,
  ) {}

  observeTaskDispatch(observation: ShadowDispatchObservation): void {
    this.scheduled += 1;
    const work = this.recordTaskDispatch(observation)
      .then(() => { this.completed += 1; })
      .catch(() => { this.failed += 1; });
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  getHealth(): CommitmentObserverHealth {
    return {
      authority: "none-shadow-only",
      scheduled: this.scheduled,
      completed: this.completed,
      failed: this.failed,
      pending: this.pending.size,
    };
  }

  /** Test/shutdown observability only; production dispatch never calls this. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private async recordTaskDispatch(observation: ShadowDispatchObservation): Promise<void> {
    const observedAt = this.clock.now().toISOString();
    const evidencePayload = Buffer.from(JSON.stringify({
      kind: "loop_task_dispatch",
      taskId: observation.taskId,
      cycleNumber: observation.cycleNumber,
      ...(observation.correlationId ? { correlationId: observation.correlationId } : {}),
    }), "utf8");
    const registered = await this.registry.register("application/json", evidencePayload);
    if (registered.status !== "registered" && registered.status !== "already_registered") return;
    const resolved = await this.registry.resolve(registered.ref);
    if (resolved.status !== "resolved") return;

    const stable = createHash("sha256")
      .update(`${observation.cycleNumber}\n${observation.taskId}\n${observation.correlationId ?? ""}`)
      .digest("hex");
    const commitmentId = `commitment:shadow:${stable}` as CommitmentId;
    const owner = "actor:loop-orchestrator" as ActorRef;
    const proposedId = `transition:shadow:${stable}:proposed` as TransitionId;
    const committedId = `transition:shadow:${stable}:committed` as TransitionId;
    const executionId = `observation:shadow:${stable}:execution` as CausalRecordId;

    const proposed = await this.store.append({
      kind: "shadow_commitment_transition",
      schemaVersion: 1,
      transitionId: proposedId,
      commitmentId,
      expectedVersion: recordVersion(0),
      resultingVersion: recordVersion(1),
      from: null,
      to: "proposed",
      owner,
      observedActor: owner,
      observedAuthorityPath: "plan",
      grounds: [resolved.ref],
      revisionAuthority: [owner],
      observedAt,
      provenance: [],
      shadowOnly: true,
    });
    if (proposed.status !== "appended" && proposed.status !== "duplicate") return;

    const committed = await this.store.append({
      kind: "shadow_commitment_transition",
      schemaVersion: 1,
      transitionId: committedId,
      commitmentId,
      expectedVersion: recordVersion(1),
      resultingVersion: recordVersion(2),
      from: "proposed",
      to: "committed",
      owner,
      observedActor: owner,
      observedAuthorityPath: "plan",
      grounds: [resolved.ref],
      revisionAuthority: [owner],
      observedAt,
      provenance: [proposedId],
      shadowOnly: true,
    });
    if (committed.status !== "appended" && committed.status !== "duplicate") return;

    await this.store.append({
      kind: "shadow_effect_observation",
      schemaVersion: 1,
      observationId: executionId,
      commitmentId,
      phase: "execution_observed",
      observedAt,
      observedAuthorityPath: "loop_dispatch",
      evidence: [resolved.ref],
      provenance: [committedId],
      shadowOnly: true,
    });
  }
}
