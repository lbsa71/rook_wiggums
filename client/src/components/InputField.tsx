import { useState } from "react";
import { apiPost } from "../hooks/useApi";

interface InputFieldProps {
  onSent: () => void;
}

export function InputField({ onSent }: InputFieldProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await apiPost("/api/conversation/send", { message });
      setMessage("");
      onSent();
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-field">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={sending}
        data-testid="message-input"
      />
      <button onClick={handleSend} disabled={sending || !message.trim()}>
        Send
      </button>
    </div>
  );
}
