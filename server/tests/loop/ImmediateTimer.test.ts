import { ImmediateTimer } from "../../src/loop/ImmediateTimer";
import { ITimer } from "../../src/loop/ITimer";

describe("ImmediateTimer", () => {
  let timer: ImmediateTimer;

  beforeEach(() => {
    timer = new ImmediateTimer();
  });

  it("implements ITimer", () => {
    const t: ITimer = timer;
    expect(t).toBeDefined();
  });

  it("resolves immediately", async () => {
    const start = Date.now();
    await timer.delay(5000);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it("records calls", async () => {
    expect(timer.getCalls()).toEqual([]);

    await timer.delay(100);
    await timer.delay(200);
    await timer.delay(300);

    expect(timer.getCalls()).toEqual([100, 200, 300]);
  });

  it("resets recorded calls", async () => {
    await timer.delay(100);
    expect(timer.getCalls()).toHaveLength(1);

    timer.reset();
    expect(timer.getCalls()).toEqual([]);
  });
});
