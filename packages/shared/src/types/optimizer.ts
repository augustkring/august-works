import type {
  WorkflowEdgeV1,
  WorkflowJsonSchema,
  WorkflowNodeV1,
  WorkflowRiskClass,
  WorkflowSideEffectClass,
} from "./workflow.js";

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

export const OPTIMIZER_SUGGESTION_STATUSES = [
  "detected",
  "generated",
  "evaluating",
  "ready_for_shadow",
  "shadowing",
  "ready_to_promote",
  "promoted",
  "rejected",
  "needs_revision",
] as const;
export type OptimizerSuggestionStatus =
  (typeof OPTIMIZER_SUGGESTION_STATUSES)[number];

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

export const OPTIMIZER_SUGGESTION_EVIDENCE_STATES = [
  "disabled",
  "no_published_revision",
  "insufficient_runs",
  "correction_evidence_incomplete",
  "no_candidate",
  "ready",
] as const;
export type OptimizerSuggestionEvidenceState =
  (typeof OPTIMIZER_SUGGESTION_EVIDENCE_STATES)[number];

export interface WorkflowOptimizerSuggestion
  extends OptimizerCandidateSuggestion {
  id: string;
  status: OptimizerSuggestionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OptimizerSuggestionResponse {
  state: OptimizerSuggestionEvidenceState;
  workflowId: string;
  workflowRevisionId: string | null;
  terminalRunCount: number;
  correctionEvidenceCount: number;
  minimumObservationCount: number;
  suggestions: WorkflowOptimizerSuggestion[];
}


export const OPTIMIZER_COMPILER_RESULT_STATUSES = [
  "compiled",
  "unsupported",
] as const;
export type OptimizerCompilerResultStatus =
  (typeof OPTIMIZER_COMPILER_RESULT_STATUSES)[number];

export interface OptimizerCompilerBusinessInvariant {
  id: string;
  description: string;
  critical: boolean;
}

export interface OptimizerCompilerTraceSample {
  runId: string;
  inputShapeHash: string | null;
  outputShapeHash: string | null;
  outcome: OptimizerStepOutcome;
}

export type OptimizerObservedImplementation =
  | {
      kind: "expression";
      sourceCode: string;
    }
  | {
      kind: "transform";
      sourceCode: string;
    }
  | {
      kind: "subgraph";
      stepOrdinals: number[];
      nodes: WorkflowNodeV1[];
      edges: WorkflowEdgeV1[];
    }
  | {
      kind: "generated_code";
      language: "typescript" | "python";
      sourceCode: string;
    };

export interface OptimizerCompilerInput {
  suggestion: WorkflowOptimizerSuggestion;
  inputSchema: WorkflowJsonSchema;
  outputSchema: WorkflowJsonSchema;
  businessInvariants: OptimizerCompilerBusinessInvariant[];
  allowedCapabilityRefs: string[];
  traceSamples: OptimizerCompilerTraceSample[];
  observedImplementation: OptimizerObservedImplementation | null;
  riskClass: WorkflowRiskClass;
  sideEffectClass: WorkflowSideEffectClass;
}

export interface OptimizerCompilerDependencyManifest {
  capabilityRefs: string[];
  packages: [];
}

export interface OptimizerCompilerGeneratedTestSpec {
  schema: "optimizer.compiler.test_spec.v1";
  suggestionId: string;
  traceSamples: OptimizerCompilerTraceSample[];
  businessInvariants: OptimizerCompilerBusinessInvariant[];
  requiredCapabilityRefs: string[];
}

export interface OptimizerCompiledArtifactCandidate {
  kind: "artifact";
  artifact: {
    name: string;
    description: string;
    kind: Extract<
      OptimizerCandidateType,
      "expression" | "transform" | "typescript" | "python"
    >;
    language: "typescript" | "python" | null;
    inputSchema: WorkflowJsonSchema;
    outputSchema: WorkflowJsonSchema;
    riskClass: WorkflowRiskClass;
    sideEffectClass: WorkflowSideEffectClass;
    createdByOptimizerSuggestionId: string;
    originWorkflowId: string;
    originNodeId: null;
    sourceCode: string;
    dependencyManifest: OptimizerCompilerDependencyManifest;
    testSpec: OptimizerCompilerGeneratedTestSpec;
  };
}

export interface OptimizerCompiledSubgraphCandidate {
  kind: "subgraph";
  subgraph: {
    workflowId: string;
    workflowRevisionId: string;
    stepOrdinals: number[];
    nodes: WorkflowNodeV1[];
    edges: WorkflowEdgeV1[];
    inputSchema: WorkflowJsonSchema;
    outputSchema: WorkflowJsonSchema;
    riskClass: WorkflowRiskClass;
    sideEffectClass: WorkflowSideEffectClass;
  };
}

export type OptimizerCompiledCandidate =
  | OptimizerCompiledArtifactCandidate
  | OptimizerCompiledSubgraphCandidate;

export interface OptimizerCompilerResult {
  status: OptimizerCompilerResultStatus;
  reasonCode: string;
  candidate: OptimizerCompiledCandidate | null;
  dependencyManifest: OptimizerCompilerDependencyManifest;
  generatedTestSpec: OptimizerCompilerGeneratedTestSpec;
  knownAssumptions: string[];
  unsupportedCases: string[];
  fallbackConditions: string[];
}

export const OPTIMIZER_REPLAY_CASE_CATEGORIES = [
  "representative",
  "corrected",
  "boundary",
  "shape_variant",
] as const;
export type OptimizerReplayCaseCategory =
  (typeof OPTIMIZER_REPLAY_CASE_CATEGORIES)[number];

export const OPTIMIZER_REPLAY_EXECUTION_MODES = [
  "pure",
  "dry_run",
  "sandbox",
] as const;
export type OptimizerReplayExecutionMode =
  (typeof OPTIMIZER_REPLAY_EXECUTION_MODES)[number];

export interface OptimizerReplayCase {
  id: string;
  category: OptimizerReplayCaseCategory;
  sourceRunId: string | null;
  input: unknown;
  expectedOutput?: unknown;
}

export interface OptimizerReplayInvariantResult {
  id: string;
  critical: boolean;
  passed: boolean;
  detail: string | null;
}

export interface OptimizerReplayCaseResult {
  id: string;
  category: OptimizerReplayCaseCategory;
  status: "passed" | "failed" | "unsupported";
  outputSchemaValid: boolean;
  exactOutputMatch: boolean | null;
  invariantResults: OptimizerReplayInvariantResult[];
  differenceSummary: string;
  durationMs: number;
  costEstimate: number | null;
  unsupportedCases: string[];
}

export interface OptimizerReplayEvaluation {
  status: "passed" | "failed";
  reasonCode: string;
  criticalInvariantFailure: boolean;
  requiredCategories: OptimizerReplayCaseCategory[];
  missingCategories: OptimizerReplayCaseCategory[];
  caseResults: OptimizerReplayCaseResult[];
  passedCaseCount: number;
  failedCaseCount: number;
  unsupportedCaseCount: number;
  totalDurationMs: number;
  totalCostEstimate: number | null;
}
