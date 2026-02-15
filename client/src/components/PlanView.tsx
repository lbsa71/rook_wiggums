import { useState, useEffect } from "react";
import { apiGet } from "../hooks/useApi";
import { LoopEvent } from "../hooks/useWebSocket";
import { parsePlanTasks, PlanTask } from "../parsers/planParser";
import { TaskTree } from "./TaskTree";

interface SubstrateContent {
  rawMarkdown: string;
  meta: { fileType: string };
}

interface PlanViewProps {
  lastEvent: LoopEvent | null;
}

export function PlanView({ lastEvent }: PlanViewProps) {
  const [tasks, setTasks] = useState<PlanTask[]>([]);

  const fetchPlan = () => {
    apiGet<SubstrateContent>("/api/substrate/PLAN")
      .then((data) => setTasks(parsePlanTasks(data.rawMarkdown)))
      .catch(() => setTasks([]));
  };

  useEffect(() => { fetchPlan(); }, []);

  useEffect(() => {
    if (lastEvent?.type === "cycle_complete") {
      fetchPlan();
    }
  }, [lastEvent]);

  return (
    <div className="plan-view">
      <TaskTree tasks={tasks} />
    </div>
  );
}
