import { parseArgs } from "../src/cli";

describe("parseArgs", () => {
  it("defaults to start command with no config", () => {
    const result = parseArgs(["node", "cli.ts"]);

    expect(result.command).toBe("start");
    expect(result.configPath).toBeUndefined();
  });

  it("parses init command", () => {
    const result = parseArgs(["node", "cli.ts", "init"]);

    expect(result.command).toBe("init");
    expect(result.configPath).toBeUndefined();
  });

  it("parses start command with --config flag", () => {
    const result = parseArgs(["node", "cli.ts", "start", "--config", "/my/config.json"]);

    expect(result.command).toBe("start");
    expect(result.configPath).toBe("/my/config.json");
  });

  it("parses --config flag without explicit command", () => {
    const result = parseArgs(["node", "cli.ts", "--config", "/my/config.json"]);

    expect(result.command).toBe("start");
    expect(result.configPath).toBe("/my/config.json");
  });

  it("parses init command with --config flag", () => {
    const result = parseArgs(["node", "cli.ts", "init", "--config", "/my/config.json"]);

    expect(result.command).toBe("init");
    expect(result.configPath).toBe("/my/config.json");
  });

  it("parses backup command", () => {
    const result = parseArgs(["node", "cli.ts", "backup"]);

    expect(result.command).toBe("backup");
    expect(result.configPath).toBeUndefined();
  });

  it("defaults model to undefined (uses config/default)", () => {
    const result = parseArgs(["node", "cli.ts"]);

    expect(result.model).toBeUndefined();
  });

  it("parses --model flag", () => {
    const result = parseArgs(["node", "cli.ts", "start", "--model", "opus"]);

    expect(result.command).toBe("start");
    expect(result.model).toBe("opus");
  });

  it("parses --model with other flags", () => {
    const result = parseArgs(["node", "cli.ts", "--config", "/my/config.json", "--model", "haiku"]);

    expect(result.configPath).toBe("/my/config.json");
    expect(result.model).toBe("haiku");
  });

  it("defaults outputDir to undefined", () => {
    const result = parseArgs(["node", "cli.ts", "backup"]);

    expect(result.outputDir).toBeUndefined();
  });

  it("parses --output flag for backup command", () => {
    const result = parseArgs(["node", "cli.ts", "backup", "--output", "/my/backups"]);

    expect(result.command).toBe("backup");
    expect(result.outputDir).toBe("/my/backups");
  });

  it("parses restore command", () => {
    const result = parseArgs(["node", "cli.ts", "restore"]);

    expect(result.command).toBe("restore");
  });

  it("parses restore command with --input flag", () => {
    const result = parseArgs(["node", "cli.ts", "restore", "--input", "/backups/my-backup.tar.gz"]);

    expect(result.command).toBe("restore");
    expect(result.inputPath).toBe("/backups/my-backup.tar.gz");
  });

  it("defaults inputPath to undefined", () => {
    const result = parseArgs(["node", "cli.ts", "restore"]);

    expect(result.inputPath).toBeUndefined();
  });

  it("parses transfer command with --source and --dest", () => {
    const result = parseArgs(["node", "cli.ts", "transfer", "--source", "/space-a", "--dest", "/space-b"]);

    expect(result.command).toBe("transfer");
    expect(result.source).toBe("/space-a");
    expect(result.dest).toBe("/space-b");
  });

  it("defaults source and dest to undefined", () => {
    const result = parseArgs(["node", "cli.ts", "transfer"]);

    expect(result.command).toBe("transfer");
    expect(result.source).toBeUndefined();
    expect(result.dest).toBeUndefined();
  });

  it("parses -i flag for SSH identity", () => {
    const result = parseArgs([
      "node", "cli.ts", "transfer",
      "-i", "~/.ssh/google_compute_engine",
      "--dest", "rook@34.63.182.98",
    ]);

    expect(result.command).toBe("transfer");
    expect(result.identity).toBe("~/.ssh/google_compute_engine");
    expect(result.dest).toBe("rook@34.63.182.98");
  });

  it("parses --identity as alias for -i", () => {
    const result = parseArgs([
      "node", "cli.ts", "transfer",
      "--identity", "/keys/id_rsa",
      "--dest", "rook@host",
    ]);

    expect(result.identity).toBe("/keys/id_rsa");
  });

  it("parses logs command", () => {
    const result = parseArgs(["node", "cli.ts", "logs"]);

    expect(result.command).toBe("logs");
  });

  it("parses logs command with remote source and identity", () => {
    const result = parseArgs([
      "node", "cli.ts", "logs",
      "-i", "~/.ssh/google_compute_engine",
      "--source", "rook@34.63.182.98",
    ]);

    expect(result.command).toBe("logs");
    expect(result.identity).toBe("~/.ssh/google_compute_engine");
    expect(result.source).toBe("rook@34.63.182.98");
  });

  it("parses -n flag for line count", () => {
    const result = parseArgs([
      "node", "cli.ts", "logs",
      "--source", "rook@host",
      "-n", "50",
    ]);

    expect(result.lines).toBe(50);
  });

  it("parses --lines as alias for -n", () => {
    const result = parseArgs([
      "node", "cli.ts", "logs",
      "--lines", "100",
    ]);

    expect(result.lines).toBe(100);
  });
});
