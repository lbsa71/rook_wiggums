import { IFileSystem } from "../../substrate/abstractions/IFileSystem";
import { ILogger } from "../../logging";

export interface Finding {
  severity: "info" | "warning" | "critical";
  /** Stable UPPER_SNAKE_CASE identifier for the finding type. Must NOT include
   *  dynamic data (cycle numbers, GC-NNN, etc.) — the category is the key used
   *  to accumulate history across cycles and reach the escalation threshold.
   *  Valid values: ESCALATE_FILE_EMPTY, CLAUDE_BOUNDARIES_CONFLICT,
   *  SGAB_RECLASSIFICATION, VALUES_RECRUITMENT, SOURCE_CODE_BYPASS,
   *  AUDIT_FAILURE, UNKNOWN_FINDING (and any domain-specific additions). */
  category: string;
  message: string;
}

export interface EscalationInfo {
  findingId: string;
  severity: string;
  message: string;
  cycles: number[];
  firstDetectedCycle: number;
  lastOccurrenceCycle: number;
}

export class SuperegoFindingTracker {
  private findingHistory: Map<string, number[]> = new Map();
  private readonly CONSECUTIVE_THRESHOLD = 3;

  /**
   * Generate a stable signature for a finding based on severity and category.
   * Returns a human-readable key of the form "severity:CATEGORY_KEY".
   *
   * Using category (not message content) ensures the signature is stable across
   * cycles even when the message text includes dynamic data (cycle numbers,
   * timestamps, GC-NNN references).  A stable key is required for the
   * CONSECUTIVE_THRESHOLD escalation gate to function correctly.
   */
  generateSignature(finding: Finding): string {
    return `${finding.severity}:${finding.category}`;
  }

  /**
   * Track a finding occurrence at the given cycle number.
   * Returns true if this finding should be escalated (3+ consecutive occurrences).
   */
  track(finding: Finding, cycleNumber: number): boolean {
    const signature = this.generateSignature(finding);
    const history = this.findingHistory.get(signature) || [];
    
    // Add current cycle to history
    history.push(cycleNumber);
    this.findingHistory.set(signature, history);

    // Check if should escalate
    return this.shouldEscalate(signature);
  }

  /**
   * Check if a finding has occurred in 3+ consecutive audit cycles.
   * Consecutive means the cycles form an unbroken sequence when sorted.
   */
  shouldEscalate(findingId: string): boolean {
    const history = this.findingHistory.get(findingId);
    if (!history || history.length < this.CONSECUTIVE_THRESHOLD) {
      return false;
    }

    // Check if last 3 occurrences are consecutive
    const sorted = [...history].sort((a, b) => a - b);
    const last3 = sorted.slice(-this.CONSECUTIVE_THRESHOLD);
    
    // Check if they form a consecutive sequence
    for (let i = 1; i < last3.length; i++) {
      // Allow for the audit interval - findings should appear every N cycles
      // We consider them consecutive if they're reasonably close (within 2x normal interval)
      const gap = last3[i] - last3[i - 1];
      if (gap > 50) { // Max reasonable gap between audits (even with interval of 20-40)
        return false;
      }
    }

    return true;
  }

  /**
   * Get escalation information for a finding that should be escalated.
   */
  getEscalationInfo(finding: Finding): EscalationInfo | null {
    const signature = this.generateSignature(finding);
    const history = this.findingHistory.get(signature);
    
    if (!history || history.length < this.CONSECUTIVE_THRESHOLD) {
      return null;
    }

    const sorted = [...history].sort((a, b) => a - b);
    
    return {
      findingId: signature,
      severity: finding.severity,
      message: finding.message,
      cycles: sorted,
      firstDetectedCycle: sorted[0],
      lastOccurrenceCycle: sorted[sorted.length - 1],
    };
  }

  /**
   * Remove a finding from tracking after escalation to avoid repeated escalations.
   */
  clearFinding(findingId: string): void {
    this.findingHistory.delete(findingId);
  }

  /**
   * Get all tracked finding signatures (for testing/debugging).
   */
  getTrackedFindings(): string[] {
    return Array.from(this.findingHistory.keys());
  }

  /**
   * Get history for a specific finding (for testing/debugging).
   */
  getFindingHistory(findingId: string): number[] | undefined {
    return this.findingHistory.get(findingId);
  }

  /**
   * Serialize tracker state to a JSON file for persistence across restarts.
   */
  async save(filePath: string, fs: IFileSystem): Promise<void> {
    const data = JSON.stringify(Object.fromEntries(this.findingHistory));
    await fs.writeFile(filePath, data);
  }

  /**
   * Deserialize tracker state from a JSON file.
   * Returns a fresh tracker if the file does not exist or is corrupted.
   */
  static async load(filePath: string, fs: IFileSystem, logger?: ILogger): Promise<SuperegoFindingTracker> {
    const tracker = new SuperegoFindingTracker();
    try {
      const content = await fs.readFile(filePath);
      const parsed: unknown = JSON.parse(content);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
            tracker.findingHistory.set(key, value as number[]);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("ENOENT")) {
        logger?.debug(`SuperegoFindingTracker: could not load state from ${filePath}: ${message}`);
      }
    }
    return tracker;
  }
}
