import { expect, it } from "vitest";
import type { WorkflowDetail, WorkflowGraphV1 } from "@paperclipai/shared";
import { workflowNodeDefinitions } from "../workflows/workflow-node-registry.js";
import { workflowReview } from "./workflow-review.js";

const graph: WorkflowGraphV1 = {
  version: 1,
  nodes: [
    {
      id: "begin",
      type: "core.manual_trigger",
      name: "Start",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "review",
      type: "human.approval",
      name: "Ask the owner",
      position: { x: 0, y: 1 },
      config: { prompt: "PRIVATE-PROMPT", recipients: ["PRIVATE-RECIPIENT"] },
    },
    {
      id: "missing",
      type: "not.registered",
      name: "Unknown",
      position: { x: 1, y: 1 },
      config: { credential: "SECRET" },
    },
  ],
  edges: [
    {
      id: "one",
      source: "begin",
      target: "review",
      sourceHandle: "true",
      label: "Needs review",
    },
    {
      id: "two",
      source: "begin",
      target: "missing",
      sourceHandle: "false",
      label: "Other path",
    },
  ],
  variables: [{ name: "secret", defaultValue: "PRIVATE-DEFAULT" }],
  settings: {},
};
function detail(): WorkflowDetail {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    companyId: "10000000-0000-4000-8000-000000000002",
    name: "Review deals",
    description: null,
    status: "active",
    projectId: null,
    folderId: null,
    publishedRevisionId: null,
    draftRevisionId: "10000000-0000-4000-8000-000000000003",
    createdByUserId: "owner",
    createdByAgentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    publishedRevision: null,
    draftRevision: {
      id: "10000000-0000-4000-8000-000000000003",
      companyId: "10000000-0000-4000-8000-000000000002",
      workflowId: "10000000-0000-4000-8000-000000000001",
      revisionNumber: 1,
      state: "draft",
      graph: structuredClone(graph),
      inputSchema: { secret: "PRIVATE-SCHEMA" },
      outputSchema: null,
      changeSummary: "PRIVATE-CHANGE",
      createdByUserId: "owner",
      createdByAgentId: null,
      createdByRunId: null,
      createdAt: new Date(),
    },
  };
}
it("preserves declared branching and excludes private configuration while keeping unknown authority explicit", () => {
  const result = workflowReview(detail(), workflowNodeDefinitions(), true);
  expect(result.status).toBe("draft");
  expect(result.active).toBeNull();
  expect(result.draft?.steps[0].next).toEqual([
    { number: 2, label: "Needs review", output: "true" },
    { number: 3, label: "Other path", output: "false" },
  ]);
  expect(result.draft?.steps[1].approval).toBe("checkpoint");
  expect(result.draft?.steps[0].approval).toBe("not_verified");
  expect(result.draft?.steps[2]).toMatchObject({
    effect: "unknown",
    testMode: "unavailable",
    retry: "unknown",
  });
  const payload = JSON.stringify(result);
  for (const forbidden of [
    "PRIVATE-",
    "SECRET",
    "position",
    "config",
    "inputSchema",
    "createdBy",
  ])
    expect(payload).not.toContain(forbidden);
});
it("keeps an active immutable revision separate from the proposed draft and suppresses archived edits", () => {
  const source = detail();
  source.publishedRevision = {
    ...source.draftRevision!,
    id: "10000000-0000-4000-8000-000000000004",
    state: "published",
    revisionNumber: 1,
  };
  source.publishedRevisionId = source.publishedRevision.id;
  source.draftRevision!.revisionNumber = 2;
  expect(workflowReview(source, workflowNodeDefinitions(), true)).toMatchObject(
    {
      status: "active",
      active: { state: "published", version: 1 },
      draft: { state: "draft", version: 2 },
    },
  );
  source.status = "archived";
  expect(workflowReview(source, [], true).canEdit).toBe(false);
});
it.each([
  "too_many_nodes",
  "too_many_edges",
  "dangling_connection",
  "duplicate_node",
  "duplicate_edge",
  "cycle",
])("does not hide incomplete topology as a complete flow: %s", (kind) => {
  const source = detail();
  const value = source.draftRevision!.graph;
  if (kind === "too_many_nodes")
    value.nodes = Array.from({ length: 101 }, (_, i) => ({
      ...value.nodes[0],
      id: String(i),
    }));
  if (kind === "too_many_edges")
    value.edges = Array.from({ length: 201 }, (_, i) => ({
      ...value.edges[0],
      id: String(i),
    }));
  if (kind === "dangling_connection") value.edges[0].target = "absent";
  if (kind === "duplicate_node") value.nodes[1].id = value.nodes[0].id;
  if (kind === "duplicate_edge") value.edges[1].id = value.edges[0].id;
  if (kind === "cycle")
    value.edges.push({ id: "cycle", source: "review", target: "begin" });
  expect(workflowReview(source, [], false).draft).toMatchObject({
    coverage: "flow_unavailable",
    steps: [],
  });
});

it("orders dependencies before their consumers even when the stored graph array has another order", () => {
  const source = detail();
  source.draftRevision!.graph.nodes.reverse();
  const result = workflowReview(source, workflowNodeDefinitions(), false);
  expect(result.draft?.steps[0].name).toBe("Start");
  expect(result.draft?.steps[0].next.map((next) => next.output)).toEqual([
    "true",
    "false",
  ]);
});

it.each(["company", "workflow", "state", "id"])(
  "rejects a mismatched native revision binding: %s",
  (field) => {
    const source = detail();
    const revision = source.draftRevision!;
    if (field === "company")
      revision.companyId = "10000000-0000-4000-8000-000000000009";
    if (field === "workflow")
      revision.workflowId = "10000000-0000-4000-8000-000000000009";
    if (field === "state") revision.state = "discarded";
    if (field === "id") revision.id = "10000000-0000-4000-8000-000000000009";
    expect(() => workflowReview(source, [], false)).toThrow(
      "Workflow revision binding changed",
    );
  },
);

function liveAndDraft() {
  const source = detail();
  source.publishedRevision = structuredClone(source.draftRevision!);
  source.publishedRevision.id = "10000000-0000-4000-8000-000000000004";
  source.publishedRevision.state = "published";
  source.publishedRevisionId = source.publishedRevision.id;
  source.draftRevision!.revisionNumber = 2;
  return source;
}
it("compares native identities and material declarations while omitting private values and preserving the active source", () => {
  const source = liveAndDraft();
  const original = structuredClone(source.publishedRevision);
  const draft = source.draftRevision!;
  draft.graph.nodes.find((node) => node.id === "review")!.config = {
    prompt: "NEW-PRIVATE-PROMPT",
  };
  draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== "missing");
  draft.graph.nodes.push({
    id: "new",
    name: "Next",
    type: "core.noop",
    position: { x: 0, y: 0 },
    config: { private: "NEW-SECRET" },
  });
  draft.graph.edges[1].target = "new";
  draft.graph.variables[0].defaultValue = "NEW-PRIVATE-DEFAULT";
  draft.graph.settings.totalDeadlineSeconds = 10;
  const result = workflowReview(source, workflowNodeDefinitions(), false);
  expect(result.comparison).toEqual({
    state: "available",
    steps: [
      { number: 2, change: "changed" },
      { number: 3, change: "added" },
    ],
    removedSteps: 1,
    connectionsChanged: true,
    dataDefinitionChanged: true,
    settingsChanged: true,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE|SECRET|prompt|defaultValue|sha256/,
  );
  expect(source.publishedRevision).toEqual(original);
});
it("ignores layout, object-key insertion order and graph-array ordering without inventing an access or test decision", () => {
  const source = liveAndDraft();
  source.publishedRevision!.graph.nodes[0].config = { a: 1, b: 2 };
  source.draftRevision!.graph.nodes[0].config = { b: 2, a: 1 };
  source.draftRevision!.graph.nodes[0].position = { x: 100, y: 200 };
  source.draftRevision!.graph.nodes.reverse();
  source.draftRevision!.graph.edges.reverse();
  expect(workflowReview(source, [], false).comparison).toEqual({
    state: "available",
    steps: [],
    removedSteps: 0,
    connectionsChanged: false,
    dataDefinitionChanged: false,
    settingsChanged: false,
  });
});
it("uses dependency step numbers when a changed node moves within the stored array", () => {
  const source = liveAndDraft();
  source.draftRevision!.graph.nodes[0].continueOnFailure = true;
  source.draftRevision!.graph.nodes.reverse();
  expect(workflowReview(source, [], false).comparison).toMatchObject({
    state: "available",
    steps: [{ number: 1, change: "changed" }],
  });
});
it.each(["oversized_private_value", "deep_private_value", "invalid_topology"])(
  "does not report no changes when comparison is unavailable: %s",
  (reason) => {
    const source = liveAndDraft();
    if (reason === "oversized_private_value")
      source.draftRevision!.graph.nodes[0].config = {
        private: "x".repeat(262145),
      };
    if (reason === "deep_private_value") {
      let value: unknown = "PRIVATE-LEAF";
      for (let i = 0; i < 40; i++) value = { nested: value };
      source.draftRevision!.graph.nodes[0].config = value;
    }
    if (reason === "invalid_topology")
      source.draftRevision!.graph.edges[0].target = "absent";
    expect(workflowReview(source, [], false).comparison).toEqual({
      state: "unavailable",
    });
  },
);
it("does not fabricate comparison before a first publication", () => {
  expect(workflowReview(detail(), [], false).comparison).toBeNull();
});

it.each(["draft", "active"])(
  "rejects a missing native %s revision instead of inventing an unpublished state",
  (state) => {
    const source = liveAndDraft();
    if (state === "draft") source.draftRevision = null;
    else source.publishedRevision = null;
    expect(() => workflowReview(source, [], false)).toThrow(
      "Workflow revision binding changed",
    );
  },
);
