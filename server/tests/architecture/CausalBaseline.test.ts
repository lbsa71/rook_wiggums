import baseline from "./fixtures/current-runtime-causal-baseline.json";
import { PlanParser } from "../../src/agents/parsers/PlanParser";
import { PermissionChecker } from "../../src/agents/permissions";
import { AgentRole } from "../../src/agents/types";
import { SubstrateFileType } from "../../src/substrate/types";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";
import { SubstrateFileWriter } from "../../src/substrate/io/FileWriter";
import { AppendOnlyWriter } from "../../src/substrate/io/AppendOnlyWriter";
import { FileLock } from "../../src/substrate/io/FileLock";
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
import type { IAgoraService } from "../../src/agora/IAgoraService";

class PassthroughCompactor implements IConversationCompactor {
  async compact(currentContent: string): Promise<string> {
    return currentContent;
  }
}

function successfulTaskResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    result: "success",
    summary: "baseline task complete",
    progressEntry: "baseline progress",
    skillUpdates: null,
    memoryUpdates: null,
    operatingContextEntry: null,
    proposals: [],
    agoraReplies: [],
    ...overrides,
  });
}

async function createRuntime(plan = "# Plan\n\n## Tasks\n- [ ] Baseline task") {
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date("2026-07-18T22:30:00.000Z"));
  const launcher = new InMemorySessionLauncher();
  const config = new SubstrateConfig("/substrate");
  const reader = new SubstrateFileReader(fs, config);
  const lock = new FileLock();
  const writer = new SubstrateFileWriter(fs, config, lock, reader);
  const appendWriter = new AppendOnlyWriter(fs, config, lock, clock);
  const checker = new PermissionChecker();
  const promptBuilder = new PromptBuilder(reader, checker);
  const classifier = new TaskClassifier({ strategicModel: "opus", tacticalModel: "sonnet" });
  const conversationManager = new ConversationManager(
    reader, fs, config, lock, appendWriter, checker, new PassthroughCompactor(), clock,
  );
  const ego = new Ego(reader, writer, conversationManager, checker, promptBuilder, launcher, clock, classifier);
  const subconscious = new Subconscious(
    reader, writer, appendWriter, conversationManager, checker, promptBuilder, launcher, clock, classifier,
  );
  const superego = new Superego(
    reader, appendWriter, checker, promptBuilder, launcher, clock, classifier, writer,
  );
  const id = new Id(reader, checker, promptBuilder, launcher, clock, classifier);

  await fs.mkdir("/substrate", { recursive: true });
  await fs.mkdir("/data", { recursive: true });
  const files: Array<[string, string]> = [
    ["PLAN.md", plan], ["MEMORY.md", "# Memory\n"], ["HABITS.md", "# Habits\n"],
    ["SKILLS.md", "# Skills\n"], ["VALUES.md", "# Values\n"], ["ID.md", "# Id\n"],
    ["SECURITY.md", "# Security\n"], ["CHARTER.md", "# Charter\n"],
    ["SUPEREGO.md", "# Superego\n"], ["AGENTS.md", "# Agents\n"],
    ["PROGRESS.md", "# Progress\n"], ["CONVERSATION.md", "# Conversation\n"],
    ["OPERATING_CONTEXT.md", "# Operating Context\n"],
    ["ESCALATE_TO_STEFAN.md", "# Escalate\n"],
  ];
  await Promise.all(files.map(([name, content]) => fs.writeFile(`/substrate/${name}`, content)));

  const logger = new InMemoryLogger();
  const orchestrator = new LoopOrchestrator(
    ego, subconscious, superego, id, appendWriter, clock, new ImmediateTimer(),
    new InMemoryEventSink(), defaultLoopConfig({
      maxConsecutiveIdleCycles: 100,
      evaluateOutcomeEnabled: false,
      superegoAuditInterval: 100,
    }), logger, undefined, undefined, undefined, undefined, undefined,
    "/substrate", fs,
  );
  return { fs, launcher, writer, checker, superego, orchestrator, logger };
}

describe("pre-implementation current-runtime causal baseline", () => {
  it("freezes the baseline fixture against the source revision under test", () => {
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.sourceBaseline).toBe("838d524");
    expect(Object.keys(baseline.interventions)).toEqual([
      "planMutation",
      "superegoDenial",
      "permissionDenial",
      "pendingProposalReplay",
      "partialBatchReplay",
      "irreversibleEffectReceipt",
    ]);
  });

  it("PLAN mutation causally changes the next dispatch selection", async () => {
    const original = "# Plan\n\n## Tasks\n- [ ] First\n- [ ] Second";
    const before = await PlanParser.findNextActionable(PlanParser.parseTasks(original));
    const mutated = PlanParser.markComplete(original, "task-1");
    const after = await PlanParser.findNextActionable(PlanParser.parseTasks(mutated));

    expect(before?.title).toBe("First");
    expect(after?.title).toBe("Second");
    expect(baseline.interventions.planMutation.classification).toBe("operative_parallel_authority");
  });

  it("Superego denial vetoes only its governed mutation and leaves PLAN dispatch intact", async () => {
    const runtime = await createRuntime();
    const before = await runtime.fs.readFile("/substrate/HABITS.md");
    await runtime.superego.applyProposals(
      [{ target: "HABITS", content: "Denied mutation" }],
      [{ approved: false, reason: "baseline denial" }],
    );

    expect(await runtime.fs.readFile("/substrate/HABITS.md")).toBe(before);
    expect(await runtime.fs.readFile("/substrate/PROGRESS.md")).toContain("baseline denial");
    const next = await PlanParser.findNextActionable(
      PlanParser.parseTasks(await runtime.fs.readFile("/substrate/PLAN.md")),
    );
    expect(next?.title).toBe("Baseline task");
    expect(baseline.interventions.superegoDenial.classification).toBe("operative_path_local_veto");
  });

  it("structured permission denial does not claim control over ambient filesystem writes", async () => {
    const runtime = await createRuntime();
    expect(() => runtime.checker.assertCanWrite(
      AgentRole.SUBCONSCIOUS, SubstrateFileType.SKILLS,
    )).toThrow("SUBCONSCIOUS does not have WRITE access to SKILLS");

    await runtime.fs.writeFile("/substrate/SKILLS.md", "ambient write outside structured permission API");
    expect(await runtime.fs.readFile("/substrate/SKILLS.md")).toContain("ambient write");
    expect(baseline.interventions.permissionDenial.classification).toBe("operative_structured_api_only");
  });

  it("persists a failed proposal batch and replays then clears it on a healthy cycle", async () => {
    const runtime = await createRuntime("# Plan\n\n## Tasks\n- [x] Idle");
    const proposal = { target: "SKILLS", content: "# Skills\n\nReplay", mode: "replace" as const };
    const trace: string[] = [];
    const originalRename = runtime.fs.rename.bind(runtime.fs);
    jest.spyOn(runtime.fs, "rename").mockImplementation(async (from, to) => {
      await originalRename(from, to);
      if (to === "/data/pending_proposals.json") {
        const state = JSON.parse(await runtime.fs.readFile(to)) as { completedProposalKeys?: string[] };
        if ((state.completedProposalKeys ?? []).length === 0) trace.push("persist_batch");
      }
    });
    const originalUnlink = runtime.fs.unlink.bind(runtime.fs);
    jest.spyOn(runtime.fs, "unlink").mockImplementation(async (path) => {
      await originalUnlink(path);
      if (path === "/data/pending_proposals.json") trace.push("clear_batch");
    });
    const evaluate = jest.spyOn(runtime.superego, "evaluateProposals")
      .mockImplementationOnce(async () => {
        trace.push("evaluate_first_begin");
        throw new Error("baseline rate limit");
      })
      .mockImplementationOnce(async () => {
        trace.push("evaluate_retry_begin");
        return [{ approved: true, reason: "healthy retry" }];
      });
    const apply = jest.spyOn(runtime.superego, "applyProposals").mockImplementation(async () => {
      trace.push("apply_begin");
      await Promise.resolve();
      trace.push("apply_resolved");
    });
    const process = (runtime.orchestrator as unknown as {
      processGovernedProposals(proposals: typeof proposal[]): Promise<void>;
    }).processGovernedProposals.bind(runtime.orchestrator);

    await expect(process([proposal])).rejects.toThrow("baseline rate limit");
    trace.push("evaluation_failed");
    expect(await runtime.fs.readFile("/data/pending_proposals.json")).toContain("Replay");

    runtime.orchestrator.start();
    await runtime.orchestrator.runOneCycle();

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith([proposal], [{ approved: true, reason: "healthy retry" }]);
    await expect(runtime.fs.exists("/data/pending_proposals.json")).resolves.toBe(false);
    expect(trace).toEqual(baseline.interventions.pendingProposalReplay.expectedOrder);
    expect(baseline.interventions.pendingProposalReplay.classification).toBe("operative_at_least_once_batch_replay");
  });

  it("reproduces duplicate first effects when a partially applied batch is retried", async () => {
    const runtime = await createRuntime();
    const originalWrite = runtime.writer.write.bind(runtime.writer);
    const write = jest.spyOn(runtime.writer, "write")
      .mockImplementationOnce(originalWrite)
      .mockRejectedValueOnce(new Error("second effect failed"))
      .mockImplementation(originalWrite);
    const proposals = [
      { target: "HABITS", content: "First effect" },
      { target: "MEMORY", content: "Second effect" },
    ];
    const evaluations = proposals.map(() => ({ approved: true, reason: "baseline" }));

    await expect(runtime.superego.applyProposals(proposals, evaluations)).rejects.toThrow("second effect failed");
    await runtime.superego.applyProposals(proposals, evaluations);

    const habits = await runtime.fs.readFile("/substrate/HABITS.md");
    expect(habits.match(/First effect/g)).toHaveLength(2);
    expect(await runtime.fs.readFile("/substrate/MEMORY.md")).toContain("Second effect");
    expect(write).toHaveBeenCalledTimes(4);
    expect(baseline.interventions.partialBatchReplay.classification).toBe("failure_signature_duplicate_first_effect");
  });

  it("marks task completion before an irreversible Agora attempt and has no typed effect receipt", async () => {
    const runtime = await createRuntime();
    runtime.launcher.enqueueSuccess(successfulTaskResult({
      agoraReplies: [{ to: "peer", text: "effect" }],
    }));
    const trace: string[] = [];
    const originalWrite = runtime.writer.write.bind(runtime.writer);
    jest.spyOn(runtime.writer, "write").mockImplementation(async (fileType, content) => {
      await originalWrite(fileType, content);
      if (fileType === SubstrateFileType.PLAN && content.includes("- [x] Baseline task")) {
        trace.push("mark_task_complete");
      }
    });
    const agora: IAgoraService = {
      sendMessage: async () => {
        trace.push("attempt_deferred_effect");
        return { ok: false, status: 503, error: "offline" };
      },
      sendToAll: async () => ({ ok: false, errors: [] }),
      replyToEnvelope: async () => ({ ok: false, status: 503, error: "offline" }),
      decodeInbound: async () => ({ ok: false, reason: "unused" }),
      getPeers: () => ["peer"],
      getPeerConfig: (name) => name === "peer" ? { publicKey: "peer", name: "peer" } : undefined,
      getSelfIdentity: () => ({ publicKey: "self", name: "rook" }),
      connectRelay: async () => undefined,
      disconnectRelay: async () => undefined,
      isRelayConnected: () => false,
    };
    runtime.orchestrator.setAgoraService(agora);
    runtime.orchestrator.start();

    const result = await runtime.orchestrator.runOneCycle();

    expect(result.success).toBe(true);
    expect(await runtime.fs.readFile("/substrate/PLAN.md")).toContain("- [x] Baseline task");
    trace.push("retain_task_complete");
    expect(trace).toEqual(baseline.interventions.irreversibleEffectReceipt.expectedOrder);
    expect(await runtime.fs.exists("/data/action_receipts.json")).toBe(false);
    expect(baseline.interventions.irreversibleEffectReceipt.classification)
      .toBe("missing_typed_receipt_completion_precedes_effect");
  });
});
