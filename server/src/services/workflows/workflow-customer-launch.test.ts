import { expect, it } from "vitest";
import type { WorkflowRevision } from "@paperclipai/shared";
import {
  customerWorkflowLaunchReady,
  customerWorkflowTestReady,
} from "./workflow-customer-launch.js";
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
it("admits only literal internal timers fitting strictly within the explicit deadline", () => {
  const value = revision(); value.state = "draft";
  value.graph.nodes.push({ id: "wait", name: "Wait", type: "core.wait", config: { durationSeconds: 1 }, position: { x: 0, y: 1 } });
  value.graph.edges.push({ id: "next", source: "start", target: "wait" });
  expect(customerWorkflowTestReady(value)).toBe(true);
  value.graph.settings.totalDeadlineSeconds = 1; expect(customerWorkflowTestReady(value)).toBe(false);
  value.graph.settings.totalDeadlineSeconds = 60;
  for (const config of [{ durationSeconds: "{{trigger.duration}}" }, { durationSeconds: 61 }, { durationSeconds: 1, artifactId: "hidden" }]) {
    value.graph.nodes[1].config = config; expect(customerWorkflowTestReady(value)).toBe(false);
  }
});
it("requires both native condition paths before reporting an unpublished internal test ready", () => {
  const value = revision();
  value.state = "draft";
  value.graph.nodes.push(
    {
      id: "route",
      name: "Choose",
      type: "core.condition",
      config: { expression: "true" },
      position: { x: 0, y: 1 },
    },
    {
      id: "yes",
      name: "Chosen",
      type: "core.merge",
      config: { mode: "all" },
      position: { x: 0, y: 2 },
    },
    {
      id: "no",
      name: "Unselected",
      type: "core.merge",
      config: { mode: "all" },
      position: { x: 1, y: 2 },
    },
  );
  value.graph.edges.push(
    { id: "start-route", source: "start", target: "route" },
    { id: "yes-path", source: "route", target: "yes", sourceHandle: "true" },
  );
  expect(customerWorkflowTestReady(value)).toBe(false);
  value.graph.edges.push({
    id: "no-path",
    source: "route",
    target: "no",
    sourceHandle: "false",
  });
  expect(customerWorkflowTestReady(value)).toBe(true);
  value.graph.edges.push({ id: "cycle", source: "yes", target: "route" });
  expect(customerWorkflowTestReady(value)).toBe(false);
});
it.each([
  "draft",
  "input",
  "output",
  "variables",
  "missing_deadline",
  "long_deadline",
  "large_graph",
  "large_unicode_graph",
  "many_nodes",
  "network",
  "child",
  "agent",
  "unknown",
  "optimizer_transform",
  "recovery_approval",
  "delayed_retry",
  "node_input_contract",
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
  if (scenario === "large_unicode_graph")
    value.graph.nodes[0].config = { private: "界".repeat(22_000) };
  if (scenario === "many_nodes")
    value.graph.nodes = Array.from({ length: 21 }, (_, i) => ({
      ...value.graph.nodes[0],
      id: String(i),
    }));
  if (scenario === "network") value.graph.nodes[0].type = "core.http_request";
  if (scenario === "child") value.graph.nodes[0].type = "core.subworkflow";
  if (scenario === "agent") value.graph.nodes[0].type = "agent.task";
  if (scenario === "optimizer_transform")
    value.graph.nodes[0].type = "core.transform";
  if (scenario === "recovery_approval")
    value.graph.nodes[0].failurePolicy = "wait_for_human";
  if (scenario === "delayed_retry")
    value.graph.nodes[0].retryPolicy = {
      mode: "fixed",
      maxAttempts: 2,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
    };
  if (scenario === "node_input_contract") value.graph.nodes[0].inputSchema = {};
  if (scenario === "unknown") value.graph.nodes[0].type = "self.declared.pure";
  expect(customerWorkflowLaunchReady(value)).toBe(false);
  if (scenario !== "draft") {
    value.state = "draft";
    expect(customerWorkflowTestReady(value)).toBe(false);
  }
});
it("keeps draft test eligibility distinct from published live launch eligibility", () => {
  const value = revision();
  expect(customerWorkflowTestReady(value)).toBe(false);
  value.state = "draft";
  expect(customerWorkflowTestReady(value)).toBe(true);
  expect(customerWorkflowLaunchReady(value)).toBe(false);
});
