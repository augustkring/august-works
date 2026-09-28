import { describe, expect, it } from "vitest";
import {
  pipelineAutomationTargetSchema,
  pipelineStageOnEnterSchema,
} from "./validators/pipeline.js";

describe("pipeline automation targets", () => {
  it("keeps legacy run_routine stage automation valid", () => {
    const routineId = "11111111-1111-4111-8111-111111111111";
    expect(
      pipelineStageOnEnterSchema.parse({
        type: "run_routine",
        routineId,
      }),
    ).toMatchObject({
      type: "run_routine",
      routineId,
    });
  });

  it("accepts a Workflow as a generalized stage automation target", () => {
    const workflowId = "22222222-2222-4222-8222-222222222222";
    expect(
      pipelineStageOnEnterSchema.parse({
        type: "run_target",
        target: {
          kind: "workflow",
          workflowId,
        },
      }),
    ).toMatchObject({
      type: "run_target",
      target: {
        kind: "workflow",
        workflowId,
      },
    });
  });

  it("accepts an explicit Routine generalized target", () => {
    const routineId = "11111111-1111-4111-8111-111111111111";
    expect(
      pipelineAutomationTargetSchema.parse({
        kind: "routine",
        routineId,
      }),
    ).toEqual({
      kind: "routine",
      routineId,
    });
  });

  it("fails closed for an unknown target kind", () => {
    const result = pipelineStageOnEnterSchema.safeParse({
      type: "run_target",
      target: {
        kind: "script",
        scriptId: "33333333-3333-4333-8333-333333333333",
      },
    });
    expect(result.success).toBe(false);
  });
});
