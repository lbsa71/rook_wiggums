import type { IProcessRunner } from "./agents/claude/IProcessRunner";
import type { IFileSystem } from "./substrate/abstractions/IFileSystem";

const DEFAULT_REMOTE_LOG = ".local/share/rook-wiggums/debug.log";

export interface RemoteLogOptions {
  runner: IProcessRunner;
  host: string;
  identity?: string;
  lines?: number;
}

export interface LocalLogOptions {
  fs: IFileSystem;
  logPath: string;
}

export interface LogResult {
  success: boolean;
  output?: string;
  error?: string;
}

export function resolveRemoteLogPath(_host: string): string {
  return DEFAULT_REMOTE_LOG;
}

export async function fetchRemoteLogs(options: RemoteLogOptions): Promise<LogResult> {
  const { runner, host, identity, lines = 200 } = options;
  const logPath = resolveRemoteLogPath(host);

  const args: string[] = [];
  if (identity) {
    args.push("-i", identity);
  }
  args.push(host, `tail -n ${lines} ${logPath}`);

  const result = await runner.run("ssh", args);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr };
  }

  return { success: true, output: result.stdout };
}

export async function fetchLocalLogs(options: LocalLogOptions): Promise<LogResult> {
  const { fs, logPath } = options;

  if (!(await fs.exists(logPath))) {
    return { success: false, error: `Log file not found: ${logPath}` };
  }

  const content = await fs.readFile(logPath);
  return { success: true, output: content };
}
