import { IScheduler } from "./IScheduler";

/**
 * Holds a collection of schedulers and runs all that are due on each cycle.
 */
export class SchedulerCoordinator {
  private readonly schedulers: IScheduler[];

  constructor(schedulers: IScheduler[]) {
    this.schedulers = schedulers;
  }

  /**
   * Check each scheduler in order and run those that are due.
   *
   * @param pendingMessageCount - Number of pending agent messages at the time of the call.
   *   Non-urgent schedulers (urgent=false) are skipped when this is > 0 so that the agent
   *   can process waiting messages in the next cycle without delay from optional background jobs.
   *
   * Errors thrown by a scheduler's run() propagate immediately and stop
   * subsequent schedulers from executing in this cycle. Callers should
   * ensure individual schedulers handle their own errors where needed.
   */
  async runDueSchedulers(pendingMessageCount = 0): Promise<void> {
    for (const scheduler of this.schedulers) {
      if (pendingMessageCount > 0 && scheduler.urgent === false) {
        continue;
      }
      if (await scheduler.shouldRun()) {
        await scheduler.run();
      }
    }
  }
}
