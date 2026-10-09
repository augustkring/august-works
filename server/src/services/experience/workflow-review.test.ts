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
