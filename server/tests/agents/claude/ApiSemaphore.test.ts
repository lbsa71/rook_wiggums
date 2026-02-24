import { ApiSemaphore } from "../../../src/agents/claude/ApiSemaphore";

describe("ApiSemaphore", () => {
  it("allows up to maxConcurrent acquires without blocking", async () => {
    const sem = new ApiSemaphore(2);

    const r1 = await sem.acquire();
    const r2 = await sem.acquire();

    // Both acquired without blocking
    expect(sem.active).toBe(2);

    r1();
    r2();
    expect(sem.active).toBe(0);
  });

  it("blocks the third acquire when maxConcurrent is 2", async () => {
    const sem = new ApiSemaphore(2);
    const order: string[] = [];

    const r1 = await sem.acquire();
    const r2 = await sem.acquire();

    const thirdAcquire = sem.acquire().then((release) => {
      order.push("third-acquired");
      return release;
    });

    // Give microtask a chance to settle
    await tick();
    expect(order).toEqual([]); // third is still blocked

    r1(); // release one slot
    const r3 = await thirdAcquire;
    expect(order).toEqual(["third-acquired"]);
    expect(sem.active).toBe(2);

    r2();
    r3();
    expect(sem.active).toBe(0);
  });

  it("maintains FIFO ordering", async () => {
    const sem = new ApiSemaphore(1);
    const order: string[] = [];

    const r1 = await sem.acquire();

    const secondAcquire = sem.acquire().then((release) => {
      order.push("second");
      return release;
    });
    const thirdAcquire = sem.acquire().then((release) => {
      order.push("third");
      return release;
    });

    r1();

    const r2 = await secondAcquire;
    r2();

    const r3 = await thirdAcquire;
    r3();

    expect(order).toEqual(["second", "third"]);
  });

  it("handles release called multiple times (idempotent)", async () => {
    const sem = new ApiSemaphore(1);
    const release = await sem.acquire();

    release();
    release(); // should not throw or decrement below 0
    expect(sem.active).toBe(0);
  });

  it("reports waiting count", async () => {
    const sem = new ApiSemaphore(1);
    expect(sem.waiting).toBe(0);

    const r1 = await sem.acquire();
    expect(sem.waiting).toBe(0);

    const p2 = sem.acquire();
    const p3 = sem.acquire();
    expect(sem.waiting).toBe(2);

    r1();
    const r2 = await p2;
    expect(sem.waiting).toBe(1);

    r2();
    const r3 = await p3;
    expect(sem.waiting).toBe(0);

    r3();
  });

  it("defaults to maxConcurrent of 2", () => {
    const sem = new ApiSemaphore();
    expect(sem.maxConcurrent).toBe(2);
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
