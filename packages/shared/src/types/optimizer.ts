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
