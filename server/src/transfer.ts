import type { IProcessRunner } from "./agents/claude/IProcessRunner";

const DEFAULT_REMOTE_SUBSTRATE = ".local/share/rook-wiggums/substrate";

export interface TransferOptions {
  runner: IProcessRunner;
  sourceSubstrate: string;
  destSubstrate: string;
  sourceConfig?: string;
  destConfig?: string;
  identity?: string;
}

export interface TransferResult {
  success: boolean;
  error?: string;
}

/**
 * If dest is `user@host` (no colon/path), appends the default substrate path.
 * If dest is `user@host:/path` or a local path, returns unchanged.
 */
export function resolveRemotePath(dest: string): string {
  // Local path — no @
  if (!dest.includes("@")) return dest;
  // Already has explicit path — has colon after @
  if (dest.includes(":")) return dest;
  // Remote host without path — append default
  return `${dest}:${DEFAULT_REMOTE_SUBSTRATE}`;
}

function buildRsyncArgs(source: string, dest: string, identity?: string): string[] {
  const args = ["-a"];
  if (identity) {
    args.push("-e", `ssh -i ${identity}`);
  }
  args.push(`${source}/`, `${dest}/`);
  return args;
}

export async function transfer(options: TransferOptions): Promise<TransferResult> {
  const { runner, sourceSubstrate, destSubstrate, identity } = options;

  const substrateArgs = buildRsyncArgs(sourceSubstrate, destSubstrate, identity);
  const substrateResult = await runner.run("rsync", substrateArgs);

  if (substrateResult.exitCode !== 0) {
    return { success: false, error: substrateResult.stderr };
  }

  if (options.sourceConfig && options.destConfig) {
    const configArgs = buildRsyncArgs(options.sourceConfig, options.destConfig, identity);
    const configResult = await runner.run("rsync", configArgs);

    if (configResult.exitCode !== 0) {
      return { success: false, error: configResult.stderr };
    }
  }

  return { success: true };
}
