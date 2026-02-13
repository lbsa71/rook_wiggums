import { fetchRemoteLogs, fetchLocalLogs, resolveRemoteLogPath } from "../src/logs";
import { InMemoryProcessRunner } from "../src/agents/claude/InMemoryProcessRunner";
import { InMemoryFileSystem } from "../src/substrate/abstractions/InMemoryFileSystem";

describe("resolveRemoteLogPath", () => {
  it("appends default log path for bare user@host", () => {
    expect(resolveRemoteLogPath("user@34.63.182.98")).toBe(
      ".local/share/substrate/debug.log"
    );
  });
});

describe("fetchRemoteLogs", () => {
  let runner: InMemoryProcessRunner;

  beforeEach(() => {
    runner = new InMemoryProcessRunner();
  });

  it("runs ssh with tail command on remote host", async () => {
    runner.enqueue({ stdout: "log line 1\nlog line 2\n", stderr: "", exitCode: 0 });

    const result = await fetchRemoteLogs({
      runner,
      host: "user@34.63.182.98",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("log line 1\nlog line 2\n");

    const calls = runner.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("ssh");
    expect(calls[0].args).toContain("user@34.63.182.98");
    expect(calls[0].args.some(a => a.includes("tail"))).toBe(true);
  });

  it("uses identity file when provided", async () => {
    runner.enqueue({ stdout: "log output\n", stderr: "", exitCode: 0 });

    await fetchRemoteLogs({
      runner,
      host: "user@34.63.182.98",
      identity: "~/.ssh/google_compute_engine",
    });

    const calls = runner.getCalls();
    expect(calls[0].args).toContain("-i");
    expect(calls[0].args).toContain("~/.ssh/google_compute_engine");
  });

  it("defaults to 200 lines", async () => {
    runner.enqueue({ stdout: "", stderr: "", exitCode: 0 });

    await fetchRemoteLogs({
      runner,
      host: "user@example.com",
    });

    const calls = runner.getCalls();
    const tailArg = calls[0].args.find(a => a.includes("tail"));
    expect(tailArg).toContain("-n 200");
  });

  it("supports custom line count", async () => {
    runner.enqueue({ stdout: "", stderr: "", exitCode: 0 });

    await fetchRemoteLogs({
      runner,
      host: "user@example.com",
      lines: 50,
    });

    const calls = runner.getCalls();
    const tailArg = calls[0].args.find(a => a.includes("tail"));
    expect(tailArg).toContain("-n 50");
  });

  it("returns failure on non-zero exit code", async () => {
    runner.enqueue({ stdout: "", stderr: "No such file", exitCode: 1 });

    const result = await fetchRemoteLogs({
      runner,
      host: "user@example.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No such file");
  });
});

describe("fetchLocalLogs", () => {
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
  });

  it("reads the local debug.log file", async () => {
    await fs.writeFile("/data/debug.log", "line 1\nline 2\nline 3\n");

    const result = await fetchLocalLogs({
      fs,
      logPath: "/data/debug.log",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("line 1\nline 2\nline 3\n");
  });

  it("returns failure when log file does not exist", async () => {
    const result = await fetchLocalLogs({
      fs,
      logPath: "/nonexistent/debug.log",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
