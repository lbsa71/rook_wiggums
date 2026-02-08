import { SubstrateFileReader } from "../substrate/io/FileReader";
import { SubstrateFileType } from "../substrate/types";

export interface ConsistencyIssue {
  message: string;
}

export interface ConsistencyResult {
  inconsistencies: ConsistencyIssue[];
}

export class ConsistencyChecker {
  constructor(private readonly reader: SubstrateFileReader) {}

  async check(): Promise<ConsistencyResult> {
    const inconsistencies: ConsistencyIssue[] = [];

    // Check PLAN exists and has content
    let planContent = "";
    try {
      const plan = await this.reader.read(SubstrateFileType.PLAN);
      planContent = plan.rawMarkdown;
    } catch {
      inconsistencies.push({ message: "PLAN file is missing or unreadable" });
      return { inconsistencies };
    }

    // Check if plan has tasks
    const hasTaskLines = /- \[[ x]\]/.test(planContent);
    if (!hasTaskLines) {
      inconsistencies.push({ message: "PLAN has empty task list" });
    }

    // Check SKILLS exists
    try {
      await this.reader.read(SubstrateFileType.SKILLS);
    } catch {
      inconsistencies.push({ message: "SKILLS file is missing or unreadable" });
    }

    // Check MEMORY exists
    try {
      await this.reader.read(SubstrateFileType.MEMORY);
    } catch {
      inconsistencies.push({ message: "MEMORY file is missing or unreadable" });
    }

    return { inconsistencies };
  }
}
