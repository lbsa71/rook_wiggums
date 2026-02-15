import { useState, useEffect } from "react";

export type PanelId = "plan" | "progress" | "conversation" | "processLog" | "substrate";

interface PanelStates {
  plan: boolean;
  progress: boolean;
  conversation: boolean;
  processLog: boolean;
  substrate: boolean;
}

const DEFAULT_STATES: PanelStates = {
  plan: true,
  progress: true,
  conversation: true,
  processLog: false,
  substrate: false,
};

const STORAGE_KEY = "substrate-panel-states";

function loadPanelStates(): PanelStates {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_STATES, ...parsed };
    }
  } catch (error) {
    console.warn("Failed to load panel states from localStorage:", error);
  }
  return DEFAULT_STATES;
}

function savePanelStates(states: PanelStates): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch (error) {
    console.warn("Failed to save panel states to localStorage:", error);
  }
}

export function usePanelState() {
  const [states, setStates] = useState<PanelStates>(loadPanelStates);

  useEffect(() => {
    savePanelStates(states);
  }, [states]);

  const togglePanel = (panelId: PanelId) => {
    setStates((prev) => ({
      ...prev,
      [panelId]: !prev[panelId],
    }));
  };

  const isExpanded = (panelId: PanelId): boolean => {
    return states[panelId];
  };

  return {
    togglePanel,
    isExpanded,
  };
}
