import type { IClock } from "../../substrate/abstractions/IClock";
import type {
  ISessionLauncher,
  ClaudeSessionRequest,
  ClaudeSessionResult,
  LaunchOptions,
} from "../claude/ISessionLauncher";
import type { IHttpClient } from "../ollama/IHttpClient";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Anthropic Messages API request message shape.
 */
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Expected response shape from Anthropic's POST /v1/messages endpoint.
 */
interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    type?: string;
    message?: string;
  };
}

/**
 * ISessionLauncher implementation that calls the Anthropic Messages API
 * using a Claude Max subscription bearer token (generated via `claude setup-token`).
 *
 * This routes inference billing to the Claude Max subscription rather than the
 * pay-per-token Anthropic API account.
 *
 * API endpoint: https://api.anthropic.com/v1/messages
 * Auth: Authorization: Bearer <accessToken read from anthropicTokenPath>
 *
 * Graceful fallback: if the token file is missing or malformed, createAgentLayer
 * skips construction and falls back to the default launcher.
 *
 * Config shape (config.json):
 *   { "sessionLauncher": "anthropic", "anthropicTokenPath": "~/.master-plan/credentials.json", "anthropicModel": "claude-sonnet-4-20250514" }
 *   { "idLauncher": "anthropic", "anthropicTokenPath": "~/.master-plan/credentials.json", "idAnthropicModel": "claude-sonnet-4-20250514" }
 *
 * Credential file format (from `claude setup-token`):
 *   { "claudeAiOauth": { "accessToken": "sk-ant-oat01-..." } }
 *
 * @see https://docs.anthropic.com/en/api/messages
 */
export class AnthropicSessionLauncher implements ISessionLauncher {
  private readonly model: string;
  private readonly accessToken: string;

  constructor(
    private readonly httpClient: IHttpClient,
    private readonly clock: IClock,
    accessToken: string,
    model?: string,
  ) {
    this.accessToken = accessToken;
    this.model = model ?? DEFAULT_ANTHROPIC_MODEL;
  }

  async launch(
    request: ClaudeSessionRequest,
    options?: LaunchOptions,
  ): Promise<ClaudeSessionResult> {
    if (!this.accessToken) {
      return {
        rawOutput: "",
        exitCode: 1,
        durationMs: 0,
        success: false,
        error: "Anthropic access token not configured — set anthropicTokenPath in config.json",
      };
    }

    const startMs = this.clock.now().getTime();
    const modelToUse = options?.model ?? this.model;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const messages: AnthropicMessage[] = [];
    messages.push({ role: "user", content: request.message });

    const body: Record<string, unknown> = {
      model: modelToUse,
      messages,
      max_tokens: DEFAULT_MAX_TOKENS,
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    try {
      const response = await this.httpClient.post(
        `${ANTHROPIC_BASE_URL}/messages`,
        body,
        {
          timeoutMs,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
          },
        },
      );

      const durationMs = this.clock.now().getTime() - startMs;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          rawOutput: "",
          exitCode: 1,
          durationMs,
          success: false,
          error: `Anthropic returned HTTP ${response.status}: ${this.redactToken(errorText)}`,
        };
      }

      const data = (await response.json()) as AnthropicResponse;

      if (data.error) {
        return {
          rawOutput: "",
          exitCode: 1,
          durationMs,
          success: false,
          error: `Anthropic API error: ${this.redactToken(data.error.message ?? JSON.stringify(data.error))}`,
        };
      }

      const text = data.content?.find((c) => c.type === "text")?.text ?? "";

      return {
        rawOutput: text,
        exitCode: 0,
        durationMs,
        success: true,
      };
    } catch (err) {
      const durationMs = this.clock.now().getTime() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      const isConnectionError =
        message.includes("ECONNREFUSED") ||
        message.includes("fetch failed") ||
        message.includes("connect ECONNREFUSED");

      return {
        rawOutput: "",
        exitCode: 1,
        durationMs,
        success: false,
        error: isConnectionError
          ? `Cannot reach Anthropic API at ${ANTHROPIC_BASE_URL} — check network connectivity. (${this.redactToken(message)})`
          : this.redactToken(message),
      };
    }
  }

  /**
   * Health probe: make a minimal Messages API call to verify the token is valid
   * and the API is reachable. Returns false on any error rather than throwing.
   */
  async healthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.post(
        `${ANTHROPIC_BASE_URL}/messages`,
        {
          model: this.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        },
        {
          timeoutMs: 10000,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Strip the access token from any string to prevent accidental logging.
   */
  private redactToken(text: string): string {
    if (!this.accessToken) return text;
    return text.replaceAll(this.accessToken, "[REDACTED]");
  }
}
