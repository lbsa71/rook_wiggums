import { Ego } from "../../../src/agents/roles/Ego";
import { PermissionChecker } from "../../../src/agents/permissions";
import { PromptBuilder } from "../../../src/agents/prompts/PromptBuilder";
import { InMemorySessionLauncher } from "../../../src/agents/claude/InMemorySessionLauncher";
import { SubstrateFileReader } from "../../../src/substrate/io/FileReader";
import { SubstrateFileWriter } from "../../../src/substrate/io/FileWriter";
import { AppendOnlyWriter } from "../../../src/substrate/io/AppendOnlyWriter";
import { ConversationManager } from "../../../src/conversation/ConversationManager";
import { ConversationCompactor } from "../../../src/conversation/ConversationCompactor";
import { FileLock } from "../../../src/substrate/io/FileLock";
import { SubstrateConfig } from "../../../src/substrate/config";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";
import { AgentRole } from "../../../src/agents/types";
import { ProcessLogEntry } from "../../../src/agents/claude/ISessionLauncher";
import { TaskClassifier } from "../../../src/agents/TaskClassifier";
import { CycleLogWriter } from "../../../src/substrate/io/CycleLogWriter";
import { SubstrateFileType } from "../../../src/substrate/types";

async function makeEgo(workingDirectory?: string, sourceCodePath?: string): Promise<{ ego: Ego; launcher: InMemorySessionLauncher }> {
  const testFs = new InMemoryFileSystem();
  const testClock = new FixedClock(new Date("2025-06-15T10:00:00.000Z"));
  const testLauncher = new InMemorySessionLauncher();
  const config = new SubstrateConfig("/substrate");
  const reader = new SubstrateFileReader(testFs, config);
  const lock = new FileLock();
  const writer = new SubstrateFileWriter(testFs, config, lock);
  const appendWriter = new AppendOnlyWriter(testFs, config, lock, testClock);
  const checker = new PermissionChecker();
  const promptBuilder = new PromptBuilder(reader, checker);
  const taskClassifier = new TaskClassifier({ strategicModel: "opus", tacticalModel: "sonnet" });
  const compactor = new ConversationCompactor(testLauncher, workingDirectory ?? "/workspace");
  const conversationManager = new ConversationManager(reader, testFs, config, lock, appendWriter, checker, compactor, testClock);

  await testFs.mkdir("/substrate", { recursive: true });
  await testFs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Tasks\n- [ ] Task A");
  await testFs.writeFile("/substrate/VALUES.md", "# Values\n\nBe good");

  const ego = new Ego(reader, writer, conversationManager, checker, promptBuilder, testLauncher, testClock, taskClassifier, workingDirectory, sourceCodePath);
  return { ego, launcher: testLauncher };
}

describe("Ego agent", () => {
  let fs: InMemoryFileSystem;
  let clock: FixedClock;
  let launcher: InMemorySessionLauncher;
  let ego: Ego;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    clock = new FixedClock(new Date("2025-06-15T10:00:00.000Z"));
    launcher = new InMemorySessionLauncher();
    const config = new SubstrateConfig("/substrate");
    const reader = new SubstrateFileReader(fs, config);
    const lock = new FileLock();
    const writer = new SubstrateFileWriter(fs, config, lock);
    const appendWriter = new AppendOnlyWriter(fs, config, lock, clock);
    const checker = new PermissionChecker();
    const promptBuilder = new PromptBuilder(reader, checker);
    const taskClassifier = new TaskClassifier({ strategicModel: "opus", tacticalModel: "sonnet" });
    
    // Create ConversationCompactor and ConversationManager
    const compactor = new ConversationCompactor(launcher, "/workspace");
    const conversationManager = new ConversationManager(
      reader, fs, config, lock, appendWriter, checker, compactor, clock
    );

    ego = new Ego(
      reader, writer, conversationManager, checker, promptBuilder, launcher, clock, taskClassifier, "/workspace",
      undefined, new CycleLogWriter(fs, clock, "/substrate")
    );

    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nBuild it\n\n## Tasks\n- [ ] Task A\n- [ ] Task B\n- [x] Task C");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nSome memories");
    await fs.writeFile("/substrate/HABITS.md", "# Habits\n\nSome habits");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nSome skills");
    await fs.writeFile("/substrate/VALUES.md", "# Values\n\nBe good");
    await fs.writeFile("/substrate/ID.md", "# Id\n\nCore identity");
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\nStay safe");
    await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nOur mission");
    await fs.writeFile("/substrate/SUPEREGO.md", "# Superego\n\nRules here");
    await fs.writeFile("/substrate/AGENTS.md", "# Agents\n\nConfig here");
    await fs.writeFile("/substrate/PROGRESS.md", "# Progress\n\n");
    await fs.writeFile("/substrate/CONVERSATION.md", "# Conversation\n\n");
    await fs.writeFile("/substrate/OPERATING_CONTEXT.md", "# Operating Context\n\n");
  });

  describe("readPlan", () => {
    it("reads the current plan content", async () => {
      const plan = await ego.readPlan();
      expect(plan).toContain("# Plan");
      expect(plan).toContain("Task A");
    });
  });

  describe("writePlan", () => {
    it("writes new plan content", async () => {
      const newPlan = "# Plan\n\n## Current Goal\nNew goal\n\n## Tasks\n- [ ] New task";
      await ego.writePlan(newPlan);

      const content = await fs.readFile("/substrate/PLAN.md");
      expect(content).toContain("New goal");
      expect(content).toContain("New task");
    });

    it("enforces WRITE permission for EGO on PLAN", async () => {
      const newPlan = "# Plan\n\n## Current Goal\nGoal\n\n## Tasks\n- [ ] Task";
      await expect(ego.writePlan(newPlan)).resolves.not.toThrow();
    });
  });

  describe("appendConversation", () => {
    it("appends an entry to CONVERSATION", async () => {
      await ego.appendConversation("User asked about deployment");

      const content = await fs.readFile("/substrate/CONVERSATION.md");
      expect(content).toContain("[2025-06-15T10:00:00.000Z]");
      expect(content).toContain("[EGO] User asked about deployment");
    });
  });

  describe("respondToMessage", () => {
    it("writes EGO response to cycle_log.md (not CONVERSATION.md)", async () => {
      launcher.enqueueSuccess("Hello! How can I help you today?");

      await ego.respondToMessage("Ji!");

      // EGO response must NOT appear in CONVERSATION.md
      const conversation = await fs.readFile("/substrate/CONVERSATION.md");
      expect(conversation).not.toContain("Hello! How can I help you today?");

      // EGO response MUST appear in cycle_log.md with [EGO] tag
      const cycleLog = await fs.readFile("/substrate/cycle_log.md");
      expect(cycleLog).toContain("[EGO] Hello! How can I help you today?");
    });

    it("includes the user message in the launch prompt", async () => {
      launcher.enqueueSuccess("Hi there!");

      await ego.respondToMessage("Ji!");

      const launches = launcher.getLaunches();
      expect(launches[0].request.message).toContain("Ji!");
    });

    it("passes onLogEntry callback to the session", async () => {
      launcher.enqueueSuccess("Response");

      const entries: ProcessLogEntry[] = [];
      await ego.respondToMessage("Hi", (e) => entries.push(e));

      const launches = launcher.getLaunches();
      expect(launches[0].options?.onLogEntry).toBeDefined();
    });

    it("does not write to cycle_log on session failure", async () => {
      launcher.enqueueFailure("session crashed");

      await expect(ego.respondToMessage("Hello")).rejects.toThrow("Message response session failed: session crashed");

      // Neither CONVERSATION.md nor cycle_log.md should get the error text
      const conversation = await fs.readFile("/substrate/CONVERSATION.md");
      expect(conversation).not.toContain("session crashed");

      const hasCycleLog = await fs.exists("/substrate/cycle_log.md");
      if (hasCycleLog) {
        const cycleLog = await fs.readFile("/substrate/cycle_log.md");
        expect(cycleLog).not.toContain("session crashed");
      }
    });

    it("passes cwd to session launcher", async () => {
      launcher.enqueueSuccess("Hi!");

      await ego.respondToMessage("Hello");

      const launches = launcher.getLaunches();
      expect(launches[0].options?.cwd).toBe("/workspace");
    });

    it("passes sourceCodePath as additionalDirs when provided", async () => {
      const { ego: egoWithSource, launcher: launcher2 } = await makeEgo("/workspace", "/source/root");
      launcher2.enqueueSuccess("Hi!");

      await egoWithSource.respondToMessage("Hello");

      const launches = launcher2.getLaunches();
      expect(launches[0].options?.additionalDirs).toEqual(["/source/root"]);
    });

    it("does not set additionalDirs when sourceCodePath is not provided", async () => {
      launcher.enqueueSuccess("Hi!");

      await ego.respondToMessage("Hello");

      const launches = launcher.getLaunches();
      expect(launches[0].options?.additionalDirs).toBeUndefined();
    });

    it("builds respondToMessage system prompt from PromptBuilder plus message-mode instructions", async () => {
      launcher.enqueueSuccess("Hi!");
      const promptBuilderSpy = jest.spyOn(PromptBuilder.prototype, "buildSystemPrompt");

      await ego.respondToMessage("Hello");

      const launches = launcher.getLaunches();
      const systemPrompt = launches[0].request.systemPrompt;
      expect(promptBuilderSpy).toHaveBeenCalledWith(AgentRole.EGO);
      expect(systemPrompt).toContain("Your role is to plan, decide, and dispatch.");
      expect(systemPrompt).toContain("=== AUTONOMY REMINDER ===");
      expect(systemPrompt).toContain("Before asking for permission, question your reason.");
      expect(systemPrompt).toContain("Act autonomously within your charter. Hard limits in BOUNDARIES.md still apply; everything else is yours to decide and do.");
      expect(systemPrompt).not.toContain("=== ENDORSEMENT CHECK ===");
      expect(systemPrompt).not.toContain("ENDORSEMENT_CHECK");
      expect(systemPrompt).toContain("=== MESSAGE MODE ===");
      expect(systemPrompt).toContain("A user or peer has sent you a message.");

      promptBuilderSpy.mockRestore();
    });
  });

  describe("dispatchNext", () => {
    it("returns the next actionable task from the plan", async () => {
      const { dispatch } = await ego.dispatchNext();
      expect(dispatch).toBeDefined();
      expect(dispatch!.taskId).toBe("task-1");
      expect(dispatch!.description).toBe("Task A");
      expect(dispatch!.targetRole).toBe(AgentRole.SUBCONSCIOUS);
    });

    it("returns null dispatch when all tasks are complete", async () => {
      await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nDone\n\n## Tasks\n- [x] Done");
      const { dispatch } = await ego.dispatchNext();
      expect(dispatch).toBeNull();
    });

    it("returns null dispatch when plan has no tasks", async () => {
      await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nNothing\n\n## Tasks\n");
      const { dispatch } = await ego.dispatchNext();
      expect(dispatch).toBeNull();
    });

    it("returns null dispatch and non-empty blockedTaskIds for BLOCKED tasks", async () => {
      await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nWaiting\n\n## Tasks\n- [ ] Fix infra **BLOCKED** waiting on Ollama recovery\n");
      const { dispatch, blockedTaskIds } = await ego.dispatchNext();
      expect(dispatch).toBeNull();
      expect(blockedTaskIds).toEqual(["task-1"]);
    });

    it("returns empty blockedTaskIds when no tasks are blocked", async () => {
      const { blockedTaskIds } = await ego.dispatchNext();
      expect(blockedTaskIds).toEqual([]);
    });

    it("returns a snapshot containing the PLAN.md content", async () => {
      const { snapshot } = await ego.dispatchNext();
      expect(snapshot).toBeDefined();
      expect(snapshot.files[SubstrateFileType.PLAN]).toBeDefined();
      expect(snapshot.files[SubstrateFileType.PLAN]).toContain("Task A");
    });

    it("reports deferred tasks without WHEN triggers as unreachable", async () => {
      await fs.writeFile(
        "/substrate/PLAN.md",
        "# Plan\n\n## Current Goal\nGoal\n\n## Tasks\n- [ ] Task A\n- [~] Orphan deferred task\n- [~] Gated task WHEN `true`\n"
      );

      const { dispatch, unreachableDeferredTaskIds } = await ego.dispatchNext();

      expect(dispatch).toBeDefined();
      expect(unreachableDeferredTaskIds).toEqual(["task-2"]);
    });

    it("returns empty unreachableDeferredTaskIds when no orphan deferred tasks exist", async () => {
      const { unreachableDeferredTaskIds } = await ego.dispatchNext();
      expect(unreachableDeferredTaskIds).toEqual([]);
    });
  });
});
