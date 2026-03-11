import * as path from "path";
import { IFileSystem } from "../substrate/abstractions/IFileSystem";

export interface CanaryRecord {
  timestamp: string;
  cycle: number;
  launcher: string;
  candidateCount: number;
  highPriorityConfidence: number | null;
  parseErrors: number;
  pass: boolean;
  trigger?: "idle" | "api";
}

/**
 * Appends Id cycle observability records to `data/canary-log.jsonl`.
 * Each record captures outcome metrics for a single Id.generateDrives() invocation,
 * enabling agents to verify canary gate criteria without shell access.
 */
export class CanaryLogger {
  constructor(
    private readonly fs: IFileSystem,
    private readonly filePath: string,
  ) {}

  async recordCycle(record: CanaryRecord): Promise<void> {
    const dir = path.dirname(this.filePath);
    await this.fs.mkdir(dir, { recursive: true });
    await this.fs.appendFile(this.filePath, JSON.stringify(record) + "\n");
  }
}
