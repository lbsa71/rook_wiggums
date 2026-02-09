import { MessageChannel } from "../../src/session/MessageChannel";

describe("MessageChannel", () => {
  it("yields a pushed item when iterated", async () => {
    const ch = new MessageChannel<string>();
    ch.push("hello");
    ch.close();

    const items: string[] = [];
    for await (const item of ch) {
      items.push(item);
    }
    expect(items).toEqual(["hello"]);
  });

  it("yields multiple items in FIFO order", async () => {
    const ch = new MessageChannel<number>();
    ch.push(1);
    ch.push(2);
    ch.push(3);
    ch.close();

    const items: number[] = [];
    for await (const item of ch) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);
  });

  it("drains buffered items then terminates on close", async () => {
    const ch = new MessageChannel<string>();
    ch.push("a");
    ch.push("b");
    ch.close();

    const items: string[] = [];
    for await (const item of ch) {
      items.push(item);
    }
    expect(items).toEqual(["a", "b"]);
  });

  it("terminates immediately when closed with no items", async () => {
    const ch = new MessageChannel<string>();
    ch.close();

    const items: string[] = [];
    for await (const item of ch) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });

  it("wakes a waiting consumer when an item is pushed", async () => {
    const ch = new MessageChannel<string>();
    const items: string[] = [];

    const consumer = (async () => {
      for await (const item of ch) {
        items.push(item);
      }
    })();

    // Give consumer time to start waiting
    await new Promise((r) => setTimeout(r, 10));

    ch.push("delayed");
    ch.close();

    await consumer;
    expect(items).toEqual(["delayed"]);
  });

  it("throws when pushing after close", () => {
    const ch = new MessageChannel<string>();
    ch.close();
    expect(() => ch.push("too late")).toThrow("closed");
  });

  it("reports closed state", () => {
    const ch = new MessageChannel<string>();
    expect(ch.isClosed()).toBe(false);
    ch.close();
    expect(ch.isClosed()).toBe(true);
  });

  it("supports multiple concurrent consumers reading the same items", async () => {
    // Each consumer gets all items (not partitioned)
    const ch = new MessageChannel<string>();
    ch.push("x");
    ch.close();

    const iter1 = ch[Symbol.asyncIterator]();
    const r1 = await iter1.next();
    expect(r1).toEqual({ value: "x", done: false });

    const r2 = await iter1.next();
    expect(r2.done).toBe(true);
  });
});
