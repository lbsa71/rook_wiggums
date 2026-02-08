import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanView } from "../../src/components/PlanView";

describe("PlanView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays parsed tasks after fetching plan", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        rawMarkdown: "# Plan\n\n## Tasks\n- [ ] Task A\n- [x] Task B",
        meta: { fileType: "PLAN" },
      }),
    } as Response);

    render(<PlanView lastEvent={null} />);

    await waitFor(() => {
      expect(screen.getByText("Task A")).toBeInTheDocument();
      expect(screen.getByText("Task B")).toBeInTheDocument();
    });
  });
});
