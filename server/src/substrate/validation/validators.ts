import { SubstrateFileType } from "../types";
import { detectSecrets, formatSecretErrors, redactSecrets } from "./SecretDetector";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Present only when secrets were detected and redacted */
  redactedContent?: string;
}

export function validateSubstrateContent(
  content: string,
  fileType: SubstrateFileType
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let redactedContent: string | undefined;

  if (!content || content.trim().length === 0) {
    errors.push("Content must not be empty");
  }

  if (content && !content.trimStart().startsWith("# ")) {
    errors.push("Content must start with a # heading");
  }

  if (fileType === SubstrateFileType.PLAN && errors.length === 0) {
    if (!content.includes("\n## ")) {
      errors.push("PLAN must have at least one ## section");
    } else if (!content.includes("\n## Tasks")) {
      errors.push("PLAN must have a ## Tasks section");
    }
  }

  // Secret detection: warn and redact, don't block
  const secretResult = detectSecrets(content);
  if (secretResult.hasSecrets) {
    warnings.push(...formatSecretErrors(secretResult));
    redactedContent = redactSecrets(content, secretResult);
  }

  return { valid: errors.length === 0, errors, warnings, redactedContent };
}
