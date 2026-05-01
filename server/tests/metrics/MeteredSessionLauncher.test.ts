import { MeteredSessionLauncher } from "../../src/metrics/MeteredSessionLauncher";
import { InMemorySessionLauncher } from "../../src/agents/claude/InMemorySessionLauncher";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";
import type { IMetricsService, LlmSessionMetric, MetricsQuery, UsageSummary } from "../../src/metrics/IMetricsService";

class RecordingMetricsService implements IMetricsService {
  readonly recorded: LlmSessionMetric[] = [];

  async recordLlmSession(metric: LlmSessionMetric): Promise<void> {
    this.recorded.push(metric);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(_query: MetricsQuery): Promise<T[]> {
    return [];
  }

  async summarizeUsage(_windowHours: number): Promise<UsageSummary> {
    return {
      windowHours: 24,
      sessions: 0,
      promptTokens: 0,
      cachedInputTokens: 0,
      nonCachedInputTokens: 0,
      completionTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      estimatedCostUsd: 0,
      knownCostUsd: 0,
      unknownCostSessions: 0,
    };
  }
}

describe("MeteredSessionLauncher", () => {
  it("records launcher usage with role and operation context", async () => {
    const inner = new InMemorySessionLauncher();
    const metrics = new RecordingMetricsService();
    const clock = new FixedClock(new Date("2026-05-01T12:00:00.000Z"));
    const launcher = new MeteredSessionLauncher(inner, metrics, clock);
    inner.enqueue({
      rawOutput: "ok",
      exitCode: 0,
      durationMs: 250,
      success: true,
      usage: {
        provider: "codex",
        model: "gpt-5.5",
        promptTokens: 100,
        cachedInputTokens: 30,
        nonCachedInputTokens: 70,
        completionTokens: 5,
        reasoningOutputTokens: 1,
        totalTokens: 105,
        costUsd: 0.001,
        costKnown: false,
        costEstimate: true,
        billingSource: "static_estimate",
        telemetrySource: "codex-exec-json",
      },
    });

    await launcher.launch(
      { systemPrompt: "", message: "hello" },
      { usageContext: { role: "EGO", operation: "decide" } },
    );

    expect(metrics.recorded).toEqual([
      expect.objectContaining({
        startedAt: "2026-05-01T12:00:00.000Z",
        completedAt: "2026-05-01T12:00:00.250Z",
        role: "EGO",
        operation: "decide",
        provider: "codex",
        model: "gpt-5.5",
        totalTokens: 105,
        costUsd: 0.001,
        success: true,
        durationMs: 250,
      }),
    ]);
  });

  it("does not record sessions when the provider reports no usage", async () => {
    const inner = new InMemorySessionLauncher();
    const metrics = new RecordingMetricsService();
    const launcher = new MeteredSessionLauncher(inner, metrics, new FixedClock(new Date("2026-05-01T12:00:00.000Z")));
    inner.enqueueSuccess("ok");

    await launcher.launch({ systemPrompt: "", message: "hello" });

    expect(metrics.recorded).toEqual([]);
  });
});
