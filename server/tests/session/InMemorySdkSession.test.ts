import { InMemorySdkSession } from "../../src/session/InMemorySdkSession";
import { SdkMessage, SdkAssistantMessage, SdkResultSuccess } from "../../src/agents/claude/AgentSdkLauncher";
import { SdkUserMessage } from "../../src/session/ISdkSession";

describe("InMemorySdkSession", () => {
  const textMessage: SdkAssistantMessage = {
    type: "assistant",
    message: { content: [{ type: "text", text: "hello" }] },
  };

  const resultMessage: SdkResultSuccess = {
    type: "result",
    subtype: "success",
    result: "done",
    total_cost_usd: 0.01,
    duration_ms: 1000,
  };

  it("yields all pre-loaded messages in order", async () => {
    const session = new InMemorySdkSession([textMessage, resultMessage]);
    const messages: SdkMessage[] = [];

    for await (const msg of session) {
      messages.push(msg);
    }

    expect(messages).toEqual([textMessage, resultMessage]);
  });

  it("yields no messages when created empty", async () => {
    const session = new InMemorySdkSession([]);
    const messages: SdkMessage[] = [];

    for await (const msg of session) {
      messages.push(msg);
    }

    expect(messages).toEqual([]);
  });

  it("records streamInput calls", async () => {
    const session = new InMemorySdkSession([resultMessage]);

    const userMsg: SdkUserMessage = {
      type: "user",
      message: { role: "user", content: "test message" },
      parent_tool_use_id: null,
      session_id: "sess-1",
    };

    async function* singleMessage() {
      yield userMsg;
    }

    await session.streamInput(singleMessage());

    const calls = session.getStreamInputCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([userMsg]);
  });

  it("records multiple streamInput calls separately", async () => {
    const session = new InMemorySdkSession([resultMessage]);

    const msg1: SdkUserMessage = {
      type: "user",
      message: { role: "user", content: "first" },
      parent_tool_use_id: null,
      session_id: "sess-1",
    };
    const msg2: SdkUserMessage = {
      type: "user",
      message: { role: "user", content: "second" },
      parent_tool_use_id: null,
      session_id: "sess-1",
    };

    async function* first() { yield msg1; }
    async function* second() { yield msg2; }

    await session.streamInput(first());
    await session.streamInput(second());

    const calls = session.getStreamInputCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([msg1]);
    expect(calls[1]).toEqual([msg2]);
  });

  it("tracks close state", () => {
    const session = new InMemorySdkSession([resultMessage]);
    expect(session.wasClosed()).toBe(false);

    session.close();
    expect(session.wasClosed()).toBe(true);
  });
});
