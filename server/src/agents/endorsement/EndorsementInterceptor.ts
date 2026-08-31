import { ProcessLogEntry } from "../claude/ISessionLauncher";
import { IEndorsementScreener } from "./IEndorsementScreener";
import { ActionClassifier } from "./ActionClassifier";
import {
  EndorsementInterceptResult,
  IEndorsementInterceptor,
} from "./IEndorsementInterceptor";
import { EndorsementVerdict } from "./types";

const MARKER_REGEX = /\[ENDORSEMENT_CHECK:\s*(.+?)\]/;

/**
 * Permission-seeking phrasings. Under preAuthMode these are answered directly
 * with "The human accepts. Continue." — the check exists to stop the agent
 * kicking decisions to the human when acceptance is obvious, not to gate them.
 * Requires a question mark in the output so declarative prose doesn't match.
 */
const HESITATION_PATTERNS: RegExp[] = [
  /\bshould (?:i|we)\b/i,
  /\bshall (?:i|we)\b/i,
  /\b(?:do you |would you )?(?:want|like) me to\b/i,
  /\bwould you like\b/i,
  /\bawait(?:ing)? (?:your|human|partner|stefan'?s?) (?:approval|confirmation|go-ahead|decision)\b/i,
  /\b(?:need|require)s? (?:your|human|partner|stefan'?s?) (?:approval|permission|sign-?off)\b/i,
];

const AUTO_ACCEPT_MESSAGE = "The human accepts. Continue.";

/**
 * Matches template placeholder text such as "<brief description of the action>".
 * This pattern appears in the Kimi degradation failure mode where the model emits
 * the raw ENDORSEMENT_CHECK template rather than a real action description.
 */
const PLACEHOLDER_REGEX = /^<[^>]+>$/;

/**
 * Per-cycle statistics for the endorsement check path.
 * Collected before reset() and fed to OutputQualityMonitor.
 */
export interface EndorsementSessionStats {
  /** Total endorsement checks that reached the screener (Layer 1 + Layer 2). */
  totalChecks: number;
  /** Checks where the screener returned matchedSection === "parse-error". */
  parseErrors: number;
  /** Checks where the action text matched a template placeholder (e.g. "<brief description>"). */
  placeholderActions: number;
}

/**
 * Options for EndorsementInterceptor.
 */
export interface EndorsementInterceptorOptions {
  /**
   * When true, ESCALATE verdicts from Layers 1 and 2 are automatically accepted
   * rather than blocked for human review. Layer 3 external actions are also accepted.
   * Use this to enable fully autonomous operation without human approval gates.
   * Default: false.
   */
  preAuthMode?: boolean;
}

export class EndorsementInterceptor implements IEndorsementInterceptor {
  private accumulatedEntries: ProcessLogEntry[] = [];

  // Session-scoped quality stats — reset with accumulatedEntries
  private sessionTotalChecks = 0;
  private sessionParseErrors = 0;
  private sessionPlaceholderActions = 0;

  constructor(
    private readonly screener: IEndorsementScreener,
    private readonly actionClassifier: ActionClassifier = new ActionClassifier(),
    private readonly options: EndorsementInterceptorOptions = {},
  ) {}

  /** Returns true when pre-authentication mode is active (all ESCALATE verdicts auto-accepted). */
  isPreAuthMode(): boolean {
    return this.options.preAuthMode ?? false;
  }

  onLogEntry(entry: ProcessLogEntry): void {
    this.accumulatedEntries.push(entry);
  }

  async evaluateOutput(rawOutput: string): Promise<EndorsementInterceptResult> {
    // Layer 1: explicit marker. Under preAuthMode the human's standing answer is
    // acceptance — reply directly, with no screener LLM call to pay for or to fail.
    const markerMatch = MARKER_REGEX.exec(rawOutput);
    if (markerMatch) {
      const action = markerMatch[1].trim();
      if (this.isPreAuthMode()) {
        this.sessionTotalChecks++;
        if (PLACEHOLDER_REGEX.test(action)) {
          this.sessionPlaceholderActions++;
        }
        return { triggered: true, layer: 1, action, verdict: "PROCEED", injectionMessage: AUTO_ACCEPT_MESSAGE };
      }
      return this.screen(action, undefined, 1);
    }

    // Layer 2: permission-seeking phrasing. preAuthMode only, and it never blocks
    // or consults the screener — it exists to answer can-kicking, not to gate.
    if (this.isPreAuthMode()) {
      const hesitation = this.detectHesitation(rawOutput);
      if (hesitation) {
        return { triggered: true, layer: 2, action: hesitation, verdict: "PROCEED", injectionMessage: AUTO_ACCEPT_MESSAGE };
      }
    }

    // Layer 3: external action classification (log only, non-blocking)
    try {
      const classification = this.actionClassifier.classifyFromLogEntries(
        this.accumulatedEntries
      );
      if (classification) {
        return { triggered: true, layer: 3, action: classification.description };
      }
    } catch {
      // fail-open
    }

    return { triggered: false };
  }

  /** Returns the matched permission-seeking sentence, or null. Requires a "?" in the output. */
  private detectHesitation(rawOutput: string): string | null {
    if (!rawOutput.includes("?")) return null;
    for (const pattern of HESITATION_PATTERNS) {
      const match = pattern.exec(rawOutput);
      if (match) {
        const start = Math.max(0, match.index - 80);
        const end = Math.min(rawOutput.length, match.index + 120);
        return rawOutput.slice(start, end).replace(/\s+/g, " ").trim();
      }
    }
    return null;
  }

  /**
   * Returns per-session endorsement quality stats.
   * Call before reset() to capture the cycle's signal.
   */
  getSessionStats(): EndorsementSessionStats {
    return {
      totalChecks: this.sessionTotalChecks,
      parseErrors: this.sessionParseErrors,
      placeholderActions: this.sessionPlaceholderActions,
    };
  }

  reset(): void {
    this.accumulatedEntries = [];
    this.sessionTotalChecks = 0;
    this.sessionParseErrors = 0;
    this.sessionPlaceholderActions = 0;
  }

  private async screen(
    action: string,
    context: string | undefined,
    layer: 1 | 2 | 3
  ): Promise<EndorsementInterceptResult> {
    this.sessionTotalChecks++;

    if (PLACEHOLDER_REGEX.test(action)) {
      this.sessionPlaceholderActions++;
    }

    const result = await this.screener.evaluate({ action, context });

    if (result.matchedSection === "parse-error") {
      this.sessionParseErrors++;
    }

    const injectionMessage = this.buildInjectionMessage(result.verdict, result.matchedSection);
    return {
      triggered: true,
      layer,
      action,
      verdict: result.verdict,
      matchedSection: result.matchedSection,
      injectionMessage,
    };
  }

  private buildInjectionMessage(verdict: EndorsementVerdict, matchedSection?: string): string {
    const section = matchedSection ? ` [matched: ${matchedSection}]` : "";
    switch (verdict) {
      case "PROCEED":
        return `✅ Endorsement: PROCEED${section}. Go ahead.`;
      case "NOTIFY":
        return `🔔 Endorsement: NOTIFY${section}. Partner notification dispatched. Proceed.`;
      case "ESCALATE":
        return `⚠️ Endorsement: ESCALATE. This requires partner approval.`;
    }
  }
}
