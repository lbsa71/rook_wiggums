import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthIndicators } from "../../src/components/HealthIndicators";

async function flushAsyncUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("HealthIndicators", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays overall health status", async () => {
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(<HealthIndicators />);

    await act(async () => {
      resolveFetch!({
        ok: true,
        json: () => Promise.resolve({
          overall: "healthy",
          drift: { score: 0, findings: [] },
          consistency: { inconsistencies: [] },
          security: { compliant: true, issues: [] },
          planQuality: { score: 1, findings: [] },
          reasoning: { valid: true, issues: [] },
        }),
      } as Response);
      await flushAsyncUpdates();
    });

    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("displays degraded status with color coding", async () => {
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(<HealthIndicators />);

    await act(async () => {
      resolveFetch!({
        ok: true,
        json: () => Promise.resolve({
          overall: "unhealthy",
          drift: { score: 0.8, findings: [{ fileType: "PLAN", message: "Bad" }] },
          consistency: { inconsistencies: [{ message: "Inconsistent" }] },
          security: { compliant: false, issues: ["No constraints"] },
          planQuality: { score: 0.25, findings: [{ message: "No tasks" }] },
          reasoning: { valid: false, issues: [{ message: "Disconnected" }] },
        }),
      } as Response);
      await flushAsyncUpdates();
    });

    expect(screen.getByText("unhealthy")).toBeInTheDocument();
  });
});
