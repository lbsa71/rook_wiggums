import { SubstrateFileReader } from "../substrate/io/FileReader";
import { DriftAnalyzer, DriftResult } from "./DriftAnalyzer";
import { ConsistencyChecker, ConsistencyResult } from "./ConsistencyChecker";
import { SecurityAnalyzer, SecurityResult } from "./SecurityAnalyzer";
import { PlanQualityEvaluator, PlanQualityResult } from "./PlanQualityEvaluator";
import { ReasoningValidator, ReasoningResult } from "./ReasoningValidator";

export interface HealthCheckResult {
  overall: "healthy" | "degraded" | "unhealthy";
  drift: DriftResult;
  consistency: ConsistencyResult;
  security: SecurityResult;
  planQuality: PlanQualityResult;
  reasoning: ReasoningResult;
}

export class HealthCheck {
  private readonly driftAnalyzer: DriftAnalyzer;
  private readonly consistencyChecker: ConsistencyChecker;
  private readonly securityAnalyzer: SecurityAnalyzer;
  private readonly planQualityEvaluator: PlanQualityEvaluator;
  private readonly reasoningValidator: ReasoningValidator;

  constructor(reader: SubstrateFileReader) {
    this.driftAnalyzer = new DriftAnalyzer(reader);
    this.consistencyChecker = new ConsistencyChecker(reader);
    this.securityAnalyzer = new SecurityAnalyzer(reader);
    this.planQualityEvaluator = new PlanQualityEvaluator(reader);
    this.reasoningValidator = new ReasoningValidator(reader);
  }

  async run(): Promise<HealthCheckResult> {
    const [drift, consistency, security, planQuality, reasoning] = await Promise.all([
      this.driftAnalyzer.analyze(),
      this.consistencyChecker.check(),
      this.securityAnalyzer.analyze(),
      this.planQualityEvaluator.evaluate(),
      this.reasoningValidator.validate(),
    ]);

    const overall = this.determineOverall(drift, consistency, security, planQuality, reasoning);

    return { overall, drift, consistency, security, planQuality, reasoning };
  }

  private determineOverall(
    drift: DriftResult,
    consistency: ConsistencyResult,
    security: SecurityResult,
    planQuality: PlanQualityResult,
    reasoning: ReasoningResult
  ): "healthy" | "degraded" | "unhealthy" {
    const issues =
      (drift.score > 0.5 ? 1 : 0) +
      (consistency.inconsistencies.length > 0 ? 1 : 0) +
      (!security.compliant ? 1 : 0) +
      (planQuality.score < 0.5 ? 1 : 0) +
      (!reasoning.valid ? 1 : 0);

    if (issues === 0) return "healthy";
    if (issues <= 2) return "degraded";
    return "unhealthy";
  }
}
