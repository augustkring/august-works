import { describe, expect, it } from "vitest";
import type {
  OptimizerCompilerResult,
  OptimizerReplayCase,
} from "@paperclipai/shared";

import { evaluateOptimizerHistoricalReplay } from "./optimizer-historical-replay.js";

function compilerResult(
  sideEffectClass: "pure" | "write" = "pure",
): OptimizerCompilerResult {
  return {
    status: "compiled",
    reasonCode: "optimizer_compiler_artifact_compiled",
    candidate: {
      kind: "artifact",
      artifact: {
        name: "Normalize email",
        description: "Replay candidate",
        kind: "transform",
        language: null,
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
        riskClass: sideEffectClass === "write" ? "C2" : "C1",
        sideEffectClass,
        createdByOptimizerSuggestionId:
          "00000000-0000-4000-8000-000000000010",
        originWorkflowId: "00000000-0000-4000-8000-000000000002",
        originNodeId: null,
        sourceCode: JSON.stringify({
          email: "lower(trim(input.email))",
        }),
        dependencyManifest: { capabilityRefs: [], packages: [] },
        testSpec: {
          schema: "optimizer.compiler.test_spec.v1",
          suggestionId: "00000000-0000-4000-8000-000000000010",
          traceSamples: [
            {
              runId: "run-1",
              inputShapeHash: "a".repeat(64),
              outputShapeHash: "b".repeat(64),
              outcome: "success",
            },
          ],
          businessInvariants: [
            {
              id: "email-present",
              description: "Email remains present",
              critical: true,
            },
          ],
          requiredCapabilityRefs: [],
        },
      },
    },
    dependencyManifest: { capabilityRefs: [], packages: [] },
    generatedTestSpec: {
      schema: "optimizer.compiler.test_spec.v1",
      suggestionId: "00000000-0000-4000-8000-000000000010",
      traceSamples: [
        {
          runId: "run-1",
          inputShapeHash: "a".repeat(64),
          outputShapeHash: "b".repeat(64),
          outcome: "success",
        },
      ],
      businessInvariants: [
        {
          id: "email-present",
          description: "Email remains present",
          critical: true,
        },
      ],
      requiredCapabilityRefs: [],
    },
    knownAssumptions: [],
    unsupportedCases: [],
    fallbackConditions: [],
  };
}

function cases(): OptimizerReplayCase[] {
  return [
    {
      id: "representative",
      category: "representative",
      sourceRunId: "run-1",
      input: { email: " ALICE@EXAMPLE.COM " },
      expectedOutput: { email: "alice@example.com" },
    },
    {
      id: "boundary",
      category: "boundary",
      sourceRunId: null,
      input: { email: "a@b.co" },
      expectedOutput: { email: "a@b.co" },
    },
    {
      id: "shape",
      category: "shape_variant",
      sourceRunId: null,
      input: { email: "BOB@EXAMPLE.COM" },
      expectedOutput: { email: "bob@example.com" },
    },
  ];
}

describe("optimizer historical replay", () => {
  it("passes only when every required case and critical invariant passes", async () => {
    const result = await evaluateOptimizerHistoricalReplay(
      {
        compilerResult: compilerResult(),
        cases: cases(),
        executionMode: "pure",
      },
      {
        execute: async ({ replayCase }) => ({
          output: {
            email: String(
              (replayCase.input as { email: string }).email,
            )
              .trim()
              .toLowerCase(),
          },
          durationMs: 2,
          costEstimate: 0,
        }),
        evaluateInvariant: async () => ({ passed: true }),
      },
    );

    expect(result).toMatchObject({
      status: "passed",
      reasonCode: "optimizer_replay_passed",
      criticalInvariantFailure: false,
      passedCaseCount: 3,
      failedCaseCount: 0,
      unsupportedCaseCount: 0,
      missingCategories: [],
    });
  });

  it("fails the whole replay on one critical invariant even when outputs match", async () => {
    const result = await evaluateOptimizerHistoricalReplay(
      {
        compilerResult: compilerResult(),
        cases: cases(),
        executionMode: "pure",
      },
      {
        execute: async ({ replayCase }) => ({
          output: {
            email: String(
              (replayCase.input as { email: string }).email,
            )
              .trim()
              .toLowerCase(),
          },
          durationMs: 1,
          costEstimate: null,
        }),
        evaluateInvariant: async ({ replayCase }) => ({
          passed: replayCase.id !== "boundary",
          detail:
            replayCase.id === "boundary" ? "Boundary invariant failed" : null,
        }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      reasonCode: "optimizer_replay_critical_invariant_failed",
      criticalInvariantFailure: true,
    });
  });

  it("does not treat a high aggregate score as enough when dataset coverage is incomplete", async () => {
    const onlyRepresentative = cases().filter(
      (item) => item.category === "representative",
    );
    const result = await evaluateOptimizerHistoricalReplay(
      {
        compilerResult: compilerResult(),
        cases: onlyRepresentative,
        executionMode: "pure",
      },
      {
        execute: async () => ({
          output: { email: "alice@example.com" },
          durationMs: 1,
          costEstimate: 0,
        }),
        evaluateInvariant: async () => ({ passed: true }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      reasonCode: "optimizer_replay_dataset_incomplete",
      missingCategories: expect.arrayContaining(["boundary", "shape_variant"]),
    });
  });

  it("blocks live-style replay for write candidates", async () => {
    const result = await evaluateOptimizerHistoricalReplay(
      {
        compilerResult: compilerResult("write"),
        cases: cases(),
        executionMode: "pure",
      },
      {
        execute: async () => {
          throw new Error("must not execute");
        },
        evaluateInvariant: async () => ({ passed: true }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      reasonCode: "optimizer_replay_unsafe_execution_mode",
      unsupportedCaseCount: 3,
    });
  });

  it("records output schema and exact-output differences per case without raw diff payloads", async () => {
    const result = await evaluateOptimizerHistoricalReplay(
      {
        compilerResult: compilerResult(),
        cases: cases(),
        executionMode: "pure",
      },
      {
        execute: async () => ({
          output: { wrong: true },
          durationMs: 3,
          costEstimate: 1,
        }),
        evaluateInvariant: async () => ({ passed: true }),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.caseResults[0]).toMatchObject({
      status: "failed",
      outputSchemaValid: false,
      differenceSummary: "output_schema_invalid",
    });
    expect(JSON.stringify(result)).not.toContain("ALICE@EXAMPLE.COM");
  });
});
