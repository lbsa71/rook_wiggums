import type { SessionUsage } from "../agents/claude/ISessionLauncher";

export interface LlmSessionMetric {
  id?: string;
  startedAt: string;
  completedAt: string;
  role?: string;
  operation?: string;
  provider: SessionUsage["provider"];
  model?: string;
  promptTokens?: number;
  cachedInputTokens?: number;
  nonCachedInputTokens?: number;
  completionTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  costKnown: boolean;
  costEstimate: boolean;
  billingSource: SessionUsage["billingSource"];
  telemetrySource: string;
  success: boolean;
  durationMs: number;
}

export interface MetricsQuery {
  sql: string;
  params?: unknown[];
  maxRows?: number;
}

export interface UsageSummary {
  windowHours: number;
  sessions: number;
  promptTokens: number;
  cachedInputTokens: number;
  nonCachedInputTokens: number;
  completionTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
  estimatedCostUsd: number;
  knownCostUsd: number;
  unknownCostSessions: number;
}

export interface IMetricsService {
  recordLlmSession(metric: LlmSessionMetric): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(query: MetricsQuery): Promise<T[]>;
  summarizeUsage(windowHours: number): Promise<UsageSummary>;
}
