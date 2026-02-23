import { ChatMessageProvider } from "../../../src/tinybus/providers/ChatMessageProvider";
import { createMessage } from "../../../src/tinybus/core/Message";

describe("ChatMessageProvider", () => {
  let provider: ChatMessageProvider;
  let handleUserMessageFn: jest.Mock;

  beforeEach(() => {
    handleUserMessageFn = jest.fn().mockResolvedValue(undefined);
    provider = new ChatMessageProvider("test-provider", handleUserMessageFn);
  });

  describe("initialization", () => {
    it("has correct id", () => {
      expect(provider.id).toBe("test-provider");
    });

    it("is not ready before start", async () => {
      expect(await provider.isReady()).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("becomes ready after start", async () => {
      await provider.start();
      expect(await provider.isReady()).toBe(true);
    });

    it("becomes not ready after stop", async () => {
      await provider.start();
      await provider.stop();
      expect(await provider.isReady()).toBe(false);
    });
  });

  describe("send", () => {
    beforeEach(async () => {
      await provider.start();
    });

    it("calls handleUserMessage with text from payload object", async () => {
      const message = createMessage({
        type: "chat",
        payload: { text: "Hello, world!" },
      });

      await provider.send(message);

      expect(handleUserMessageFn).toHaveBeenCalledTimes(1);
      expect(handleUserMessageFn).toHaveBeenCalledWith("Hello, world!");
    });

    it("calls handleUserMessage with string payload", async () => {
      const message = createMessage({
        type: "chat",
        payload: "Direct string message",
      });

      await provider.send(message);

      expect(handleUserMessageFn).toHaveBeenCalledTimes(1);
      expect(handleUserMessageFn).toHaveBeenCalledWith("Direct string message");
    });

    it("converts non-string payload to string", async () => {
      const message = createMessage({
        type: "chat",
        payload: 12345,
      });

      await provider.send(message);

      expect(handleUserMessageFn).toHaveBeenCalledTimes(1);
      expect(handleUserMessageFn).toHaveBeenCalledWith("12345");
    });

    it("throws error when payload is missing text", async () => {
      const message = createMessage({
        type: "chat",
        payload: {},
      });

      await expect(provider.send(message)).rejects.toThrow(
        "Chat message payload must contain text"
      );
    });

    it("throws error when payload is null", async () => {
      const message = createMessage({
        type: "chat",
        payload: null,
      });

      await expect(provider.send(message)).rejects.toThrow(
        "Chat message payload must contain text"
      );
    });

    it("throws error when not started", async () => {
      await provider.stop();

      const message = createMessage({
        type: "chat",
        payload: { text: "test" },
      });

      await expect(provider.send(message)).rejects.toThrow(
        "Provider test-provider not started"
      );
    });

    it("propagates errors from handleUserMessage", async () => {
      const error = new Error("Test error");
      handleUserMessageFn.mockRejectedValue(error);

      const message = createMessage({
        type: "chat",
        payload: { text: "test" },
      });

      await expect(provider.send(message)).rejects.toThrow("Test error");
    });

    it("silently skips non-chat message types", async () => {
      const message = createMessage({
        type: "agora.send",
        payload: { peerName: "stefan", type: "publish", payload: { text: "hi" } },
      });

      await provider.send(message);

      expect(handleUserMessageFn).not.toHaveBeenCalled();
    });
  });

  describe("getMessageTypes", () => {
    it("returns empty array (accepts all message types)", () => {
      expect(provider.getMessageTypes()).toEqual([]);
    });
  });
});
