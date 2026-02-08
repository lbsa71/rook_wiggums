import { useState, useEffect, useRef, useCallback } from "react";

export interface LoopEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export function useWebSocket(url: string) {
  const [lastEvent, setLastEvent] = useState<LoopEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setLastEvent(parsed);
      } catch {
        // ignore non-JSON messages
      }
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return { lastEvent, connected };
}
