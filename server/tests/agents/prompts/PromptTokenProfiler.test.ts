import { InMemoryLogger } from "../../../src/logging";
import type {
  ClaudeSessionRequest,
  ClaudeSessionResult,
  ISessionLauncher,
  LaunchOptions,
} from "../../../src/agents/claude/ISessionLauncher";
import { PromptProfilingSessionLauncher } from "../../../src/agents/prompts/PromptProfilingSessionLauncher";
import {
  PROMPT_TOKEN_CATEGORIES,
  PromptTokenProfiler,
} from "../../../src/agents/prompts/PromptTokenProfiler";

describe("PromptTokenProfiler", () => {
  it("attributes every assembled-prompt unit to the six requested categories", () => {
    const request: ClaudeSessionRequest = {
      systemPrompt: [
        "You are the Subconscious — an execution role.",
        "Static role doctrine belongs here.",
        "",
        "=== ENVIRONMENT ===",
        "Substrate directory: /substrate",
        "",
        "=== TOOL REFERENCE ===",
        "- Run shell command: `Bash`",
        "",
        "=== AUTONOMY REMINDER ===",
        "Act within the established charter.",
      ].join("\n"),
      message: [
        "[REQUIRED FILES — read before reasoning]",
        "- /substrate/ID.md — required before reasoning",
        "- /substrate/PEERS.md — required before reasoning",
        "- /substrate/MEMORY.md — required before reasoning",
        "- /substrate/PLAN.md — required before reasoning",
        "",
        "[FILES — read on demand]",
        "- /substrate/SKILLS.md — capability index",
        "",
        "[RUNTIME STATE]",
        "Status: baseline",
        "",
        "Execute representative task.",
      ].join("\n"),
    };

    const profile = new PromptTokenProfiler().profile(request, {
      model: "test-model",
      usageContext: { role: "SUBCONSCIOUS", operation: "execute" },
    });

    expect(profile.estimator).toBe("lexical_units_v1");
    expect(profile.role).toBe("SUBCONSCIOUS");
    expect(profile.operation).toBe("execute");
    expect(profile.model).toBe("test-model");
    expect(profile.totalCharacters).toBe(request.systemPrompt.length + request.message.length);
    expect(profile.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      PROMPT_TOKEN_CATEGORIES.reduce(
        (total, category) => total + profile.categories[category].characters,
        0,
      ),
    ).toBe(profile.totalCharacters);
    for (const category of PROMPT_TOKEN_CATEGORIES) {
      expect(profile.categories[category].estimatedTokens).toBeGreaterThan(0);
    }
    expect(
      PROMPT_TOKEN_CATEGORIES.reduce(
        (total, category) => total + profile.categories[category].estimatedTokens,
        0,
      ),
    ).toBe(profile.totalEstimatedTokens);
  });

  it("estimates repeated eight-unit content without retaining prompt text", () => {
    const repeated = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const request = { systemPrompt: repeated, message: repeated };
    const profile = new PromptTokenProfiler().profile(request);

    expect(profile.duplicateContent.shingleSize).toBe(8);
    expect(profile.duplicateContent.duplicateEstimatedTokens).toBeGreaterThanOrEqual(8);
    expect(profile.duplicateContent.crossCategoryDuplicateEstimatedTokens).toBeGreaterThanOrEqual(8);
    expect(profile.duplicateContent.duplicateShare).toBeGreaterThan(0);
    expect(JSON.stringify(profile)).not.toContain(repeated);
  });
});

describe("PromptProfilingSessionLauncher", () => {
  const result: ClaudeSessionResult = {
    rawOutput: "ok",
    exitCode: 0,
    durationMs: 1,
    success: true,
  };

  function recordingLauncher(calls: Array<{ request: ClaudeSessionRequest; options?: LaunchOptions }>): ISessionLauncher {
    return {
      launch: async (request, options) => {
        calls.push({ request, options });
        return result;
      },
    };
  }

  it("forwards the same request and routing option objects and returns the same result", async () => {
    const calls: Array<{ request: ClaudeSessionRequest; options?: LaunchOptions }> = [];
    const logger = new InMemoryLogger();
    const launcher = new PromptProfilingSessionLauncher(recordingLauncher(calls), logger);
    const request = { systemPrompt: "system bytes\n", message: "message bytes\n" };
    const options: LaunchOptions = {
      model: "strategic-model",
      effort: "high",
      continueSession: false,
      persistSession: false,
      usageContext: { role: "EGO", operation: "planIteration" },
    };

    const returned = await launcher.launch(request, options);

    expect(returned).toBe(result);
    expect(calls).toHaveLength(1);
    expect(calls[0].request).toBe(request);
    expect(calls[0].options).toBe(options);
    expect(calls[0].request.systemPrompt).toBe("system bytes\n");
    expect(calls[0].request.message).toBe("message bytes\n");
    expect(calls[0].options?.model).toBe("strategic-model");
    expect(calls[0].options?.effort).toBe("high");
    expect(logger.getEntries()).toHaveLength(1);
    expect(logger.getEntries()[0]).toContain("[PROMPT_PROFILE]");
  });

  it("fails open when profiling throws", async () => {
    const calls: Array<{ request: ClaudeSessionRequest; options?: LaunchOptions }> = [];
    const logger = new InMemoryLogger();
    const failingProfiler = {
      profile: () => {
        throw new Error("observer unavailable");
      },
    } as PromptTokenProfiler;
    const launcher = new PromptProfilingSessionLauncher(
      recordingLauncher(calls),
      logger,
      failingProfiler,
    );
    const request = { systemPrompt: "system", message: "message" };

    await expect(launcher.launch(request)).resolves.toBe(result);
    expect(calls[0].request).toBe(request);
    expect(logger.getWarnEntries()).toEqual([
      "prompt profiling failed open: observer unavailable",
    ]);
  });
});
