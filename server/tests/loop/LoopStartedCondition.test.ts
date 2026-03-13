import { LoopStartedCondition } from "../../src/loop/LoopStartedCondition";

describe("LoopStartedCondition", () => {
  it("fires on first evaluate() call (simulates process startup)", async () => {
    const condition = new LoopStartedCondition();
    expect(await condition.evaluate("loop_started")).toBe(true);
  });

  it("does not fire on subsequent calls (edge trigger resets after first fire)", async () => {
    const condition = new LoopStartedCondition();
    await condition.evaluate("loop_started"); // first call: fires
    expect(await condition.evaluate("loop_started")).toBe(false);
  });

  it("does not fire on any further subsequent calls", async () => {
    const condition = new LoopStartedCondition();
    await condition.evaluate("loop_started");
    await condition.evaluate("loop_started");
    expect(await condition.evaluate("loop_started")).toBe(false);
  });

  it("ignores the condition string argument (matches any value)", async () => {
    const condition = new LoopStartedCondition();
    expect(await condition.evaluate("")).toBe(true);
    expect(await condition.evaluate("loop_started")).toBe(false);
  });
});
