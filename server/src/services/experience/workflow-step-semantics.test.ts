import { expect, it } from "vitest";
import type { WorkflowGraphV1 } from "@paperclipai/shared";
import { workflowStepSemanticsSchema } from "@paperclipai/shared";
import { workflowNodeDefinitions } from "../workflows/workflow-node-registry.js";
import { workflowStepSemantics } from "./workflow-step-semantics.js";

function review(type: string, config: unknown = {}) {
  const node: WorkflowGraphV1["nodes"][number] = { id: "private-node", name: "Private step", type, config, position: { x: 0, y: 0 } };
  return workflowStepSemanticsSchema.parse(workflowStepSemantics(node, workflowNodeDefinitions().find(item => item.type === type)));
}
it("separates declared internal controls from approval and execution authority without copying private inputs", () => {
  expect(review("core.manual_trigger")).toMatchObject({ actor: "workflow", input: "start_data", approvalPolicy: "no_checkpoint", access: "no_step_grant", maxAttempts: 1 });
  expect(review("human.approval", { summary: "PRIVATE summary", consequence: "PRIVATE consequence" })).toMatchObject({ actor: "human", input: "approval_material", approvalPolicy: "human_checkpoint" });
  const tool = review("connector.action", { connectionId: "PRIVATE ID", input: { token: "SECRET" } });
  expect(tool).toMatchObject({ actor: "connected_tool", input: "tool_arguments", approvalPolicy: "execution_review", access: "execution_check", idempotency: "provider_passthrough" });
  expect(JSON.stringify(tool)).not.toMatch(/PRIVATE|SECRET|connectionId|token/);
  expect(review("agent.task", { agentId: "PRIVATE agent", objective: "SECRET" })).toMatchObject({ actor: "selected_agent", input: "task_brief", maxAttempts: 3, idempotency: "workflow_step_key" });
});
it("uses the recorded delay only within the Native range, with no dynamic evaluation", () => {
  expect(review("core.wait", { durationSeconds: 15 })).toMatchObject({ durationSeconds: 15, idempotency: "workflow_step_key" });
  for (const value of ["{{trigger.secret}}", 0, 604801, 1.5, Infinity]) expect(review("core.wait", { durationSeconds: value }).durationSeconds).toBeNull();
});
it("never presents unregistered or draft-only operations as available", () => {
  expect(review("not.registered", { credential: "SECRET" })).toMatchObject({ actor: "unknown", input: "advanced", approvalPolicy: "unavailable", access: "unavailable", maxAttempts: null, idempotency: "unknown" });
  const definition = { ...workflowNodeDefinitions()[0], publishState: "draft_only" as const };
  expect(workflowStepSemantics({ id: "x", type: definition.type, name: "x", config: {}, position: { x: 0, y: 0 } }, definition).approvalPolicy).toBe("unavailable");
});
