import { ConversationCompactor } from "../../src/conversation/ConversationCompactor";
import { InMemorySessionLauncher } from "../../src/agents/claude/InMemorySessionLauncher";
import type { IOllamaOffloadService } from "../../src/agents/ollama/IOllamaOffloadService";
import type { OffloadTask, OffloadResult } from "../../src/agents/ollama/OllamaOffloadService";
import { InMemoryLogger } from "../../src/logging";

// ── Mock offload service for testing ──

class MockOffloadService implements IOllamaOffloadService {
  private readonly results: OffloadResult[] = [];
  private _offloadCalls = 0;
  private _inBackoff = false;

  enqueueSuccess(text: string): void {
    this.results.push({ ok: true, result: text });
  }

  enqueueFailure(reason: "unavailable" | "quality_fail" | "parse_error"): void {
    this.results.push({ ok: false, reason });
  }

  setBackoff(inBackoff: boolean): void {
    this._inBackoff = inBackoff;
  }

  get offloadCalls(): number {
    return this._offloadCalls;
  }

  async offload(_task: OffloadTask): Promise<OffloadResult> {
    this._offloadCalls++;
    const next = this.results.shift();
    if (!next) throw new Error("MockOffloadService: no more queued results");
    return next;
  }

  isInBackoff(): boolean {
    return this._inBackoff;
  }
}

// ── Standard test data ──

const OLD_NEW_CONTENT =
  `# Conversation\n\n` +
  `[2025-01-01T09:00:00.000Z] [USER] What is the plan?\n` +
  `[2025-01-01T09:01:00.000Z] [EGO] The plan is to implement feature X\n` +
  `[2025-01-01T10:30:00.000Z] [USER] How is it going?\n` +
  `[2025-01-01T10:35:00.000Z] [EGO] Making good progress\n`;

const ONE_HOUR_AGO = "2025-01-01T10:00:00.000Z";

// ── Original tests (backward compatibility) ──

describe("ConversationCompactor", () => {
  let launcher: InMemorySessionLauncher;
  let compactor: ConversationCompactor;

  beforeEach(() => {
    launcher = new InMemorySessionLauncher();
    compactor = new ConversationCompactor(launcher);
  });

  it("should return content as-is when all entries are recent", async () => {
    const oneHourAgo = "2025-01-01T10:00:00.000Z";
    const content =
      `# Conversation\n\n` +
      `[2025-01-01T10:30:00.000Z] [EGO] Hello\n` +
      `[2025-01-01T10:35:00.000Z] [USER] Hi there\n`;

    const result = await compactor.compact(content, oneHourAgo);

    expect(result).toBe(content);
  });

  it("should compact old entries and keep recent ones detailed", async () => {
    launcher.enqueue({
      rawOutput: "User asked about plan, I explained feature X implementation",
      exitCode: 0,
      durationMs: 100,
      success: true
    });

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    expect(result).toContain("# Conversation");
    expect(result).toContain("## Summary of Earlier Conversation");
    expect(result).toContain("User asked about plan, I explained feature X implementation");
    expect(result).toContain("## Recent Conversation (Last Hour)");
    expect(result).toContain("[2025-01-01T10:30:00.000Z] [USER] How is it going?");
    expect(result).toContain("[2025-01-01T10:35:00.000Z] [EGO] Making good progress");
    expect(result).not.toContain("[2025-01-01T09:00:00.000Z]");
    expect(result).not.toContain("[2025-01-01T09:01:00.000Z]");
  });

  it("should handle summarization failure gracefully", async () => {
    const content =
      `[2025-01-01T09:00:00.000Z] [USER] Old message\n` +
      `[2025-01-01T10:30:00.000Z] [USER] New message\n`;

    launcher.enqueue({
      rawOutput: "",
      exitCode: 1,
      durationMs: 100,
      success: false,
      error: "Failed to summarize"
    });

    const result = await compactor.compact(content, ONE_HOUR_AGO);

    expect(result).toContain("Previous conversation history compacted");
    expect(result).toContain("[2025-01-01T10:30:00.000Z] [USER] New message");
  });

  it("should preserve header lines in compacted output", async () => {
    const content =
      `# Conversation\n` +
      `## Instructions\n\n` +
      `[2025-01-01T09:00:00.000Z] [USER] Old message\n` +
      `[2025-01-01T10:30:00.000Z] [USER] New message\n`;

    launcher.enqueue({
      rawOutput: "Summary of old conversation",
      exitCode: 0,
      durationMs: 100,
      success: true
    });

    const result = await compactor.compact(content, ONE_HOUR_AGO);

    expect(result).toContain("# Conversation");
    expect(result).toContain("## Instructions");
  });

  it("should handle empty content", async () => {
    const content = "";

    const result = await compactor.compact(content, ONE_HOUR_AGO);

    expect(result).toBe("");
  });

  it("should handle content with no timestamps", async () => {
    const content =
      `# Conversation\n` +
      `This is some text without timestamps\n`;

    const result = await compactor.compact(content, ONE_HOUR_AGO);

    expect(result).toBe(content);
  });
});

// ── Ollama offload integration tests (Phase 2) ──

describe("ConversationCompactor with Ollama offload", () => {
  let launcher: InMemorySessionLauncher;
  let offloadService: MockOffloadService;
  let logger: InMemoryLogger;

  beforeEach(() => {
    launcher = new InMemorySessionLauncher();
    offloadService = new MockOffloadService();
    logger = new InMemoryLogger();
  });

  it("uses Ollama offload result when offload succeeds", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueSuccess(
      "User asked about plan. EGO explained feature X implementation strategy."
    );

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    // Ollama summary should appear
    expect(result).toContain("User asked about plan. EGO explained feature X implementation strategy.");
    expect(result).toContain("## Summary of Earlier Conversation");
    expect(result).toContain("## Recent Conversation (Last Hour)");
    // Session launcher should NOT have been called (Ollama handled it)
    expect(launcher.getLaunches().length).toBe(0);
    // Offload service should have been called once
    expect(offloadService.offloadCalls).toBe(1);
  });

  it("falls back to session launcher when offload returns unavailable", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueFailure("unavailable");
    launcher.enqueue({
      rawOutput: "Claude summarized the conversation about feature X",
      exitCode: 0,
      durationMs: 200,
      success: true,
    });

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    // Claude fallback summary should appear
    expect(result).toContain("Claude summarized the conversation about feature X");
    // Both offload and session launcher should have been called
    expect(offloadService.offloadCalls).toBe(1);
    expect(launcher.getLaunches().length).toBe(1);
  });

  it("falls back to session launcher when offload returns quality_fail", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueFailure("quality_fail");
    launcher.enqueue({
      rawOutput: "Proper summary from Claude after quality gate rejection",
      exitCode: 0,
      durationMs: 150,
      success: true,
    });

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    expect(result).toContain("Proper summary from Claude after quality gate rejection");
    expect(offloadService.offloadCalls).toBe(1);
    expect(launcher.getLaunches().length).toBe(1);
  });

  it("falls back to session launcher when offload returns parse_error", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueFailure("parse_error");
    launcher.enqueue({
      rawOutput: "Claude handled the compaction after parse error",
      exitCode: 0,
      durationMs: 100,
      success: true,
    });

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    expect(result).toContain("Claude handled the compaction after parse error");
    expect(offloadService.offloadCalls).toBe(1);
    expect(launcher.getLaunches().length).toBe(1);
  });

  it("falls back gracefully when offload throws unexpectedly", async () => {
    // Use a broken offload service that throws
    const brokenOffload: IOllamaOffloadService = {
      offload: async () => { throw new Error("unexpected kaboom"); },
      isInBackoff: () => false,
    };
    const compactor = new ConversationCompactor(launcher, undefined, brokenOffload, logger);

    launcher.enqueue({
      rawOutput: "Claude recovered after offload threw an error",
      exitCode: 0,
      durationMs: 100,
      success: true,
    });

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    expect(result).toContain("Claude recovered after offload threw an error");
    expect(launcher.getLaunches().length).toBe(1);
  });

  it("uses fallback note when both offload and session launcher fail", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueFailure("unavailable");
    launcher.enqueue({
      rawOutput: "",
      exitCode: 1,
      durationMs: 100,
      success: false,
      error: "Claude also failed",
    });

    const result = await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    expect(result).toContain("Previous conversation history compacted");
    expect(result).toContain("2 lines summarized");
  });

  it("does not call offload when no old content exists", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    const recentOnly =
      `# Conversation\n\n` +
      `[2025-01-01T10:30:00.000Z] [EGO] Hello\n` +
      `[2025-01-01T10:35:00.000Z] [USER] Hi there\n`;

    const result = await compactor.compact(recentOnly, ONE_HOUR_AGO);

    expect(result).toBe(recentOnly);
    expect(offloadService.offloadCalls).toBe(0);
    expect(launcher.getLaunches().length).toBe(0);
  });

  it("passes compaction task type and quality gate to offload service", async () => {
    let capturedTask: OffloadTask | undefined;
    const capturingOffload: IOllamaOffloadService = {
      offload: async (task) => {
        capturedTask = task;
        return { ok: true, result: "Valid summary of the conversation about feature X planning." };
      },
      isInBackoff: () => false,
    };
    const compactor = new ConversationCompactor(launcher, undefined, capturingOffload, logger);

    await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    expect(capturedTask).toBeDefined();
    expect(capturedTask!.taskType).toBe("compaction");
    // Quality gate should reject very short strings
    expect(capturedTask!.qualityGate("short")).toBe(false);
    // Quality gate should accept substantive summaries
    expect(capturedTask!.qualityGate("A substantive summary of the conversation contents.")).toBe(true);
  });

  it("logs offload attempt and fallback when offload fails", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueFailure("unavailable");
    launcher.enqueue({
      rawOutput: "Claude summary",
      exitCode: 0,
      durationMs: 100,
      success: true,
    });

    await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    const debugMessages = logger.getEntries();
    expect(debugMessages.some(m => m.includes("Attempting Ollama offload"))).toBe(true);
    expect(debugMessages.some(m => m.includes("offload failed") && m.includes("unavailable"))).toBe(true);
  });

  it("logs success when offload succeeds", async () => {
    const compactor = new ConversationCompactor(launcher, undefined, offloadService, logger);

    offloadService.enqueueSuccess(
      "Valid compacted summary from the Ollama model endpoint."
    );

    await compactor.compact(OLD_NEW_CONTENT, ONE_HOUR_AGO);

    const debugMessages = logger.getEntries();
    expect(debugMessages.some(m => m.includes("Ollama offload succeeded"))).toBe(true);
  });
});
