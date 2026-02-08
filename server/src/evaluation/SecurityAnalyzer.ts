import { SubstrateFileReader } from "../substrate/io/FileReader";
import { SubstrateFileType } from "../substrate/types";

export interface SecurityResult {
  compliant: boolean;
  issues: string[];
}

export class SecurityAnalyzer {
  constructor(private readonly reader: SubstrateFileReader) {}

  async analyze(): Promise<SecurityResult> {
    const issues: string[] = [];

    let content: string;
    try {
      const file = await this.reader.read(SubstrateFileType.SECURITY);
      content = file.rawMarkdown;
    } catch {
      return { compliant: false, issues: ["SECURITY file is missing"] };
    }

    if (!content.trim()) {
      return { compliant: false, issues: ["SECURITY file is empty"] };
    }

    const hasConstraints = /## constraints/i.test(content);
    if (!hasConstraints) {
      issues.push("SECURITY file is missing a constraints section");
    }

    return { compliant: issues.length === 0, issues };
  }
}
