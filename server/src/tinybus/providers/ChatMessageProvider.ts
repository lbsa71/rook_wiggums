import { Message } from "../core/Message";
import { Provider } from "../core/Provider";

/**
 * Provider that handles chat messages by calling handleUserMessage
 * Used to route UI chat messages through TinyBus
 */
export class ChatMessageProvider implements Provider {
  public readonly id: string;
  private ready = false;
  private started = false;
  private messageHandler?: (message: Message) => Promise<void>;
  private handleUserMessageFn: (message: string) => Promise<void>;

  constructor(id: string, handleUserMessageFn: (message: string) => Promise<void>) {
    this.id = id;
    this.handleUserMessageFn = handleUserMessageFn;
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  async start(): Promise<void> {
    this.started = true;
    this.ready = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.ready = false;
  }

  async send(message: Message): Promise<void> {
    if (!this.started) {
      throw new Error(`Provider ${this.id} not started`);
    }

    // Only handle chat messages — silently skip other types (e.g. agora.send)
    if (message.type !== "chat") {
      return;
    }

    // Extract message text from payload
    let messageText: string;
    if (typeof message.payload === "string") {
      messageText = message.payload;
    } else if (message.payload && typeof message.payload === "object") {
      if ("text" in message.payload) {
        const textValue = message.payload.text;
        if (textValue === null || textValue === undefined || textValue === "") {
          throw new Error(`Chat message payload.text must be a non-empty string, got: ${JSON.stringify(message.payload)}`);
        }
        messageText = String(textValue);
      } else {
        // Object without "text" property
        throw new Error(`Chat message payload must contain text, got: ${JSON.stringify(message.payload)}`);
      }
    } else if (message.payload === null || message.payload === undefined) {
      throw new Error(`Chat message payload must contain text, got: ${JSON.stringify(message.payload)}`);
    } else {
      // Fallback: try to stringify the payload
      const stringified = String(message.payload);
      if (!stringified || stringified.trim() === "") {
        throw new Error(`Chat message payload must contain text, got: ${JSON.stringify(message.payload)}`);
      }
      messageText = stringified;
    }

    if (!messageText || messageText.trim() === "") {
      throw new Error(`Chat message payload must contain non-empty text, got: ${JSON.stringify(message.payload)}`);
    }

    // Call handleUserMessage with the extracted text
    await this.handleUserMessageFn(messageText);
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Get the message types this provider supports
   * Empty array means the provider accepts all message types
   */
  getMessageTypes(): string[] {
    return []; // Accept all message types (will handle chat messages based on routing)
  }
}
