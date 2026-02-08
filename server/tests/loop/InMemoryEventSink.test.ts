import { InMemoryEventSink } from "../../src/loop/InMemoryEventSink";
import { ILoopEventSink } from "../../src/loop/ILoopEventSink";
import { LoopEvent, LoopState } from "../../src/loop/types";

describe("InMemoryEventSink", () => {
  let sink: InMemoryEventSink;

  beforeEach(() => {
    sink = new InMemoryEventSink();
  });

  it("implements ILoopEventSink", () => {
    const s: ILoopEventSink = sink;
    expect(s).toBeDefined();
  });

  it("starts with no events", () => {
    expect(sink.getEvents()).toEqual([]);
  });

  it("collects emitted events", () => {
    const event: LoopEvent = {
      type: "state_changed",
      timestamp: "2025-06-15T10:00:00.000Z",
      data: { from: LoopState.STOPPED, to: LoopState.RUNNING },
    };

    sink.emit(event);
    expect(sink.getEvents()).toEqual([event]);
  });

  it("collects multiple events in order", () => {
    const event1: LoopEvent = {
      type: "state_changed",
      timestamp: "2025-06-15T10:00:00.000Z",
      data: { from: LoopState.STOPPED, to: LoopState.RUNNING },
    };
    const event2: LoopEvent = {
      type: "cycle_complete",
      timestamp: "2025-06-15T10:00:01.000Z",
      data: { cycleNumber: 1 },
    };

    sink.emit(event1);
    sink.emit(event2);

    expect(sink.getEvents()).toEqual([event1, event2]);
  });

  it("resets collected events", () => {
    sink.emit({
      type: "idle",
      timestamp: "2025-06-15T10:00:00.000Z",
      data: {},
    });
    expect(sink.getEvents()).toHaveLength(1);

    sink.reset();
    expect(sink.getEvents()).toEqual([]);
  });

  it("returns a copy of events (not the internal array)", () => {
    sink.emit({
      type: "idle",
      timestamp: "2025-06-15T10:00:00.000Z",
      data: {},
    });

    const events = sink.getEvents();
    events.push({
      type: "error",
      timestamp: "2025-06-15T10:00:01.000Z",
      data: {},
    });

    expect(sink.getEvents()).toHaveLength(1);
  });
});
