import { SdkMessage } from "../agents/claude/AgentSdkLauncher";
import { ISdkSession, SdkUserMessage } from "./ISdkSession";

export class InMemorySdkSession implements ISdkSession {
  private readonly messages: SdkMessage[];
  private readonly streamInputCalls: SdkUserMessage[][] = [];
  private closed = false;

  constructor(messages: SdkMessage[]) {
    this.messages = [...messages];
  }

  async streamInput(stream: AsyncIterable<SdkUserMessage>): Promise<void> {
    const collected: SdkUserMessage[] = [];
    for await (const msg of stream) {
      collected.push(msg);
    }
    this.streamInputCalls.push(collected);
  }

  close(): void {
    this.closed = true;
  }

  getStreamInputCalls(): SdkUserMessage[][] {
    return [...this.streamInputCalls];
  }

  wasClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<SdkMessage> {
    let index = 0;
    const messages = this.messages;
    return {
      async next(): Promise<IteratorResult<SdkMessage>> {
        if (index < messages.length) {
          return { value: messages[index++], done: false };
        }
        return { value: undefined as unknown as SdkMessage, done: true };
      },
    };
  }
}
