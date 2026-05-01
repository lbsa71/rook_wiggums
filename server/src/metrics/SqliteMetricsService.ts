import * as crypto from "node:crypto";
import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { ILogger } from "../logging";
import type { IMetricsService, LlmSessionMetric, MetricsQuery, UsageSummary } from "./IMetricsService";

const DEFAULT_MAX_ROWS = 100;
const ABSOLUTE_MAX_ROWS = 1_000;

export class SqliteMetricsService implements IMetricsService {
  private db: DatabaseSync | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly logger?: ILogger,
  ) {}

  static forSubstratePath(substratePath: string, logger?: ILogger): SqliteMetricsService {
    return new SqliteMetricsService(path.join(substratePath, ".metrics", "metrics.sqlite"), logger);
  }

  async recordLlmSession(metric: LlmSessionMetric): Promise<void> {
    try {
      const db = await this.open();
      db.prepare(`
        INSERT INTO llm_sessions (
          id, started_at, completed_at, role, operation, provider, model,
          prompt_tokens, cached_input_tokens, non_cached_input_tokens,
          completion_tokens, reasoning_output_tokens, total_tokens, cost_usd,
          cost_known, cost_estimate, billing_source, telemetry_source,
          success, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        metric.id ?? crypto.randomUUID(),
        metric.startedAt,
        metric.completedAt,
        metric.role ?? null,
        metric.operation ?? null,
        metric.provider,
        metric.model ?? null,
        metric.promptTokens ?? null,
        metric.cachedInputTokens ?? null,
        metric.nonCachedInputTokens ?? null,
        metric.completionTokens ?? null,
        metric.reasoningOutputTokens ?? null,
        metric.totalTokens ?? null,
        metric.costUsd ?? null,
        metric.costKnown ? 1 : 0,
        metric.costEstimate ? 1 : 0,
        metric.billingSource,
        metric.telemetrySource,
        metric.success ? 1 : 0,
        metric.durationMs,
      );
    } catch (err) {
      this.logger?.debug(`metrics: failed to record LLM session — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(query: MetricsQuery): Promise<T[]> {
    const sql = this.validateReadOnlySql(query.sql);
    const maxRows = this.normalizeMaxRows(query.maxRows);
    const db = await this.open();
    const rows = db.prepare(`SELECT * FROM (${sql}) LIMIT ?`).all(...(query.params ?? []), maxRows);
    return rows.map((row) => ({ ...(row as Record<string, unknown>) }) as T);
  }

  async summarizeUsage(windowHours: number): Promise<UsageSummary> {
    const hours = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
    const rows = await this.query<{
      sessions: number;
      promptTokens: number | null;
      cachedInputTokens: number | null;
      nonCachedInputTokens: number | null;
      completionTokens: number | null;
      reasoningOutputTokens: number | null;
      totalTokens: number | null;
      costUsd: number | null;
      estimatedCostUsd: number | null;
      knownCostUsd: number | null;
      unknownCostSessions: number;
    }>({
      sql: `
        SELECT
          count(*) AS sessions,
          coalesce(sum(prompt_tokens), 0) AS promptTokens,
          coalesce(sum(cached_input_tokens), 0) AS cachedInputTokens,
          coalesce(sum(non_cached_input_tokens), 0) AS nonCachedInputTokens,
          coalesce(sum(completion_tokens), 0) AS completionTokens,
          coalesce(sum(reasoning_output_tokens), 0) AS reasoningOutputTokens,
          coalesce(sum(total_tokens), 0) AS totalTokens,
          coalesce(sum(cost_usd), 0) AS costUsd,
          coalesce(sum(CASE WHEN cost_estimate = 1 THEN cost_usd ELSE 0 END), 0) AS estimatedCostUsd,
          coalesce(sum(CASE WHEN cost_known = 1 THEN cost_usd ELSE 0 END), 0) AS knownCostUsd,
          sum(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCostSessions
        FROM llm_sessions
        WHERE datetime(started_at) >= datetime('now', ?)
      `,
      params: [`-${hours} hours`],
      maxRows: 1,
    });
    const row = rows[0];
    return {
      windowHours: hours,
      sessions: Number(row?.sessions ?? 0),
      promptTokens: Number(row?.promptTokens ?? 0),
      cachedInputTokens: Number(row?.cachedInputTokens ?? 0),
      nonCachedInputTokens: Number(row?.nonCachedInputTokens ?? 0),
      completionTokens: Number(row?.completionTokens ?? 0),
      reasoningOutputTokens: Number(row?.reasoningOutputTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      costUsd: Number(row?.costUsd ?? 0),
      estimatedCostUsd: Number(row?.estimatedCostUsd ?? 0),
      knownCostUsd: Number(row?.knownCostUsd ?? 0),
      unknownCostSessions: Number(row?.unknownCostSessions ?? 0),
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private async open(): Promise<DatabaseSync> {
    if (this.db) return this.db;
    await mkdir(path.dirname(this.dbPath), { recursive: true });
    const sqliteModule = "node:" + "sqlite";
    const { DatabaseSync } = await import(sqliteModule);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 250;

      CREATE TABLE IF NOT EXISTS llm_sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        role TEXT,
        operation TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        prompt_tokens INTEGER,
        cached_input_tokens INTEGER,
        non_cached_input_tokens INTEGER,
        completion_tokens INTEGER,
        reasoning_output_tokens INTEGER,
        total_tokens INTEGER,
        cost_usd REAL,
        cost_known INTEGER NOT NULL,
        cost_estimate INTEGER NOT NULL,
        billing_source TEXT NOT NULL,
        telemetry_source TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_llm_sessions_started_at ON llm_sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_llm_sessions_role_model ON llm_sessions(role, operation, provider, model);

      CREATE VIEW IF NOT EXISTS usage_daily AS
      SELECT
        date(started_at) AS day,
        provider,
        model,
        role,
        operation,
        count(*) AS sessions,
        coalesce(sum(total_tokens), 0) AS tokens,
        coalesce(sum(cost_usd), 0) AS cost_usd
      FROM llm_sessions
      GROUP BY day, provider, model, role, operation;
    `);
    return this.db;
  }

  private validateReadOnlySql(sql: string): string {
    const trimmed = sql.trim().replace(/;+\s*$/, "");
    if (!trimmed) throw new Error("SQL query is empty");
    if (!/^(select|with)\b/i.test(trimmed)) {
      throw new Error("Only SELECT or WITH ... SELECT metrics queries are allowed");
    }
    if (trimmed.includes(";")) {
      throw new Error("Multiple SQL statements are not allowed");
    }
    const forbidden = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|analyze|transaction|begin|commit|rollback)\b/i;
    if (forbidden.test(trimmed) || /\bpragma_/i.test(trimmed)) {
      throw new Error("Metrics queries are read-only");
    }
    return trimmed;
  }

  private normalizeMaxRows(maxRows: number | undefined): number {
    if (maxRows === undefined) return DEFAULT_MAX_ROWS;
    if (!Number.isInteger(maxRows) || maxRows < 1) {
      throw new Error("maxRows must be a positive integer");
    }
    return Math.min(maxRows, ABSOLUTE_MAX_ROWS);
  }
}
