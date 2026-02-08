import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NotificationToast } from "../../src/components/NotificationToast";

describe("NotificationToast", () => {
  it("renders notification messages", () => {
    const notifications = [
      { id: "1", message: "Audit completed", type: "success" as const, timestamp: Date.now() },
      { id: "2", message: "Error occurred", type: "error" as const, timestamp: Date.now() },
    ];

    render(<NotificationToast notifications={notifications} onDismiss={() => {}} />);

    expect(screen.getByText("Audit completed")).toBeInTheDocument();
    expect(screen.getByText("Error occurred")).toBeInTheDocument();
  });

  it("renders nothing when no notifications", () => {
    const { container } = render(<NotificationToast notifications={[]} onDismiss={() => {}} />);
    expect(container.querySelector(".toast-container")).toBeNull();
  });
});
