import type {
  ClaudeSessionRequest,
  ClaudeSessionResult,
  ISessionLauncher,
  LaunchOptions,
} from "../agents/claude/ISessionLauncher";
import type { IClock } from "../substrate/abstractions/IClock";
import type { IMetricsService } from "./IMetricsService";

export class MeteredSessionLauncher implements ISessionLauncher {
  constructor(
    private readonly inner: ISessionLauncher,
    private readonly metrics: IMetricsService,
    private readonly clock: IClock,
  ) {}

  async launch(request: ClaudeSessionRequest, options?: LaunchOptions): Promise<ClaudeSessionResult> {
    const started = this.clock.now();
    const result = await this.inner.launch(request, options);
    if (result.usage) {
      const completed = new Date(started.getTime() + result.durationMs);
      await this.metrics.recordLlmSession({
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        role: options?.usageContext?.role,
        operation: options?.usageContext?.operation,
        provider: result.usage.provider,
        model: result.usage.model,
        promptTokens: result.usage.promptTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        nonCachedInputTokens: result.usage.nonCachedInputTokens,
        completionTokens: result.usage.completionTokens,
        reasoningOutputTokens: result.usage.reasoningOutputTokens,
        totalTokens: result.usage.totalTokens,
        costUsd: result.usage.costUsd,
        costKnown: result.usage.costKnown,
        costEstimate: result.usage.costEstimate,
        billingSource: result.usage.billingSource,
        telemetrySource: result.usage.telemetrySource,
        success: result.success,
        durationMs: result.durationMs,
      });
    }
    return result;
  }
}
