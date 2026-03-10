import { SleepWakeTimer, InMemorySleepWakeTimer } from "../../src/loop/SleepWakeTimer";
import { InMemoryLogger } from "../../src/logging";

describe("SleepWakeTimer", () => {
  let timer: SleepWakeTimer;

  beforeEach(() => {
    jest.useFakeTimers();
    timer = new SleepWakeTimer(new InMemoryLogger());
  });

  afterEach(() => {
    timer.clear();
    jest.useRealTimers();
  });

  it("fires the callback at the scheduled time", () => {
    const cb = jest.fn();
    const wakeAt = new Date(Date.now() + 60_000);
    timer.set(wakeAt, cb);

    jest.advanceTimersByTime(59_999);
    expect(cb).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires immediately when wakeAt is in the past", () => {
    const cb = jest.fn();
    timer.set(new Date(Date.now() - 1000), cb);

    jest.advanceTimersByTime(0);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("clears the timer", () => {
    const cb = jest.fn();
    timer.set(new Date(Date.now() + 60_000), cb);

    timer.clear();
    jest.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("replaces an existing timer when set() is called again", () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    timer.set(new Date(Date.now() + 60_000), cb1);
    timer.set(new Date(Date.now() + 30_000), cb2);

    jest.advanceTimersByTime(30_000);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    // cb1 should still not fire — it was replaced
    expect(cb1).not.toHaveBeenCalled();
  });
});

describe("InMemorySleepWakeTimer", () => {
  it("records set() calls", () => {
    const timer = new InMemorySleepWakeTimer();
    const cb = jest.fn();
    const wakeAt = new Date("2026-01-01T00:00:00Z");

    timer.set(wakeAt, cb);

    expect(timer.scheduledAt).toEqual(wakeAt);
    expect(timer.onWake).toBe(cb);
  });

  it("fire() invokes the callback and resets state", () => {
    const timer = new InMemorySleepWakeTimer();
    const cb = jest.fn();
    timer.set(new Date("2026-01-01T00:00:00Z"), cb);

    timer.fire();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(timer.scheduledAt).toBeNull();
    expect(timer.onWake).toBeNull();
  });

  it("clear() resets state and increments counter", () => {
    const timer = new InMemorySleepWakeTimer();
    timer.set(new Date("2026-01-01T00:00:00Z"), jest.fn());

    timer.clear();

    expect(timer.scheduledAt).toBeNull();
    expect(timer.onWake).toBeNull();
    expect(timer.clearCount).toBe(1);
  });
});
