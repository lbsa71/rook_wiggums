import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemStatus } from "../../src/components/SystemStatus";

describe("SystemStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays loop state after fetching", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        state: "STOPPED",
        metrics: {
          totalCycles: 5,
          successfulCycles: 3,
          failedCycles: 1,
          idleCycles: 1,
          consecutiveIdleCycles: 0,
          superegoAudits: 1,
        },
      }),
    } as Response);

    render(<SystemStatus lastEvent={null} />);

    await waitFor(() => {
      expect(screen.getByTestId("loop-state")).toHaveTextContent("STOPPED");
    });
    expect(screen.getByText("Cycles: 5")).toBeInTheDocument();
    expect(screen.getByText("Audits: 1")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    render(<SystemStatus lastEvent={null} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
