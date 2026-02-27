import { ProcessLogEntry } from "../claude/ISessionLauncher";
import { EndorsementVerdict } from "./types";

export interface EndorsementInterceptResult {
  triggered: boolean;
  layer?: 1 | 2 | 3;
  action?: string;
  verdict?: EndorsementVerdict;
  matchedSection?: string;
  injectionMessage?: string;
}

export interface IEndorsementInterceptor {
  onLogEntry(entry: ProcessLogEntry): void;
  evaluateOutput(rawOutput: string): Promise<EndorsementInterceptResult>;
  reset(): void;
}
