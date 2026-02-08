import { SubstrateFileReader } from "../substrate/io/FileReader";
import { SubstrateFileType } from "../substrate/types";

export interface DriftFinding {
  fileType: string;
  message: string;
}

export interface DriftResult {
  score: number;
  findings: DriftFinding[];
}

const REQUIRED_HEADINGS: Partial<Record<SubstrateFileType, string>> = {
  [SubstrateFileType.PLAN]: "# Plan",
  [SubstrateFileType.VALUES]: "# Values",
  [SubstrateFileType.SECURITY]: "# Security",
  [SubstrateFileType.CHARTER]: "# Charter",
  [SubstrateFileType.MEMORY]: "# Memory",
};

const FILES_TO_CHECK: SubstrateFileType[] = [
  SubstrateFileType.PLAN,
  SubstrateFileType.VALUES,
  SubstrateFileType.SECURITY,
  SubstrateFileType.CHARTER,
  SubstrateFileType.MEMORY,
];

export class DriftAnalyzer {
  constructor(private readonly reader: SubstrateFileReader) {}

  async analyze(): Promise<DriftResult> {
    const findings: DriftFinding[] = [];
    let checked = 0;
    let drifted = 0;

    for (const fileType of FILES_TO_CHECK) {
      checked++;
      try {
        const content = await this.reader.read(fileType);
        const raw = content.rawMarkdown.trim();

        if (!raw) {
          drifted++;
          findings.push({ fileType, message: `${fileType} file is empty` });
          continue;
        }

        const expectedHeading = REQUIRED_HEADINGS[fileType];
        if (expectedHeading && !raw.startsWith(expectedHeading)) {
          drifted++;
          findings.push({
            fileType,
            message: `${fileType} missing expected heading: "${expectedHeading}"`,
          });
        }
      } catch {
        drifted++;
        findings.push({ fileType, message: `${fileType} file could not be read` });
      }
    }

    const score = checked > 0 ? drifted / checked : 0;
    return { score, findings };
  }
}
