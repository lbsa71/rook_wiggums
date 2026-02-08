import { LoopEvent } from "./types";

export interface ILoopEventSink {
  emit(event: LoopEvent): void;
}
