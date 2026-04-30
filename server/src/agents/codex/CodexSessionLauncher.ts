import type { IProcessRunner } from "../claude/IProcessRunner";
import type { IClock } from "../../substrate/abstractions/IClock";
import type { ILogger } from "../../logging";
import type {
  ISessionLauncher,
  ClaudeSessionRequest,
  ClaudeSessionResult,
  LaunchOptions,
} from "../claude/ISessionLauncher";

/**
 * ISessionLauncher implementation that invokes the Codex CLI for agent
 * reasoning sessions (Ego / Subconscious / Superego / Id).
 *
 * CLI mapping (from `codex exec --help`):
 *   systemPrompt    -> prepended to the message as a "SYSTEM INSTRUCTIONS:" block
 *   message         -> codex exec "<message>"
 *   model           -> -m <model> when a non-Claude model is supplied
 *   cwd             -> -C <cwd> and process cwd
 *   additionalDirs  -> --add-dir <dir>
 *   continueSession -> intentionally ignored; Substrate injects complete file context each turn
 *   bypass approvals -> required for non-interactive MCP tool execution
 */
export class CodexSessionLauncher implements ISessionLauncher {
  constructor(
    private readonly processRunner: IProcessRunner,
    private readonly clock: IClock,
    private readonly model?: string,
    private readonly logger?: ILogger,
  ) {}

  async launch(
    request: ClaudeSessionRequest,
    options?: LaunchOptions,
  ): Promise<ClaudeSessionResult> {
    const startMs = this.clock.now().getTime();
    const modelToUse = this.resolveModel(options?.model ?? this.model);
    const fullMessage = request.systemPrompt
      ? `SYSTEM INSTRUCTIONS:\n${request.systemPrompt}\n\n---\n\n${request.message}`
      : request.message;

    const cwd = options?.cwd;
    const args = this.buildExecArgs(fullMessage, modelToUse, cwd, options?.additionalDirs);

    this.logger?.debug(`codex-launch: exec model=${modelToUse ?? "default"} cwd=${cwd ?? process.cwd()}`);

    try {
      const result = await this.processRunner.run("codex", args, {
        cwd,
        timeoutMs: options?.timeoutMs,
        idleTimeoutMs: options?.idleTimeoutMs,
        stdin: fullMessage,
        onStdout: options?.onLogEntry
          ? (chunk) => options.onLogEntry!({ type: "text", content: chunk })
          : undefined,
      });

      const durationMs = this.clock.now().getTime() - startMs;
      const success = result.exitCode === 0;
      if (!success) {
        this.logger?.debug(`codex-launch: failed exit=${result.exitCode} stderr=${result.stderr || "none"}`);
      } else {
        this.logger?.debug(`codex-launch: completed in ${durationMs}ms`);
      }

      return {
        rawOutput: result.stdout,
        exitCode: result.exitCode,
        durationMs,
        success,
        error: success ? undefined : result.stderr || `codex exited with code ${result.exitCode}`,
      };
    } catch (err) {
      this.logger?.debug(`codex-launch: error — ${err instanceof Error ? err.message : String(err)}`);
      return {
        rawOutput: "",
        exitCode: 1,
        durationMs: this.clock.now().getTime() - startMs,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private buildExecArgs(
    message: string,
    model: string | undefined,
    cwd: string | undefined,
    additionalDirs: string[] | undefined,
  ): string[] {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--color",
      "never",
      "--skip-git-repo-check",
      "--ephemeral",
    ];
    if (model) {
      args.push("-m", model);
    }
    if (cwd) {
      args.push("-C", cwd);
    }
    for (const dir of additionalDirs ?? []) {
      args.push("--add-dir", dir);
    }
    args.push("-");
    return args;
  }

  private resolveModel(model: string | undefined): string | undefined {
    if (!model) return undefined;
    // Resolved config defaults to Claude model names. When Codex is selected
    // without an explicit Codex model, let the Codex CLI use its own profile.
    if (model.startsWith("claude-")) return undefined;
    return model;
  }
}
