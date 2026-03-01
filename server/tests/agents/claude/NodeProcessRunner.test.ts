/**
 * Tests for NodeProcessRunner — a real child-process spawner.
 *
 * These tests use actual `node` subprocesses to exercise all code paths.
 * Each test is scoped to complete well within the global 4000ms jest timeout.
 * Timeout-trigger tests use explicit short timeoutMs/idleTimeoutMs values
 * (≤ 200ms) and carry an explicit per-test timeout of 2000ms.
 */
import { NodeProcessRunner } from "../../../src/agents/claude/NodeProcessRunner";
import { ProcessRunOptions } from "../../../src/agents/claude/IProcessRunner";

// Shared inline node commands ─────────────────────────────────────────────
const NODE = "node";

/** Write a string to stdout then exit 0 */
function stdoutScript(text: string): string[] {
  return ["-e", `process.stdout.write(${JSON.stringify(text)})`];
}

/** Write a string to stderr then exit 0 */
function stderrScript(text: string): string[] {
  return ["-e", `process.stderr.write(${JSON.stringify(text)})`];
}

/** Exit with the given code */
function exitScript(code: number): string[] {
  return ["-e", `process.exit(${code})`];
}

// ─────────────────────────────────────────────────────────────────────────

describe("NodeProcessRunner", () => {
  let runner: NodeProcessRunner;

  beforeEach(() => {
    runner = new NodeProcessRunner();
  });

  // ── Basic output capture ───────────────────────────────────────────────

  describe("stdout capture", () => {
    it("returns stdout from a completed process", async () => {
      const result = await runner.run(NODE, stdoutScript("hello world"));
      expect(result.stdout).toBe("hello world");
    });

    it("returns an empty stdout when the process writes nothing", async () => {
      const result = await runner.run(NODE, exitScript(0), {
        idleTimeoutMs: 5000,
      });
      expect(result.stdout).toBe("");
    });

    it("accumulates multiple stdout chunks into a single string", async () => {
      const script = [
        "-e",
        "process.stdout.write('A');process.stdout.write('B');process.stdout.write('C');",
      ];
      const result = await runner.run(NODE, script);
      expect(result.stdout).toBe("ABC");
    });
  });

  describe("stderr capture", () => {
    it("returns stderr from a process", async () => {
      const result = await runner.run(NODE, stderrScript("oops"));
      expect(result.stderr).toBe("oops");
    });

    it("captures both stdout and stderr independently", async () => {
      const script = [
        "-e",
        "process.stdout.write('out');process.stderr.write('err');",
      ];
      const result = await runner.run(NODE, script);
      expect(result.stdout).toBe("out");
      expect(result.stderr).toBe("err");
    });

    it("returns empty stderr when the process writes nothing to stderr", async () => {
      const result = await runner.run(NODE, stdoutScript("only stdout"));
      expect(result.stderr).toBe("");
    });
  });

  describe("exit code", () => {
    it("returns exitCode 0 for a successful process", async () => {
      const result = await runner.run(NODE, exitScript(0), {
        idleTimeoutMs: 5000,
      });
      expect(result.exitCode).toBe(0);
    });

    it("returns a non-zero exitCode from a failing process", async () => {
      const result = await runner.run(NODE, exitScript(1), {
        idleTimeoutMs: 5000,
      });
      expect(result.exitCode).toBe(1);
    });

    it("returns the exact exit code (arbitrary value)", async () => {
      const result = await runner.run(NODE, exitScript(42), {
        idleTimeoutMs: 5000,
      });
      expect(result.exitCode).toBe(42);
    });
  });

  // ── onStdout callback ──────────────────────────────────────────────────

  describe("onStdout option", () => {
    it("calls the callback with each stdout chunk as it arrives", async () => {
      const received: string[] = [];
      const opts: ProcessRunOptions = { onStdout: (c) => received.push(c) };
      await runner.run(NODE, stdoutScript("streaming output"), opts);
      expect(received.join("")).toBe("streaming output");
    });

    it("calls the callback for each separate write", async () => {
      const received: string[] = [];
      const script = [
        "-e",
        // Two synchronous writes — may coalesce in a single chunk or arrive separately
        "process.stdout.write('first');process.stdout.write('second');",
      ];
      await runner.run(NODE, script, { onStdout: (c) => received.push(c) });
      expect(received.join("")).toBe("firstsecond");
      expect(received.length).toBeGreaterThanOrEqual(1);
    });

    it("does not call the callback when no stdout is produced", async () => {
      const received: string[] = [];
      await runner.run(NODE, exitScript(0), {
        onStdout: (c) => received.push(c),
        idleTimeoutMs: 5000,
      });
      expect(received).toHaveLength(0);
    });

    it("does not require an onStdout callback (optional)", async () => {
      const result = await runner.run(NODE, stdoutScript("no callback"));
      expect(result.stdout).toBe("no callback");
    });
  });

  // ── cwd option ────────────────────────────────────────────────────────

  describe("cwd option", () => {
    it("runs the process in the specified working directory", async () => {
      const result = await runner.run(
        NODE,
        ["-e", "process.stdout.write(process.cwd())"],
        { cwd: "/tmp" },
      );
      expect(result.stdout).toBe("/tmp");
    });
  });

  // ── Hard timeout ──────────────────────────────────────────────────────

  describe("hard timeout", () => {
    it(
      "rejects with a timeout error when the process exceeds timeoutMs",
      async () => {
        // Process writes output every 10ms (keeps idle timer reset) but
        // the hard timer fires first at 150ms.
        const longRunning = [
          "-e",
          "setInterval(function(){process.stdout.write('x');},10);",
        ];
        await expect(
          runner.run(NODE, longRunning, {
            timeoutMs: 150,
            idleTimeoutMs: 10_000,
          }),
        ).rejects.toThrow("150ms");
      },
      2000,
    );

    it(
      "error message includes the configured timeout value",
      async () => {
        const longRunning = [
          "-e",
          "setInterval(function(){process.stdout.write('x');},10);",
        ];
        await expect(
          runner.run(NODE, longRunning, {
            timeoutMs: 175,
            idleTimeoutMs: 10_000,
          }),
        ).rejects.toThrow(/timed out after 175ms/);
      },
      2000,
    );
  });

  // ── Idle timeout ──────────────────────────────────────────────────────

  describe("idle timeout", () => {
    it(
      "rejects when the process produces no output for idleTimeoutMs",
      async () => {
        // Process stays alive (via setTimeout) but never writes any output.
        const silentProcess = ["-e", "setTimeout(function(){},30_000);"];
        await expect(
          runner.run(NODE, silentProcess, {
            timeoutMs: 30_000,
            idleTimeoutMs: 150,
          }),
        ).rejects.toThrow("150ms");
      },
      2000,
    );

    it(
      "error message indicates idle rather than hard timeout",
      async () => {
        const silentProcess = ["-e", "setTimeout(function(){},30_000);"];
        await expect(
          runner.run(NODE, silentProcess, {
            timeoutMs: 30_000,
            idleTimeoutMs: 175,
          }),
        ).rejects.toThrow(/idle for 175ms/);
      },
      2000,
    );

    it(
      "resets the idle timer when stdout data arrives",
      async () => {
        // Process writes every 50ms, which continuously resets the idle timer.
        // The hard timer at 300ms is the only thing that terminates it.
        // If idle timer were NOT reset by output, it would fire at 200ms.
        const chattingProcess = [
          "-e",
          "setInterval(function(){process.stdout.write('.');},50);",
        ];
        await expect(
          runner.run(NODE, chattingProcess, {
            timeoutMs: 300,
            idleTimeoutMs: 200,
          }),
        ).rejects.toThrow(/timed out after 300ms/); // hard timeout, not idle
      },
      2000,
    );
  });

  // ── Error event (spawn failure) ───────────────────────────────────────

  describe("spawn error", () => {
    it("rejects when the command is not found", async () => {
      await expect(
        runner.run("__bishop_nonexistent_command__", [], {
          timeoutMs: 5000,
          idleTimeoutMs: 5000,
        }),
      ).rejects.toThrow();
    });

    it("rejection reason is an Error (not a string)", async () => {
      const caught = await runner
        .run("__bishop_nonexistent_command__", [], {
          timeoutMs: 5000,
          idleTimeoutMs: 5000,
        })
        .catch((e: unknown) => e);
      // toBeInstanceOf(Error) can fail cross-realm; check shape instead
      expect(caught).toBeTruthy();
      expect(typeof (caught as Error).message).toBe("string");
    });
  });

  // ── Default options ───────────────────────────────────────────────────

  describe("default options", () => {
    it("uses defaults when no options object is supplied", async () => {
      // Quick process — completes before any timer fires
      const result = await runner.run(NODE, stdoutScript("default options"));
      expect(result.stdout).toBe("default options");
      expect(result.exitCode).toBe(0);
    });

    it("uses default timeoutMs when only idleTimeoutMs is provided", async () => {
      // Confirming partial options object is handled correctly
      const result = await runner.run(NODE, stdoutScript("partial opts"), {
        idleTimeoutMs: 5000,
      });
      expect(result.stdout).toBe("partial opts");
    });
  });
});
