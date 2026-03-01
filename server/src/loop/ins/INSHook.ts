import { SubstrateFileReader } from "../../substrate/io/FileReader";
import { SubstrateFileType } from "../../substrate/types";
import { IFileSystem } from "../../substrate/abstractions/IFileSystem";
import { IClock } from "../../substrate/abstractions/IClock";
import { ILogger } from "../../logging";
import { INSResult, INSAction, INSConfig } from "./types";
import { ComplianceStateManager } from "./ComplianceStateManager";

/** Precondition extraction patterns — matches common blocking language in task summaries */
const PRECONDITION_PATTERNS = [
  /(?:blocked by|waiting for|precondition:|awaiting|depends on|gated on)\s*["""]?(.+?)["""]?\s*$/im,
  /(?:cannot proceed|unable to continue).*?(?:until|because)\s+(.+?)$/im,
];

/**
 * INS (Involuntary Nervous System) Phase 1: Rule Layer.
 *
 * Deterministic pre-cycle hook that runs five substrate health checks.
 * No model calls. Never throws. Returns INSResult with zero or more actions.
 *
 * Rules:
 * 1. CONVERSATION.md line count > threshold → compaction flag
 * 2. PROGRESS.md line count > threshold → compaction flag
 * 3. MEMORY.md char count > threshold → compaction flag
 * 4. Consecutive partial results with same precondition → compliance flag
 * 5. Files in memory/ older than N days with SUPERSEDED marker → archive flag
 *
 * Budget: < 500ms total. Noop cycles produce zero I/O.
 */
export class INSHook {
  constructor(
    private readonly reader: SubstrateFileReader,
    private readonly fs: IFileSystem,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly config: INSConfig,
    private readonly complianceState: ComplianceStateManager,
  ) {}

  async evaluate(
    cycleNumber: number,
    lastTaskResult?: { result: string; summary?: string },
  ): Promise<INSResult> {
    const actions: INSAction[] = [];

    try {
      // Rule 1: CONVERSATION.md compaction
      const convAction = await this.checkFileLineCount(
        SubstrateFileType.CONVERSATION,
        "CONVERSATION.md",
        this.config.conversationLineThreshold,
      );
      if (convAction) actions.push(convAction);

      // Rule 2: PROGRESS.md compaction
      const progAction = await this.checkFileLineCount(
        SubstrateFileType.PROGRESS,
        "PROGRESS.md",
        this.config.progressLineThreshold,
      );
      if (progAction) actions.push(progAction);

      // Rule 3: MEMORY.md size
      const memAction = await this.checkMemorySize();
      if (memAction) actions.push(memAction);

      // Rule 4: Consecutive-partial detection
      const partialAction = await this.checkConsecutivePartials(cycleNumber, lastTaskResult);
      if (partialAction) actions.push(partialAction);

      // Rule 5: Archive candidates
      const archiveActions = await this.checkArchiveCandidates();
      actions.push(...archiveActions);
    } catch (err) {
      // INS never blocks the cycle
      this.logger.debug(
        `ins: evaluate failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return { noop: true, actions: [] };
    }

    if (actions.length > 0) {
      this.logger.debug(
        `ins: cycle ${cycleNumber} — ${actions.length} action(s): ${actions.map((a) => a.type).join(", ")}`,
      );
    }

    return { noop: actions.length === 0, actions };
  }

  // --- Private rule methods ---

  private async checkFileLineCount(
    fileType: SubstrateFileType,
    fileName: string,
    threshold: number,
  ): Promise<INSAction | null> {
    try {
      const content = await this.reader.read(fileType);
      const lineCount = content.rawMarkdown.split("\n").length;
      if (lineCount > threshold) {
        return {
          type: "compaction",
          target: fileName,
          detail: `Line count ${lineCount} exceeds threshold ${threshold} — compaction recommended`,
        };
      }
    } catch {
      // File might not exist — not an error
    }
    return null;
  }

  private async checkMemorySize(): Promise<INSAction | null> {
    try {
      const content = await this.reader.read(SubstrateFileType.MEMORY);
      const charCount = content.rawMarkdown.length;
      if (charCount > this.config.memoryCharThreshold) {
        const estimatedTokens = Math.round(charCount / 4);
        return {
          type: "compaction",
          target: "MEMORY.md",
          detail: `Character count ${charCount} (~${estimatedTokens} tokens) exceeds threshold — summary recommended`,
        };
      }
    } catch {
      // File might not exist
    }
    return null;
  }

  private async checkConsecutivePartials(
    cycleNumber: number,
    lastTaskResult?: { result: string; summary?: string },
  ): Promise<INSAction | null> {
    if (!lastTaskResult) return null;

    if (lastTaskResult.result === "partial") {
      const precondition = this.extractPrecondition(lastTaskResult.summary);
      if (precondition) {
        this.complianceState.recordPartial(precondition, cycleNumber);
        const count = this.complianceState.getPartialCount(precondition);
        if (count >= this.config.consecutivePartialThreshold) {
          await this.complianceState.save();
          return {
            type: "compliance_flag",
            target: "Ego",
            detail: `Consecutive-partial pattern detected (${count} cycles). Stated precondition: "${precondition}". Possible constructed constraint — examine whether this precondition is real.`,
            flaggedPattern: precondition,
          };
        }
        await this.complianceState.save();
      }
    } else if (lastTaskResult.result === "success") {
      // Success clears all partial tracking
      this.complianceState.clearAll();
      if (this.complianceState.isDirty()) {
        await this.complianceState.save();
      }
    }

    return null;
  }

  private extractPrecondition(summary?: string): string | null {
    if (!summary) return null;
    for (const pattern of PRECONDITION_PATTERNS) {
      const match = summary.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  private async checkArchiveCandidates(): Promise<INSAction[]> {
    const actions: INSAction[] = [];
    try {
      const dirExists = await this.fs.exists(this.config.memoryPath);
      if (!dirExists) return actions;

      const entries = await this.fs.readdir(this.config.memoryPath);
      // Performance guard: skip if too many files
      if (entries.length > 100) {
        this.logger.debug(`ins: memory/ has ${entries.length} files — skipping archive scan (>100)`);
        return actions;
      }

      const now = this.clock.now().getTime();
      const ageThresholdMs = this.config.archiveAgeDays * 24 * 60 * 60 * 1000;

      for (const entry of entries) {
        const filePath = `${this.config.memoryPath}/${entry}`;
        try {
          const stat = await this.fs.stat(filePath);
          if (!stat.isFile) continue;

          // Two-pass: check age first, then read content only for old files
          const ageMs = now - stat.mtimeMs;
          if (ageMs < ageThresholdMs) continue;

          const content = await this.fs.readFile(filePath);
          if (/SUPERSEDED/i.test(content)) {
            const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000));
            actions.push({
              type: "archive_tag",
              target: entry,
              detail: `File is ${ageDays} days old and contains SUPERSEDED marker — archive candidate`,
            });
          }
        } catch {
          // Individual file errors are not fatal
        }
      }
    } catch {
      // Directory read errors are not fatal
    }
    return actions;
  }
}
