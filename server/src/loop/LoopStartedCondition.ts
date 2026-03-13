import type { IConditionEvaluator } from "./IConditionEvaluator";

/**
 * LoopStartedCondition — fires once on each process startup.
 *
 * Matches condition: `loop_started`
 *
 * This evaluator is initialised with `pending = true` so the condition fires on
 * the very first HeartbeatScheduler cycle after the process starts (or restarts).
 * After evaluate() returns `true` it resets to `false` — the HeartbeatScheduler
 * edge-trigger then arms itself for the next startup.
 *
 * Primary use-case: prompt the agent to scan `shared/patterns/` for entries
 * published while it was absent (rate-limited, offline, or otherwise unavailable).
 */
export class LoopStartedCondition implements IConditionEvaluator {
  static readonly PREFIX = "loop_started";

  private pending = true;

  async evaluate(_condition: string): Promise<boolean> {
    if (this.pending) {
      this.pending = false;
      return true;
    }
    return false;
  }
}
