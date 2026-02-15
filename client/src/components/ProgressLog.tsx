import { useState, useEffect, useRef } from "react";
import { apiGet } from "../hooks/useApi";
import { LoopEvent } from "../hooks/useWebSocket";
import { parseProgressEntries, ProgressEntry } from "../parsers/progressParser";
import { ProgressTimeline } from "./ProgressTimeline";

interface SubstrateContent {
  rawMarkdown: string;
}

interface ProgressLogProps {
  lastEvent: LoopEvent | null;
}

export function ProgressLog({ lastEvent }: ProgressLogProps) {
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchProgress = () => {
    apiGet<SubstrateContent>("/api/substrate/PROGRESS")
      .then((data) => {
        setEntries(parseProgressEntries(data.rawMarkdown).reverse());
      })
      .catch(() => {});
  };

  useEffect(() => { fetchProgress(); }, []);

  useEffect(() => {
    if (lastEvent?.type === "cycle_complete") {
      fetchProgress();
    }
  }, [lastEvent]);

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [entries]);

  return (
    <div className="progress-log">
      <div ref={containerRef} className="progress-entries" data-testid="progress-entries">
        <ProgressTimeline entries={entries} />
      </div>
    </div>
  );
}
