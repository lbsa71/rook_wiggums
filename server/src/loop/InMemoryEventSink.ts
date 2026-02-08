import { ILoopEventSink } from "./ILoopEventSink";
import { LoopEvent } from "./types";

export class InMemoryEventSink implements ILoopEventSink {
  private events: LoopEvent[] = [];

  emit(event: LoopEvent): void {
    this.events.push(event);
  }

  getEvents(): LoopEvent[] {
    return [...this.events];
  }

  reset(): void {
    this.events = [];
  }
}
