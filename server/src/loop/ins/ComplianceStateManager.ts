import { IFileSystem } from "../../substrate/abstractions/IFileSystem";
import { ILogger } from "../../logging";
import { ComplianceState, emptyComplianceState } from "./types";

/**
 * Manages persistent compliance state for INS consecutive-partial detection.
 * State is stored at .ins/state/compliance.json and survives restarts.
 *
 * Write frequency is low — only when a partial is recorded or cleared.
 * Follows the same pattern as SuperegoFindingTracker.load().
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
      const parsed = JSON.parse(raw) as ComplianceState;
      // Basic validation
      if (typeof parsed.partials !== "object" || parsed.partials === null) {
        throw new Error("invalid partials field");
      }
      return new ComplianceStateManager(fs, statePath, logger, parsed);
    } catch {
      logger.debug("ins: compliance state not found or invalid, starting fresh");
      return new ComplianceStateManager(fs, statePath, logger, emptyComplianceState());
    }
  }

  recordPartial(precondition: string, cycleNumber: number): void {
    const existing = this.state.partials[precondition];
    if (existing) {
      existing.count++;
      existing.lastCycle = cycleNumber;
    } else {
      this.state.partials[precondition] = {
        count: 1,
        firstCycle: cycleNumber,
        lastCycle: cycleNumber,
      };
    }
    this.state.lastUpdatedCycle = cycleNumber;
    this.dirty = true;
  }

  getPartialCount(precondition: string): number {
    return this.state.partials[precondition]?.count ?? 0;
  }

  clearPartial(precondition: string): void {
    if (this.state.partials[precondition]) {
      delete this.state.partials[precondition];
      this.dirty = true;
    }
  }

  /** Clear all tracked partials (e.g., on successful cycle with no partials) */
  clearAll(): void {
    if (Object.keys(this.state.partials).length > 0) {
      this.state.partials = {};
      this.dirty = true;
    }
  }

  getState(): ComplianceState {
    return { ...this.state, partials: { ...this.state.partials } };
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
