import { expect, it } from "vitest";
import type { WorkflowRevision } from "@paperclipai/shared";
import { customerWorkflowLaunchReady } from "./workflow-customer-launch.js";
function revision(): WorkflowRevision {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    companyId: "10000000-0000-4000-8000-000000000002",
    workflowId: "10000000-0000-4000-8000-000000000003",
    revisionNumber: 1,
    state: "published",
    inputSchema: null,
    outputSchema: null,
    changeSummary: null,
    createdByUserId: null,
    createdByAgentId: null,
    createdByRunId: null,
    createdAt: new Date(),
    graph: {
      version: 1,
      nodes: [
        {
          id: "start",
          name: "Start",
          type: "core.manual_trigger",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      variables: [],
      settings: { totalDeadlineSeconds: 60 },
    },
  };
}
it("admits the bounded built-in internal subset without declaring completion or verification", () =>
  expect(customerWorkflowLaunchReady(revision())).toBe(true));
it.each([
  "draft",
  "input",
  "output",
  "variables",
  "missing_deadline",
  "long_deadline",
  "large_graph",
  "many_nodes",
  "network",
  "child",
  "agent",
  "unknown",
])("requires native advanced review for %s", (scenario) => {
  const value = revision();
  if (scenario === "draft") value.state = "draft";
  if (scenario === "input") value.inputSchema = {};
  if (scenario === "output") value.outputSchema = {};
  if (scenario === "variables")
    value.graph.variables = [{ name: "private", defaultValue: "PRIVATE" }];
  if (scenario === "missing_deadline") value.graph.settings = {};
  if (scenario === "long_deadline")
    value.graph.settings.totalDeadlineSeconds = 61;
  if (scenario === "large_graph")
    value.graph.nodes[0].config = { private: "X".repeat(65536) };
  if (scenario === "many_nodes")
    value.graph.nodes = Array.from({ length: 21 }, (_, i) => ({
      ...value.graph.nodes[0],
      id: String(i),
    }));
  if (scenario === "network") value.graph.nodes[0].type = "core.http_request";
  if (scenario === "child") value.graph.nodes[0].type = "core.subworkflow";
  if (scenario === "agent") value.graph.nodes[0].type = "agent.task";
  if (scenario === "unknown") value.graph.nodes[0].type = "self.declared.pure";
  expect(customerWorkflowLaunchReady(value)).toBe(false);
});
