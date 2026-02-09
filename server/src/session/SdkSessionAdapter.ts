import { SdkMessage, SdkQueryFn } from "../agents/claude/AgentSdkLauncher";
import { ISdkSession, SdkSessionFactory, SdkUserMessage } from "./ISdkSession";

class SdkSessionWrapper implements ISdkSession {
  private readonly stream: AsyncIterable<SdkMessage>;

  constructor(stream: AsyncIterable<SdkMessage>) {
    this.stream = stream;
  }

  async streamInput(_stream: AsyncIterable<SdkUserMessage>): Promise<void> {
    // The V1 query() API supports streamInput on the returned object.
    // We cast and delegate to the underlying SDK stream if it supports it.
    const underlying = this.stream as { streamInput?: (s: AsyncIterable<SdkUserMessage>) => Promise<void> };
    if (typeof underlying.streamInput === "function") {
      await underlying.streamInput(_stream);
    }
  }

  close(): void {
    const underlying = this.stream as { close?: () => void };
    if (typeof underlying.close === "function") {
      underlying.close();
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SdkMessage> {
    return this.stream[Symbol.asyncIterator]();
  }
}

export function createSdkSessionFactory(queryFn: SdkQueryFn): SdkSessionFactory {
  return (params) => {
    const stream = queryFn({ prompt: params.prompt, options: params.options });
    return new SdkSessionWrapper(stream);
  };
}
