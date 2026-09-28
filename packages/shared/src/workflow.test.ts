import { describe, expect, it } from "vitest";
import {
  emptyWorkflowGraphV1,
  workflowGraphV1Schema,
  workflowRetryPolicySchema,
} from "./validators/workflow.js";

describe("Workflow Graph V1", () => {
  it("accepts an empty draft graph", () => {
    expect(workflowGraphV1Schema.parse(emptyWorkflowGraphV1)).toEqual(
      emptyWorkflowGraphV1,
    );
  });

  it("accepts a bounded typed graph envelope before node registry validation", () => {
    const graph = {
      version: 1 as const,
      nodes: [
        {
          id: "start",
          type: "core.start",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "finish",
          type: "core.finish",
          name: "Finish",
          position: { x: 240, y: 0 },
          config: {},
          retryPolicy: {
            mode: "fixed" as const,
            maxAttempts: 3,
            initialDelayMs: 1_000,
            maxDelayMs: 5_000,
          },
        },
      ],
      edges: [{ id: "edge-1", source: "start", target: "finish" }],
      variables: [{ name: "threshold", required: true, defaultValue: 10 }],
      settings: { totalDeadlineSeconds: 3_600 },
    };
    expect(workflowGraphV1Schema.parse(graph)).toEqual(graph);
  });

  it("rejects duplicate node/edge/variable identities and dangling edges", () => {
    const parsed = workflowGraphV1Schema.safeParse({
      version: 1,
      nodes: [
        { id: "same", type: "core.start", name: "One", position: { x: 0, y: 0 }, config: {} },
        { id: "same", type: "core.finish", name: "Two", position: { x: 1, y: 1 }, config: {} },
      ],
      edges: [
        { id: "edge", source: "same", target: "missing" },
        { id: "edge", source: "missing", target: "same" },
      ],
      variables: [
        { name: "value" },
        { name: "value" },
      ],
      settings: {},
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toEqual(expect.arrayContaining([
        "Duplicate workflow node id: same",
        "Duplicate workflow edge id: edge",
        "Unknown target node: missing",
        "Unknown source node: missing",
        "Duplicate workflow variable: value",
      ]));
    }
  });

  it("enforces retry invariants", () => {
    expect(workflowRetryPolicySchema.safeParse({
      mode: "none",
      maxAttempts: 2,
      initialDelayMs: 0,
      maxDelayMs: 0,
    }).success).toBe(false);
    expect(workflowRetryPolicySchema.safeParse({
      mode: "exponential",
      maxAttempts: 4,
      initialDelayMs: 5_000,
      maxDelayMs: 1_000,
    }).success).toBe(false);
  });
});
