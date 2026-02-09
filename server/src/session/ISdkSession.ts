import { SdkMessage } from "../agents/claude/AgentSdkLauncher";

export interface SdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

export interface ISdkSession extends AsyncIterable<SdkMessage> {
  streamInput(stream: AsyncIterable<SdkUserMessage>): Promise<void>;
  close(): void;
}

export type SdkSessionFactory = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => ISdkSession;
