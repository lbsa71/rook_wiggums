import { SchedulerCoordinator } from "../../src/loop/SchedulerCoordinator";
import { IScheduler } from "../../src/loop/IScheduler";

function makeScheduler(shouldRunResult: boolean, runFn?: () => Promise<void>): IScheduler & { runCalled: boolean } {
  const s = {
    runCalled: false,
    shouldRun: async () => shouldRunResult,
    run: async () => {
      s.runCalled = true;
      if (runFn) await runFn();
    },
  };
  return s;
}

describe("SchedulerCoordinator", () => {
  it("calls run() for schedulers whose shouldRun() returns true", async () => {
    const due = makeScheduler(true);
    const notDue = makeScheduler(false);
    const coordinator = new SchedulerCoordinator([due, notDue]);

    await coordinator.runDueSchedulers();

    expect(due.runCalled).toBe(true);
    expect(notDue.runCalled).toBe(false);
  });

  it("does nothing when no schedulers are registered", async () => {
    const coordinator = new SchedulerCoordinator([]);
    await expect(coordinator.runDueSchedulers()).resolves.toBeUndefined();
  });

  it("runs all due schedulers in order", async () => {
    const order: number[] = [];
    const schedulers = [1, 2, 3].map((n) =>
      makeScheduler(true, async () => { order.push(n); })
    );
    const coordinator = new SchedulerCoordinator(schedulers);

    await coordinator.runDueSchedulers();

    expect(order).toEqual([1, 2, 3]);
  });

  it("skips run() when shouldRun() returns false", async () => {
    const s = makeScheduler(false);
    const coordinator = new SchedulerCoordinator([s]);

    await coordinator.runDueSchedulers();

    expect(s.runCalled).toBe(false);
  });

  it("propagates errors thrown by run()", async () => {
    const failing: IScheduler = {
      shouldRun: async () => true,
      run: async () => { throw new Error("scheduler error"); },
    };
    const coordinator = new SchedulerCoordinator([failing]);

    await expect(coordinator.runDueSchedulers()).rejects.toThrow("scheduler error");
  });
});
