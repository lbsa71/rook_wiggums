import { useState, useEffect, useRef } from "react";

export interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  timestamp: number;
}

interface Event {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const MAX_NOTIFICATIONS = 5;
const DISMISS_MS = 5000;

let nextId = 1;

function mapEvent(event: Event): { message: string; type: Notification["type"] } | null {
  switch (event.type) {
    case "audit_complete":
      return { message: "Superego audit completed", type: "success" };
    case "idle_handler":
      return { message: `Idle handler: ${event.data.action ?? "activated"}`, type: "info" };
    case "state_changed":
      return { message: `Loop state: ${event.data.from} \u2192 ${event.data.to}`, type: "info" };
    case "error":
      return { message: `Error: ${event.data.message ?? "unknown"}`, type: "error" };
    case "evaluation_requested":
      return { message: "Evaluation requested", type: "warning" };
    default:
      return null;
  }
}

export function useNotifications(lastEvent: Event | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const prevEventRef = useRef<Event | null>(null);

  useEffect(() => {
    if (!lastEvent || lastEvent === prevEventRef.current) return;
    prevEventRef.current = lastEvent;

    const mapped = mapEvent(lastEvent);
    if (!mapped) return;

    const id = String(nextId++);
    const notification: Notification = {
      id,
      message: mapped.message,
      type: mapped.type,
      timestamp: Date.now(),
    };

    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

    const timer = setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, DISMISS_MS);

    return () => clearTimeout(timer);
  }, [lastEvent]);

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return { notifications, dismiss };
}
