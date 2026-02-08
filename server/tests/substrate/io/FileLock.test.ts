import { FileLock } from "../../../src/substrate/io/FileLock";
import { SubstrateFileType } from "../../../src/substrate/types";

describe("FileLock", () => {
  let lock: FileLock;

  beforeEach(() => {
    lock = new FileLock();
  });

  it("acquires and releases a lock", async () => {
    const release = await lock.acquire(SubstrateFileType.PLAN);
    expect(typeof release).toBe("function");
    release();
  });

  it("serializes access to the same file type", async () => {
    const order: number[] = [];

    const release1 = await lock.acquire(SubstrateFileType.PLAN);

    const promise2 = lock.acquire(SubstrateFileType.PLAN).then((release) => {
      order.push(2);
      release();
    });

    // First lock is still held, so second should not have run
    order.push(1);
    release1();

    await promise2;

    expect(order).toEqual([1, 2]);
  });

  it("allows concurrent access to different file types", async () => {
    const release1 = await lock.acquire(SubstrateFileType.PLAN);
    const release2 = await lock.acquire(SubstrateFileType.MEMORY);

    // Both acquired without blocking
    release1();
    release2();
  });

  it("queues multiple waiters in order", async () => {
    const order: number[] = [];

    const release1 = await lock.acquire(SubstrateFileType.PLAN);

    const p2 = lock.acquire(SubstrateFileType.PLAN).then((release) => {
      order.push(2);
      release();
    });

    const p3 = lock.acquire(SubstrateFileType.PLAN).then((release) => {
      order.push(3);
      release();
    });

    order.push(1);
    release1();

    await Promise.all([p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });
});
