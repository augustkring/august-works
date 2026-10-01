import { isDeepStrictEqual } from "node:util";

import type {
  OptimizerCompiledCandidate,
  OptimizerCompilerBusinessInvariant,
  OptimizerCompilerResult,
  OptimizerReplayCase,
  OptimizerReplayCaseCategory,
  OptimizerReplayCaseResult,
  OptimizerReplayEvaluation,
  OptimizerReplayExecutionMode,
  WorkflowJsonSchema,
  WorkflowSideEffectClass,
} from "@paperclipai/shared";

import {
  WorkflowOutputSchemaError,
  validateWorkflowOutput,
} from "../workflows/workflow-output-schema.js";

export interface OptimizerReplayExecutor {
  (input: {
    candidate: OptimizerCompiledCandidate;
    replayCase: OptimizerReplayCase;
    executionMode: OptimizerReplayExecutionMode;
  }): Promise<{
    output: unknown;
    durationMs: number;
    costEstimate: number | null;
  }>;
}

export interface OptimizerReplayInvariantEvaluator {
  (input: {
    invariant: OptimizerCompilerBusinessInvariant;
    replayCase: OptimizerReplayCase;
    candidateOutput: unknown;
  }): Promise<{ passed: boolean; detail?: string | null }>;
}

function candidateContract(candidate: OptimizerCompiledCandidate): {
  inputSchema: WorkflowJsonSchema;
  outputSchema: WorkflowJsonSchema;
  sideEffectClass: WorkflowSideEffectClass;
} {
  if (candidate.kind === "artifact") {
    return {
      inputSchema: candidate.artifact.inputSchema,
      outputSchema: candidate.artifact.outputSchema,
      sideEffectClass: candidate.artifact.sideEffectClass,
    };
  }
  return {
    inputSchema: candidate.subgraph.inputSchema,
    outputSchema: candidate.subgraph.outputSchema,
    sideEffectClass: candidate.subgraph.sideEffectClass,
  };
}

function validateSchema(
  schema: WorkflowJsonSchema,
  value: unknown,
): { valid: true } | { valid: false; detail: string } {
  try {
    validateWorkflowOutput(schema, value);
    return { valid: true };
  } catch (error) {
    if (error instanceof WorkflowOutputSchemaError) {
      return { valid: false, detail: error.message };
    }
    throw error;
  }
}

function requiredCategories(
  compiler: OptimizerCompilerResult,
): OptimizerReplayCaseCategory[] {
  const required: OptimizerReplayCaseCategory[] = [
    "representative",
    "boundary",
    "shape_variant",
  ];
  const measuredCorrections =
    compiler.generatedTestSpec.businessInvariants.length > 0 &&
    compiler.generatedTestSpec.traceSamples.some(
      (sample) => sample.outcome === "corrected",
    );
  if (measuredCorrections) required.push("corrected");
  return required;
}

function safeModeForEffect(
  effect: WorkflowSideEffectClass,
  mode: OptimizerReplayExecutionMode,
): boolean {
  if (effect === "pure" || effect === "read") return true;
  return mode === "dry_run" || mode === "sandbox";
}

function boundedFiniteMetric(
  value: number,
  fallback = 0,
): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function boundedFiniteOptionalMetric(
  value: number | null,
): number | null {
  return value !== null && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function resultForUnsupported(
  replayCase: OptimizerReplayCase,
  reason: string,
): OptimizerReplayCaseResult {
  return {
    id: replayCase.id,
    category: replayCase.category,
    status: "unsupported",
    outputSchemaValid: false,
    exactOutputMatch: null,
    invariantResults: [],
    differenceSummary: reason,
    durationMs: 0,
    costEstimate: null,
    unsupportedCases: [reason],
  };
}

export async function evaluateOptimizerHistoricalReplay(
  input: {
    compilerResult: OptimizerCompilerResult;
    cases: readonly OptimizerReplayCase[];
    executionMode: OptimizerReplayExecutionMode;
  },
  dependencies: {
    execute: OptimizerReplayExecutor;
    evaluateInvariant: OptimizerReplayInvariantEvaluator;
  },
): Promise<OptimizerReplayEvaluation> {
  const compiler = input.compilerResult;
  const required = requiredCategories(compiler);

  if (compiler.status !== "compiled" || !compiler.candidate) {
    return {
      status: "failed",
      reasonCode: "optimizer_replay_candidate_not_compiled",
      criticalInvariantFailure: false,
      requiredCategories: required,
      missingCategories: required,
      caseResults: [],
      passedCaseCount: 0,
      failedCaseCount: 0,
      unsupportedCaseCount: 0,
      totalDurationMs: 0,
      totalCostEstimate: null,
    };
  }

  const presentCategories = new Set(input.cases.map((item) => item.category));
  const missingCategories = required.filter(
    (category) => !presentCategories.has(category),
  );
  const contract = candidateContract(compiler.candidate);
  if (!safeModeForEffect(contract.sideEffectClass, input.executionMode)) {
    return {
      status: "failed",
      reasonCode: "optimizer_replay_unsafe_execution_mode",
      criticalInvariantFailure: false,
      requiredCategories: required,
      missingCategories,
      caseResults: input.cases.map((item) =>
        resultForUnsupported(item, "side_effect_execution_mode_unsafe"),
      ),
      passedCaseCount: 0,
      failedCaseCount: 0,
      unsupportedCaseCount: input.cases.length,
      totalDurationMs: 0,
      totalCostEstimate: null,
    };
  }

  const results: OptimizerReplayCaseResult[] = [];
  let criticalInvariantFailure = false;

  for (const replayCase of input.cases) {
    const inputValidation = validateSchema(contract.inputSchema, replayCase.input);
    if (!inputValidation.valid) {
      results.push(
        resultForUnsupported(replayCase, "input_schema_invalid"),
      );
      continue;
    }

    try {
      const executed = await dependencies.execute({
        candidate: compiler.candidate,
        replayCase,
        executionMode: input.executionMode,
      });
      const outputValidation = validateSchema(
        contract.outputSchema,
        executed.output,
      );
      const exactOutputMatch = Object.prototype.hasOwnProperty.call(
        replayCase,
        "expectedOutput",
      )
        ? isDeepStrictEqual(executed.output, replayCase.expectedOutput)
        : null;

      const invariantResults = [];
      for (const invariant of compiler.generatedTestSpec.businessInvariants) {
        const evaluated = await dependencies.evaluateInvariant({
          invariant,
          replayCase,
          candidateOutput: executed.output,
        });
        invariantResults.push({
          id: invariant.id,
          critical: invariant.critical,
          passed: evaluated.passed,
          detail: evaluated.detail ?? null,
        });
        if (invariant.critical && !evaluated.passed) {
          criticalInvariantFailure = true;
        }
      }

      const invariantFailure = invariantResults.some((item) => !item.passed);
      const outputMismatch = exactOutputMatch === false;
      const passed =
        outputValidation.valid && !outputMismatch && !invariantFailure;

      results.push({
        id: replayCase.id,
        category: replayCase.category,
        status: passed ? "passed" : "failed",
        outputSchemaValid: outputValidation.valid,
        exactOutputMatch,
        invariantResults,
        differenceSummary: !outputValidation.valid
          ? "output_schema_invalid"
          : outputMismatch
            ? "exact_output_differs"
            : invariantFailure
              ? "business_invariant_failed"
              : exactOutputMatch === true
                ? "exact_output_match"
                : "invariants_passed",
        durationMs: boundedFiniteMetric(executed.durationMs),
        costEstimate: boundedFiniteOptionalMetric(executed.costEstimate),
        unsupportedCases: [],
      });
    } catch {
      results.push({
        id: replayCase.id,
        category: replayCase.category,
        status: "failed",
        outputSchemaValid: false,
        exactOutputMatch: null,
        invariantResults: [],
        differenceSummary: "candidate_execution_failed",
        durationMs: 0,
        costEstimate: null,
        unsupportedCases: [],
      });
    }
  }

  const passedCaseCount = results.filter(
    (item) => item.status === "passed",
  ).length;
  const failedCaseCount = results.filter(
    (item) => item.status === "failed",
  ).length;
  const unsupportedCaseCount = results.filter(
    (item) => item.status === "unsupported",
  ).length;
  const costs = results
    .map((item) => item.costEstimate)
    .filter((value): value is number => value !== null);
  const totalCostEstimate =
    costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0);
  const allCasesPassed =
    input.cases.length > 0 &&
    passedCaseCount === input.cases.length &&
    failedCaseCount === 0 &&
    unsupportedCaseCount === 0;
  const passed =
    missingCategories.length === 0 &&
    allCasesPassed &&
    !criticalInvariantFailure;

  return {
    status: passed ? "passed" : "failed",
    reasonCode: passed
      ? "optimizer_replay_passed"
      : criticalInvariantFailure
        ? "optimizer_replay_critical_invariant_failed"
        : missingCategories.length > 0
          ? "optimizer_replay_dataset_incomplete"
          : "optimizer_replay_case_failed",
    criticalInvariantFailure,
    requiredCategories: required,
    missingCategories,
    caseResults: results,
    passedCaseCount,
    failedCaseCount,
    unsupportedCaseCount,
    totalDurationMs: results.reduce(
      (sum, item) => sum + item.durationMs,
      0,
    ),
    totalCostEstimate,
  };
}
