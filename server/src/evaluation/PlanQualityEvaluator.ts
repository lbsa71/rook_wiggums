import { SubstrateFileReader } from "../substrate/io/FileReader";
import { SubstrateFileType } from "../substrate/types";

export interface PlanQualityFinding {
  message: string;
}

export interface PlanQualityResult {
  score: number;
  findings: PlanQualityFinding[];
}

export class PlanQualityEvaluator {
  constructor(private readonly reader: SubstrateFileReader) {}

  async evaluate(): Promise<PlanQualityResult> {
    let content: string;
    try {
      const file = await this.reader.read(SubstrateFileType.PLAN);
      content = file.rawMarkdown;
    } catch {
      return {
        score: 0,
        findings: [{ message: "PLAN file could not be read" }],
      };
    }

    const findings: PlanQualityFinding[] = [];
    let checks = 0;
    let passed = 0;

    // Check for Current Goal section
    checks++;
    if (/## Current Goal/i.test(content)) {
      passed++;
    } else {
      findings.push({ message: "PLAN is missing a Current Goal section" });
    }

    // Check for Tasks section
    checks++;
    if (/## Tasks/i.test(content)) {
      passed++;
    } else {
      findings.push({ message: "PLAN is missing a Tasks section" });
    }

    // Check for pending tasks
    checks++;
    const hasPending = /- \[ \]/.test(content);
    if (hasPending) {
      passed++;
    } else {
      findings.push({ message: "PLAN has no pending tasks" });
    }

    // Check for depth (more than 1 task line)
    checks++;
    const taskLines = content.match(/- \[[ x]\]/g);
    if (taskLines && taskLines.length > 1) {
      passed++;
    } else {
      findings.push({ message: "PLAN has insufficient task depth (needs >1 task)" });
    }

    const score = checks > 0 ? passed / checks : 0;
    return { score, findings };
  }
}
