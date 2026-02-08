import * as http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ILoopEventSink } from "./ILoopEventSink";
import { LoopEvent } from "./types";

export class LoopWebSocketServer implements ILoopEventSink {
  private wss: WebSocketServer;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server });
  }

  emit(event: LoopEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  close(): void {
    this.wss.close();
  }
}
