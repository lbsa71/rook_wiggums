import { createHash } from "node:crypto";
import type {
  ClaudeSessionRequest,
  LaunchOptions,
  SessionUsageContext,
} from "../claude/ISessionLauncher";

export const PROMPT_TOKEN_CATEGORIES = [
  "identity",
  "relationships",
  "memory",
  "operationalState",
  "toolInstructions",
  "roteKnowledge",
] as const;

export type PromptTokenCategory = (typeof PROMPT_TOKEN_CATEGORIES)[number];

export interface PromptCategoryAttribution {
  characters: number;
  estimatedTokens: number;
  share: number;
}

export interface PromptDuplicateEstimate {
  /** Fixed normalized lexical-unit window used for the conservative estimate. */
  shingleSize: number;
  duplicateEstimatedTokens: number;
  duplicateShare: number;
  crossCategoryDuplicateEstimatedTokens: number;
  byCategory: Record<PromptTokenCategory, number>;
}

export interface PromptTokenProfile {
  schemaVersion: 1;
  estimator: "lexical_units_v1";
  role?: string;
  operation?: string;
  model?: string;
  promptSha256: string;
  systemPromptSha256: string;
  messageSha256: string;
  totalCharacters: number;
  totalEstimatedTokens: number;
  categories: Record<PromptTokenCategory, PromptCategoryAttribution>;
  duplicateContent: PromptDuplicateEstimate;
}

interface CategorizedText {
  category: PromptTokenCategory;
  text: string;
}

interface TokenUnit {
  normalized: string;
  category: PromptTokenCategory;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_]+|[^\s]/gu;
const DUPLICATE_SHINGLE_SIZE = 8;

const FILE_CATEGORIES: ReadonlyArray<readonly [RegExp, PromptTokenCategory]> = [
  [/\b(?:ID|VALUES)\.md\b/, "identity"],
  [/\b(?:PEERS|CONVERSATION)\.md\b/, "relationships"],
  [/\b(?:MEMORY|HABITS)\.md\b/, "memory"],
  [/\b(?:PLAN|OPERATING_CONTEXT|PROGRESS|SECURITY|BOUNDARIES|ESCALATE_TO_STEFAN)\.md\b/, "operationalState"],
  [/\b(?:SKILLS|CHARTER|AGENTS|SUPEREGO)\.md\b/, "roteKnowledge"],
];

function emptyCategoryCounts(): Record<PromptTokenCategory, number> {
  return {
    identity: 0,
    relationships: 0,
    memory: 0,
    operationalState: 0,
    toolInstructions: 0,
    roteKnowledge: 0,
  };
}

function lexicalUnits(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

function categoryForFileReference(line: string): PromptTokenCategory | undefined {
  return FILE_CATEGORIES.find(([pattern]) => pattern.test(line))?.[1];
}

function splitPreservingNewlines(text: string): string[] {
  return text.match(/.*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function categorizeSystemPrompt(systemPrompt: string): CategorizedText[] {
  const segments: CategorizedText[] = [];
  let category: PromptTokenCategory = "roteKnowledge";
  let sawRoleIdentity = false;

  for (const line of splitPreservingNewlines(systemPrompt)) {
    if (line.startsWith("=== ENVIRONMENT ===")) {
      category = "operationalState";
    } else if (line.startsWith("=== TOOL REFERENCE ===")) {
      category = "toolInstructions";
    } else if (line.startsWith("=== AUTONOMY REMINDER ===") || line.startsWith("=== ENDORSEMENT CHECK ===")) {
      category = "roteKnowledge";
    } else if (line.startsWith("=== MESSAGE MODE ===")) {
      category = "relationships";
    }

    const fileCategory = categoryForFileReference(line);
    let lineCategory = fileCategory ?? category;
    if (!sawRoleIdentity && line.startsWith("You are the ")) {
      lineCategory = "identity";
      sawRoleIdentity = true;
    }
    segments.push({ category: lineCategory, text: line });
  }

  return segments;
}

function categorizeMessage(message: string): CategorizedText[] {
  const segments: CategorizedText[] = [];
  let category: PromptTokenCategory = "operationalState";

  for (const line of splitPreservingNewlines(message)) {
    if (line.startsWith("[REQUIRED FILES") || line.startsWith("[FILES — read on demand]")) {
      category = "roteKnowledge";
    } else if (line.startsWith("[RUNTIME STATE]") || line.startsWith("[TASK]")) {
      category = "operationalState";
    } else if (line.startsWith("[PENDING MESSAGES")) {
      category = "relationships";
    }

    const fileCategory = categoryForFileReference(line);
    segments.push({ category: fileCategory ?? category, text: line });
  }

  return segments;
}

function categorize(request: ClaudeSessionRequest): CategorizedText[] {
  return [
    ...categorizeSystemPrompt(request.systemPrompt),
    ...categorizeMessage(request.message),
  ];
}

function duplicateEstimate(tokens: TokenUnit[]): PromptDuplicateEstimate {
  const duplicatePositions = new Set<number>();
  const crossCategoryPositions = new Set<number>();
  const firstCategoryByShingle = new Map<string, PromptTokenCategory>();

  for (let start = 0; start <= tokens.length - DUPLICATE_SHINGLE_SIZE; start += 1) {
    const window = tokens.slice(start, start + DUPLICATE_SHINGLE_SIZE);
    const shingle = window.map((token) => token.normalized).join("\u0001");
    const firstCategory = firstCategoryByShingle.get(shingle);
    if (firstCategory === undefined) {
      firstCategoryByShingle.set(shingle, window[0].category);
      continue;
    }

    for (let offset = 0; offset < DUPLICATE_SHINGLE_SIZE; offset += 1) {
      const position = start + offset;
      duplicatePositions.add(position);
      if (tokens[position].category !== firstCategory) {
        crossCategoryPositions.add(position);
      }
    }
  }

  const byCategory = emptyCategoryCounts();
  for (const position of duplicatePositions) {
    byCategory[tokens[position].category] += 1;
  }

  return {
    shingleSize: DUPLICATE_SHINGLE_SIZE,
    duplicateEstimatedTokens: duplicatePositions.size,
    duplicateShare: tokens.length === 0 ? 0 : duplicatePositions.size / tokens.length,
    crossCategoryDuplicateEstimatedTokens: crossCategoryPositions.size,
    byCategory,
  };
}

/**
 * Tokenizer-independent prompt attribution for relative context-cost measurement.
 * "estimatedTokens" are normalized lexical units, not provider billing tokens; the
 * estimator name is emitted in every report so measurements cannot be mistaken for
 * exact model-token counts.
 */
export class PromptTokenProfiler {
  profile(
    request: ClaudeSessionRequest,
    options?: Pick<LaunchOptions, "model" | "usageContext">,
  ): PromptTokenProfile {
    const categorized = categorize(request);
    const characterCounts = emptyCategoryCounts();
    const tokenCounts = emptyCategoryCounts();
    const tokens: TokenUnit[] = [];

    for (const segment of categorized) {
      characterCounts[segment.category] += segment.text.length;
      for (const token of lexicalUnits(segment.text)) {
        tokenCounts[segment.category] += 1;
        tokens.push({ normalized: token.toLocaleLowerCase("en-US"), category: segment.category });
      }
    }

    const totalCharacters = request.systemPrompt.length + request.message.length;
    const totalEstimatedTokens = tokens.length;
    const categories = Object.fromEntries(
      PROMPT_TOKEN_CATEGORIES.map((category) => [category, {
        characters: characterCounts[category],
        estimatedTokens: tokenCounts[category],
        share: totalEstimatedTokens === 0 ? 0 : tokenCounts[category] / totalEstimatedTokens,
      }]),
    ) as Record<PromptTokenCategory, PromptCategoryAttribution>;

    return {
      schemaVersion: 1,
      estimator: "lexical_units_v1",
      role: options?.usageContext?.role,
      operation: options?.usageContext?.operation,
      model: options?.model,
      promptSha256: createHash("sha256")
        .update(request.systemPrompt)
        .update("\u0000")
        .update(request.message)
        .digest("hex"),
      systemPromptSha256: createHash("sha256").update(request.systemPrompt).digest("hex"),
      messageSha256: createHash("sha256").update(request.message).digest("hex"),
      totalCharacters,
      totalEstimatedTokens,
      categories,
      duplicateContent: duplicateEstimate(tokens),
    };
  }
}

export interface PromptProfileObserver {
  observe(profile: PromptTokenProfile, context?: SessionUsageContext): void;
}
