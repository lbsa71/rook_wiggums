import { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import { apiGet } from "../hooks/useApi";
import { LoopEvent } from "../hooks/useWebSocket";

interface SubstrateContent {
  rawMarkdown: string;
}

interface ConversationEntry {
  role: string;
  message: string;
  isAgora?: boolean;
  isTinyBus?: boolean;
}

interface ConversationViewProps {
  lastEvent: LoopEvent | null;
  refreshKey: number;
}

const ENTRY_RE = /^\[[\d\-T:.Z]+\]\s*\[(\w+)\]\s*/;

function parseEntries(raw: string): ConversationEntry[] {
  const lines = raw.split("\n");
  const entries: ConversationEntry[] = [];
  let current: ConversationEntry | null = null;

  for (const line of lines) {
    const match = line.match(ENTRY_RE);
    if (match) {
      if (current) entries.push(current);
      const message = line.replace(ENTRY_RE, "");
      const isAgora = message.includes("📨") && message.includes("Agora message");
      const isTinyBus = message.includes("🔔") && message.includes("TinyBus message");
      current = { 
        role: match[1], 
        message,
        isAgora,
        isTinyBus,
      };
    } else if (current) {
      current.message += "\n" + line;
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function ConversationView({ lastEvent, refreshKey }: ConversationViewProps) {
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const entriesRef = useRef<HTMLDivElement>(null);

  const fetchConversation = () => {
    apiGet<SubstrateContent>("/api/substrate/CONVERSATION")
      .then((data) => {
        setEntries(parseEntries(data.rawMarkdown));
      })
      .catch(() => {});
  };

  useEffect(() => { fetchConversation(); }, [refreshKey]);

  useEffect(() => {
    if (lastEvent?.type === "cycle_complete" || 
        lastEvent?.type === "conversation_response" ||
        (lastEvent?.type === "file_changed" && lastEvent.data.fileType === "CONVERSATION")) {
      fetchConversation();
    }
  }, [lastEvent]);

  useEffect(() => {
    const el = entriesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="conversation-view">
      <div className="conversation-entries" data-testid="conversation-entries" ref={entriesRef}>
        {entries.length === 0 ? (
          <p>No conversation yet.</p>
        ) : (
          entries.map((entry, i) => (
            <div 
              key={i} 
              className={`conversation-entry ${entry.isAgora ? "agora-message" : ""} ${entry.isTinyBus ? "tinybus-message" : ""}`}
            >
              <span className={`role-dot role-${entry.role.toLowerCase()}`} title={entry.role} />
              <div className="conversation-message">
                <Markdown>{entry.message}</Markdown>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
