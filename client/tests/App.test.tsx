import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "../src/App";

function mockFetchByPath(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const payload =
      url.includes("/api/loop/status")
        ? { state: "STOPPED", metrics: { totalCycles: 0, successfulCycles: 0, failedCycles: 0, idleCycles: 0, consecutiveIdleCycles: 0, superegoAudits: 0 } }
        : url.includes("/api/health")
          ? { overall: "healthy", drift: { score: 0, findings: [] }, consistency: { inconsistencies: [] }, security: { compliant: true, issues: [] }, planQuality: { score: 1, findings: [] }, reasoning: { valid: true, issues: [] } }
          : url.includes("/api/substrate")
            ? { rawMarkdown: "", meta: { fileType: "PLAN" } }
            : {};
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);
  });
}

async function flushAsyncUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchByPath();
    class MockWebSocket {
      close = vi.fn();
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
    }
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("renders the application title", async () => {
    await act(async () => {
      render(<App />);
      await flushAsyncUpdates();
    });
    await waitFor(() => {
      expect(screen.getByText("Substrate")).toBeInTheDocument();
    });
  });

  it("shows connection status", async () => {
    await act(async () => {
      render(<App />);
      await flushAsyncUpdates();
    });
    await waitFor(() => {
      expect(screen.getByText("Disconnected")).toBeInTheDocument();
    });
  });
});
