import { z } from "zod";
import type { AgentAuthoringContent } from "./agent-authoring.js";

const draftText = z.string().trim().min(1).max(24000);
const reviewedDraft = z.strictObject({
  draft: draftText,
  proposedTask: z.strictObject({
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(20000),
  }).nullable(),
});

export function agentDraftRequestsTaskReview(content: Pick<AgentAuthoringContent, "capabilities">) {
  return content.capabilities.some(capability => capability.operation === "create_task" && capability.autonomy === "ask_first");
}

/** This is model output data, never an executable tool/resource envelope. */
export const AGENT_REVIEWED_TASK_OUTPUT_INSTRUCTIONS =
  'Return only one JSON object with exactly {"draft":"internal draft text","proposedTask":null} or {"draft":"internal draft text","proposedTask":{"title":"one suggested task","description":"its bounded internal scope"}}. Propose at most one task, only when the requested outcome requires it. The controller fixes its company, parent, backlog state and absence of an assignee. A current authorized human must explicitly approve task creation. Do not include identifiers, tools, permissions, recipients, status, additional fields or executable commands. Never claim that a proposed task has been created, assigned or started.';

export function parseAgentDraftOutput(text: string, taskReview: boolean) {
  try {
    if (!taskReview) return { draft: draftText.parse(text), proposedTask: null };
    if (text.length > 45000) throw new Error();
    return reviewedDraft.parse(JSON.parse(text));
  } catch {
    // Model content may contain private Source data; never include it in errors.
    throw new Error("agent_draft_output_invalid");
  }
}
