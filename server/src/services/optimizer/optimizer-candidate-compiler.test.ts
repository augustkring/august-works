import { describe, expect, it } from "vitest";
import type {
  OptimizerCompilerInput,
  WorkflowOptimizerSuggestion,
} from "@paperclipai/shared";

import { compileOptimizerCandidate } from "./optimizer-candidate-compiler.js";

function suggestion(
  overrides: Partial<WorkflowOptimizerSuggestion> = {},
): WorkflowOptimizerSuggestion {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    companyId: "00000000-0000-4000-8000-000000000001",
    workflowId: "00000000-0000-4000-8000-000000000002",
    workflowRevisionId: "00000000-0000-4000-8000-000000000003",
    signatureHash: "a".repeat(64),
    status: "detected",
    candidateType: "transform",
    stepOrdinals: [2],
    operationTypes: ["core.transform"],
    capabilityRefs: [null],
    sideEffectRisk: "low",
    observationCount: 3,
    successRate: 1,
    humanCorrectionRate: 0,
    humanCorrectionEvidenceCount: 3,
    humanCorrectionEvidenceCoverage: 1,
    inputShapeStability: 1,
    outputShapeStability: 1,
    averageDurationMs: 100,
    averageCost: 2,
    estimatedLatencySavingsMs: 100,
    estimatedCostSavings: 2,
    observedRunIds: ["run-1", "run-2", "run-3"],
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

function input(
  overrides: Partial<OptimizerCompilerInput> = {},
): OptimizerCompilerInput {
  return {
    suggestion: suggestion(),
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
      additionalProperties: false,
    },
    businessInvariants: [
      {
        id: "email-present",
        description: "Output email remains present.",
        critical: true,
      },
    ],
    allowedCapabilityRefs: [],
    traceSamples: [
      {
        runId: "run-1",
        inputShapeHash: "b".repeat(64),
        outputShapeHash: "c".repeat(64),
        outcome: "success",
      },
      {
        runId: "run-2",
        inputShapeHash: "b".repeat(64),
        outputShapeHash: "c".repeat(64),
        outcome: "success",
      },
      {
        runId: "run-3",
        inputShapeHash: "b".repeat(64),
        outputShapeHash: "c".repeat(64),
        outcome: "success",
      },
    ],
    observedImplementation: {
      kind: "transform",
      sourceCode: JSON.stringify({
        email: "lower(trim(input.email))",
      }),
    },
    riskClass: "C1",
    sideEffectClass: "pure",
    ...overrides,
  };
}

describe("optimizer candidate compiler", () => {
  it("compiles an observed deterministic transform without broadening authority", () => {
    const result = compileOptimizerCandidate(input());

    expect(result).toMatchObject({
      status: "compiled",
      reasonCode: "optimizer_compiler_artifact_compiled",
      dependencyManifest: { capabilityRefs: [], packages: [] },
      candidate: {
        kind: "artifact",
        artifact: {
          kind: "transform",
          language: null,
          createdByOptimizerSuggestionId:
            "00000000-0000-4000-8000-000000000010",
          originWorkflowId: "00000000-0000-4000-8000-000000000002",
          riskClass: "C1",
          sideEffectClass: "pure",
        },
      },
    });
    expect(result.generatedTestSpec.businessInvariants).toEqual([
      expect.objectContaining({ id: "email-present", critical: true }),
    ]);
    expect(JSON.stringify(result)).not.toContain(" Alice@Example.COM ");
  });

  it("fails closed when the suggestion needs a capability outside the allowlist", () => {
    const s = suggestion({
      candidateType: "tool_chain",
      capabilityRefs: ["tool:crm.update"],
      sideEffectRisk: "medium",
      stepOrdinals: [2, 3],
      operationTypes: ["connector.action", "connector.action"],
    });
    const result = compileOptimizerCandidate(
      input({
        suggestion: s,
        allowedCapabilityRefs: [],
        riskClass: "C2",
        sideEffectClass: "write",
        observedImplementation: {
          kind: "subgraph",
          stepOrdinals: [2, 3],
          nodes: [],
          edges: [],
        },
      }),
    );

    expect(result).toMatchObject({
      status: "unsupported",
      reasonCode: "optimizer_compiler_capability_not_allowed",
      candidate: null,
    });
    expect(result.unsupportedCases).toContain(
      "capability_not_allowed:tool:crm.update",
    );
  });

  it("preserves exact subgraph span and only the explicitly allowed capability set", () => {
    const s = suggestion({
      candidateType: "tool_chain",
      capabilityRefs: ["tool:crm.read"],
      sideEffectRisk: "low",
      stepOrdinals: [2, 3],
      operationTypes: ["connector.action", "core.transform"],
    });
    const result = compileOptimizerCandidate(
      input({
        suggestion: s,
        allowedCapabilityRefs: ["tool:crm.read", "tool:unrelated"],
        riskClass: "C1",
        sideEffectClass: "read",
        observedImplementation: {
          kind: "subgraph",
          stepOrdinals: [2, 3],
          nodes: [
            {
              id: "read",
              type: "connector.action",
              name: "Read CRM",
              position: { x: 0, y: 0 },
              config: { toolCatalogEntryId: "crm.read" },
            },
          ],
          edges: [],
        },
      }),
    );

    expect(result).toMatchObject({
      status: "compiled",
      candidate: {
        kind: "subgraph",
        subgraph: { stepOrdinals: [2, 3] },
      },
      dependencyManifest: {
        capabilityRefs: ["tool:crm.read"],
        packages: [],
      },
    });
    expect(result.dependencyManifest.capabilityRefs).not.toContain(
      "tool:unrelated",
    );
  });

  it("rejects unobserved trace samples and mismatched risk classification", () => {
    const unknown = compileOptimizerCandidate(
      input({
        traceSamples: [
          {
            runId: "run-unknown",
            inputShapeHash: null,
            outputShapeHash: null,
            outcome: "success",
          },
        ],
      }),
    );
    expect(unknown.reasonCode).toBe(
      "optimizer_compiler_trace_sample_not_observed",
    );

    const riskMismatch = compileOptimizerCandidate(
      input({
        suggestion: suggestion({ sideEffectRisk: "high" }),
        riskClass: "C1",
        sideEffectClass: "pure",
      }),
    );
    expect(riskMismatch.reasonCode).toBe(
      "optimizer_compiler_risk_classification_mismatch",
    );
  });

  it("does not invent generated code when no explicit generated source exists", () => {
    const result = compileOptimizerCandidate(
      input({
        suggestion: suggestion({
          candidateType: "typescript",
          operationTypes: ["core.transform"],
        }),
        observedImplementation: null,
      }),
    );

    expect(result).toMatchObject({
      status: "unsupported",
      reasonCode: "optimizer_compiler_observed_implementation_required",
      candidate: null,
    });
  });

  it("keeps generated TypeScript inside the qualified pure C0/C1 pilot", () => {
    const s = suggestion({
      candidateType: "typescript",
      sideEffectRisk: "medium",
    });
    const result = compileOptimizerCandidate(
      input({
        suggestion: s,
        observedImplementation: {
          kind: "generated_code",
          language: "typescript",
          sourceCode: "export default (input) => input",
        },
        riskClass: "C2",
        sideEffectClass: "write",
      }),
    );

    expect(result).toMatchObject({
      status: "unsupported",
      reasonCode: "optimizer_compiler_generated_code_pilot_denied",
    });
  });
});
