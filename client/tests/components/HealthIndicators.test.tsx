import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthIndicators } from "../../src/components/HealthIndicators";

describe("HealthIndicators", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays overall health status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
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

    render(<HealthIndicators />);

    await waitFor(() => {
      expect(screen.getByText("healthy")).toBeInTheDocument();
    });
  });

  it("displays degraded status with color coding", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
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

    render(<HealthIndicators />);

    await waitFor(() => {
      expect(screen.getByText("unhealthy")).toBeInTheDocument();
    });
  });
});
