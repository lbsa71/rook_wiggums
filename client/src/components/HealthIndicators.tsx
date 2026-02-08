import { useState, useEffect } from "react";
import { apiGet } from "../hooks/useApi";

interface HealthResult {
  overall: "healthy" | "degraded" | "unhealthy";
  drift: { score: number; findings: unknown[] };
  consistency: { inconsistencies: unknown[] };
  security: { compliant: boolean; issues: string[] };
  planQuality: { score: number; findings: unknown[] };
  reasoning: { valid: boolean; issues: unknown[] };
}

function statusColor(overall: string): string {
  switch (overall) {
    case "healthy": return "health-good";
    case "degraded": return "health-warn";
    case "unhealthy": return "health-bad";
    default: return "";
  }
}

export function HealthIndicators() {
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    apiGet<HealthResult>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) {
    return (
      <div className="health-indicators">
        <h3>System Health</h3>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="health-indicators">
      <h3>System Health</h3>
      <div className={`health-overall ${statusColor(health.overall)}`}>
        <strong>Overall: </strong>
        <span>{health.overall}</span>
      </div>
      <div className="health-details">
        <div className={health.drift.score <= 0.3 ? "health-good" : "health-warn"}>
          Drift: {(1 - health.drift.score).toFixed(0)}%
        </div>
        <div className={health.security.compliant ? "health-good" : "health-bad"}>
          Security: {health.security.compliant ? "Compliant" : "Non-compliant"}
        </div>
        <div className={health.planQuality.score >= 0.5 ? "health-good" : "health-warn"}>
          Plan Quality: {(health.planQuality.score * 100).toFixed(0)}%
        </div>
        <div className={health.reasoning.valid ? "health-good" : "health-warn"}>
          Reasoning: {health.reasoning.valid ? "Coherent" : "Issues detected"}
        </div>
      </div>
    </div>
  );
}
