import {
  assertApprovedProviderFallback,
  classifyProviderFailure,
  ProviderFallbackLauncher,
  UnsafeProviderFallbackError,
} from "../../src/agents/ProviderFallbackLauncher";
import { InMemorySessionLauncher } from "../../src/agents/claude/InMemorySessionLauncher";
import { InferenceLivenessTracker } from "../../src/evaluation/InferenceLivenessTracker";

describe("ProviderFallbackLauncher", () => {
  it.each([
    ["auth", "Anthropic returned HTTP 401: invalid API key", true],
    ["rate_limit", "Codex failed: rate limit exceeded / HTTP 429", true],
    ["provider", "Cannot reach Groq API: fetch failed", true],
    ["model", "Google AI returned HTTP 404: model not found", true],
    ["tool", "mcp tool call failed: no such tool", false],
  ] as const)("classifies %s failures", (kind, error, degradedRouteAllowed) => {
    expect(classifyProviderFailure({
      rawOutput: "",
      exitCode: 1,
      durationMs: 0,
      success: false,
      error,
    })).toEqual(expect.objectContaining({
      kind,
      degradedRouteAllowed,
    }));
  });

  it("does not replay a task through another provider after a tool failure", async () => {
    const primary = new InMemorySessionLauncher();
    const fallback = new InMemorySessionLauncher();
    primary.enqueueFailure("mcp tool failed after dispatch");
    fallback.enqueueSuccess("fallback");
    const launcher = new ProviderFallbackLauncher(primary, [{
      provider: "ollama",
      model: "qwen3:14b",
      launcher: fallback,
    }]);

    const result = await launcher.launch({ systemPrompt: "", message: "send the message" });

    expect(result.success).toBe(false);
    expect(fallback.getLaunches()).toHaveLength(0);
  });

  it("does not continue past a degraded route that reports a tool failure", async () => {
    const primary = new InMemorySessionLauncher();
    const firstFallback = new InMemorySessionLauncher();
    const secondFallback = new InMemorySessionLauncher();
    primary.enqueueFailure("primary provider timed out");
    firstFallback.enqueueFailure("MCP tool failed after dispatch");
    secondFallback.enqueueSuccess("unsafe replay");
    const launcher = new ProviderFallbackLauncher(primary, [
      {
        provider: "ollama",
        model: "qwen3:14b",
        launcher: firstFallback,
      },
      {
        provider: "groq",
        model: "llama-3.1-8b-instant",
        launcher: secondFallback,
      },
    ]);

    const result = await launcher.launch({ systemPrompt: "", message: "send the message" });

    expect(result.success).toBe(false);
    expect(firstFallback.getLaunches()).toHaveLength(1);
    expect(secondFallback.getLaunches()).toHaveLength(0);
  });

  it("gives tool-side-effect evidence precedence over overlapping auth keywords", () => {
    expect(classifyProviderFailure("MCP tool failed after dispatch: permission denied"))
      .toEqual(expect.objectContaining({
        kind: "tool",
        retryable: false,
        degradedRouteAllowed: false,
      }));
  });

  it("retains raw tool evidence when the terminal error reports a provider timeout", () => {
    expect(classifyProviderFailure({
      rawOutput: "MCP tool call completed before the stream closed",
      exitCode: 1,
      durationMs: 1000,
      success: false,
      error: "provider timed out",
    })).toEqual(expect.objectContaining({
      kind: "tool",
      degradedRouteAllowed: false,
    }));
  });

  it("does not route unknown failures", async () => {
    const primary = new InMemorySessionLauncher();
    const fallback = new InMemorySessionLauncher();
    primary.enqueueFailure("malformed response");
    fallback.enqueueSuccess("fallback");
    const launcher = new ProviderFallbackLauncher(primary, [{
      provider: "ollama",
      model: "qwen3:14b",
      launcher: fallback,
    }]);

    const result = await launcher.launch({ systemPrompt: "", message: "run" });

    expect(result.success).toBe(false);
    expect(fallback.getLaunches()).toHaveLength(0);
  });

  it("routes classified provider failures to an approved degraded route", async () => {
    const primary = new InMemorySessionLauncher();
    const fallback = new InMemorySessionLauncher();
    primary.enqueueFailure("Cannot reach Groq API: fetch failed");
    fallback.enqueueSuccess("fallback ok");
    const launcher = new ProviderFallbackLauncher(primary, [{
      provider: "ollama",
      model: "qwen3:14b",
      launcher: fallback,
    }]);

    const result = await launcher.launch(
      { systemPrompt: "", message: "run" },
      { model: "gpt-5.4-mini", usageContext: { role: "EGO", operation: "decide" } },
    );

    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe("fallback ok");
    expect(fallback.getLaunches()[0].options).toEqual(expect.objectContaining({
      model: "qwen3:14b",
      allowFrontierModel: false,
    }));
  });

  it("blocks unsafe fallback routes to frontier or unknown-cost models", async () => {
    const primary = new InMemorySessionLauncher();
    const unsafe = new InMemorySessionLauncher();
    primary.enqueueFailure("HTTP 429: rate limit exceeded");
    unsafe.enqueueSuccess("unsafe");
    const launcher = new ProviderFallbackLauncher(primary, [{
      provider: "codex",
      model: "gpt-5.5",
      launcher: unsafe,
    }]);

    const result = await launcher.launch({ systemPrompt: "", message: "run" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no approved degraded provider fallback succeeded");
    expect(unsafe.getLaunches()).toHaveLength(0);
  });

  it("rejects unknown-cost remote fallback models explicitly", () => {
    expect(() => assertApprovedProviderFallback("anthropic", "claude-sonnet-4-20250514"))
      .toThrow(UnsafeProviderFallbackError);
    expect(() => assertApprovedProviderFallback("anthropic", "claude-haiku-4-20250514"))
      .not.toThrow();
  });

  describe("InferenceLivenessTracker integration", () => {
    it("calls recordSuccess on primary success", async () => {
      const primary = new InMemorySessionLauncher();
      const tracker = new InferenceLivenessTracker();
      primary.enqueueSuccess("ok");
      const launcher = new ProviderFallbackLauncher(primary, [], undefined, tracker);

      await launcher.launch({ systemPrompt: "", message: "run" });

      expect(tracker.getState().consecutiveFailures).toBe(0);
      expect(tracker.getState().lastSuccessAt).not.toBeNull();
    });

    it("calls recordSuccess when fallback succeeds", async () => {
      const primary = new InMemorySessionLauncher();
      const fallback = new InMemorySessionLauncher();
      const tracker = new InferenceLivenessTracker();
      primary.enqueueFailure("fetch failed");
      fallback.enqueueSuccess("fallback ok");
      const launcher = new ProviderFallbackLauncher(primary, [{
        provider: "ollama",
        model: "qwen3:14b",
        launcher: fallback,
      }], undefined, tracker);

      await launcher.launch({ systemPrompt: "", message: "run" });

      expect(tracker.getState().consecutiveFailures).toBe(0);
      expect(tracker.getState().lastSuccessAt).not.toBeNull();
    });

    it("calls recordFailure when all routes fail", async () => {
      const primary = new InMemorySessionLauncher();
      const tracker = new InferenceLivenessTracker();
      primary.enqueueFailure("HTTP 401: unauthorized");
      const launcher = new ProviderFallbackLauncher(primary, [], undefined, tracker);

      await launcher.launch({ systemPrompt: "", message: "run" });

      expect(tracker.getState().consecutiveFailures).toBe(1);
      expect(tracker.getState().lastFailureAt).not.toBeNull();
    });

    it("records failure for unknown failures that skip routing", async () => {
      const primary = new InMemorySessionLauncher();
      const tracker = new InferenceLivenessTracker();
      primary.enqueueFailure("malformed response");
      const launcher = new ProviderFallbackLauncher(primary, [], undefined, tracker);

      await launcher.launch({ systemPrompt: "", message: "run" });

      // unknown failures: degradedRouteAllowed=false, recordFailure called
      expect(tracker.getState().consecutiveFailures).toBe(1);
    });

    it("marks unhealthy after 3 consecutive failures", async () => {
      const primary = new InMemorySessionLauncher();
      const tracker = new InferenceLivenessTracker();
      const launcher = new ProviderFallbackLauncher(primary, [], undefined, tracker);

      primary.enqueueFailure("HTTP 401");
      await launcher.launch({ systemPrompt: "", message: "run" });
      primary.enqueueFailure("HTTP 401");
      await launcher.launch({ systemPrompt: "", message: "run" });
      expect(tracker.isHealthy()).toBe(true); // 2 failures < threshold

      primary.enqueueFailure("HTTP 401");
      await launcher.launch({ systemPrompt: "", message: "run" });
      expect(tracker.isHealthy()).toBe(false); // 3 failures >= threshold
    });
  });
});
