import { Notification } from "../hooks/useNotifications";

const TYPE_COLORS: Record<Notification["type"], string> = {
  info: "#00d4ff",
  success: "#4caf50",
  warning: "#ffd700",
  error: "#f44336",
};

interface NotificationToastProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

export function NotificationToast({ notifications, onDismiss }: NotificationToastProps) {
  if (notifications.length === 0) return null;

  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="toast"
          style={{ borderLeftColor: TYPE_COLORS[n.type] }}
          onClick={() => onDismiss(n.id)}
        >
          {n.message}
        </div>
      ))}
    </div>
  );
}
