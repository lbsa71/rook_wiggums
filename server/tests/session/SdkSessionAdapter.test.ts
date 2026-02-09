import { createSdkSessionFactory } from "../../src/session/SdkSessionAdapter";
import { SdkMessage, SdkQueryFn, SdkResultSuccess } from "../../src/agents/claude/AgentSdkLauncher";

describe("SdkSessionAdapter", () => {
  const resultMessage: SdkResultSuccess = {
    type: "result",
    subtype: "success",
    result: "done",
    total_cost_usd: 0.01,
    duration_ms: 100,
  };

  it("creates a session that yields messages from queryFn", async () => {
    const queryFn: SdkQueryFn = async function* () {
      yield resultMessage;
    };

    const factory = createSdkSessionFactory(queryFn);
    const session = factory({ prompt: "test" });

    const messages: SdkMessage[] = [];
    for await (const msg of session) {
      messages.push(msg);
    }

    expect(messages).toEqual([resultMessage]);
  });

  it("passes prompt and options to queryFn", async () => {
    let capturedParams: { prompt: string; options?: Record<string, unknown> } | null = null;

    const queryFn: SdkQueryFn = async function* (params) {
      capturedParams = params;
      yield resultMessage;
    };

    const factory = createSdkSessionFactory(queryFn);
    const session = factory({ prompt: "hello", options: { model: "opus" } });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of session) { /* drain */ }

    expect(capturedParams).not.toBeNull();
    expect(capturedParams!.prompt).toBe("hello");
    expect(capturedParams!.options).toEqual({ model: "opus" });
  });

  it("streamInput delegates to underlying stream if supported", async () => {
    const calls: unknown[] = [];

    const queryFn: SdkQueryFn = (_params) => {
      const stream = (async function* () {
        yield resultMessage;
      })();

      return Object.assign(stream, {
        streamInput: async (s: AsyncIterable<unknown>) => {
          for await (const item of s) {
            calls.push(item);
          }
        },
      });
    };

    const factory = createSdkSessionFactory(queryFn);
    const session = factory({ prompt: "test" });

    async function* messages() {
      yield { type: "user" as const, message: { role: "user" as const, content: "hi" }, parent_tool_use_id: null, session_id: "s1" };
    }
    await session.streamInput(messages());

    expect(calls).toHaveLength(1);
  });

  it("close delegates to underlying stream if supported", () => {
    let closed = false;

    const queryFn: SdkQueryFn = () => {
      const stream = (async function* () {
        yield resultMessage;
      })();
      return Object.assign(stream, { close: () => { closed = true; } });
    };

    const factory = createSdkSessionFactory(queryFn);
    const session = factory({ prompt: "test" });
    session.close();

    expect(closed).toBe(true);
  });
});
