import { describe, expect, it } from "vitest";
import type { PipelineCaseLiveness } from "@paperclipai/shared";
import { derivePipelineLivenessBanner } from "./pipeline-liveness";

describe("pipeline liveness workflow targets", () => {
  it("links a failed Workflow automation to the exact Workflow run", () => {
    const liveness: PipelineCaseLiveness = {
      state: "attention",
      reason: "automation_failed",
      message: "Workflow step failed.",
      automation: {
        automationId: "stage-1:on_enter",
        targetKind: "workflow",
        targetRef: "11111111-1111-4111-8111-111111111111",
        workflowRunId: "22222222-2222-4222-8222-222222222222",
        executionId: "33333333-3333-4333-8333-333333333333",
        error: "workflow_failed",
      },
    };

    const view = derivePipelineLivenessBanner(liveness);

    expect(view).toMatchObject({
      title: "Automation failed",
      retryKind: "automation",
      workflowRunLink: {
        href:
          "/workflows/11111111-1111-4111-8111-111111111111/runs/22222222-2222-4222-8222-222222222222",
        label: "Open workflow run",
      },
    });
  });

  it("does not invent a Workflow run link for routine-backed failures", () => {
    const liveness: PipelineCaseLiveness = {
      state: "attention",
      reason: "automation_failed",
      message: "Routine automation failed.",
      automation: {
        automationId: "stage-1:on_enter",
        routineId: "11111111-1111-4111-8111-111111111111",
        targetKind: "routine",
        targetRef: "11111111-1111-4111-8111-111111111111",
        executionId: "33333333-3333-4333-8333-333333333333",
        error: "routine_failed",
      },
    };

    expect(
      derivePipelineLivenessBanner(liveness)?.workflowRunLink,
    ).toBeNull();
  });
});
