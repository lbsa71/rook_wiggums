import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";
import { SystemClock } from "../../../src/substrate/abstractions/SystemClock";
import { IClock } from "../../../src/substrate/abstractions/IClock";

describe("FixedClock", () => {
  it("returns the injected date", () => {
    const date = new Date("2025-06-15T10:30:00Z");
    const clock: IClock = new FixedClock(date);
    expect(clock.now()).toEqual(date);
  });

  it("returns the same date on multiple calls", () => {
    const date = new Date("2025-06-15T10:30:00Z");
    const clock = new FixedClock(date);
    expect(clock.now()).toEqual(date);
    expect(clock.now()).toEqual(date);
  });

  it("allows changing the time via setNow", () => {
    const clock = new FixedClock(new Date("2025-01-01T00:00:00Z"));
    const newDate = new Date("2025-12-31T23:59:59Z");
    clock.setNow(newDate);
    expect(clock.now()).toEqual(newDate);
  });
});

describe("SystemClock", () => {
  it("returns a date close to the current time", () => {
    const clock: IClock = new SystemClock();
    const before = Date.now();
    const result = clock.now();
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});
