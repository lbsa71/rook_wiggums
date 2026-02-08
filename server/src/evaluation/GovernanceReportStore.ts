import { IFileSystem } from "../substrate/abstractions/IFileSystem";
import { IClock } from "../substrate/abstractions/IClock";

export interface StoredReport {
  timestamp: string;
  findings: Array<{ severity: string; message: string }>;
  proposalEvaluations: Array<{ approved: boolean; reason: string }>;
  summary: string;
  [key: string]: unknown;
}

export class GovernanceReportStore {
  constructor(
    private readonly fs: IFileSystem,
    private readonly reportsDir: string,
    private readonly clock: IClock
  ) {}

  async save(report: Record<string, unknown>): Promise<void> {
    const timestamp = this.clock.now().toISOString();
    const filename = timestamp.replace(/:/g, "-") + ".json";
    const path = `${this.reportsDir}/${filename}`;
    const data = { ...report, timestamp };
    await this.fs.writeFile(path, JSON.stringify(data, null, 2));
  }

  async list(): Promise<StoredReport[]> {
    try {
      const entries = await this.fs.readdir(this.reportsDir);
      const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort().reverse();
      const reports: StoredReport[] = [];
      for (const file of jsonFiles) {
        const content = await this.fs.readFile(`${this.reportsDir}/${file}`);
        reports.push(JSON.parse(content));
      }
      return reports;
    } catch {
      return [];
    }
  }

  async latest(): Promise<StoredReport | null> {
    const reports = await this.list();
    return reports.length > 0 ? reports[0] : null;
  }
}
