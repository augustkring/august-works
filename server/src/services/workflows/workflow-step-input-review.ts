import { workflowStepInputReviewSchema, type WorkflowGraphV1, type WorkflowStepInputReview } from "@paperclipai/shared";
import { z } from "zod";
import { reviewGuidedCondition } from "./workflow-guided-condition.js";

/** Exact closed Native inputs, never a raw graph/config projection. The
 * current Source/reader owner belongs to the caller, including before return. */
export function reviewWorkflowStepInput(node: WorkflowGraphV1["nodes"][number]): WorkflowStepInputReview {
  const advanced = { kind: "advanced" as const };
  if (node.type === "core.condition") return reviewGuidedCondition(node.config) ?? advanced;
  const config = node.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return advanced;
  if (node.type === "agent.task") {
    const task = config as Record<string, unknown>;
    // Keep the selected Agent, Native defaults and output contract. Complex
    // output requirements belong to Advanced until they can be fully reviewed.
    if (Object.keys(config).some(key => !["agentId", "objective", "waitForCompletion", "expectedOutputSchema"].includes(key)) ||
      !z.uuid().safeParse(task.agentId).success ||
      task.expectedOutputSchema !== undefined && task.expectedOutputSchema !== null ||
      task.waitForCompletion !== undefined && typeof task.waitForCompletion !== "boolean") return advanced;
    const value = workflowStepInputReviewSchema.safeParse({ kind: "agent_task", objective: task.objective,
      waitForCompletion: task.waitForCompletion ?? true });
    return value.success && value.data.kind === "agent_task" && value.data.objective === task.objective ? value.data : advanced;
  }
  const fields = Object.keys(config), kind = node.type === "core.wait" ? "wait" : node.type === "human.approval" ? "approval" : null;
  if (!kind || (kind === "wait" ? fields.length !== 1 || fields[0] !== "durationSeconds"
    : fields.length !== 2 || !fields.includes("summary") || !fields.includes("consequence"))) return advanced;
  const value = workflowStepInputReviewSchema.safeParse({ ...config, kind });
  if (!value.success) return advanced;
  if (value.data.kind === "approval" && (value.data.summary !== (config as Record<string, unknown>).summary ||
    value.data.consequence !== (config as Record<string, unknown>).consequence)) return advanced;
  return value.data;
}
