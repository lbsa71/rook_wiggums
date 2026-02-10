import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LoopControls } from "../../src/components/LoopControls";

describe("LoopControls", () => {
  it("enables Start when STOPPED", () => {
    render(<LoopControls state="STOPPED" onStateChange={vi.fn()} />);

    expect(screen.getByText("Start")).not.toBeDisabled();
    expect(screen.getByText("Pause")).toBeDisabled();
    expect(screen.getByText("Resume")).toBeDisabled();
    expect(screen.getByText("Stop")).toBeDisabled();
  });

  it("enables Pause and Stop when RUNNING", () => {
    render(<LoopControls state="RUNNING" onStateChange={vi.fn()} />);

    expect(screen.getByText("Start")).toBeDisabled();
    expect(screen.getByText("Pause")).not.toBeDisabled();
    expect(screen.getByText("Resume")).toBeDisabled();
    expect(screen.getByText("Stop")).not.toBeDisabled();
  });

  it("enables Resume and Stop when PAUSED", () => {
    render(<LoopControls state="PAUSED" onStateChange={vi.fn()} />);

    expect(screen.getByText("Start")).toBeDisabled();
    expect(screen.getByText("Pause")).toBeDisabled();
    expect(screen.getByText("Resume")).not.toBeDisabled();
    expect(screen.getByText("Stop")).not.toBeDisabled();
  });

  it("Restart button is always enabled regardless of state", () => {
    const { rerender } = render(<LoopControls state="STOPPED" onStateChange={vi.fn()} />);
    expect(screen.getByText("Restart")).not.toBeDisabled();

    rerender(<LoopControls state="RUNNING" onStateChange={vi.fn()} />);
    expect(screen.getByText("Restart")).not.toBeDisabled();

    rerender(<LoopControls state="PAUSED" onStateChange={vi.fn()} />);
    expect(screen.getByText("Restart")).not.toBeDisabled();
  });

  it("Restart button calls /api/loop/restart", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const onStateChange = vi.fn();
    render(<LoopControls state="RUNNING" onStateChange={onStateChange} />);

    fireEvent.click(screen.getByText("Restart"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/loop/restart",
      expect.objectContaining({ method: "POST" }),
    );
    fetchSpy.mockRestore();
  });
});
