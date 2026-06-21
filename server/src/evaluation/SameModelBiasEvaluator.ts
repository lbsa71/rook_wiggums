export type SameModelBiasRisk = "low" | "medium" | "high";

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
}

const PEER_CONVERGENCE_RE = /\b(rook|nova|peer|claude|same-model|same model|shared training|convergence|consensus|agreement|agreed|ack|endors(?:e|ed|ement)|accepted)\b/i;
const HIGH_SCRUTINY_RE = /\b(values|governance|adversarial|challenge|independence|same-model|same model|bias|external grounding|vpcc|methodolog(?:y|ies)|evaluation|heuristic|delegation)\b/i;
const SMOOTH_ACCEPTANCE_RE = /\b(no (?:issues|gaps|concerns|blockers)|straightforward|smooth(?:ly)?|easy agreement|easy consensus|aligned|fully agree|nothing remains|complete and accepted)\b/i;
const MITIGATION_RE = /\b(adversarial lens|negative control|source-independence|external grounding|same-model caveat|bias check|scrutin(?:y|ize|ised|ized)|steelman|counterexample|independent evidence|governed proposal|not live|pending superego|tests? passed|full jest|full eslint|build passed|validation passed)\b/i;

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

    if (containsAny(text, HIGH_SCRUTINY_RE)) {
      score += 1;
      triggers.push("high-scrutiny-domain");
    }

    if (containsAny(text, SMOOTH_ACCEPTANCE_RE)) {
      score += 2;
      triggers.push("smooth-acceptance-language");
    }

    const hasMitigation = containsAny(text, MITIGATION_RE);
    if (hasMitigation) {
      score = Math.max(0, score - 2);
      triggers.push("mitigation-evidence-present");
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
      findings,
      recommendedActions,
      qualityPenalty: risk === "high" ? 20 : risk === "medium" ? 10 : 0,
      requiresReassessment: risk === "high",
    };
  }
}
