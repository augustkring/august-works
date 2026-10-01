import { describe, expect, it } from "vitest";
import type { OptimizerTrace } from "@paperclipai/shared";

import { detectOptimizerCandidates } from "./optimizer-pattern-detector.js";

function trace(
  runId: string,
  overrides: Partial<OptimizerTrace> = {},
): OptimizerTrace {
  return {
    companyId: "00000000-0000-4000-8000-000000000001",
    workflowId: "00000000-0000-4000-8000-000000000002",
    workflowRevisionId: "00000000-0000-4000-8000-000000000003",
    taskId: null,
    routineId: null,
    runId,
    executorType: "workflow",
    steps: [
      {
        ordinal: 1,
        operationType: "core.transform",
        capabilityRef: null,
        inputShapeHash: "a".repeat(64),
        outputShapeHash: "b".repeat(64),
        sideEffectClass: "pure",
        durationMs: 120,
        cost: 4,
        outcome: "success",
      },
    ],
    finalOutcome: "succeeded",
    humanCorrection: false,
    createdAt: "2026-09-30T20:00:00.000Z",
    ...overrides,
  };
}

describe("optimizer pattern detector", () => {
  it("suggests a stable deterministic transform after three distinct runs", () => {
    const suggestions = detectOptimizerCandidates([
      trace("run-1"),
      trace("run-2"),
      trace("run-3"),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      candidateType: "transform",
      operationTypes: ["core.transform"],
      sideEffectRisk: "low",
      observationCount: 3,
      successRate: 1,
      humanCorrectionRate: 0,
      inputShapeStability: 1,
      outputShapeStability: 1,
      averageDurationMs: 120,
      averageCost: 4,
    });
  });

  it("does not let duplicate trace imports satisfy the observation threshold", () => {
    expect(
      detectOptimizerCandidates([
        trace("run-1"),
        trace("run-1"),
        trace("run-2"),
      ]),
    ).toEqual([]);
  });

  it("preserves unknown correction evidence without fabricating a zero rate", () => {
    const suggestions = detectOptimizerCandidates([
      trace("run-1", { humanCorrection: undefined }),
      trace("run-2", { humanCorrection: undefined }),
      trace("run-3", { humanCorrection: undefined }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      candidateType: "transform",
      sideEffectRisk: "low",
      humanCorrectionRate: null,
      humanCorrectionEvidenceCount: 0,
      humanCorrectionEvidenceCoverage: 0,
    });
  });

  it("filters unstable shapes and high human-correction rates", () => {
    const unstable = detectOptimizerCandidates([
      trace("run-1"),
      trace("run-2", {
        steps: [
          {
            ...trace("x").steps[0]!,
            inputShapeHash: "c".repeat(64),
            outputShapeHash: "d".repeat(64),
          },
        ],
      }),
      trace("run-3", {
        steps: [
          {
            ...trace("x").steps[0]!,
            inputShapeHash: "e".repeat(64),
            outputShapeHash: "f".repeat(64),
          },
        ],
      }),
    ]);
    expect(unstable).toEqual([]);

    const corrected = detectOptimizerCandidates([
      trace("run-1", { humanCorrection: true }),
      trace("run-2", { humanCorrection: true }),
      trace("run-3"),
    ]);
    expect(corrected).toEqual([]);
  });

  it("never treats agent or human semantic steps as deterministic candidates", () => {
    const semanticSteps = [
      {
        ...trace("x").steps[0]!,
        operationType: "agent.task",
        sideEffectClass: "write",
      },
    ];
    const suggestions = detectOptimizerCandidates([
      trace("run-1", { steps: semanticSteps }),
      trace("run-2", { steps: semanticSteps }),
      trace("run-3", { steps: semanticSteps }),
    ]);

    expect(suggestions).toEqual([]);
  });

  it("keeps identical operation types on different ordinals as distinct spans", () => {
    const first = [
      trace("a-1"),
      trace("a-2"),
      trace("a-3"),
    ];
    const second = [
      trace("b-1", {
        steps: [{ ...trace("x").steps[0]!, ordinal: 2 }],
      }),
      trace("b-2", {
        steps: [{ ...trace("x").steps[0]!, ordinal: 2 }],
      }),
      trace("b-3", {
        steps: [{ ...trace("x").steps[0]!, ordinal: 2 }],
      }),
    ];

    const suggestions = detectOptimizerCandidates([...first, ...second]);
    expect(suggestions).toHaveLength(2);
    expect(
      suggestions.map((suggestion) => suggestion.stepOrdinals).sort(),
    ).toEqual([[1], [2]]);
    expect(
      new Set(suggestions.map((suggestion) => suggestion.signatureHash)).size,
    ).toBe(2);
  });

  it("requires complete correction evidence for side-effectful candidates", () => {
    const toolStep = {
      ...trace("x").steps[0]!,
      operationType: "connector.action",
      capabilityRef: "tool:00000000-0000-4000-8000-000000000099",
      sideEffectClass: "write",
    };

    expect(
      detectOptimizerCandidates([
        trace("run-1", { steps: [toolStep], humanCorrection: undefined }),
        trace("run-2", { steps: [toolStep], humanCorrection: false }),
        trace("run-3", { steps: [toolStep], humanCorrection: false }),
      ]),
    ).toEqual([]);
  });

  it("keeps write-side-effect patterns suggestion-only but marks their risk", () => {
    const toolStep = {
      ...trace("x").steps[0]!,
      operationType: "connector.action",
      capabilityRef: "tool:00000000-0000-4000-8000-000000000099",
      sideEffectClass: "write",
    };
    const suggestions = detectOptimizerCandidates([
      trace("run-1", { steps: [toolStep] }),
      trace("run-2", { steps: [toolStep] }),
      trace("run-3", { steps: [toolStep] }),
    ]);

    expect(suggestions[0]).toMatchObject({
      candidateType: "tool_chain",
      sideEffectRisk: "medium",
    });
  });
});
