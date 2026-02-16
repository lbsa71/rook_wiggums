import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemStatus } from "../../src/components/SystemStatus";

const loopStatus = {
  state: "STOPPED",
  metrics: {
    totalCycles: 5,
    successfulCycles: 3,
    failedCycles: 1,
    idleCycles: 1,
    consecutiveIdleCycles: 0,
    superegoAudits: 1,
  },
};

async function flushAsyncUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SystemStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays loop state after fetching", async () => {
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(<SystemStatus lastEvent={null} />);

    await act(async () => {
      resolveFetch!({
        ok: true,
        json: () => Promise.resolve(loopStatus),
      } as Response);
      await flushAsyncUpdates();
    });

    expect(screen.getByTestId("loop-state")).toHaveTextContent("STOPPED");
    expect(screen.getByText("Cycles: 5")).toBeInTheDocument();
    expect(screen.getByText("Audits: 1")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    render(<SystemStatus lastEvent={null} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
