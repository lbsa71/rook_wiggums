import { IFileSystem } from "../substrate/abstractions/IFileSystem";
import { IClock } from "../substrate/abstractions/IClock";
import * as path from "node:path";

/**
 * Single delegation ratio measurement
 */
export interface DelegationEntry {
  timestamp: string; // ISO 8601
  delegated_issues: number;
  total_coding_issues: number;
  delegation_ratio: number; // 0.0 to 1.0
  week_start: string; // ISO 8601 date (Monday of the week)
  delegate_label: string;
  /** Legacy field retained so existing JSONL metrics remain readable. */
  copilot_issues?: number;
}

/**
 * Delegation ratio status
 */
export interface DelegationStatus {
  ratio: number;
  delegated_issues: number;
  total_issues: number;
  delegate_label: string;
  target_ratio: number;
  status: "OK" | "WARNING" | "CRITICAL";
  alert?: string;
  /** Legacy field retained for older API consumers. */
  copilot_issues?: number;
}

const DEFAULT_TARGET_RATIO = 0.8;
const WARNING_RATIO = 0.6;
const DEFAULT_DELEGATE_LABEL = "external_agent";

/**
 * Tracks delegation ratio to verify offloading pattern compliance.
 * 
 * Design:
 * - JSONL append-only format for weekly delegation measurements
 * - Stores in ~/.local/share/substrate/.metrics/delegation_ratio.jsonl
 * - Target: >=80% of eligible coding tasks delegated to an explicitly named
 *   helper route, not to any specific commercial shell.
 * 
 * Expected usage:
 * - MetricsScheduler calls recordDelegationRatio() weekly
 * - Currently stores manual counts (future: GitHub API integration)
 * 
 * Note: This is a placeholder implementation. Full GitHub API integration
 * would require gh CLI or REST API calls to query issue assignments.
 */
export class DelegationTracker {
  private readonly metricsPath: string;

  constructor(
    private readonly fs: IFileSystem,
    private readonly clock: IClock,
    substrateDir: string
  ) {
    const metricsDir = `${substrateDir}/.metrics`;
    this.metricsPath = `${metricsDir}/delegation_ratio.jsonl`;
  }

  /**
   * Record delegation ratio for a week
   * 
   * @param delegatedIssues Number of coding issues delegated to an external/helper route
   * @param totalCodingIssues Total number of coding issues
   * @param delegateLabel Label for the route being measured, e.g. "pi" or "external_agent"
   */
  async recordDelegationRatio(
    delegatedIssues: number,
    totalCodingIssues: number,
    delegateLabel = DEFAULT_DELEGATE_LABEL
  ): Promise<void> {
    const now = this.clock.now();
    const weekStart = this.getWeekStart(now);
    const ratio = totalCodingIssues > 0 ? delegatedIssues / totalCodingIssues : 0;

    const entry: DelegationEntry = {
      timestamp: now.toISOString(),
      delegated_issues: delegatedIssues,
      total_coding_issues: totalCodingIssues,
      delegation_ratio: ratio,
      week_start: weekStart.toISOString(),
      delegate_label: delegateLabel,
    };

    // Ensure .metrics directory exists
    const metricsDir = path.dirname(this.metricsPath);
    await this.fs.mkdir(metricsDir, { recursive: true });

    // Append to JSONL file
    const line = JSON.stringify(entry) + "\n";
    try {
      const existing = await this.fs.readFile(this.metricsPath);
      await this.fs.writeFile(this.metricsPath, existing + line);
    } catch {
      // File doesn't exist, create it
      await this.fs.writeFile(this.metricsPath, line);
    }
  }

  /**
   * Get all delegation history
   */
  async getHistory(): Promise<DelegationEntry[]> {
    try {
      const content = await this.fs.readFile(this.metricsPath);
      const lines = content.trim().split("\n").filter(l => l.trim());
      return lines.map(line => this.normalizeEntry(JSON.parse(line) as Partial<DelegationEntry>));
    } catch {
      return [];
    }
  }

  /**
   * Get latest delegation ratio
   */
  async getLatestEntry(): Promise<DelegationEntry | null> {
    const history = await this.getHistory();
    return history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Get delegation status with alerts
   */
  async getDelegationStatus(): Promise<DelegationStatus | null> {
    const latest = await this.getLatestEntry();
    if (!latest) {
      return null;
    }

    let status: "OK" | "WARNING" | "CRITICAL" = "OK";
    let alert: string | undefined;

    if (latest.delegation_ratio < WARNING_RATIO) {
      status = "CRITICAL";
      alert = `Delegation ratio below 60% (target: >=${Math.round(DEFAULT_TARGET_RATIO * 100)}%)`;
    } else if (latest.delegation_ratio < DEFAULT_TARGET_RATIO) {
      status = "WARNING";
      alert = `Delegation ratio below ${Math.round(DEFAULT_TARGET_RATIO * 100)}% target`;
    }

    return {
      ratio: latest.delegation_ratio,
      delegated_issues: latest.delegated_issues,
      total_issues: latest.total_coding_issues,
      delegate_label: latest.delegate_label,
      target_ratio: DEFAULT_TARGET_RATIO,
      status,
      alert,
      ...(latest.copilot_issues !== undefined ? { copilot_issues: latest.copilot_issues } : {}),
    };
  }

  private normalizeEntry(entry: Partial<DelegationEntry>): DelegationEntry {
    const delegatedIssues = entry.delegated_issues ?? entry.copilot_issues ?? 0;
    const totalCodingIssues = entry.total_coding_issues ?? 0;
    const delegationRatio = entry.delegation_ratio ?? (totalCodingIssues > 0 ? delegatedIssues / totalCodingIssues : 0);
    return {
      timestamp: entry.timestamp ?? "",
      delegated_issues: delegatedIssues,
      total_coding_issues: totalCodingIssues,
      delegation_ratio: delegationRatio,
      week_start: entry.week_start ?? "",
      delegate_label: entry.delegate_label ?? (entry.copilot_issues !== undefined ? "copilot_legacy" : DEFAULT_DELEGATE_LABEL),
      ...(entry.copilot_issues !== undefined ? { copilot_issues: entry.copilot_issues } : {}),
    };
  }

  /**
   * Get week start (Monday) for a given date
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Clear all delegation history (use with caution)
   */
  async clear(): Promise<void> {
    try {
      await this.fs.unlink(this.metricsPath);
    } catch {
      // File may not exist, ignore
    }
  }
}
