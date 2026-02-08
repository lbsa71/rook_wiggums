import { ClaudeSessionLauncher } from "../../../src/agents/claude/ClaudeSessionLauncher";
import { InMemoryProcessRunner } from "../../../src/agents/claude/InMemoryProcessRunner";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";

describe("ClaudeSessionLauncher", () => {
  let runner: InMemoryProcessRunner;
  let clock: FixedClock;
  let launcher: ClaudeSessionLauncher;

  beforeEach(() => {
    runner = new InMemoryProcessRunner();
    clock = new FixedClock(new Date("2025-06-15T10:00:00.000Z"));
    launcher = new ClaudeSessionLauncher(runner, clock);
  });

  it("sends system prompt and message via claude CLI", async () => {
    runner.enqueue({ stdout: '{"action":"idle"}', stderr: "", exitCode: 0 });

    await launcher.launch({
      systemPrompt: "You are the Ego",
      message: "What should we do?",
    });

    const calls = runner.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("claude");
    expect(calls[0].args).toContain("--print");
    expect(calls[0].args).toContain("--output-format");
    expect(calls[0].args).toContain("text");

    const spIdx = calls[0].args.indexOf("--system-prompt");
    expect(spIdx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[spIdx + 1]).toBe("You are the Ego");

    const lastArg = calls[0].args[calls[0].args.length - 1];
    expect(lastArg).toBe("What should we do?");
  });

  it("returns success result on exit code 0", async () => {
    runner.enqueue({ stdout: '{"action":"idle"}', stderr: "", exitCode: 0 });

    const result = await launcher.launch({
      systemPrompt: "sys",
      message: "msg",
    });

    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe('{"action":"idle"}');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("returns failure result on non-zero exit code", async () => {
    runner.enqueue({ stdout: "", stderr: "Claude crashed", exitCode: 1 });

    const result = await launcher.launch({
      systemPrompt: "sys",
      message: "msg",
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("Claude crashed");
  });

  it("computes durationMs from clock", async () => {
    runner.enqueue({ stdout: "ok", stderr: "", exitCode: 0 });

    clock.setNow(new Date("2025-06-15T10:00:00.000Z"));

    const launchPromise = launcher.launch({
      systemPrompt: "sys",
      message: "msg",
    });

    clock.setNow(new Date("2025-06-15T10:00:05.000Z"));

    const result = await launchPromise;
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("retries on failure up to maxRetries", async () => {
    runner.enqueue({ stdout: "", stderr: "fail1", exitCode: 1 });
    runner.enqueue({ stdout: "", stderr: "fail2", exitCode: 1 });
    runner.enqueue({ stdout: '{"ok":true}', stderr: "", exitCode: 0 });

    const result = await launcher.launch(
      { systemPrompt: "sys", message: "msg" },
      { maxRetries: 3, retryDelayMs: 0 }
    );

    expect(result.success).toBe(true);
    expect(runner.getCalls()).toHaveLength(3);
  });

  it("returns last failure after exhausting retries", async () => {
    runner.enqueue({ stdout: "", stderr: "fail1", exitCode: 1 });
    runner.enqueue({ stdout: "", stderr: "fail2", exitCode: 1 });

    const result = await launcher.launch(
      { systemPrompt: "sys", message: "msg" },
      { maxRetries: 2, retryDelayMs: 0 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("fail2");
    expect(runner.getCalls()).toHaveLength(2);
  });

  it("defaults to 1 attempt (no retries) when options not specified", async () => {
    runner.enqueue({ stdout: "", stderr: "fail", exitCode: 1 });

    const result = await launcher.launch({
      systemPrompt: "sys",
      message: "msg",
    });

    expect(result.success).toBe(false);
    expect(runner.getCalls()).toHaveLength(1);
  });
});
