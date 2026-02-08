import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProgressLog } from "../../src/components/ProgressLog";

describe("ProgressLog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("displays progress entries in reverse order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        rawMarkdown: "# Progress\n\n[2025-01-01] First entry\n[2025-01-02] Second entry",
      }),
    } as Response);

    render(<ProgressLog lastEvent={null} />);

    await waitFor(() => {
      const entries = screen.getByTestId("progress-entries");
      expect(entries.textContent).toContain("Second entry");
    });
  });

  it("shows empty state when no entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rawMarkdown: "# Progress\n\n" }),
    } as Response);

    render(<ProgressLog lastEvent={null} />);

    await waitFor(() => {
      expect(screen.getByText("No progress entries yet.")).toBeInTheDocument();
    });
  });
});
