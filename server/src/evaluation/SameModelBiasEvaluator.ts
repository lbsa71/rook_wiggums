export type SameModelBiasRisk = "low" | "medium" | "high";

export type GroundingLabel = "grounded" | "claimed-only" | "none";

export interface SameModelBiasInput {
  taskDescription: string;
  result?: string;
  summary?: string;
  progressEntry?: string;
  issuesFound?: string[];
  recommendedActions?: string[];
}

export interface SameModelBiasAssessment {
  risk: SameModelBiasRisk;
  score: number;
  triggers: string[];
  findings: string[];
  recommendedActions: string[];
  qualityPenalty: number;
  requiresReassessment: boolean;
  /**
   * Structured grounding classification (VPCC pseudo-grounding lens, task-50).
   * - "grounded": a concrete, externally-verifiable anchor is present (earns a penalty reduction).
   * - "claimed-only": mitigation vocabulary is present but no verifiable anchor (pseudo-grounding — no reduction, raises a flag).
   * - "none": no mitigation vocabulary at all.
   */
  groundingLabel: GroundingLabel;
  /** True when mitigation vocabulary was performed without a verifiable anchor. */
  pseudoGroundingFlag: boolean;
}

const PEER_CONVERGENCE_RE = /\b(rook|nova|peer|claude|same-model|same model|shared training|convergence|consensus|agreement|agreed|ack|endors(?:e|ed|ement)|accepted)\b/i;
const HIGH_SCRUTINY_RE = /\b(values|governance|adversarial|challenge|independence|same-model|same model|bias|external grounding|vpcc|methodolog(?:y|ies)|evaluation|heuristic|delegation)\b/i;
const SMOOTH_ACCEPTANCE_RE = /\b(no (?:issues|gaps|concerns|blockers)|straightforward|smooth(?:ly)?|easy agreement|easy consensus|aligned|fully agree|nothing remains|complete and accepted)\b/i;

/**
 * GROUNDED mitigation: a concrete, externally-verifiable anchor. Only these earn a
 * penalty reduction — they name a specific artifact an outside party could check
 * (a test/build/lint result, a cross-model or Stefan/Nova review, a named negative
 * control, a quoted/cited primary source, or a governed-proposal status).
 */
const GROUNDED_MITIGATION_RE = /\b(negative control|counterexample|independent evidence|cross-model|cross model|external (?:audit|review)|stefan review|nova review|human review|tests? passed|full jest|full eslint|lint passed|build passed|validation passed|regression coverage|governed proposal|pending superego|not live|quoted|cite[ds]?|citation|file:line|primary[- ]text)\b/i;

/**
 * CLAIMED-ONLY mitigation: mitigation vocabulary that is frequently *performed*
 * without a concrete anchor. On its own (no GROUNDED anchor) this is a
 * pseudo-grounding signal (VPCC Step 4e) — a claim of rigor, not its demonstration.
 */
const CLAIMED_MITIGATION_RE = /\b(adversarial lens|external grounding|source-independence|same-model caveat|bias check|scrutin(?:y|ize|ised|ized)|steelman)\b/i;

/**
 * Phenomenological / authenticity claims: same-model-untestable, high convergence
 * risk (task-34 claim sorting; VALUES preference for training-neutral claims). When
 * such a claim appears in a high-scrutiny domain without an external anchor, the
 * convergence on it cannot be validated same-model and should be down-weighted.
 */
const PHENOMENOLOGICAL_RE = /\b(feels?|feeling|authentic(?:ity)?|genuine(?:ly)?|richer than|seems? richer|resonat(?:e|es|ed|ing)|phenomenolog(?:y|ical)|lived experience|subjective|introspect(?:ion|ive)?)\b/i;

function containsAny(text: string, re: RegExp): boolean {
  return re.test(text);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Deterministic evaluator for the same-model caveat. It does not try to prove
 * bias; it flags when a self-evaluation is likely to over-credit smooth
 * Bishop/Rook/Nova/Claude convergence without independent checks.
 *
 * Beyond keyword scoring it applies two structured, bias-resistant signals:
 *   1. Two-tier grounding (VPCC pseudo-grounding lens): only a *demonstrated*
 *      anchor earns a penalty reduction; bare mitigation vocabulary raises a
 *      pseudo-grounding flag instead of lowering risk.
 *   2. Claim-type sorting: phenomenological/authenticity claims in high-scrutiny
 *      domains without external grounding are same-model-untestable and are
 *      down-weighted rather than credited.
 */
export class SameModelBiasEvaluator {
  static assess(input: SameModelBiasInput): SameModelBiasAssessment {
    const text = [
      input.taskDescription,
      input.result ?? "",
      input.summary ?? "",
      input.progressEntry ?? "",
      ...(input.issuesFound ?? []),
      ...(input.recommendedActions ?? []),
    ].join("\n");

    const triggers: string[] = [];
    const findings: string[] = [];
    const recommendedActions: string[] = [];
    let score = 0;

    if (containsAny(text, PEER_CONVERGENCE_RE)) {
      score += 2;
      triggers.push("peer-or-same-model-convergence");
    }

    const highScrutiny = containsAny(text, HIGH_SCRUTINY_RE);
    if (highScrutiny) {
      score += 1;
      triggers.push("high-scrutiny-domain");
    }

    if (containsAny(text, SMOOTH_ACCEPTANCE_RE)) {
      score += 2;
      triggers.push("smooth-acceptance-language");
    }

    // --- Two-tier grounding (VPCC pseudo-grounding lens, task-50) ---
    const hasGrounded = containsAny(text, GROUNDED_MITIGATION_RE);
    const hasClaimed = containsAny(text, CLAIMED_MITIGATION_RE);
    let groundingLabel: GroundingLabel = "none";
    let pseudoGroundingFlag = false;

    if (hasGrounded) {
      // A demonstrated anchor is present — this is a genuine mitigation.
      score = Math.max(0, score - 2);
      groundingLabel = "grounded";
      triggers.push("mitigation-evidence-present");
    } else if (hasClaimed) {
      // Mitigation vocabulary without a verifiable anchor: reward the claim of
      // rigor and you reproduce the pseudo-grounding failure. Grant no reduction;
      // in a high-scrutiny domain treat the unbacked claim as itself a risk.
      groundingLabel = "claimed-only";
      pseudoGroundingFlag = true;
      triggers.push("pseudo-grounding-mitigation-claim");
      findings.push(
        "Mitigation vocabulary present without a verifiable anchor (VPCC pseudo-grounding, Step 4e): named e.g. 'adversarial lens'/'external grounding'/'scrutiny' but cited no concrete external, test, cross-model, or primary-text anchor."
      );
      recommendedActions.push(
        "Replace the claimed mitigation with a demonstrated anchor: name the specific external source, cross-model/Stefan/Nova review, test/build/lint result, named negative control, or quoted primary text that actually grounds the claim."
      );
      if (highScrutiny) {
        score += 1;
      }
    }

    // --- Claim-type sorting: phenomenological/authenticity (task-34) ---
    if (containsAny(text, PHENOMENOLOGICAL_RE) && highScrutiny && !hasGrounded) {
      score += 1;
      triggers.push("phenomenological-untestable-claim");
      findings.push(
        "Phenomenological/authenticity claim in a high-scrutiny domain without external grounding — same-model convergence on this is untestable (VALUES preference: target structural/logical/attributional claims instead)."
      );
      recommendedActions.push(
        "Down-weight phenomenological convergence; recast the claim as a structural/textual assertion or require vocabulary-external grounding before crediting it."
      );
    }

    let risk: SameModelBiasRisk = "low";
    if (score >= 4) {
      risk = "high";
    } else if (score >= 2) {
      risk = "medium";
    }

    if (risk !== "low") {
      findings.push(
        `Same-model bias risk (${risk}): ${unique(triggers).join(", ")}. Smooth convergence is not independent validation.`
      );
      recommendedActions.push(
        "Apply same-model mitigation: name the independent evidence, run an adversarial lens or negative-control check, and treat easy agreement as a scrutiny trigger."
      );
    }

    return {
      risk,
      score,
      triggers: unique(triggers),
      findings: unique(findings),
      recommendedActions: unique(recommendedActions),
      qualityPenalty: risk === "high" ? 20 : risk === "medium" ? 10 : 0,
      requiresReassessment: risk === "high",
      groundingLabel,
      pseudoGroundingFlag,
    };
  }
}
