export const OPTIMIZER_EXECUTOR_TYPES = [
  "agent",
  "workflow",
  "tool",
  "human",
] as const;
export type OptimizerExecutorType =
  (typeof OPTIMIZER_EXECUTOR_TYPES)[number];

export const OPTIMIZER_STEP_OUTCOMES = [
  "success",
  "failure",
  "corrected",
] as const;
export type OptimizerStepOutcome =
  (typeof OPTIMIZER_STEP_OUTCOMES)[number];

export interface OptimizerTraceStep {
  ordinal: number;
  operationType: string;
  capabilityRef: string | null;
  inputShapeHash: string | null;
  outputShapeHash: string | null;
  sideEffectClass: string;
  durationMs: number;
  /** Canonical integer cents from the existing cost ledger. */
  cost: number | null;
  outcome: OptimizerStepOutcome;
}

export interface OptimizerTrace {
  companyId: string;
  workflowId: string | null;
  workflowRevisionId: string | null;
  taskId: string | null;
  routineId: string | null;
  runId: string;
  executorType: OptimizerExecutorType;
  steps: OptimizerTraceStep[];
  finalOutcome: string;
  humanCorrection?: boolean;
  createdAt: string;
}

export const OPTIMIZER_CANDIDATE_TYPES = [
  "expression",
  "transform",
  "tool_chain",
  "subworkflow",
  "typescript",
  "python",
] as const;
export type OptimizerCandidateType =
  (typeof OPTIMIZER_CANDIDATE_TYPES)[number];

export type OptimizerSideEffectRisk = "low" | "medium" | "high";

export interface OptimizerCandidateSuggestion {
  companyId: string;
  workflowId: string | null;
  workflowRevisionId: string | null;
  signatureHash: string;
  candidateType: OptimizerCandidateType;
  /** Stable span coordinates within the normalized workflow trace. */
  stepOrdinals: number[];
  operationTypes: string[];
  capabilityRefs: Array<string | null>;
  sideEffectRisk: OptimizerSideEffectRisk;
  observationCount: number;
  successRate: number;
  /**
   * Null means no authoritative correction evidence was observed. It must
   * never be rendered or interpreted as a measured 0% correction rate.
   */
  humanCorrectionRate: number | null;
  humanCorrectionEvidenceCount: number;
  humanCorrectionEvidenceCoverage: number;
  inputShapeStability: number;
  outputShapeStability: number;
  averageDurationMs: number;
  averageCost: number | null;
  estimatedLatencySavingsMs: number;
  estimatedCostSavings: number | null;
  observedRunIds: string[];
}

