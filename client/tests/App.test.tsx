import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch for all API calls made by child components
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        state: "STOPPED",
        metrics: {
          totalCycles: 0, successfulCycles: 0, failedCycles: 0,
          idleCycles: 0, consecutiveIdleCycles: 0, superegoAudits: 0,
        },
      }),
    } as Response);
    // Mock WebSocket as a class
    class MockWebSocket {
      close = vi.fn();
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
    }
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("renders the application title", () => {
    render(<App />);
    expect(screen.getByText("Substrate")).toBeInTheDocument();
  });

  it("shows connection status", () => {
    render(<App />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});
