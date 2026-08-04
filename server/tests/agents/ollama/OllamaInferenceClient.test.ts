import { OllamaInferenceClient } from "../../../src/agents/ollama/OllamaInferenceClient";
import { InMemoryHttpClient } from "../../../src/agents/ollama/InMemoryHttpClient";

describe("OllamaInferenceClient", () => {
  let http: InMemoryHttpClient;
  let client: OllamaInferenceClient;

  beforeEach(() => {
    http = new InMemoryHttpClient();
    client = new OllamaInferenceClient(http, "http://localhost:11434", "qwen3:14b");
  });

  it("returns generated text on success", async () => {
    http.enqueueJson({ response: "a concise summary" });
    const result = await client.infer("prompt");
    expect(result).toEqual({ ok: true, result: "a concise summary" });
  });

  it("strips <think> chain-of-thought from the compaction/offload path", async () => {
    // Regression: OllamaOffloadService compacts CONVERSATION.md via infer(); a
    // thinking default model must not persist raw <think> tokens to substrate.
    http.enqueueJson({
      response: "<think>the user wants a short summary of the log</think>\nI said X, you said Y, we decided Z.",
    });
    const result = await client.infer("prompt");
    expect(result).toEqual({ ok: true, result: "I said X, you said Y, we decided Z." });
  });

  it("preserves a think-only response so a quality gate can reject it", async () => {
    const thinkOnly = "<think>reasoning only, produced no answer</think>";
    http.enqueueJson({ response: thinkOnly });
    const result = await client.infer("prompt");
    expect(result).toEqual({ ok: true, result: thinkOnly });
  });

  it("reports parse_error when the response field is missing", async () => {
    http.enqueueJson({ notResponse: true });
    const result = await client.infer("prompt");
    expect(result).toEqual({ ok: false, reason: "parse_error" });
  });

  it("reports unavailable on non-ok HTTP status", async () => {
    http.enqueueError(500, "boom");
    const result = await client.infer("prompt");
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("probe returns true when /api/tags is reachable", async () => {
    http.enqueueJson({ models: [] });
    expect(await client.probe()).toBe(true);
  });

  it("probe returns false on network error", async () => {
    http.enqueueNetworkError("ECONNREFUSED");
    expect(await client.probe()).toBe(false);
  });
});
