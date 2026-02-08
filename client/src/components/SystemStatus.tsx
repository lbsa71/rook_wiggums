import { useState, useEffect } from "react";
import { apiGet } from "../hooks/useApi";
import { LoopEvent } from "../hooks/useWebSocket";

interface LoopStatus {
  state: string;
  metrics: {
    totalCycles: number;
    successfulCycles: number;
    failedCycles: number;
    idleCycles: number;
    consecutiveIdleCycles: number;
    superegoAudits: number;
  };
}

interface SystemStatusProps {
  lastEvent: LoopEvent | null;
}

export function SystemStatus({ lastEvent }: SystemStatusProps) {
  const [status, setStatus] = useState<LoopStatus | null>(null);

  useEffect(() => {
    apiGet<LoopStatus>("/api/loop/status").then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "state_changed" || lastEvent?.type === "cycle_complete") {
      apiGet<LoopStatus>("/api/loop/status").then(setStatus).catch(() => {});
    }
  }, [lastEvent]);

  if (!status) return <div>Loading...</div>;

  return (
    <div className="system-status">
      <h2>System Status</h2>
      <div className="status-state" data-testid="loop-state">{status.state}</div>
      <div className="status-metrics">
        <span>Cycles: {status.metrics.totalCycles}</span>
        <span>Success: {status.metrics.successfulCycles}</span>
        <span>Failed: {status.metrics.failedCycles}</span>
        <span>Idle: {status.metrics.idleCycles}</span>
        <span>Audits: {status.metrics.superegoAudits}</span>
      </div>
    </div>
  );
}
