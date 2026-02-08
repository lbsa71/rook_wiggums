import * as http from "node:http";
import WebSocket from "ws";
import { LoopWebSocketServer } from "../../src/loop/LoopWebSocketServer";
import { ILoopEventSink } from "../../src/loop/ILoopEventSink";
import { LoopEvent, LoopState } from "../../src/loop/types";

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data.toString()));
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
    } else {
      ws.once("open", () => resolve());
    }
  });
}

describe("LoopWebSocketServer", () => {
  let httpServer: http.Server;
  let wsServer: LoopWebSocketServer;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach((done) => {
    httpServer = http.createServer();
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      wsServer = new LoopWebSocketServer(httpServer);
      done();
    });
  });

  afterEach((done) => {
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN) c.close();
    }
    clients.length = 0;
    wsServer.close();
    httpServer.close(() => done());
  });

  function connect(): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    clients.push(ws);
    return ws;
  }

  it("implements ILoopEventSink", () => {
    const sink: ILoopEventSink = wsServer;
    expect(sink).toBeDefined();
  });

  it("broadcasts events to connected clients", async () => {
    const ws = connect();
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);

    const event: LoopEvent = {
      type: "state_changed",
      timestamp: "2025-06-15T10:00:00.000Z",
      data: { from: LoopState.STOPPED, to: LoopState.RUNNING },
    };
    wsServer.emit(event);

    const msg = await msgPromise;
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("state_changed");
    expect(parsed.data.to).toBe("RUNNING");
  });

  it("broadcasts to multiple clients", async () => {
    const ws1 = connect();
    const ws2 = connect();
    await waitForOpen(ws1);
    await waitForOpen(ws2);

    const msg1Promise = waitForMessage(ws1);
    const msg2Promise = waitForMessage(ws2);

    const event: LoopEvent = {
      type: "cycle_complete",
      timestamp: "2025-06-15T10:00:01.000Z",
      data: { cycleNumber: 1 },
    };
    wsServer.emit(event);

    const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);
    expect(JSON.parse(msg1).type).toBe("cycle_complete");
    expect(JSON.parse(msg2).type).toBe("cycle_complete");
  });

  it("handles client disconnect gracefully", async () => {
    const ws = connect();
    await waitForOpen(ws);

    // Close the client
    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));

    // Emitting after disconnect should not throw
    const event: LoopEvent = {
      type: "idle",
      timestamp: "2025-06-15T10:00:02.000Z",
      data: {},
    };
    expect(() => wsServer.emit(event)).not.toThrow();
  });

  it("does not send to closed clients", async () => {
    const ws1 = connect();
    const ws2 = connect();
    await waitForOpen(ws1);
    await waitForOpen(ws2);

    // Close ws1
    ws1.close();
    await new Promise((resolve) => ws1.once("close", resolve));

    // ws2 should still receive
    const msgPromise = waitForMessage(ws2);

    const event: LoopEvent = {
      type: "idle",
      timestamp: "2025-06-15T10:00:03.000Z",
      data: { consecutiveIdleCycles: 1 },
    };
    wsServer.emit(event);

    const msg = await msgPromise;
    expect(JSON.parse(msg).type).toBe("idle");
  });
});
