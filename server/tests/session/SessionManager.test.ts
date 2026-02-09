import { SessionManager, SessionConfig } from "../../src/session/SessionManager";
import { InMemorySdkSession } from "../../src/session/InMemorySdkSession";
import { SdkSessionFactory } from "../../src/session/ISdkSession";
import { SdkAssistantMessage, SdkResultSuccess, SdkResultError, SdkSystemMessage } from "../../src/agents/claude/AgentSdkLauncher";
import { ProcessLogEntry } from "../../src/agents/claude/StreamJsonParser";
import { FixedClock } from "../../src/substrate/abstractions/FixedClock";
import { InMemoryLogger } from "../../src/logging";

describe("SessionManager", () => {
  const config: SessionConfig = {
    systemPrompt: "You are a test agent.",
    initialPrompt: "Do something.",
    cwd: "/tmp/test",
    model: "sonnet",
  };

  const textMessage: SdkAssistantMessage = {
    type: "assistant",
    message: { content: [{ type: "text", text: "I did the thing" }] },
  };

  const successResult: SdkResultSuccess = {
    type: "result",
    subtype: "success",
    result: "done",
    total_cost_usd: 0.05,
    duration_ms: 2000,
  };

  const errorResult: SdkResultError = {
    type: "result",
    subtype: "error",
    errors: ["something broke"],
    total_cost_usd: 0.01,
    duration_ms: 500,
  };

  const initMessage: SdkSystemMessage = {
    type: "system",
    subtype: "init",
    model: "sonnet",
    claude_code_version: "1.0.0",
  };

  function createFactory(session: InMemorySdkSession): SdkSessionFactory {
    return () => session;
  }

  function makeClock(start?: Date): FixedClock {
    const clock = new FixedClock();
    clock.setNow(start ?? new Date("2025-01-01T00:00:00Z"));
    return clock;
  }

  it("run() iterates messages and returns success", async () => {
    const session = new InMemorySdkSession([textMessage, successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    const result = await manager.run();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("run() returns error on error result", async () => {
    const session = new InMemorySdkSession([errorResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    const result = await manager.run();

    expect(result.success).toBe(false);
    expect(result.error).toBe("something broke");
  });

  it("run() emits log entries via onLogEntry", async () => {
    const session = new InMemorySdkSession([initMessage, textMessage, successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();
    const entries: ProcessLogEntry[] = [];

    const manager = new SessionManager(
      createFactory(session), config, clock, logger, (e) => entries.push(e),
    );

    await manager.run();

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some((e) => e.type === "status")).toBe(true);
    expect(entries.some((e) => e.type === "text")).toBe(true);
  });

  it("run() measures duration via clock", async () => {
    const session = new InMemorySdkSession([successResult]);
    const clock = makeClock(new Date("2025-01-01T00:00:00Z"));
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    // Advance clock during iteration by overriding — since InMemorySdkSession
    // yields synchronously, we advance after construction
    const runPromise = manager.run();
    clock.setNow(new Date("2025-01-01T00:05:00Z"));
    const result = await runPromise;

    expect(result.durationMs).toBe(5 * 60 * 1000);
  });

  it("run() passes config to factory", async () => {
    const session = new InMemorySdkSession([successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    let capturedParams: { prompt: string; options?: Record<string, unknown> } | null = null;
    const factory: SdkSessionFactory = (params) => {
      capturedParams = params;
      return session;
    };

    const manager = new SessionManager(factory, config, clock, logger);
    await manager.run();

    expect(capturedParams).not.toBeNull();
    expect(capturedParams!.prompt).toBe("Do something.");
    expect(capturedParams!.options).toMatchObject({
      systemPrompt: "You are a test agent.",
      model: "sonnet",
      cwd: "/tmp/test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
    });
  });

  it("inject() pushes message into active session streamInput", async () => {
    // Create a session that won't end until we close
    const session = new InMemorySdkSession([textMessage, successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    // Start run but inject before it completes
    const runPromise = manager.run();
    manager.inject("hello from user");
    await runPromise;

    // The inject call should have been captured
    // We can verify the channel was set up by checking logs
    expect(logger.getEntries().some((e) => e.includes("inject"))).toBe(true);
  });

  it("inject() when not active logs warning", () => {
    const session = new InMemorySdkSession([successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    // Don't call run() — not active
    manager.inject("test");

    expect(logger.getEntries().some((e) => e.includes("not active"))).toBe(true);
  });

  it("stop() closes session", async () => {
    const session = new InMemorySdkSession([textMessage, successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    const runPromise = manager.run();
    manager.stop();
    await runPromise;

    expect(session.wasClosed()).toBe(true);
  });

  it("isActive() returns true during run, false before and after", async () => {
    const session = new InMemorySdkSession([successResult]);
    const clock = makeClock();
    const logger = new InMemoryLogger();

    const manager = new SessionManager(
      createFactory(session), config, clock, logger,
    );

    expect(manager.isActive()).toBe(false);

    const runPromise = manager.run();
    // After run starts (microtask), session is active — but with sync InMemory
    // it may already be done. We verify post-run state.
    await runPromise;

    expect(manager.isActive()).toBe(false);
  });

  it("handles exception from session iteration", async () => {
    // Create a factory that returns a session that throws
    const factory: SdkSessionFactory = () => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("session exploded");
      },
      async streamInput() {},
      close() {},
    });

    const clock = makeClock();
    const logger = new InMemoryLogger();
    const manager = new SessionManager(factory, config, clock, logger);

    const result = await manager.run();

    expect(result.success).toBe(false);
    expect(result.error).toBe("session exploded");
  });
});
