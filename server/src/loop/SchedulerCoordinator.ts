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
   * Errors thrown by a scheduler's run() propagate immediately and stop
   * subsequent schedulers from executing in this cycle. Callers should
   * ensure individual schedulers handle their own errors where needed.
   */
  async runDueSchedulers(): Promise<void> {
    for (const scheduler of this.schedulers) {
      if (await scheduler.shouldRun()) {
        await scheduler.run();
      }
    }
  }
}
