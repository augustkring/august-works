import type { WorkflowGraphV1, WorkflowNodeDefinitionDescriptor, WorkflowStepSemantics } from "@paperclipai/shared";

/** Only closed structural facts. Do not copy arbitrary config, input values,
 * objectives, recipients, connection IDs or schemas into derived surfaces. */
export function workflowStepSemantics(node: WorkflowGraphV1["nodes"][number], definition?: WorkflowNodeDefinitionDescriptor): WorkflowStepSemantics {
  const retry = node.retryPolicy ?? definition?.retryPolicyDefault;
  const base: WorkflowStepSemantics = {
    actor: "unknown", input: "advanced", durationSeconds: null,
    approvalPolicy: "unavailable", access: "unavailable",
    maxAttempts: retry?.maxAttempts ?? null,
    idempotency: definition?.idempotencyStrategy ?? "unknown",
  };
  if (!definition || definition.publishState !== "ready") return base;
  // A declared absence of a step grant is not a workflow/run permission.
  base.access = definition.authorizationRequirements.length ? "execution_check" : "no_step_grant";
  base.approvalPolicy = node.type === "human.approval" ? "human_checkpoint"
    : definition.sideEffectClass === "pure" && !definition.authorizationRequirements.length ? "no_checkpoint" : "execution_review";
  switch (node.type) {
    case "core.manual_trigger": base.actor = "workflow"; base.input = "start_data"; break;
    case "core.transform": case "automation.artifact": base.actor = "workflow"; base.input = "mapped_data"; break;
    case "core.condition": case "core.switch": base.actor = "workflow"; base.input = "condition_data"; break;
    case "core.merge": case "core.parallel": base.actor = "workflow"; base.input = "mapped_data"; break;
    case "core.wait": {
      base.actor = "workflow"; base.input = "delay";
      const config = node.config as Record<string, unknown> | null;
      const seconds = config && typeof config === "object" && !Array.isArray(config) ? config.durationSeconds : null;
      if (typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 1 && seconds <= 604800) base.durationSeconds = seconds;
      break;
    }
    case "human.approval": base.actor = "human"; base.input = "approval_material"; break;
    case "agent.task": case "agent.external": base.actor = "selected_agent"; base.input = "task_brief"; break;
    case "work.create_task": base.actor = "workflow"; base.input = "task_brief"; break;
    case "connector.action": base.actor = "connected_tool"; base.input = "tool_arguments"; break;
    case "core.subworkflow": base.actor = "workflow"; base.input = "child_workflow_data"; break;
    case "native.foundation_query": case "native.memory_recall": base.actor = "workflow"; base.input = "native_query"; break;
    case "core.http_request": base.actor = "workflow"; base.input = "http_request"; break;
  }
  return base;
}
