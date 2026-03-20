import {
  AnthropicSessionLauncher,
  DEFAULT_ANTHROPIC_MODEL,
} from "../../../src/agents/anthropic/AnthropicSessionLauncher";
import { InMemoryHttpClient } from "../../../src/agents/ollama/InMemoryHttpClient";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";
import type { ClaudeSessionRequest } from "../../../src/agents/claude/ISessionLauncher";

const FAKE_TOKEN = "sk-ant-oat01-test_access_token_1234567890";

function makeRequest(
  overrides?: Partial<ClaudeSessionRequest>,
): ClaudeSessionRequest {
  return {
    systemPrompt: "",
    message: "Execute this task.",
    ...overrides,
  };
}

function makeAnthropicResponse(content: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_ANTHROPIC_MODEL,
    content: [{ type: "text", text: content }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

describe("AnthropicSessionLauncher", () => {
  let http: InMemoryHttpClient;
  let clock: FixedClock;
  let launcher: AnthropicSessionLauncher;

  beforeEach(() => {
    http = new InMemoryHttpClient();
    clock = new FixedClock(new Date("2026-01-01T00:00:00Z"));
    launcher = new AnthropicSessionLauncher(http, clock, FAKE_TOKEN);
  });

  // ── Missing token ─────────────────────────────────────────────────────────

  it("does not throw when constructed with an empty accessToken", () => {
    expect(() => new AnthropicSessionLauncher(http, clock, "")).not.toThrow();
  });

  it("returns success=false with descriptive error when accessToken is empty", async () => {
    const emptyTokenLauncher = new AnthropicSessionLauncher(http, clock, "");
    const result = await emptyTokenLauncher.launch(makeRequest());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Anthropic access token not configured");
    expect(http.getRequests()).toHaveLength(0);
  });

  // ── URL and model routing ─────────────────────────────────────────────────

  it("posts to Anthropic /v1/messages endpoint", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    await launcher.launch(makeRequest());

    const [req] = http.getRequests();
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("uses default model in request body", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    await launcher.launch(makeRequest());

    const body = http.getRequests()[0].body as Record<string, unknown>;
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it("uses constructor model when no options.model provided", async () => {
    const customLauncher = new AnthropicSessionLauncher(
      http,
      clock,
      FAKE_TOKEN,
      "claude-haiku-4-20250514",
    );
    http.enqueueJson(makeAnthropicResponse("ok"));

    await customLauncher.launch(makeRequest());

    const body = http.getRequests()[0].body as Record<string, unknown>;
    expect(body.model).toBe("claude-haiku-4-20250514");
  });

  it("uses options.model when provided, overriding constructor model", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    await launcher.launch(makeRequest(), { model: "claude-opus-4-20250514" });

    const body = http.getRequests()[0].body as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-4-20250514");
  });

  // ── Auth and version headers ──────────────────────────────────────────────

  it("sends Authorization Bearer header with access token", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    await launcher.launch(makeRequest());

    const [req] = http.getRequests();
    expect((req.options as Record<string, unknown>)?.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${FAKE_TOKEN}` }),
    );
  });

  it("sends anthropic-version header", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    await launcher.launch(makeRequest());

    const [req] = http.getRequests();
    expect((req.options as Record<string, unknown>)?.headers).toEqual(
      expect.objectContaining({ "anthropic-version": "2023-06-01" }),
    );
  });

  // ── Request body shape ────────────────────────────────────────────────────

  it("sends system prompt as top-level system field when non-empty", async () => {
    http.enqueueJson(makeAnthropicResponse("result"));

    await launcher.launch(
      makeRequest({ systemPrompt: "You are an agent.", message: "Do the task." }),
    );

    const body = http.getRequests()[0].body as Record<string, unknown>;
    expect(body.system).toBe("You are an agent.");
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Do the task.");
  });

  it("omits system field when systemPrompt is empty", async () => {
    http.enqueueJson(makeAnthropicResponse("result"));

    await launcher.launch(makeRequest({ systemPrompt: "", message: "Hello" }));

    const body = http.getRequests()[0].body as Record<string, unknown>;
    expect(body.system).toBeUndefined();
    const messages = body.messages as Array<{ role: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("includes max_tokens in request body", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    await launcher.launch(makeRequest());

    const body = http.getRequests()[0].body as Record<string, unknown>;
    expect(typeof body.max_tokens).toBe("number");
    expect((body.max_tokens as number)).toBeGreaterThan(0);
  });

  // ── Success case ──────────────────────────────────────────────────────────

  it("returns rawOutput and success=true on HTTP 200", async () => {
    http.enqueueJson(makeAnthropicResponse('{"result":"success"}'));

    const result = await launcher.launch(makeRequest());

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.rawOutput).toBe('{"result":"success"}');
    expect(result.error).toBeUndefined();
  });

  it("reports durationMs via clock (FixedClock → 0ms)", async () => {
    http.enqueueJson(makeAnthropicResponse("ok"));

    const result = await launcher.launch(makeRequest());

    expect(result.durationMs).toBe(0);
  });

  // ── Error cases ───────────────────────────────────────────────────────────

  it("returns success=false with HTTP status in error on non-200 response", async () => {
    http.enqueueError(401, "invalid_api_key");

    const result = await launcher.launch(makeRequest());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("401");
    expect(result.rawOutput).toBe("");
  });

  it("returns success=false with Anthropic error field when present", async () => {
    http.enqueueJson({
      error: {
        type: "rate_limit_error",
        message: "Rate limit exceeded",
      },
    });

    const result = await launcher.launch(makeRequest());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Rate limit exceeded");
  });

  it("returns success=false on network error", async () => {
    http.enqueueNetworkError("connect ECONNREFUSED 104.18.6.88:443");

    const result = await launcher.launch(makeRequest());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Cannot reach Anthropic API");
  });

  it("does not leak access token in error messages", async () => {
    http.enqueueError(401, `Invalid token: ${FAKE_TOKEN}`);

    const result = await launcher.launch(makeRequest());

    expect(result.error).not.toContain(FAKE_TOKEN);
    expect(result.error).toContain("[REDACTED]");
  });

  // ── healthy() probe ───────────────────────────────────────────────────────

  it("healthy() returns true when API responds with HTTP 200", async () => {
    http.enqueueJson(makeAnthropicResponse("hi"));

    const result = await launcher.healthy();

    expect(result).toBe(true);
  });

  it("healthy() returns false when API responds with non-200", async () => {
    http.enqueueError(401, "unauthorized");

    const result = await launcher.healthy();

    expect(result).toBe(false);
  });

  it("healthy() returns false on network error (no throw)", async () => {
    http.enqueueNetworkError("connect ECONNREFUSED");

    const result = await launcher.healthy();

    expect(result).toBe(false);
  });
});
