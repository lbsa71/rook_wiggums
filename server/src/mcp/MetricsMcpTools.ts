import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IMetricsService } from "../metrics/IMetricsService";

export function registerMetricsTools(server: McpServer, metrics: IMetricsService): void {
  server.tool(
    "get_usage_summary",
    "Get aggregate LLM token and cost usage for a recent time window",
    {
      windowHours: z.number().positive().max(24 * 365).optional().describe("Lookback window in hours; defaults to 24"),
    },
    async ({ windowHours }) => {
      try {
        const summary = await metrics.summarizeUsage(windowHours ?? 24);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, summary }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }] };
      }
    },
  );

  server.tool(
    "query_metrics",
    "Run a read-only SQL SELECT query against approved metrics views/tables",
    {
      sql: z.string().describe("Read-only SELECT or WITH ... SELECT SQL query"),
      params: z.array(z.unknown()).optional().describe("Positional SQL parameters"),
      maxRows: z.number().int().positive().max(1000).optional().describe("Maximum rows to return; defaults to 100"),
    },
    async ({ sql, params, maxRows }) => {
      try {
        const rows = await metrics.query({ sql, params, maxRows });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, rows }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }] };
      }
    },
  );
}
