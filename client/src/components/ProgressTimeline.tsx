import { ProgressEntry } from "../parsers/progressParser";

const AGENT_COLORS: Record<string, string> = {
  EGO: "#00d4ff",
  SUBCONSCIOUS: "#4caf50",
  SUPEREGO: "#ffd700",
  ID: "#e040fb",
};

interface ProgressTimelineProps {
  entries: ProgressEntry[];
}

export function ProgressTimeline({ entries }: ProgressTimelineProps) {
  if (entries.length === 0) {
    return <p>No progress entries yet.</p>;
  }

  return (
    <div className="timeline">
      {entries.map((entry, i) => {
        const color = AGENT_COLORS[entry.agent] ?? "#888";
        return (
          <div key={i} className="timeline-entry">
            <div className="timeline-dot" style={{ backgroundColor: color }} />
            <div className="timeline-content">
              <div className="timeline-meta">
                {entry.agent && (
                  <span className="timeline-agent" style={{ color }}>
                    {entry.agent}
                  </span>
                )}
                <span className="timeline-time">{formatTime(entry.timestamp)}</span>
              </div>
              <div className="timeline-message">{entry.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}
