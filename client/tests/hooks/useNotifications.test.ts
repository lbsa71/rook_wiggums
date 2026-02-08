import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useNotifications } from "../../src/hooks/useNotifications";

describe("useNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a notification from an event", () => {
    const { result, rerender } = renderHook(
      ({ event }) => useNotifications(event),
      { initialProps: { event: null as { type: string; timestamp: string; data: Record<string, unknown> } | null } }
    );

    expect(result.current.notifications).toHaveLength(0);

    rerender({
      event: { type: "audit_complete", timestamp: "2025-01-01T00:00:00Z", data: {} },
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].message).toBe("Superego audit completed");
    expect(result.current.notifications[0].type).toBe("success");
  });

  it("auto-dismisses after 5 seconds", () => {
    const { result, rerender } = renderHook(
      ({ event }) => useNotifications(event),
      { initialProps: { event: null as { type: string; timestamp: string; data: Record<string, unknown> } | null } }
    );

    rerender({
      event: { type: "error", timestamp: "2025-01-01T00:00:00Z", data: { message: "Boom" } },
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it("limits max notifications to 5", () => {
    const { result, rerender } = renderHook(
      ({ event }) => useNotifications(event),
      { initialProps: { event: null as { type: string; timestamp: string; data: Record<string, unknown> } | null } }
    );

    for (let i = 0; i < 7; i++) {
      rerender({
        event: { type: "state_changed", timestamp: `2025-01-01T00:00:0${i}Z`, data: { from: "A", to: "B" } },
      });
    }

    expect(result.current.notifications.length).toBeLessThanOrEqual(5);
  });
});
