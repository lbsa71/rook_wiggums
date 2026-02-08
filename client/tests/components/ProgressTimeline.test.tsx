import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { parseProgressEntries } from "../../src/parsers/progressParser";
import { ProgressTimeline } from "../../src/components/ProgressTimeline";

describe("parseProgressEntries", () => {
  it("extracts timestamp, agent, and message from progress lines", () => {
    const raw = "[2025-06-15T10:00:00.000Z] [EGO] Did something important";
    const entries = parseProgressEntries(raw);

    expect(entries).toEqual([
      {
        timestamp: "2025-06-15T10:00:00.000Z",
        agent: "EGO",
        message: "Did something important",
      },
    ]);
  });

  it("handles lines without agent tag", () => {
    const raw = "[2025-06-15T10:00:00.000Z] Plain message";
    const entries = parseProgressEntries(raw);

    expect(entries).toEqual([
      {
        timestamp: "2025-06-15T10:00:00.000Z",
        agent: "",
        message: "Plain message",
      },
    ]);
  });

  it("skips non-progress lines", () => {
    const raw = "# Progress\n\n[2025-06-15T10:00:00.000Z] [EGO] Entry\nsome junk";
    const entries = parseProgressEntries(raw);

    expect(entries).toHaveLength(1);
    expect(entries[0].agent).toBe("EGO");
  });
});

describe("ProgressTimeline", () => {
  it("renders entries with agent tags", () => {
    const entries = [
      { timestamp: "2025-06-15T10:00:00.000Z", agent: "EGO", message: "First" },
      { timestamp: "2025-06-15T10:01:00.000Z", agent: "SUPEREGO", message: "Second" },
    ];

    render(<ProgressTimeline entries={entries} />);

    expect(screen.getByText("EGO")).toBeInTheDocument();
    expect(screen.getByText("SUPEREGO")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    render(<ProgressTimeline entries={[]} />);
    expect(screen.getByText("No progress entries yet.")).toBeInTheDocument();
  });
});
