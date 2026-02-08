import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationView } from "../../src/components/ConversationView";

describe("ConversationView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays conversation entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        rawMarkdown: "# Conversation\n\n[2025-01-01] [EGO] Hello there",
      }),
    } as Response);

    render(<ConversationView lastEvent={null} refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-entries")).toHaveTextContent("Hello there");
    });
  });

  it("shows empty state when no entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rawMarkdown: "# Conversation\n\n" }),
    } as Response);

    render(<ConversationView lastEvent={null} refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByText("No conversation yet.")).toBeInTheDocument();
    });
  });
});
