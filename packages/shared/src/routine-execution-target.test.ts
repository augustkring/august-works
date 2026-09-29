import { describe, expect, it } from "vitest";
import {
  createRoutineSchema,
  routineRevisionSnapshotV1Schema,
  updateRoutineSchema,
} from "./validators/routine.js";

describe("routine execution targets", () => {
  it("accepts a workflow as the routine execution target", () => {
    const workflowId = "11111111-1111-4111-8111-111111111111";
    const parsed = createRoutineSchema.parse({
      title: "Weekly deterministic report",
      executionTarget: {
        kind: "workflow",
        workflowId,
      },
    });

    expect(parsed.executionTarget).toEqual({
      kind: "workflow",
      workflowId,
    });
    expect(parsed.assigneeAgentId).toBeUndefined();
  });

  it("rejects conflicting workflow and agent targets", () => {
    const result = createRoutineSchema.safeParse({
      title: "Conflicting routine",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      executionTarget: {
        kind: "workflow",
        workflowId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["assigneeAgentId"],
        }),
      ]),
    );
  });

  it("keeps patch semantics distinct between omitted and explicitly cleared targets", () => {
    expect(updateRoutineSchema.parse({})).not.toHaveProperty(
      "executionTarget",
    );
    expect(
      updateRoutineSchema.parse({ executionTarget: null }),
    ).toMatchObject({
      executionTarget: null,
    });
  });

  it("keeps legacy routine revision snapshots readable without target fields", () => {
    const snapshot = routineRevisionSnapshotV1Schema.parse({
      version: 1,
      routine: {
        id: "33333333-3333-4333-8333-333333333333",
        companyId: "44444444-4444-4444-8444-444444444444",
        projectId: null,
        goalId: null,
        parentIssueId: null,
        title: "Legacy routine",
        description: null,
        assigneeAgentId: "22222222-2222-4222-8222-222222222222",
        priority: "medium",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        activityGatePolicy: "always",
        activityGateScope: "company",
        variables: [],
        env: null,
        responsibleUserId: "user-1",
      },
      triggers: [],
    });

    expect(snapshot.routine.executionTargetKind).toBeUndefined();
    expect(snapshot.routine.executionTargetRef).toBeUndefined();
    expect(snapshot.routine.assigneeAgentId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });
});
