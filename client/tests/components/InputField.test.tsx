import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputField } from "../../src/components/InputField";

describe("InputField", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders input and send button", () => {
    render(<InputField onSent={vi.fn()} />);

    expect(screen.getByTestId("message-input")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("disables send button when input is empty", () => {
    render(<InputField onSent={vi.fn()} />);

    expect(screen.getByText("Send")).toBeDisabled();
  });

  it("sends message and clears input on submit", async () => {
    const onSent = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    render(<InputField onSent={onSent} />);

    const input = screen.getByTestId("message-input");
    const user = userEvent.setup();
    await user.type(input, "Hello world");
    await user.click(screen.getByText("Send"));

    expect(fetch).toHaveBeenCalled();
    expect(onSent).toHaveBeenCalled();
  });
});
