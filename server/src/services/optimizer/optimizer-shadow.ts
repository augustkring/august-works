import type {
  OptimizerCompiledCandidate,
  OptimizerCompilerBusinessInvariant,
  OptimizerCompilerResult,
  OptimizerReplayEvaluation,
  OptimizerReplayExecutionMode,
  OptimizerShadowEvaluation,
  OptimizerShadowObservation,
  WorkflowJsonSchema,
  WorkflowSideEffectClass,
} from "@paperclipai/shared";

import {
  WorkflowOutputSchemaError,
  validateWorkflowOutput,
} from "../workflows/workflow-output-schema.js";

export interface OptimizerShadowExecutor {
  (input: {
    candidate: OptimizerCompiledCandidate;
    safeInput: unknown;
    executionMode: OptimizerReplayExecutionMode;
  }): Promise<{
    output: unknown;
    durationMs: number;
    costEstimate: number | null;
    resourceUse?: Record<string, number>;
  }>;
}

export interface OptimizerShadowAgreementEvaluator {
  (input: {
    trustedOutput: unknown;
    candidateOutput: unknown;
    outputSchema: WorkflowJsonSchema;
  }): Promise<{ agreement: boolean; detail?: string | null }>;
}

export interface OptimizerShadowInvariantEvaluator {
  (input: {
    invariant: OptimizerCompilerBusinessInvariant;
    observation: OptimizerShadowObservation;
    candidateOutput: unknown;
  }): Promise<{ passed: boolean; detail?: string | null }>;
}

function contract(candidate: OptimizerCompiledCandidate): {
  outputSchema: WorkflowJsonSchema;
  sideEffectClass: WorkflowSideEffectClass;
} {
  if (candidate.kind === "artifact") {
    return {
      outputSchema: candidate.artifact.outputSchema,
      sideEffectClass: candidate.artifact.sideEffectClass,
    };
  }
  return {
    outputSchema: candidate.subgraph.outputSchema,
    sideEffectClass: candidate.subgraph.sideEffectClass,
  };
}

function outputSchemaValid(
  schema: WorkflowJsonSchema,
  value: unknown,
): boolean {
  try {
    validateWorkflowOutput(schema, value);
    return true;
  } catch (error) {
    if (error instanceof WorkflowOutputSchemaError) return false;
    throw error;
  }
}

function requiresSuppressedWrites(effect: WorkflowSideEffectClass): boolean {
  return !["pure", "read"].includes(effect);
}

function safeExecutionMode(
  effect: WorkflowSideEffectClass,
  mode: OptimizerReplayExecutionMode,
): boolean {
  return !requiresSuppressedWrites(effect) || mode === "dry_run" || mode === "sandbox";
}

function unsupportedResult(
  id: string,
  reason: string,
) {
  return {
    id,
    status: "unsupported" as const,
    agreement: null,
    outputSchemaValid: false,
    invariantResults: [],
    fallbackCondition: reason,
    candidateDurationMs: 0,
    candidateCostEstimate: null,
    resourceUse: {},
  };
}

export async function evaluateOptimizerShadow(
  input: {
    compilerResult: OptimizerCompilerResult;
    replayEvaluation: OptimizerReplayEvaluation;
    observations: readonly OptimizerShadowObservation[];
    executionMode: OptimizerReplayExecutionMode;
  },
  dependencies: {
    execute: OptimizerShadowExecutor;
    evaluateAgreement: OptimizerShadowAgreementEvaluator;
    evaluateInvariant: OptimizerShadowInvariantEvaluator;
  },
): Promise<OptimizerShadowEvaluation> {
  const candidate=input.compilerResult.candidate;
  if(input.compilerResult.status!=="compiled" || !candidate){
    return {
      status:"failed",
      reasonCode:"optimizer_shadow_candidate_not_compiled",
      trustedPathAuthoritative:true,
      criticalInvariantFailure:false,
      observationResults:[],
      passedObservationCount:0,
      failedObservationCount:0,
      unsupportedObservationCount:0,
      totalCandidateDurationMs:0,
      totalCandidateCostEstimate:null,
    };
  }
  if(input.replayEvaluation.status!=="passed"){
    return {
      status:"failed",
      reasonCode:"optimizer_shadow_replay_gate_required",
      trustedPathAuthoritative:true,
      criticalInvariantFailure:false,
      observationResults:[],
      passedObservationCount:0,
      failedObservationCount:0,
      unsupportedObservationCount:0,
      totalCandidateDurationMs:0,
      totalCandidateCostEstimate:null,
    };
  }

  const candidateContract=contract(candidate);
  if(!safeExecutionMode(candidateContract.sideEffectClass,input.executionMode)){
    return {
      status:"failed",
      reasonCode:"optimizer_shadow_unsafe_execution_mode",
      trustedPathAuthoritative:true,
      criticalInvariantFailure:false,
      observationResults:input.observations.map((item)=>
        unsupportedResult(item.id,"live_side_effects_suppressed"),
      ),
      passedObservationCount:0,
      failedObservationCount:0,
      unsupportedObservationCount:input.observations.length,
      totalCandidateDurationMs:0,
      totalCandidateCostEstimate:null,
    };
  }

  const observationResults=[];
  let criticalInvariantFailure=false;

  for(const observation of input.observations){
    try{
      const execution=await dependencies.execute({
        candidate,
        safeInput:structuredClone(observation.input),
        executionMode:input.executionMode,
      });
      const schemaValid=outputSchemaValid(
        candidateContract.outputSchema,
        execution.output,
      );
      const agreementEvaluation=schemaValid
        ? await dependencies.evaluateAgreement({
            trustedOutput:structuredClone(observation.trustedOutput),
            candidateOutput:execution.output,
            outputSchema:candidateContract.outputSchema,
          })
        : {agreement:false,detail:"output_schema_invalid"};

      const invariantResults=[];
      for(const invariant of input.compilerResult.generatedTestSpec.businessInvariants){
        const result=await dependencies.evaluateInvariant({
          invariant,
          observation,
          candidateOutput:execution.output,
        });
        invariantResults.push({
          id:invariant.id,
          critical:invariant.critical,
          passed:result.passed,
          detail:result.detail??null,
        });
        if(invariant.critical && !result.passed) criticalInvariantFailure=true;
      }

      const invariantFailed=invariantResults.some((item)=>!item.passed);
      const passed=schemaValid && agreementEvaluation.agreement && !invariantFailed;
      observationResults.push({
        id:observation.id,
        status:passed?"passed" as const:"failed" as const,
        agreement:schemaValid?agreementEvaluation.agreement:false,
        outputSchemaValid:schemaValid,
        invariantResults,
        fallbackCondition:passed
          ? null
          : !schemaValid
            ? "output_schema_invalid"
            : !agreementEvaluation.agreement
              ? "trusted_output_disagreement"
              : "business_invariant_failure",
        candidateDurationMs:Math.max(0,execution.durationMs),
        candidateCostEstimate:execution.costEstimate===null
          ? null
          : Math.max(0,execution.costEstimate),
        resourceUse:Object.fromEntries(
          Object.entries(execution.resourceUse??{})
            .filter(([,value])=>Number.isFinite(value))
            .map(([key,value])=>[key,Math.max(0,value)]),
        ),
      });
    }catch{
      observationResults.push({
        id:observation.id,
        status:"failed" as const,
        agreement:null,
        outputSchemaValid:false,
        invariantResults:[],
        fallbackCondition:"candidate_execution_failed",
        candidateDurationMs:0,
        candidateCostEstimate:null,
        resourceUse:{},
      });
    }
  }

  const passedObservationCount=observationResults.filter((item)=>item.status==="passed").length;
  const failedObservationCount=observationResults.filter((item)=>item.status==="failed").length;
  const unsupportedObservationCount=observationResults.filter((item)=>item.status==="unsupported").length;
  const costs=observationResults
    .map((item)=>item.candidateCostEstimate)
    .filter((value):value is number=>value!==null);
  const passed=
    input.observations.length>0 &&
    passedObservationCount===input.observations.length &&
    !criticalInvariantFailure;

  return {
    status:passed?"passed":"failed",
    reasonCode:passed
      ?"optimizer_shadow_passed"
      :criticalInvariantFailure
        ?"optimizer_shadow_critical_invariant_failed"
        :"optimizer_shadow_observation_failed",
    trustedPathAuthoritative:true,
    criticalInvariantFailure,
    observationResults,
    passedObservationCount,
    failedObservationCount,
    unsupportedObservationCount,
    totalCandidateDurationMs:observationResults.reduce(
      (sum,item)=>sum+item.candidateDurationMs,
      0,
    ),
    totalCandidateCostEstimate:costs.length===0
      ? null
      : costs.reduce((sum,value)=>sum+value,0),
  };
}
