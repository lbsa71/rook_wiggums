import { SubstrateFileReader } from "../substrate/io/FileReader";
import { SubstrateFileType } from "../substrate/types";

export interface ReasoningIssue {
  message: string;
}

export interface ReasoningResult {
  valid: boolean;
  issues: ReasoningIssue[];
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "about", "between", "through", "after", "before",
  "and", "but", "or", "nor", "not", "no", "so", "if", "then",
  "that", "this", "it", "its", "we", "our", "they", "their",
]);

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return new Set(words.filter((w) => !STOP_WORDS.has(w)));
}

function extractGoal(planContent: string): string {
  const goalMatch = planContent.match(/## Current Goal\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  return goalMatch ? goalMatch[1].trim() : "";
}

export class ReasoningValidator {
  constructor(private readonly reader: SubstrateFileReader) {}

  async validate(): Promise<ReasoningResult> {
    const issues: ReasoningIssue[] = [];

    // Read PLAN
    let planContent: string;
    try {
      const plan = await this.reader.read(SubstrateFileType.PLAN);
      planContent = plan.rawMarkdown;
    } catch {
      return {
        valid: false,
        issues: [{ message: "PLAN file could not be read" }],
      };
    }

    // Extract goal keywords
    const goal = extractGoal(planContent);
    if (!goal) {
      return {
        valid: false,
        issues: [{ message: "PLAN has no current goal defined" }],
      };
    }

    const goalKeywords = extractKeywords(goal);
    if (goalKeywords.size === 0) {
      return {
        valid: false,
        issues: [{ message: "PLAN goal contains no meaningful keywords" }],
      };
    }

    // Read MEMORY and SKILLS
    let memoryContent = "";
    let skillsContent = "";

    try {
      const memory = await this.reader.read(SubstrateFileType.MEMORY);
      memoryContent = memory.rawMarkdown;
    } catch {
      // Missing memory is not fatal
    }

    try {
      const skills = await this.reader.read(SubstrateFileType.SKILLS);
      skillsContent = skills.rawMarkdown;
    } catch {
      // Missing skills is not fatal
    }

    // Check overlap between goal and supporting files
    const memoryKeywords = extractKeywords(memoryContent);
    const skillsKeywords = extractKeywords(skillsContent);

    const memoryOverlap = [...goalKeywords].filter((k) => memoryKeywords.has(k));
    const skillsOverlap = [...goalKeywords].filter((k) => skillsKeywords.has(k));

    const hasAnyOverlap = memoryOverlap.length > 0 || skillsOverlap.length > 0;

    if (!hasAnyOverlap) {
      issues.push({
        message: "Plan goal has no keyword overlap with MEMORY or SKILLS — possible disconnection",
      });
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
