import { SameModelBiasEvaluator } from "../../src/evaluation/SameModelBiasEvaluator";

describe("SameModelBiasEvaluator", () => {
  it("flags smooth peer convergence in high-scrutiny domains", () => {
    const assessment = SameModelBiasEvaluator.assess({
      taskDescription: "Review Rook's VALUES refinement for same-model bias",
      result: "success",
      summary: "Rook and Bishop agreed; no issues remain",
      progressEntry: "Easy consensus accepted the governance language.",
    });

    expect(assessment.risk).toBe("high");
    expect(assessment.requiresReassessment).toBe(true);
    expect(assessment.qualityPenalty).toBe(20);
    expect(assessment.triggers).toContain("peer-or-same-model-convergence");
    expect(assessment.triggers).toContain("smooth-acceptance-language");
  });

  it("reduces risk when mitigation evidence is explicit", () => {
    const assessment = SameModelBiasEvaluator.assess({
      taskDescription: "Review Rook's VALUES refinement for same-model bias",
      result: "success",
      summary: "Rook and Bishop agreed after adversarial lens and negative control checks.",
      progressEntry: "Independent evidence and external grounding were named before acceptance.",
    });

    expect(assessment.risk).not.toBe("high");
    expect(assessment.triggers).toContain("mitigation-evidence-present");
  });

  it("leaves ordinary implementation work low risk", () => {
    const assessment = SameModelBiasEvaluator.assess({
      taskDescription: "Fix path validation for substrate config",
      result: "success",
      summary: "Tests passed",
      progressEntry: "Added validation and regression coverage.",
    });

    expect(assessment.risk).toBe("low");
    expect(assessment.requiresReassessment).toBe(false);
  });
});
