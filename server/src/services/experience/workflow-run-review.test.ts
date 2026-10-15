import { expect, it } from "vitest";
import type {
  WorkflowRevision,
  WorkflowRunDetail,
  WorkflowStepRun,
  WorkflowWait,
} from "@paperclipai/shared";
import { workflowRunReview } from "./workflow-run-review.js";
import { workflowNodeDefinitions } from "../workflows/workflow-node-registry.js";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date();
function fixture() {
  const revision: WorkflowRevision = {
    id: id(3),
    companyId: id(1),
    workflowId: id(2),
    revisionNumber: 2,
    state: "superseded",
    graph: {
      version: 1,
      nodes: [
        {
          id: "review",
          type: "human.approval",
          name: "Ask owner",
          position: { x: 0, y: 0 },
          config: { private: "SECRET-CONFIG" },
        },
      ],
      edges: [],
      variables: [{ name: "private", defaultValue: "SECRET-VARIABLE" }],
      settings: {},
    },
    inputSchema: { private: "SECRET-SCHEMA" },
    outputSchema: null,
    changeSummary: "SECRET-CHANGE",
    createdByUserId: "SECRET-USER",
    createdByAgentId: null,
    createdByRunId: null,
    createdAt: now,
  };
  const step: WorkflowStepRun = {
    id: id(5),
    companyId: id(1),
    workflowRunId: id(4),
    nodeId: "review",
    attempt: 1,
    status: "waiting",
    inputJson: "SECRET-INPUT",
    outputJson: "SECRET-OUTPUT",
    errorCode: "SECRET-CODE",
    errorMessage: "SECRET-ERROR",
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    agentId: id(99),
    heartbeatRunId: id(98),
    toolInvocationId: null,
    automationArtifactVersionId: null,
    createdAt: now,
    updatedAt: now,
  };
  const wait: WorkflowWait = {
    id: id(6),
    companyId: id(1),
    workflowRunId: id(4),
    nodeId: "review",
    waitKey: "SECRET-KEY",
    kind: "human_interaction",
    status: "active",
    wakeAt: null,
    timeoutAt: null,
    referenceType: "SECRET-REFERENCE",
    referenceId: id(97),
    signalTokenHash: "SECRET-HASH",
    resolutionJson: "SECRET-RESOLUTION",
    resolvedByType: null,
    resolvedById: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const detail: WorkflowRunDetail = {
    run: {
      id: id(4),
      companyId: id(1),
      workflowId: id(2),
      workflowRevisionId: id(3),
      triggerId: null,
      status: "waiting",
      source: "manual",
      triggerPayload: { private: "SECRET-TRIGGER" },
      responsibleUserId: "SECRET-RESPONSIBLE",
      idempotencyKey: "SECRET-IDEMPOTENCY",
      correlationId: "SECRET-CORRELATION",
      executionOwnerId: "SECRET-OWNER",
      leaseExpiresAt: null,
      ownerHeartbeatAt: null,
      startedAt: now,
      finishedAt: null,
      failureCode: "SECRET-FAILURE",
      failureMessage: "SECRET-MESSAGE",
      createdAt: now,
      updatedAt: now,
    },
    steps: [step],
    waits: [wait],
  };
  return { detail, revision };
}
const project = (f: ReturnType<typeof fixture>) =>
  workflowRunReview(f.detail, f.revision, workflowNodeDefinitions());
function branching(type: "core.condition" | "core.switch" = "core.condition") {
  const f = fixture();
  f.detail.waits = [];
  f.detail.steps[0].status = "succeeded";
  f.detail.steps[0].outputJson =
    type === "core.condition"
      ? { result: true, private: "SECRET-OUTPUT" }
      : { branchKey: "SECRET-BRANCH", private: "SECRET-OUTPUT" };
  f.revision.graph.nodes[0].type = type;
  f.revision.graph.nodes.push({
    ...f.revision.graph.nodes[0],
    id: "next",
    name: "Prepare report",
    type: "core.merge",
  });
  f.revision.graph.edges = [
    {
      id: "selected",
      source: "review",
      target: "next",
      sourceHandle: type === "core.condition" ? " TRUE " : "SECRET-BRANCH",
    },
  ];
  return f;
}
function choice(f: ReturnType<typeof fixture>) {
  const trace = project(f).trace;
  if (trace.state !== "available") throw new Error("trace unavailable");
  return trace.attempts[0].branchChoice;
}
it.each(["core.condition", "core.switch"] as const)(
  "projects %s's native completed checkpoint onto its historical next-step name without exposing payloads or claiming execution",
  (type) => {
    const f = branching(type),
      before = structuredClone(f);
    expect(choice(f)).toEqual({
      state: "selected",
      nextStep: "Prepare report",
    });
    expect(f.detail.steps).toHaveLength(1);
    expect(JSON.stringify(project(f))).not.toContain("SECRET");
    expect(f).toEqual(before);
  },
);
it.each([
  "deleted",
  "waiting",
  "failed",
  "recovered",
  "invalid_output",
  "missing_branch",
  "ambiguous_branch",
  "recovery_policy",
])("does not infer a branch from %s control history", (kind) => {
  const f = branching();
  if (kind === "deleted") f.detail.steps[0].payloadDeleted = true;
  if (kind === "recovered")
    f.detail.steps[0].failureResolution = {
      policy: "continue_with_null",
      resolved: true,
    };
  if (kind === "waiting" || kind === "failed") f.detail.steps[0].status = kind;
  if (kind === "invalid_output")
    f.detail.steps[0].outputJson = { result: "true" };
  if (kind === "missing_branch")
    f.revision.graph.edges[0].sourceHandle = "false";
  if (kind === "ambiguous_branch")
    f.revision.graph.edges.push({
      ...f.revision.graph.edges[0],
      id: "duplicate-choice",
    });
  if (kind === "recovery_policy")
    f.revision.graph.nodes[0].failurePolicy = "follow_failure_branch";
  // A later target attempt is not evidence for this control decision.
  f.detail.steps.push({
    ...f.detail.steps[0],
    id: id(8),
    nodeId: "next",
    status: "succeeded",
  });
  expect(choice(f)).toEqual({ state: "not_recorded" });
});
it("rejects a trace with an unbound graph edge rather than exposing a foreign destination", () => {
  const f = branching();
  f.revision.graph.edges[0].target = "foreign";
  expect(project(f).trace).toEqual({ state: "unavailable" });
});
it("uses the exact historical revision and recorded attempts, with no private payload, actor identity or decision", () => {
  const f = fixture();
  const before = structuredClone(f);
  const result = project(f);
  expect(result).toMatchObject({
    revisionId: id(3),
    revisionNumber: 2,
    revisionState: "superseded",
    status: "waiting",
    trace: {
      state: "available",
      attempts: [
        {
          name: "Ask owner",
          status: "waiting",
          execution: "agent",
          approvalCheckpoint: true,
          waitingFor: ["human_interaction"],
        },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(JSON.stringify(result)).not.toContain(id(99));
  expect(f).toEqual(before);
});
it.each(["companyId", "workflowId", "id"] as const)(
  "rejects a mismatched revision %s",
  (key) => {
    const f = fixture();
    f.revision[key] = id(50);
    expect(() => project(f)).toThrow("binding changed");
  },
);
it.each(["draft", "published", "superseded", "discarded"] as const)(
  "retains native %s revision identity without inventing current publication",
  (state) => {
    const f = fixture();
    f.revision.state = state;
    expect(project(f).revisionState).toBe(state);
  },
);
it("distinguishes no recorded attempts from an unavailable trace", () => {
  const f = fixture();
  f.detail.steps = [];
  f.detail.waits = [];
  expect(project(f).trace).toEqual({ state: "available", attempts: [] });
  f.detail.steps = Array(501).fill(fixture().detail.steps[0]);
  expect(project(f).trace).toEqual({ state: "unavailable" });
});
it.each([
  "foreign_step",
  "foreign_wait",
  "unknown_node",
  "duplicate_attempt",
  "duplicate_node",
])("does not truncate or trust invalid %s bindings", (kind) => {
  const f = fixture();
  if (kind === "foreign_step") f.detail.steps[0].companyId = id(50);
  if (kind === "foreign_wait") f.detail.waits[0].workflowRunId = id(50);
  if (kind === "unknown_node") f.detail.steps[0].nodeId = "missing";
  if (kind === "duplicate_attempt")
    f.detail.steps.push({ ...f.detail.steps[0], id: id(30) });
  if (kind === "duplicate_node")
    f.revision.graph.nodes.push({ ...f.revision.graph.nodes[0] });
  expect(project(f).trace).toEqual({ state: "unavailable" });
});
it("does not attach a current node wait to a completed earlier attempt", () => {
  const f = fixture();
  f.detail.steps[0].status = "retried";
  f.detail.steps.push({
    ...f.detail.steps[0],
    id: id(7),
    attempt: 2,
    status: "waiting",
    agentId: null,
    toolInvocationId: id(96),
    payloadDeleted: true,
  });
  const trace = project(f).trace;
  expect(trace.state).toBe("available");
  if (trace.state !== "available") throw new Error("trace unavailable");
  expect(trace.attempts[0].waitingFor).toEqual([]);
  expect(trace.attempts[1]).toMatchObject({
    execution: "tool",
    payloadUnavailable: true,
    waitingFor: ["human_interaction"],
  });
});
it("keeps unknown operation and absent execution metadata explicit", () => {
  const f = fixture();
  f.revision.graph.nodes[0].type = "missing";
  f.detail.steps[0].agentId = null;
  expect(project(f).trace).toMatchObject({
    attempts: [
      {
        operation: "Unknown operation",
        execution: "not_recorded",
        approvalCheckpoint: false,
      },
    ],
  });
});
