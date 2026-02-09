import { IClock } from "../substrate/abstractions/IClock";
import { ILogger } from "../logging";
import { ProcessLogEntry } from "../agents/claude/StreamJsonParser";
import {
  SdkMessage,
  SdkAssistantMessage,
  SdkContentBlock,
  SdkResultSuccess,
  SdkResultError,
  SdkSystemMessage,
} from "../agents/claude/AgentSdkLauncher";
import { ISdkSession, SdkSessionFactory, SdkUserMessage } from "./ISdkSession";
import { MessageChannel } from "./MessageChannel";

export interface SessionConfig {
  systemPrompt: string;
  initialPrompt: string;
  cwd?: string;
  model?: string;
}

export interface SessionResult {
  success: boolean;
  durationMs: number;
  error?: string;
}

export class SessionManager {
  private active = false;
  private session: ISdkSession | null = null;
  private messageChannel: MessageChannel<SdkUserMessage> | null = null;

  constructor(
    private readonly factory: SdkSessionFactory,
    private readonly config: SessionConfig,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly onLogEntry?: (entry: ProcessLogEntry) => void,
  ) {}

  async run(): Promise<SessionResult> {
    const startTime = this.clock.now();
    this.active = true;

    this.logger.debug("session-manager: starting session");

    const options: Record<string, unknown> = {
      systemPrompt: this.config.systemPrompt,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
    };

    if (this.config.model) {
      options.model = this.config.model;
    }
    if (this.config.cwd) {
      options.cwd = this.config.cwd;
    }

    this.session = this.factory({
      prompt: this.config.initialPrompt,
      options,
    });

    this.messageChannel = new MessageChannel<SdkUserMessage>();

    // Non-blocking: feed messages into session as they arrive
    this.session.streamInput(this.messageChannel).catch((err) => {
      this.logger.debug(`session-manager: streamInput error — ${err instanceof Error ? err.message : String(err)}`);
    });

    let isError = false;
    let errorMessage: string | undefined;

    try {
      for await (const msg of this.session) {
        this.processMessage(msg);

        if (msg.type === "result") {
          const resultMsg = msg as SdkResultSuccess | SdkResultError;
          if (resultMsg.subtype !== "success") {
            isError = true;
            const errMsg = resultMsg as SdkResultError;
            errorMessage = errMsg.errors?.join("; ") ?? resultMsg.subtype;
          }
        }
      }
    } catch (err) {
      isError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.debug(`session-manager: error — ${errorMessage}`);
    }

    if (!this.messageChannel.isClosed()) {
      this.messageChannel.close();
    }

    this.active = false;
    this.session = null;
    this.messageChannel = null;

    const endTime = this.clock.now();
    const durationMs = endTime.getTime() - startTime.getTime();

    this.logger.debug(`session-manager: done — success=${!isError} duration=${durationMs}ms`);

    return {
      success: !isError,
      durationMs,
      error: errorMessage,
    };
  }

  inject(message: string): void {
    if (!this.active || !this.messageChannel) {
      this.logger.debug("session-manager: inject called but session is not active");
      return;
    }

    this.logger.debug(`session-manager: inject message (${message.length} chars)`);

    const userMessage: SdkUserMessage = {
      type: "user",
      message: { role: "user", content: message },
      parent_tool_use_id: null,
      session_id: "injected",
    };

    this.messageChannel.push(userMessage);
  }

  isActive(): boolean {
    return this.active;
  }

  stop(): void {
    this.logger.debug("session-manager: stop requested");
    if (this.session) {
      this.session.close();
    }
    if (this.messageChannel && !this.messageChannel.isClosed()) {
      this.messageChannel.close();
    }
  }

  private processMessage(msg: SdkMessage): void {
    if (!this.onLogEntry && msg.type !== "assistant") return;

    switch (msg.type) {
      case "system": {
        const sys = msg as SdkSystemMessage;
        if (sys.subtype === "init") {
          const entry: ProcessLogEntry = {
            type: "status",
            content: `init: model=${sys.model} v${sys.claude_code_version}`,
          };
          this.logger.debug(`  [${entry.type}] ${entry.content}`);
          this.onLogEntry?.(entry);
        }
        break;
      }
      case "assistant": {
        const asst = msg as SdkAssistantMessage;
        for (const block of asst.message.content) {
          const entry = this.mapContentBlock(block);
          this.logger.debug(`  [${entry.type}] ${entry.content}`);
          this.onLogEntry?.(entry);
        }
        break;
      }
      case "result": {
        const res = msg as SdkResultSuccess | SdkResultError;
        const parts: string[] = [res.subtype];
        if (res.total_cost_usd !== undefined) parts.push(`$${res.total_cost_usd.toFixed(4)}`);
        if (res.duration_ms !== undefined) parts.push(`${res.duration_ms}ms`);
        const entry: ProcessLogEntry = { type: "status", content: `result: ${parts.join(", ")}` };
        this.logger.debug(`  [${entry.type}] ${entry.content}`);
        this.onLogEntry?.(entry);
        break;
      }
      default:
        break;
    }
  }

  private mapContentBlock(block: SdkContentBlock): ProcessLogEntry {
    switch (block.type) {
      case "thinking":
        return { type: "thinking", content: block.thinking ?? "" };
      case "text":
        return { type: "text", content: block.text ?? "" };
      case "tool_use": {
        const name = block.name ?? "unknown";
        const input = block.input ? JSON.stringify(block.input) : "{}";
        return { type: "tool_use", content: `${name}: ${input}` };
      }
      case "tool_result": {
        const content = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
        return { type: "tool_result", content };
      }
      default:
        return { type: "status", content: block.type ?? "unknown_block" };
    }
  }
}
