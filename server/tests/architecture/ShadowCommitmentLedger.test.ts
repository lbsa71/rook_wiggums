import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EvidenceRefRegistry } from "../../src/causal/EvidenceRefRegistry";
import type {
  ActorRef,
  CommitmentId,
  EvidenceRef,
  TransitionId,
} from "../../src/causal/Identifiers";
import { recordVersion } from "../../src/causal/Identifiers";
import { CommitmentObserver } from "../../src/causal/commitments/CommitmentObserver";
import { replayShadowLedger } from "../../src/causal/commitments/CommitmentStateMachine";
import { ShadowCommitmentStore } from "../../src/causal/commitments/ShadowCommitmentStore";
import type { ShadowCommitmentTransition } from "../../src/causal/commitments/CommitmentTypes";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";
import { SubstrateFileWriter } from "../../src/substrate/io/FileWriter";
import { AppendOnlyWriter } from "../../src/substrate/io/AppendOnlyWriter";
import { FileLock } from "../../src/substrate/io/FileLock";
import { PermissionChecker } from "../../src/agents/permissions";
import { PromptBuilder } from "../../src/agents/prompts/PromptBuilder";
import { InMemorySessionLauncher } from "../../src/agents/claude/InMemorySessionLauncher";
import { TaskClassifier } from "../../src/agents/TaskClassifier";
import { ConversationManager } from "../../src/conversation/ConversationManager";
import type { IConversationCompactor } from "../../src/conversation/IConversationCompactor";
import { Ego } from "../../src/agents/roles/Ego";
import { Subconscious } from "../../src/agents/roles/Subconscious";
import { Superego } from "../../src/agents/roles/Superego";
import { Id } from "../../src/agents/roles/Id";
import { LoopOrchestrator } from "../../src/loop/LoopOrchestrator";
import { ImmediateTimer } from "../../src/loop/ImmediateTimer";
import { InMemoryEventSink } from "../../src/loop/InMemoryEventSink";
import { defaultLoopConfig } from "../../src/loop/types";
import { InMemoryLogger } from "../../src/logging";

const owner = "actor:test" as ActorRef;
const commitmentId = "commitment:test" as CommitmentId;

class PassthroughCompactor implements IConversationCompactor {
  async compact(currentContent: string): Promise<string> { return currentContent; }
}

function transition(
  id: string,
  from: ShadowCommitmentTransition["from"],
  to: ShadowCommitmentTransition["to"],
  expected: number,
  grounds: EvidenceRef[] = [],
): ShadowCommitmentTransition {
  return {
    kind: "shadow_commitment_transition",
    schemaVersion: 1,
    transitionId: id as TransitionId,
    commitmentId,
    expectedVersion: recordVersion(expected),
    resultingVersion: recordVersion(expected + 1),
    from,
    to,
    owner,
    observedActor: owner,
    observedAuthorityPath: "plan",
    grounds,
    revisionAuthority: [owner],
    observedAt: "2026-07-19T10:00:00.000Z",
    provenance: [],
    shadowOnly: true,
  };
}

function successfulTaskResult(): string {
  return JSON.stringify({
    result: "success",
    summary: "shadow parity task complete",
    progressEntry: "shadow parity progress",
    skillUpdates: null,
    memoryUpdates: null,
    operatingContextEntry: null,
    proposals: [],
    agoraReplies: [],
  });
}

async function createRuntime(commitmentObserver?: CommitmentObserver) {
  const memoryFs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date("2026-07-19T10:00:00.000Z"));
  const launcher = new InMemorySessionLauncher();
  const config = new SubstrateConfig("/substrate");
  const reader = new SubstrateFileReader(memoryFs, config);
  const lock = new FileLock();
  const writer = new SubstrateFileWriter(memoryFs, config, lock, reader);
  const appendWriter = new AppendOnlyWriter(memoryFs, config, lock, clock);
  const checker = new PermissionChecker();
  const promptBuilder = new PromptBuilder(reader, checker);
  const classifier = new TaskClassifier({ strategicModel: "opus", tacticalModel: "sonnet" });
  const conversationManager = new ConversationManager(
    reader, memoryFs, config, lock, appendWriter, checker, new PassthroughCompactor(), clock,
  );
  const ego = new Ego(reader, writer, conversationManager, checker, promptBuilder, launcher, clock, classifier);
  const subconscious = new Subconscious(
    reader, writer, appendWriter, conversationManager, checker, promptBuilder, launcher, clock, classifier,
  );
  const superego = new Superego(
    reader, appendWriter, checker, promptBuilder, launcher, clock, classifier, writer,
  );
  const id = new Id(reader, checker, promptBuilder, launcher, clock, classifier);
  await memoryFs.mkdir("/substrate", { recursive: true });
  await memoryFs.mkdir("/data", { recursive: true });
  const files: Array<[string, string]> = [
    ["PLAN.md", "# Plan\n\n## Tasks\n- [ ] Shadow parity task"],
    ["MEMORY.md", "# Memory\n"], ["HABITS.md", "# Habits\n"],
    ["SKILLS.md", "# Skills\n"], ["VALUES.md", "# Values\n"], ["ID.md", "# Id\n"],
    ["SECURITY.md", "# Security\n"], ["CHARTER.md", "# Charter\n"],
    ["SUPEREGO.md", "# Superego\n"], ["CLAUDE.md", "# Claude\n"],
    ["PROGRESS.md", "# Progress\n"], ["CONVERSATION.md", "# Conversation\n"],
    ["OPERATING_CONTEXT.md", "# Operating Context\n"],
    ["ESCALATE_TO_STEFAN.md", "# Escalate\n"],
  ];
  await Promise.all(files.map(([name, content]) => memoryFs.writeFile(`/substrate/${name}`, content)));
  const orchestrator = new LoopOrchestrator(
    ego, subconscious, superego, id, appendWriter, clock, new ImmediateTimer(),
    new InMemoryEventSink(), defaultLoopConfig({
      maxConsecutiveIdleCycles: 100,
      evaluateOutcomeEnabled: false,
      superegoAuditInterval: 100,
    }), new InMemoryLogger(), undefined, undefined, undefined, undefined, undefined,
    "/substrate", memoryFs, undefined, commitmentObserver,
  );
  launcher.enqueueSuccess(successfulTaskResult());
  return { memoryFs, launcher, orchestrator };
}

describe("Stage-2 non-authoritative shadow commitment ledger", () => {
  let root: string;
  const clock = new FixedClock(new Date("2026-07-19T10:00:00.000Z"));

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "rook-stage2-shadow-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reduces versioned transitions deterministically while effects cannot change state", () => {
    const proposed = transition("transition:1", null, "proposed", 0);
    const committed = transition("transition:2", "proposed", "committed", 1);
    const effect = {
      kind: "shadow_effect_observation" as const,
      schemaVersion: 1 as const,
      observationId: "observation:1" as never,
      commitmentId,
      phase: "execution_observed" as const,
      observedAt: "2026-07-19T10:00:01.000Z",
      observedAuthorityPath: "loop_dispatch" as const,
      evidence: [],
      provenance: [],
      shadowOnly: true as const,
    };
    const replay = replayShadowLedger([proposed, committed, effect]);

    expect(replay.commitments.get(commitmentId)).toMatchObject({
      version: 2,
      shadowProjectedState: "committed",
      executionObserved: true,
    });
    expect(replay.diagnostics).toEqual([]);
    expect(replayShadowLedger([proposed, committed, effect])).toEqual(replay);
  });

  it("diagnoses stale, unauthorized, duplicate-conflicting, and bypass events", () => {
    const proposed = transition("transition:1", null, "proposed", 0);
    const stale = transition("transition:2", "proposed", "committed", 0);
    const unauthorized = {
      ...transition("transition:3", "proposed", "committed", 1),
      observedActor: "actor:intruder" as ActorRef,
    };
    const conflictingDuplicate = { ...proposed, to: "revoked" as const };
    const bypass = {
      kind: "shadow_effect_observation" as const,
      schemaVersion: 1 as const,
      observationId: "observation:bypass" as never,
      phase: "effect_observed" as const,
      observedAt: "2026-07-19T10:00:02.000Z",
      observedAuthorityPath: "tool" as const,
      evidence: [],
      provenance: [],
      shadowOnly: true as const,
    };
    const codes = replayShadowLedger([
      proposed, stale, unauthorized, conflictingDuplicate, bypass,
    ]).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(expect.arrayContaining([
      "version_conflict", "actor_violation", "duplicate_conflict", "bypass_observation",
    ]));
  });

  it("requires resolvable EvidenceRefs and durably replays concurrent transitions", async () => {
    const registry = new EvidenceRefRegistry(path.join(root, "evidence"));
    const storePath = path.join(root, "shadow.json");
    const store = new ShadowCommitmentStore(storePath, registry, clock);
    const registered = await registry.register("application/json", Buffer.from('{"ground":true}', "utf8"));
    if (registered.status !== "registered") throw new Error("fixture registration failed");

    await expect(store.append(transition("transition:1", null, "proposed", 0, [registered.ref])))
      .resolves.toMatchObject({ status: "appended" });
    const second = store.append(transition("transition:2", "proposed", "endorsed", 1, [registered.ref]));
    const third = store.append(transition("transition:3", "endorsed", "committed", 2, [registered.ref]));
    await expect(second).resolves.toMatchObject({ status: "appended" });
    await expect(third).resolves.toMatchObject({ status: "appended" });

    const reloaded = new ShadowCommitmentStore(storePath, registry, clock);
    await expect(reloaded.readHealth()).resolves.toMatchObject({
      authority: "none-shadow-only",
      totalEvents: 3,
      commitmentsByState: { committed: 1 },
    });

    const missing = "evidence:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as EvidenceRef;
    await expect(store.append(transition("transition:4", "committed", "revoked", 3, [missing])))
      .resolves.toEqual({ status: "rejected", reason: "unresolvable_evidence", refs: [missing] });
  });

  it("fails open on corrupt shadow storage without replacing it", async () => {
    const registry = new EvidenceRefRegistry(path.join(root, "evidence"));
    const storePath = path.join(root, "shadow.json");
    const registered = await registry.register("application/json", Buffer.from('{"ground":true}', "utf8"));
    if (registered.status !== "registered") throw new Error("fixture registration failed");
    await fs.writeFile(storePath, "{partial", "utf8");
    const store = new ShadowCommitmentStore(storePath, registry, clock);

    await expect(store.append(transition("transition:1", null, "proposed", 0, [registered.ref])))
      .resolves.toEqual({ status: "unavailable", reason: "corrupt_store" });
    await expect(fs.readFile(storePath, "utf8")).resolves.toBe("{partial");
  });

  it("proves a never-settling registry cannot delay the real dispatch return or alter calls", async () => {
    class NeverSettlingRegistry extends EvidenceRefRegistry {
      override async register(): Promise<never> { return new Promise<never>(() => undefined); }
    }
    const registry = new NeverSettlingRegistry(path.join(root, "evidence"));
    const store = new ShadowCommitmentStore(path.join(root, "shadow.json"), registry, clock);
    const observer = new CommitmentObserver(registry, store, clock);
    const baseline = await createRuntime();
    const shadow = await createRuntime(observer);
    const baselineLaunch = jest.spyOn(baseline.launcher, "launch");
    const shadowLaunch = jest.spyOn(shadow.launcher, "launch");
    baseline.orchestrator.start();
    shadow.orchestrator.start();

    const baselineResult = await baseline.orchestrator.runOneCycle();
    const shadowResult = await Promise.race([
      shadow.orchestrator.runOneCycle(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shadow blocked dispatch")), 250)),
    ]);

    expect(shadowResult).toEqual(baselineResult);
    expect(shadowLaunch).toHaveBeenCalledTimes(baselineLaunch.mock.calls.length);
    expect(shadowLaunch).toHaveBeenCalledTimes(2);
    expect(await shadow.memoryFs.readFile("/substrate/PLAN.md"))
      .toBe(await baseline.memoryFs.readFile("/substrate/PLAN.md"));
    expect(observer.getHealth()).toEqual({
      authority: "none-shadow-only",
      scheduled: 1,
      completed: 0,
      failed: 0,
      pending: 1,
    });
  });
});
