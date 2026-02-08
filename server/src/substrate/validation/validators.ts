import { SubstrateFileType } from "../types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSubstrateContent(
  content: string,
  fileType: SubstrateFileType
): ValidationResult {
  const errors: string[] = [];

  if (!content || content.trim().length === 0) {
    errors.push("Content must not be empty");
  }

  if (content && !content.trimStart().startsWith("# ")) {
    errors.push("Content must start with a # heading");
  }

  if (fileType === SubstrateFileType.PLAN && errors.length === 0) {
    if (!content.includes("\n## ")) {
      errors.push("PLAN must have at least one ## section");
    }
  }

  return { valid: errors.length === 0, errors };
}
