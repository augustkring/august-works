import { describe, expect, it, vi } from "vitest";
import type {
  OptimizerCompilerResult,
  OptimizerReplayEvaluation,
  OptimizerShadowObservation,
} from "@paperclipai/shared";

import { evaluateOptimizerShadow } from "./optimizer-shadow.js";

function compiler(sideEffectClass:"pure"|"write"="pure"):OptimizerCompilerResult{
  return {
    status:"compiled",
    reasonCode:"compiled",
    candidate:{
      kind:"artifact",
      artifact:{
        name:"Candidate",
        description:"Candidate",
        kind:"transform",
        language:null,
        inputSchema:{type:"object"},
        outputSchema:{
          type:"object",
          properties:{score:{type:"number"}},
          required:["score"],
          additionalProperties:false,
        },
        riskClass:sideEffectClass==="write"?"C2":"C1",
        sideEffectClass,
        createdByOptimizerSuggestionId:"00000000-0000-4000-8000-000000000010",
        originWorkflowId:"00000000-0000-4000-8000-000000000002",
        originNodeId:null,
        sourceCode:"{}",
        dependencyManifest:{capabilityRefs:[],packages:[]},
        testSpec:{
          schema:"optimizer.compiler.test_spec.v1",
          suggestionId:"00000000-0000-4000-8000-000000000010",
          traceSamples:[],
          businessInvariants:[
            {id:"score-range",description:"Score stays in range",critical:true},
          ],
          requiredCapabilityRefs:[],
        },
      },
    },
    dependencyManifest:{capabilityRefs:[],packages:[]},
    generatedTestSpec:{
      schema:"optimizer.compiler.test_spec.v1",
      suggestionId:"00000000-0000-4000-8000-000000000010",
      traceSamples:[],
      businessInvariants:[
        {id:"score-range",description:"Score stays in range",critical:true},
      ],
      requiredCapabilityRefs:[],
    },
    knownAssumptions:[],
    unsupportedCases:[],
    fallbackConditions:[],
  };
}

function replay():OptimizerReplayEvaluation{
  return {
    status:"passed",
    reasonCode:"optimizer_replay_passed",
    criticalInvariantFailure:false,
    requiredCategories:["representative","boundary","shape_variant"],
    missingCategories:[],
    caseResults:[],
    passedCaseCount:3,
    failedCaseCount:0,
    unsupportedCaseCount:0,
    totalDurationMs:3,
    totalCostEstimate:0,
  };
}

const observations:OptimizerShadowObservation[]=[
  {id:"live-1",sourceRunId:"run-10",input:{x:1},trustedOutput:{score:1}},
  {id:"live-2",sourceRunId:"run-11",input:{x:2},trustedOutput:{score:2}},
];

describe("optimizer shadow evaluation",()=>{
  it("keeps the trusted path authoritative and records agreement evidence",async()=>{
    const execute=vi.fn(async({safeInput}:{safeInput:unknown})=>({
      output:{score:(safeInput as {x:number}).x},
      durationMs:4,
      costEstimate:1,
      resourceUse:{cpuMs:2},
    }));
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler(),
        replayEvaluation:replay(),
        observations,
        executionMode:"pure",
      },
      {
        execute,
        evaluateAgreement:async({trustedOutput,candidateOutput})=>({
          agreement:JSON.stringify(trustedOutput)===JSON.stringify(candidateOutput),
        }),
        evaluateInvariant:async()=>({passed:true}),
      },
    );
    expect(result).toMatchObject({
      status:"passed",
      reasonCode:"optimizer_shadow_passed",
      trustedPathAuthoritative:true,
      passedObservationCount:2,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("requires a passing historical replay before shadow execution",async()=>{
    const execute=vi.fn();
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler(),
        replayEvaluation:{...replay(),status:"failed"},
        observations,
        executionMode:"pure",
      },
      {
        execute,
        evaluateAgreement:async()=>({agreement:true}),
        evaluateInvariant:async()=>({passed:true}),
      },
    );
    expect(result.reasonCode).toBe("optimizer_shadow_replay_gate_required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when a nominally passed replay carries invalid gate state",async()=>{
    const execute=vi.fn();
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler(),
        replayEvaluation:{
          ...replay(),
          status:"passed",
          criticalInvariantFailure:true,
        },
        observations,
        executionMode:"pure",
      },
      {
        execute,
        evaluateAgreement:async()=>({agreement:true}),
        evaluateInvariant:async()=>({passed:true}),
      },
    );
    expect(result.reasonCode).toBe("optimizer_shadow_replay_gate_required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("sanitizes non-finite shadow runtime metrics",async()=>{
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler(),
        replayEvaluation:replay(),
        observations:[observations[0]!],
        executionMode:"pure",
      },
      {
        execute:async()=>({
          output:{score:1},
          durationMs:Number.POSITIVE_INFINITY,
          costEstimate:Number.NaN,
          resourceUse:{cpuMs:Number.NaN,wallMs:Number.POSITIVE_INFINITY},
        }),
        evaluateAgreement:async()=>({agreement:true}),
        evaluateInvariant:async()=>({passed:true}),
      },
    );
    expect(result).toMatchObject({
      status:"passed",
      totalCandidateDurationMs:0,
      totalCandidateCostEstimate:null,
      observationResults:[
        expect.objectContaining({
          candidateDurationMs:0,
          candidateCostEstimate:null,
          resourceUse:{},
        }),
      ],
    });
  });

  it("never executes write candidates in a pure/live-style mode",async()=>{
    const execute=vi.fn();
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler("write"),
        replayEvaluation:replay(),
        observations,
        executionMode:"pure",
      },
      {
        execute,
        evaluateAgreement:async()=>({agreement:true}),
        evaluateInvariant:async()=>({passed:true}),
      },
    );
    expect(result).toMatchObject({
      status:"failed",
      reasonCode:"optimizer_shadow_unsafe_execution_mode",
      unsupportedObservationCount:2,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails on candidate disagreement without mutating trusted output",async()=>{
    const trusted={score:1};
    const inputObservation:OptimizerShadowObservation={
      id:"live",
      sourceRunId:null,
      input:{x:1},
      trustedOutput:trusted,
    };
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler(),
        replayEvaluation:replay(),
        observations:[inputObservation],
        executionMode:"pure",
      },
      {
        execute:async()=>({
          output:{score:2},
          durationMs:2,
          costEstimate:null,
        }),
        evaluateAgreement:async()=>({agreement:false}),
        evaluateInvariant:async()=>({passed:true}),
      },
    );
    expect(result).toMatchObject({
      status:"failed",
      reasonCode:"optimizer_shadow_observation_failed",
      observationResults:[
        expect.objectContaining({
          agreement:false,
          fallbackCondition:"trusted_output_disagreement",
        }),
      ],
    });
    expect(trusted).toEqual({score:1});
  });

  it("blocks the whole shadow gate on one critical invariant failure",async()=>{
    const result=await evaluateOptimizerShadow(
      {
        compilerResult:compiler(),
        replayEvaluation:replay(),
        observations:[observations[0]!],
        executionMode:"pure",
      },
      {
        execute:async()=>({
          output:{score:1},
          durationMs:1,
          costEstimate:0,
        }),
        evaluateAgreement:async()=>({agreement:true}),
        evaluateInvariant:async()=>({
          passed:false,
          detail:"Critical business rule failed",
        }),
      },
    );
    expect(result).toMatchObject({
      status:"failed",
      reasonCode:"optimizer_shadow_critical_invariant_failed",
      criticalInvariantFailure:true,
    });
  });
});
