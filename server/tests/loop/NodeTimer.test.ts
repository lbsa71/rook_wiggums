import { NodeTimer } from "../../src/loop/NodeTimer";
import { ITimer } from "../../src/loop/ITimer";

describe("NodeTimer", () => {
  it("satisfies the ITimer interface", () => {
    const timer: ITimer = new NodeTimer();
    expect(typeof timer.delay).toBe("function");
    expect(typeof timer.wake).toBe("function");
  });

  // ── delay() ─────────────────────────────────────────────────────────────

  describe("delay()", () => {
    it("returns a Promise", () => {
      const timer = new NodeTimer();
      const p = timer.delay(1);
      expect(p).toBeInstanceOf(Promise);
      return p; // await so the timeout clears
    });

    it("resolves after the specified milliseconds", async () => {
      const timer = new NodeTimer();
      const start = Date.now();
      await timer.delay(20);
      const elapsed = Date.now() - start;
      // Allow generous upper bound for slow CI; lower bound is the timer itself
      expect(elapsed).toBeGreaterThanOrEqual(15);
      expect(elapsed).toBeLessThan(500);
    });

    it("resolves with undefined", async () => {
      const timer = new NodeTimer();
      const result = await timer.delay(1);
      expect(result).toBeUndefined();
    });

    it("resolves for a zero-millisecond delay", async () => {
      const timer = new NodeTimer();
      await expect(timer.delay(0)).resolves.toBeUndefined();
    });

    it("supports multiple sequential calls", async () => {
      const timer = new NodeTimer();
      await timer.delay(1);
      await timer.delay(1);
      await timer.delay(1);
      // Reaching here means all three resolved correctly
    });
  });

  // ── wake() ───────────────────────────────────────────────────────────────

  describe("wake()", () => {
    it("is a no-op when no delay is pending (before any delay)", () => {
      const timer = new NodeTimer();
      expect(() => timer.wake()).not.toThrow();
    });

    it("is a no-op after a natural delay has already resolved", async () => {
      const timer = new NodeTimer();
      await timer.delay(1);
      // delay is already resolved; wake() should be a silent no-op
      expect(() => timer.wake()).not.toThrow();
    });

    it("resolves a pending delay well before its natural expiry", async () => {
      const timer = new NodeTimer();
      const start = Date.now();

      // Start a long delay but wake it immediately
      const promise = timer.delay(10_000);
      timer.wake();
      await promise;

      const elapsed = Date.now() - start;
      // Should complete in well under 500ms, not 10 seconds
      expect(elapsed).toBeLessThan(500);
    });

    it("resolves the promise returned by delay()", async () => {
      const timer = new NodeTimer();
      const promise = timer.delay(10_000);
      timer.wake();
      // Promise must settle — if it doesn't, jest's test timeout catches it
      await expect(promise).resolves.toBeUndefined();
    });

    it("clears the internal handle so no stray callback fires", async () => {
      const timer = new NodeTimer();
      const promise = timer.delay(10_000);
      timer.wake();
      await promise;

      // Wait briefly; a stray timer callback would cause issues if it ran
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      // Reaching here without errors means no stray callback fired
    });

    it("can be called multiple times safely (idempotent after first wake)", async () => {
      const timer = new NodeTimer();
      const promise = timer.delay(10_000);

      timer.wake(); // resolves the promise
      timer.wake(); // no-op — resolver and handle are now null
      timer.wake(); // still a no-op

      await expect(promise).resolves.toBeUndefined();
    });

    it("works correctly across multiple delay/wake cycles", async () => {
      const timer = new NodeTimer();

      // First cycle: wake before natural expiry
      const p1 = timer.delay(10_000);
      timer.wake();
      await p1;

      // Second cycle: also woken early
      const p2 = timer.delay(10_000);
      timer.wake();
      await p2;

      // Third cycle: allowed to expire naturally
      await timer.delay(1);
    });

    it("does not resolve a delay that has already timed out naturally", async () => {
      const timer = new NodeTimer();
      await timer.delay(1); // resolves naturally

      // handle and resolver are both null now; wake() is a no-op
      timer.wake(); // should not throw or do anything unexpected
    });
  });
});
