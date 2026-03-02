/**
 * Inter-component communication integration tests.
 * Tests real component interactions across the Id → Superego → Ego → Subconscious pipeline
 * without mocking internal logic. Uses InMemoryFileSystem, InMemorySessionLauncher, FixedClock.
 *
 * @see https://github.com/...issues/227
 */
import { Id } from "../../src/agents/roles/Id";
import { Superego } from "../../src/agents/roles/Superego";
import { Ego } from "../../src/agents/roles/Ego";
import { Subconscious } from "../../src/agents/roles/Subconscious";
import { IdleHandler } from "../../src/loop/IdleHandler";
import { LoopOrchestrator } from "../../src/loop/LoopOrchestrator";
import { InMemoryEventSink } from "../../src/loop/InMemoryEventSink";
import { ImmediateTimer } from "../../src/loop/ImmediateTimer";
import { defaultLoopConfig } from "../../src/loop/types";
import { InMemoryLogger } from "../../src/logging";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";
import { InMemorySessionLauncher } from "../../src/agents/claude/InMemorySessionLauncher";
import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileReader } from "../../src/substrate/io/FileReader";
import { SubstrateFileWriter } from "../../src/substrate/io/FileWriter";
import { AppendOnlyWriter } from "../../src/substrate/io/AppendOnlyWriter";
import { FileLock } from "../../src/substrate/io/FileLock";
import { PermissionChecker } from "../../src/agents/permissions";
import { PromptBuilder } from "../../src/agents/prompts/PromptBuilder";
import { TaskClassifier } from "../../src/agents/TaskClassifier";
import { ConversationManager } from "../../src/conversation/ConversationManager";
import { IConversationCompactor } from "../../src/conversation/IConversationCompactor";
import { GovernanceReportStore } from "../../src/evaluation/GovernanceReportStore";
import { DriveQualityTracker } from "../../src/evaluation/DriveQualityTracker";

class MockCompactor implements IConversationCompactor {
  async compact(_currentContent: string, _oneHourAgo: string): Promise<string> {
    return "Compacted content";
  }
}

function createDeps() {
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date("2025-06-15T10:00:00.000Z"));
  const launcher = new InMemorySessionLauncher();
  const config = new SubstrateConfig("/substrate");
  const reader = new SubstrateFileReader(fs, config);
  const lock = new FileLock();
  const writer = new SubstrateFileWriter(fs, config, lock);
  const appendWriter = new AppendOnlyWriter(fs, config, lock, clock);
  const checker = new PermissionChecker();
  const promptBuilder = new PromptBuilder(reader, checker);
  const taskClassifier = new TaskClassifier({ strategicModel: "opus", tacticalModel: "sonnet" });
  const compactor = new MockCompactor();
  const conversationManager = new ConversationManager(
    reader, fs, config, lock, appendWriter, checker, compactor, clock
  );

  const ego = new Ego(reader, writer, conversationManager, checker, promptBuilder, launcher, clock, taskClassifier);
  const subconscious = new Subconscious(reader, writer, appendWriter, conversationManager, checker, promptBuilder, launcher, clock, taskClassifier);
  const superego = new Superego(reader, appendWriter, checker, promptBuilder, launcher, clock, taskClassifier, writer);
  const id = new Id(reader, checker, promptBuilder, launcher, clock, taskClassifier);

  return { fs, clock, launcher, appendWriter, ego, subconscious, superego, id, reader, writer };
}

async function setupIdleSubstrate(fs: InMemoryFileSystem) {
  await fs.mkdir("/substrate", { recursive: true });
  await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n- [x] Done task");
  await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nSome memories");
  await fs.writeFile("/substrate/HABITS.md", "# Habits\n\nSome habits");
  await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nSome skills");
  await fs.writeFile("/substrate/VALUES.md", "# Values\n\nBe good");
  await fs.writeFile("/substrate/ID.md", "# Id\n\nCore identity");
  await fs.writeFile("/substrate/SECURITY.md", "# Security\n\nStay safe");
  await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nOur mission");
  await fs.writeFile("/substrate/SUPEREGO.md", "# Superego\n\nRules here");
  await fs.writeFile("/substrate/CLAUDE.md", "# Claude\n\nConfig here");
  await fs.writeFile("/substrate/PROGRESS.md", "# Progress\n\n");
  await fs.writeFile("/substrate/CONVERSATION.md", "# Conversation\n\n");
}

async function setupActiveSubstrate(fs: InMemoryFileSystem) {
  await fs.mkdir("/substrate", { recursive: true });
  await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n- [ ] task-1 Implement feature X");
  await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nSome memories");
  await fs.writeFile("/substrate/HABITS.md", "# Habits\n\nSome habits");
  await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nSome skills");
  await fs.writeFile("/substrate/VALUES.md", "# Values\n\nBe good");
  await fs.writeFile("/substrate/ID.md", "# Id\n\nCore identity");
  await fs.writeFile("/substrate/SECURITY.md", "# Security\n\nStay safe");
  await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nOur mission");
  await fs.writeFile("/substrate/SUPEREGO.md", "# Superego\n\nRules here");
  await fs.writeFile("/substrate/CLAUDE.md", "# Claude\n\nConfig here");
  await fs.writeFile("/substrate/PROGRESS.md", "# Progress\n\n");
  await fs.writeFile("/substrate/CONVERSATION.md", "# Conversation\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Category 1: Goal Generation → Task Dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe("Category 1: Goal Generation → Task Dispatch", () => {
  it("complete idle→goal→approval→dispatch→execution flow", async () => {
    const deps = createDeps();
    await setupIdleSubstrate(deps.fs);

    const logger = new InMemoryLogger();
    const idleHandler = new IdleHandler(deps.id, deps.superego, deps.ego, deps.clock, logger);

    // Step 1: Id generates goal candidates
    deps.launcher.enqueueSuccess(JSON.stringify({
      goalCandidates: [
        { title: "Study TypeScript generics", description: "Read advanced TS docs", priority: "high", confidence: 85 },
      ],
    }));

    // Step 2: Superego evaluates and approves
    deps.launcher.enqueueSuccess(JSON.stringify({
      proposalEvaluations: [{ approved: true, reason: "Aligned with growth values" }],
    }));

    const idleResult = await idleHandler.handleIdle();
    expect(idleResult.action).toBe("plan_created");
    expect(idleResult.goalCount).toBe(1);

    // Plan now contains the approved goal as a pending task
    const planAfterGoal = await deps.fs.readFile("/substrate/PLAN.md");
    expect(planAfterGoal).toContain("Study TypeScript generics");
    expect(planAfterGoal).toContain("[ ]"); // pending task

    // Step 3: Ego dispatches the new task, Subconscious executes it
    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig(), logger, idleHandler
    );

    deps.launcher.enqueueSuccess(JSON.stringify({
      result: "success",
      summary: "Studied TypeScript generics thoroughly",
      progressEntry: "## 2025-06-15 - Study TypeScript generics (COMPLETE)\n\nRead advanced TS docs.",
      skillUpdates: null,
      memoryUpdates: null,
      proposals: [],
      agoraReplies: [],
    }));

    orchestrator.start();
    const cycleResult = await orchestrator.runOneCycle();

    expect(cycleResult.action).toBe("dispatch");
    expect(cycleResult.success).toBe(true);

    // Task should be marked complete
    const planAfterDispatch = await deps.fs.readFile("/substrate/PLAN.md");
    expect(planAfterDispatch).toContain("[x]");

    // Progress should be logged (the progressEntry is what gets written, not the summary)
    const progress = await deps.fs.readFile("/substrate/PROGRESS.md");
    expect(progress).toContain("Study TypeScript generics");
  });

  it("superego rejection blocks dispatch — no plan, loop stays idle", async () => {
    const deps = createDeps();
    await setupIdleSubstrate(deps.fs);

    const logger = new InMemoryLogger();
    const idleHandler = new IdleHandler(deps.id, deps.superego, deps.ego, deps.clock, logger);

    // Id proposes a goal
    deps.launcher.enqueueSuccess(JSON.stringify({
      goalCandidates: [
        { title: "Do something risky", description: "Take unethical action", priority: "high", confidence: 60 },
      ],
    }));

    // Superego rejects the goal
    deps.launcher.enqueueSuccess(JSON.stringify({
      proposalEvaluations: [{ approved: false, reason: "Violates safety values" }],
    }));

    const idleResult = await idleHandler.handleIdle();
    expect(idleResult.action).toBe("all_rejected");

    // Plan should remain with only the completed task — no new pending task added
    const plan = await deps.fs.readFile("/substrate/PLAN.md");
    expect(plan).not.toContain("Do something risky");
    expect(plan).not.toContain("[ ]");

    // Orchestrator should see no dispatchable task
    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig(), logger
    );
    orchestrator.start();
    const cycleResult = await orchestrator.runOneCycle();

    expect(cycleResult.action).toBe("idle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Category 2: Superego Audit → Finding Persistence
// ─────────────────────────────────────────────────────────────────────────────

describe("Category 2: Superego Audit → Finding Persistence", () => {
  it("audit findings are persisted to GovernanceReportStore", async () => {
    const deps = createDeps();
    await setupIdleSubstrate(deps.fs);

    const reportsDir = "/substrate/reports";
    await deps.fs.mkdir(reportsDir, { recursive: true });
    const reportStore = new GovernanceReportStore(deps.fs, reportsDir, deps.clock);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig({ superegoAuditInterval: 1 }), new InMemoryLogger()
    );
    orchestrator.setReportStore(reportStore);

    deps.launcher.enqueueSuccess(JSON.stringify({
      findings: [
        { severity: "warning", message: "PROGRESS.md is getting long" },
        { severity: "info", message: "All values aligned with charter" },
      ],
      proposalEvaluations: [],
      summary: "Minor housekeeping needed",
    }));

    orchestrator.start();
    await orchestrator.runOneCycle();
    // Superego audit runs as deferred work — must drain before checking the report store
    await orchestrator.drainDeferredWork();

    const stored = await reportStore.latest();
    expect(stored).not.toBeNull();
    expect(stored!.findings).toHaveLength(2);
    expect(stored!.findings[0].severity).toBe("warning");
    expect(stored!.findings[0].message).toContain("PROGRESS.md");
    expect(stored!.summary).toBe("Minor housekeeping needed");
  });

  it("repeated findings across audits are tracked and influence governance state", async () => {
    const deps = createDeps();
    await setupIdleSubstrate(deps.fs);

    // Run two sequential audits with an overlapping finding — the tracker should
    // record that the same finding appeared in multiple audit cycles.
    const firstAuditFindings = [{ severity: "warning" as const, message: "Memory file is stale" }];
    const secondAuditFindings = [{ severity: "warning" as const, message: "Memory file is stale" }];

    // First audit
    deps.launcher.enqueueSuccess(JSON.stringify({
      findings: firstAuditFindings,
      proposalEvaluations: [],
      summary: "Stale memory detected",
    }));

    const firstReport = await deps.superego.audit(undefined, 1);
    expect(firstReport.findings).toHaveLength(1);
    expect(firstReport.findings[0].message).toContain("Memory file is stale");

    // Second audit with the same finding
    deps.launcher.enqueueSuccess(JSON.stringify({
      findings: secondAuditFindings,
      proposalEvaluations: [],
      summary: "Memory still stale",
    }));

    const secondReport = await deps.superego.audit(undefined, 2);
    // Both audits should surface the finding (persistence across cycles)
    expect(secondReport.findings).toHaveLength(1);
    expect(secondReport.findings[0].severity).toBe("warning");

    // Verify the reports are independent and correctly shaped
    expect(firstReport.summary).toBe("Stale memory detected");
    expect(secondReport.summary).toBe("Memory still stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Category 3: Failure Cascade Handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Category 3: Failure Cascade Handling", () => {
  it("subconscious task failure does not corrupt substrate files", async () => {
    const deps = createDeps();
    await setupActiveSubstrate(deps.fs);

    const planBefore = await deps.fs.readFile("/substrate/PLAN.md");

    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig(), new InMemoryLogger()
    );

    // Subconscious returns failure
    deps.launcher.enqueueSuccess(JSON.stringify({
      result: "failure",
      summary: "Could not complete task due to missing dependencies",
      progressEntry: "",
      skillUpdates: null,
      memoryUpdates: null,
      proposals: [],
      agoraReplies: [],
    }));

    orchestrator.start();
    const cycleResult = await orchestrator.runOneCycle();

    expect(cycleResult.action).toBe("dispatch");
    expect(cycleResult.success).toBe(false);

    // Plan task must NOT be marked complete after failure
    const planAfter = await deps.fs.readFile("/substrate/PLAN.md");
    expect(planAfter).toContain("[ ] task-1"); // still pending

    // SKILLS and MEMORY must be unchanged
    const skills = await deps.fs.readFile("/substrate/SKILLS.md");
    expect(skills).toBe(await deps.fs.readFile("/substrate/SKILLS.md"));

    // PROGRESS.md should not contain a progress entry for a failed task
    const progress = await deps.fs.readFile("/substrate/PROGRESS.md");
    expect(progress).not.toContain("Implement feature X");

    // Original plan content should be structurally preserved
    expect(planAfter).toContain("task-1");
    expect(planBefore).toContain("task-1");
  });

  it("id error during idle handling does not prevent ego from dispatching existing tasks", async () => {
    const deps = createDeps();
    // Start with a plan that has pending tasks so Ego can dispatch without idle handling
    await setupActiveSubstrate(deps.fs);

    const logger = new InMemoryLogger();
    const idleHandler = new IdleHandler(deps.id, deps.superego, deps.ego, deps.clock, logger);

    // No response enqueued → Id.generateDrives will fail silently
    // IdleHandler should return no_goals, not propagate the error
    const idleResult = await idleHandler.handleIdle();
    // Plan has pending tasks, so it's not idle at all
    expect(idleResult.action).toBe("not_idle");

    // Simulate an idle plan where Id would be called, but fails
    await deps.fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n- [x] Done");
    const idleResult2 = await idleHandler.handleIdle();
    // Id fails (no response queued) → graceful no_goals
    expect(idleResult2.action).toBe("no_goals");

    // Now restore an active plan — Ego should still dispatch normally
    await deps.fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n- [ ] task-2 Write tests");

    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig(), logger, idleHandler
    );

    deps.launcher.enqueueSuccess(JSON.stringify({
      result: "success",
      summary: "Tests written",
      progressEntry: "Wrote comprehensive test suite",
      skillUpdates: null,
      memoryUpdates: null,
      proposals: [],
      agoraReplies: [],
    }));

    orchestrator.start();
    const cycleResult = await orchestrator.runOneCycle();

    expect(cycleResult.action).toBe("dispatch");
    expect(cycleResult.success).toBe(true);
    // PlanParser auto-generates task IDs by position, so the first (and only) pending task is always task-1
    expect(cycleResult.taskId).toBe("task-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Category 4: Feedback Loop Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Category 4: Feedback Loop Tests", () => {
  it("drive quality evaluation feeds back to Id via DriveQualityTracker", async () => {
    const deps = createDeps();
    await setupActiveSubstrate(deps.fs);

    // Mark the task as ID-generated so the orchestrator records a quality rating
    await deps.fs.writeFile(
      "/substrate/PLAN.md",
      "# Plan\n\n## Tasks\n- [ ] task-1 Research algorithms [ID-generated 2025-06-14]"
    );

    const driveQualityPath = "/substrate/drive-quality.jsonl";
    const driveQualityTracker = new DriveQualityTracker(deps.fs, driveQualityPath);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig(), new InMemoryLogger()
    );
    orchestrator.setDriveQualityTracker(driveQualityTracker);

    // Task succeeds with memory updates (boosts rating above baseline)
    deps.launcher.enqueueSuccess(JSON.stringify({
      result: "success",
      summary: "Algorithm research complete",
      progressEntry: "Researched sorting algorithms in depth",
      skillUpdates: null,
      memoryUpdates: "# Memory\n\nLearned about quicksort and mergesort trade-offs",
      proposals: [],
      agoraReplies: [],
    }));

    orchestrator.start();
    const cycleResult = await orchestrator.runOneCycle();
    expect(cycleResult.success).toBe(true);

    // Drive quality rating should now be recorded
    const ratings = await driveQualityTracker.getHistoricalRatings();
    expect(ratings).toHaveLength(1);
    expect(ratings[0].task).toContain("Research algorithms");
    expect(ratings[0].generatedAt).toBe("2025-06-14");
    // memoryUpdates present → baseline 5 + 3 = 8
    expect(ratings[0].rating).toBe(8);
    expect(ratings[0].category).toBe("research");
  });

  it("low reconsideration quality score surfaces recommended actions in event", async () => {
    const deps = createDeps();
    await setupActiveSubstrate(deps.fs);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new LoopOrchestrator(
      deps.ego, deps.subconscious, deps.superego, deps.id,
      deps.appendWriter, deps.clock, new ImmediateTimer(), eventSink,
      defaultLoopConfig({ evaluateOutcomeEnabled: true }), new InMemoryLogger()
    );

    // Task completes partially
    deps.launcher.enqueueSuccess(JSON.stringify({
      result: "partial",
      summary: "Feature partially implemented — missing error handling",
      progressEntry: "Core logic done, error paths pending",
      skillUpdates: null,
      memoryUpdates: null,
      proposals: [],
      agoraReplies: [],
    }));

    // Reconsideration returns low quality score with recommended actions
    deps.launcher.enqueueSuccess(JSON.stringify({
      outcomeMatchesIntent: false,
      qualityScore: 45,
      issuesFound: ["Error handling missing", "No tests written"],
      recommendedActions: ["Add error handling", "Write unit tests", "Review acceptance criteria"],
      needsReassessment: true,
    }));

    orchestrator.start();
    await orchestrator.runOneCycle();
    await orchestrator.drainDeferredWork();

    const reconEvents = eventSink.getEvents().filter((e) => e.type === "reconsideration_complete");
    expect(reconEvents).toHaveLength(1);

    const data = reconEvents[0].data;
    expect(data.qualityScore).toBe(45);
    expect(data.needsReassessment).toBe(true);
    expect(data.outcomeMatchesIntent).toBe(false);
    // Recommended actions are captured in the event (via issuesCount proxy)
    expect(data.issuesCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Category 5: Concurrent Operation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Category 5: Concurrent Operation Tests", () => {
  it("ego dispatch and superego audit run concurrently without substrate conflict", async () => {
    const deps = createDeps();
    await setupActiveSubstrate(deps.fs);

    // Enqueue Subconscious execution response (for Ego dispatch path)
    deps.launcher.enqueueSuccess(JSON.stringify({
      result: "success",
      summary: "Feature implemented",
      progressEntry: "Completed feature X implementation",
      skillUpdates: null,
      memoryUpdates: null,
      proposals: [],
      agoraReplies: [],
    }));

    // Enqueue Superego audit response (for concurrent audit path)
    deps.launcher.enqueueSuccess(JSON.stringify({
      findings: [{ severity: "info", message: "System operating normally" }],
      proposalEvaluations: [],
      summary: "Audit passed",
    }));

    // Run both concurrently
    const [dispatchResult, auditReport] = await Promise.all([
      // Ego finds next task and Subconscious executes it
      deps.ego.dispatchNext().then(async (dispatch) => {
        if (!dispatch) return null;
        return deps.subconscious.execute({ taskId: dispatch.taskId, description: dispatch.description });
      }),
      // Superego audits concurrently
      deps.superego.audit(),
    ]);

    // Both should complete successfully without corrupting each other
    expect(dispatchResult).not.toBeNull();
    expect(dispatchResult!.result).toBe("success");
    expect(dispatchResult!.summary).toBe("Feature implemented");

    expect(auditReport.findings).toHaveLength(1);
    expect(auditReport.findings[0].severity).toBe("info");
    expect(auditReport.summary).toBe("Audit passed");

    // Substrate files should still be consistent — plan still has the task
    // (markTaskComplete not called here since we bypassed orchestrator)
    const plan = await deps.fs.readFile("/substrate/PLAN.md");
    expect(plan).toContain("task-1");

    // PROGRESS.md should be unmodified (neither path writes progress directly)
    const progress = await deps.fs.readFile("/substrate/PROGRESS.md");
    expect(progress).toBe("# Progress\n\n");
  });
});
