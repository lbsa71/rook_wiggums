import { IClock } from "../../substrate/abstractions/IClock";
import { SubstrateFileType } from "../../substrate/types";
import { SubstrateFileReader } from "../../substrate/io/FileReader";
import { PermissionChecker } from "../permissions";
import { PromptBuilder } from "../prompts/PromptBuilder";
import { ISessionLauncher, ProcessLogEntry } from "../claude/ISessionLauncher";
import { PlanParser } from "../parsers/PlanParser";
import { extractJson } from "../parsers/extractJson";
import { AgentRole, generateCorrelationId } from "../types";
import { TaskClassifier } from "../TaskClassifier";
import { DriveQualityTracker } from "../../evaluation/DriveQualityTracker";
import { RateLimitError } from "../../loop/RateLimitError";
import { isRateLimitText } from "../../loop/rateLimitParser";

export interface GoalCandidate {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  confidence: number; // 0-100: how certain the ID is that this goal is appropriate
  correlationId?: string;
}

export interface IdleDetectionResult {
  idle: boolean;
  reason: string;
}

export interface GenerateDrivesResult {
  candidates: GoalCandidate[];
  parseErrors: number;
}

export class Id {
  constructor(
    private readonly reader: SubstrateFileReader,
    private readonly checker: PermissionChecker,
    private readonly promptBuilder: PromptBuilder,
    private readonly sessionLauncher: ISessionLauncher,
    private readonly clock: IClock,
    private readonly taskClassifier: TaskClassifier,
    private readonly workingDirectory?: string,
    private readonly driveQualityTracker?: DriveQualityTracker
  ) {}

  async detectIdle(): Promise<IdleDetectionResult> {
    this.checker.assertCanRead(AgentRole.ID, SubstrateFileType.PLAN);
    const planContent = await this.reader.read(SubstrateFileType.PLAN);
    const tasks = PlanParser.parseTasks(planContent.rawMarkdown);

    if (PlanParser.isEmpty(tasks)) {
      return { idle: true, reason: "Plan is empty — no tasks defined" };
    }

    if (PlanParser.isComplete(tasks)) {
      return { idle: true, reason: "All tasks are complete" };
    }

    return { idle: false, reason: "Plan has pending tasks" };
  }

  async generateDrives(onLogEntry?: (entry: ProcessLogEntry) => void): Promise<GenerateDrivesResult> {
    try {
      const systemPrompt = this.promptBuilder.buildSystemPrompt(AgentRole.ID);
      const eagerRefs = await this.promptBuilder.getEagerReferences(AgentRole.ID);
      const lazyRefs = this.promptBuilder.getLazyReferences(AgentRole.ID);
      
      let message = this.promptBuilder.buildAgentMessage(eagerRefs, lazyRefs, "");

      if (this.driveQualityTracker) {
        const categoryStats = await this.driveQualityTracker.getCategoryStats();
        const statEntries = Object.entries(categoryStats);
        if (statEntries.length > 0) {
          const statsText = statEntries
            .map(([cat, s]) => `  ${cat}: ${s.avgRating.toFixed(1)}/10 avg (${s.count} task${s.count === 1 ? "" : "s"})`)
            .join("\n");
          message += `[DRIVE QUALITY]\nAverage ratings by category (higher is better):\n${statsText}\n\nPrioritize categories with higher historical ratings. Avoid repeatedly suggesting drives in consistently low-performing categories unless there is clear strategic reason.\n\n`;
        }
      }

      message += `Analyze the current state. Are we idle? What goals should we pursue?`;
      
      const model = this.taskClassifier.getModel({ role: AgentRole.ID, operation: "generateDrives" });
      const result = await this.sessionLauncher.launch({
        systemPrompt,
        message,
      }, { model, onLogEntry, cwd: this.workingDirectory, continueSession: true, persistSession: true });

      if (!result.success) {
        if (isRateLimitText(result.error)) throw new RateLimitError(result.error!);
        return { candidates: [], parseErrors: 0 };
      }

      try {
        const parsed = extractJson(result.rawOutput);
        if (!Array.isArray(parsed.goalCandidates)) {
          return { candidates: [], parseErrors: 1 };
        }

        const candidates = parsed.goalCandidates.map((c: GoalCandidate) => ({
          ...c,
          correlationId: generateCorrelationId(),
        }));
        return { candidates, parseErrors: 0 };
      } catch {
        return { candidates: [], parseErrors: 1 };
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      return { candidates: [], parseErrors: 0 };  // Id silently returns empty — errors surface through other agents
    }
  }
}
