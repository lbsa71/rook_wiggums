import { apiPost } from "../hooks/useApi";

interface LoopControlsProps {
  state: string;
  onStateChange: () => void;
}

export function LoopControls({ state, onStateChange }: LoopControlsProps) {
  const handleAction = async (action: string) => {
    try {
      await apiPost(`/api/loop/${action}`);
      onStateChange();
    } catch {
      // ignore errors — state will refresh
    }
  };

  return (
    <div className="loop-controls">
      <button
        onClick={() => handleAction("start")}
        disabled={state !== "STOPPED"}
      >
        Start
      </button>
      <button
        onClick={() => handleAction("pause")}
        disabled={state !== "RUNNING"}
      >
        Pause
      </button>
      <button
        onClick={() => handleAction("resume")}
        disabled={state !== "PAUSED"}
      >
        Resume
      </button>
      <button
        onClick={() => handleAction("stop")}
        disabled={state === "STOPPED"}
      >
        Stop
      </button>
    </div>
  );
}
