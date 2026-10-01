import { createHash } from "node:crypto";

import type {
  OptimizerCandidateSuggestion,
  OptimizerCandidateType,
  OptimizerSideEffectRisk,
  OptimizerTrace,
  OptimizerTraceStep,
} from "@paperclipai/shared";

const HIGH_RISK_EFFECTS = new Set([
  "destructive",
  "financial",
  "privileged",
  "external_communication",
]);
const MEDIUM_RISK_EFFECTS = new Set(["write"]);

export interface OptimizerPatternDetectorOptions {
  minObservationCount?: number;
  maxSpanLength?: number;
  minSuccessRate?: number;
  minShapeStability?: number;
  maxHumanCorrectionRate?: number;
}

interface SpanObservation {
  companyId: string;
  workflowId: string | null;
  workflowRevisionId: string | null;
  runId: string;
  humanCorrection: boolean | undefined;
  steps: OptimizerTraceStep[];
}

function boundedRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function dominantStability(values: Array<string | null>): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "null";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / values.length;
}

function riskForSteps(steps: OptimizerTraceStep[]): OptimizerSideEffectRisk {
  if (steps.some((step) => HIGH_RISK_EFFECTS.has(step.sideEffectClass))) {
    return "high";
  }
  if (steps.some((step) => MEDIUM_RISK_EFFECTS.has(step.sideEffectClass))) {
    return "medium";
  }
  return "low";
}

function candidateTypeForSteps(
  steps: OptimizerTraceStep[],
): OptimizerCandidateType {
  if (steps.length === 1 && steps[0]!.operationType === "core.condition") {
    return "expression";
  }
  if (steps.length === 1 && steps[0]!.operationType === "core.transform") {
    return "transform";
  }
  if (
    steps.length === 1 &&
    steps[0]!.operationType === "connector.action"
  ) {
    return "tool_chain";
  }
  return "subworkflow";
}

function hasSemanticDependence(steps: OptimizerTraceStep[]): boolean {
  return steps.some(
    (step) =>
      step.operationType.startsWith("agent.") ||
      step.operationType === "human.approval",
  );
}

function signaturePayload(observation: SpanObservation): unknown {
  return {
    companyId: observation.companyId,
    workflowId: observation.workflowId,
    workflowRevisionId: observation.workflowRevisionId,
    operations: observation.steps.map((step) => ({
      ordinal: step.ordinal,
      operationType: step.operationType,
      capabilityRef: step.capabilityRef,
      sideEffectClass: step.sideEffectClass,
    })),
  };
}

function signatureHash(observation: SpanObservation): string {
  return createHash("sha256")
    .update(JSON.stringify(signaturePayload(observation)))
    .digest("hex");
}

function windows(trace: OptimizerTrace, maxSpanLength: number): SpanObservation[] {
  const observations: SpanObservation[] = [];
  for (let start = 0; start < trace.steps.length; start += 1) {
    const maxEnd = Math.min(trace.steps.length, start + maxSpanLength);
    for (let end = start + 1; end <= maxEnd; end += 1) {
      const steps = trace.steps.slice(start, end);
      if (hasSemanticDependence(steps)) continue;
      observations.push({
        companyId: trace.companyId,
        workflowId: trace.workflowId,
        workflowRevisionId: trace.workflowRevisionId,
        runId: trace.runId,
        humanCorrection: trace.humanCorrection,
        steps,
      });
    }
  }
  return observations;
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function detectOptimizerCandidates(
  traces: readonly OptimizerTrace[],
  options: OptimizerPatternDetectorOptions = {},
): OptimizerCandidateSuggestion[] {
  const minObservationCount = Math.max(3, options.minObservationCount ?? 3);
  const maxSpanLength = Math.max(1, Math.min(options.maxSpanLength ?? 4, 8));
  const minSuccessRate = options.minSuccessRate ?? 0.8;
  const minShapeStability = options.minShapeStability ?? 0.67;
  const maxHumanCorrectionRate = options.maxHumanCorrectionRate ?? 0.2;

  const groups = new Map<string, SpanObservation[]>();
  for (const trace of traces) {
    for (const observation of windows(trace, maxSpanLength)) {
      const key = signatureHash(observation);
      const group = groups.get(key);
      if (group) group.push(observation);
      else groups.set(key, [observation]);
    }
  }

  const suggestions: OptimizerCandidateSuggestion[] = [];
  for (const [signature, observations] of groups) {
    const distinctRunIds = [...new Set(observations.map((item) => item.runId))];
    if (distinctRunIds.length < minObservationCount) continue;

    // One observation per run prevents retries or duplicate trace imports from
    // artificially satisfying the minimum sample threshold.
    const byRun = new Map<string, SpanObservation>();
    for (const observation of observations) {
      if (!byRun.has(observation.runId)) byRun.set(observation.runId, observation);
    }
    const sample = [...byRun.values()];
    const first = sample[0]!;

    // Absence is not evidence of "no correction". Preserve measurement
    // coverage explicitly instead of fabricating a zero correction rate.
    const correctionEvidence = sample.filter(
      (item): item is SpanObservation & { humanCorrection: boolean } =>
        typeof item.humanCorrection === "boolean",
    );

    const inputHashes = sample.map(
      (item) => item.steps[0]?.inputShapeHash ?? null,
    );
    const outputHashes = sample.map(
      (item) => item.steps.at(-1)?.outputShapeHash ?? null,
    );
    const successful = sample.filter((item) =>
      item.steps.every((step) => step.outcome === "success"),
    ).length;
    const corrected = correctionEvidence.filter(
      (item) => item.humanCorrection,
    ).length;
    const inputShapeStability = dominantStability(inputHashes);
    const outputShapeStability = dominantStability(outputHashes);
    const successRate = boundedRate(successful, sample.length);
    const humanCorrectionRate =
      correctionEvidence.length > 0
        ? boundedRate(corrected, correctionEvidence.length)
        : null;
    const humanCorrectionEvidenceCoverage = boundedRate(
      correctionEvidence.length,
      sample.length,
    );
    const sideEffectRisk = riskForSteps(first.steps);

    // Suggestion-only can surface a pure/read deterministic opportunity with
    // an explicit "not measured" correction rate. Side-effectful candidates
    // remain fail-closed until correction evidence covers every sampled run.
    if (
      successRate < minSuccessRate ||
      (humanCorrectionRate !== null &&
        humanCorrectionRate > maxHumanCorrectionRate) ||
      (sideEffectRisk !== "low" &&
        correctionEvidence.length !== sample.length) ||
      inputShapeStability < minShapeStability ||
      outputShapeStability < minShapeStability
    ) {
      continue;
    }

    const totalDuration = sample.reduce(
      (sum, item) =>
        sum + item.steps.reduce((stepSum, step) => stepSum + step.durationMs, 0),
      0,
    );
    const costs = sample
      .map((item) =>
        item.steps.reduce<number | null>(
          (sum, step) =>
            step.cost === null ? sum : (sum ?? 0) + step.cost,
          null,
        ),
      )
      .filter((value): value is number => value !== null);
    const averageDurationMs = totalDuration / sample.length;
    const averageCost =
      costs.length > 0
        ? costs.reduce((sum, value) => sum + value, 0) / costs.length
        : null;

    suggestions.push({
      companyId: first.companyId,
      workflowId: first.workflowId,
      workflowRevisionId: first.workflowRevisionId,
      signatureHash: signature,
      candidateType: candidateTypeForSteps(first.steps),
      stepOrdinals: first.steps.map((step) => step.ordinal),
      operationTypes: first.steps.map((step) => step.operationType),
      capabilityRefs: first.steps.map((step) => step.capabilityRef),
      sideEffectRisk,
      observationCount: sample.length,
      successRate: rounded(successRate),
      humanCorrectionRate:
        humanCorrectionRate === null ? null : rounded(humanCorrectionRate),
      humanCorrectionEvidenceCount: correctionEvidence.length,
      humanCorrectionEvidenceCoverage: rounded(
        humanCorrectionEvidenceCoverage,
      ),
      inputShapeStability: rounded(inputShapeStability),
      outputShapeStability: rounded(outputShapeStability),
      averageDurationMs: rounded(averageDurationMs),
      averageCost: averageCost === null ? null : rounded(averageCost),
      // PR 43 only identifies plausible opportunity. These are conservative
      // upper-bound observations, not a promise that the compiler will achieve
      // the full saving.
      estimatedLatencySavingsMs: rounded(averageDurationMs),
      estimatedCostSavings:
        averageCost === null ? null : rounded(averageCost),
      observedRunIds: distinctRunIds.sort(),
    });
  }

  return suggestions.sort(
    (left, right) =>
      right.observationCount - left.observationCount ||
      right.averageDurationMs - left.averageDurationMs ||
      left.signatureHash.localeCompare(right.signatureHash),
  );
}
