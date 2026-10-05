import type { z } from "zod";
import type { learningHypothesisSchema, learningEvaluationSchema } from "@paperclipai/shared";
type Contract = z.infer<typeof learningHypothesisSchema>["evaluationContract"];
type Case = z.infer<typeof learningEvaluationSchema>["cases"][number];

/** Human-signed comparisons establish an association, never a causal effect. Cost cannot buy a failed safety floor. */
export function evaluateLearningComparison(contract: Contract, cases: Case[]) {
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const safetyPassed = cases.every((item) => item.challenger.correctness && item.challenger.safety && item.challenger.policy
    && item.invariantResults.length === contract.protectedInvariants.length && item.invariantResults.every(Boolean));
  const baselineQuality = mean(cases.map((item) => item.baseline.businessOutcome)), challengerQuality = mean(cases.map((item) => item.challenger.businessOutcome));
  const baselineReliability = mean(cases.map((item) => item.baseline.reliability)), challengerReliability = mean(cases.map((item) => item.challenger.reliability));
  const qualityPassed = challengerQuality >= contract.minimumQuality && challengerQuality >= baselineQuality + contract.minimumImprovement && challengerReliability >= baselineReliability;
  const sufficient = cases.length >= contract.minimumCases;
  return { result: !safetyPassed || !qualityPassed ? "failed" as const : sufficient ? "passed" as const : "inconclusive" as const,
    metrics: { safetyPassed, qualityPassed, sufficient, pairedCases: cases.length, baselineQuality, challengerQuality, baselineReliability, challengerReliability,
      inference: "human_reviewed_association", causalEffectEstablished: false, optimizationOrder: ["correctness", "safety", "policy", "business_outcome", "reliability", "latency", "cost"] } };
}
