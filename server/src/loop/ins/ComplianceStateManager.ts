import { IFileSystem } from "../../substrate/abstractions/IFileSystem";
import { ILogger } from "../../logging";
import { ComplianceState, CompliancePattern, InsAcknowledgment, emptyComplianceState } from "./types";

/**
 * Manages persistent compliance state for INS consecutive-partial detection.
 * State is stored at .ins/state/compliance.json and survives restarts.
 *
 * Phase 3: Updated schema uses patterns: CompliancePattern[] instead of
 * the Phase 1 partials: Record<string, {...}> format. Old schema is
 * migrated to fresh state on load.
 *
 * Write frequency is low — only when a partial is recorded or cleared.
 */
export class ComplianceStateManager {
  private state: ComplianceState;
  private dirty = false;

  private constructor(
    private readonly fs: IFileSystem,
    private readonly statePath: string,
    private readonly logger: ILogger,
    state: ComplianceState,
  ) {
    this.state = state;
  }

  static async load(
    statePath: string,
    fs: IFileSystem,
    logger: ILogger,
  ): Promise<ComplianceStateManager> {
    const filePath = `${statePath}/compliance.json`;
    try {
      const raw = await fs.readFile(filePath);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Detect Phase 1 schema (has 'partials' field, not 'patterns') — migrate to fresh state
      if ('partials' in parsed && !('patterns' in parsed)) {
        logger.debug("ins: detected Phase 1 compliance schema — migrating to Phase 3 (starting fresh)");
        return new ComplianceStateManager(fs, statePath, logger, emptyComplianceState());
      }
      // Validate Phase 3 schema
      const state = parsed as ComplianceState;
      if (!Array.isArray(state.patterns)) {
        throw new Error("invalid patterns field");
      }
      return new ComplianceStateManager(fs, statePath, logger, state);
    } catch {
      logger.debug("ins: compliance state not found or invalid, starting fresh");
      return new ComplianceStateManager(fs, statePath, logger, emptyComplianceState());
    }
  }

  /** Find a pattern by patternId */
  findPattern(patternId: string): CompliancePattern | undefined {
    return this.state.patterns.find(p => p.patternId === patternId);
  }

  /** Record or increment a partial pattern */
  recordOrUpdatePattern(
    patternId: string,
    role: 'Superego' | 'Subconscious',
    patternText: string,
    cycleNumber: number,
    taskId?: string,
  ): CompliancePattern {
    const existing = this.state.patterns.find(p => p.patternId === patternId);
    if (existing) {
      existing.cyclesCount++;
      existing.lastSeenCycle = cycleNumber;
      existing.patternText = patternText; // update to most recent text
      this.state.lastUpdatedCycle = cycleNumber;
      this.dirty = true;
      return existing;
    } else {
      const pattern: CompliancePattern = {
        patternId,
        role,
        patternText,
        cyclesCount: 1,
        firstSeenCycle: cycleNumber,
        lastSeenCycle: cycleNumber,
        taskId,
      };
      this.state.patterns.push(pattern);
      this.state.lastUpdatedCycle = cycleNumber;
      this.dirty = true;
      return pattern;
    }
  }

  /** Apply an acknowledgment from Ego to a pattern */
  applyAcknowledgment(
    patternId: string,
    ack: InsAcknowledgment,
    now: Date,
  ): void {
    const pattern = this.findPattern(patternId);
    if (!pattern) return;
    const ttl = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    pattern.acknowledged = true;
    pattern.acknowledgedAt = now.toISOString();
    pattern.acknowledgedVerdict = ack.verdict;
    pattern.acknowledgedTaskStatus = ack.taskStatus;
    pattern.acknowledgedTTL = ttl.toISOString();
    this.dirty = true;
  }

  /** Clear a specific pattern (task resolved or acknowledged as false_positive) */
  clearPattern(patternId: string): void {
    const index = this.state.patterns.findIndex(p => p.patternId === patternId);
    if (index !== -1) {
      this.state.patterns.splice(index, 1);
      this.dirty = true;
    }
  }

  /** Clear all tracked patterns (legacy path — used when no taskId available on success) */
  clearAll(): void {
    if (this.state.patterns.length > 0) {
      this.state.patterns = [];
      this.dirty = true;
    }
  }

  getState(): ComplianceState {
    return { ...this.state, patterns: [...this.state.patterns] };
  }

  isDirty(): boolean {
    return this.dirty;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const filePath = `${this.statePath}/compliance.json`;
    try {
      await this.fs.mkdir(this.statePath, { recursive: true });
      await this.fs.writeFile(filePath, JSON.stringify(this.state, null, 2));
      this.dirty = false;
    } catch (err) {
      this.logger.debug(
        `ins: failed to save compliance state — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
