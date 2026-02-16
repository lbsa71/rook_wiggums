import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanView } from "../../src/components/PlanView";

async function flushAsyncUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("PlanView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays parsed tasks after fetching plan", async () => {
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(<PlanView lastEvent={null} />);

    await act(async () => {
      resolveFetch!({
        ok: true,
        json: () => Promise.resolve({
          rawMarkdown: "# Plan\n\n## Tasks\n- [ ] Task A\n- [x] Task B",
          meta: { fileType: "PLAN" },
        }),
      } as Response);
      await flushAsyncUpdates();
    });

    expect(screen.getByText("Task A")).toBeInTheDocument();
    expect(screen.getByText("Task B")).toBeInTheDocument();
  });
});
