/**
 * APR-E2E-22 (option B). An assigned-MCP call that is parked for a Human tool
 * review did not execute. Its dynamic tool response is a failure whose only
 * content is the server's fixed approval-required instructions (wrapped once
 * more by the runner's tool error path). Return those instructions so the
 * OpenCode MCP bridge sends them as an MCP error (`isError: true`); OpenCode
 * then replays the call as an `is_error` tool result, which the managed model
 * gateway admits only through the exact pending approval owner it recorded.
 * Every other response keeps its current shape (null).
 */
const APPROVAL_REQUIRED = /^A human approval card was posted on task [^\s]{1,200}\. Do not retry this call now\. Wrap up other work and end your run noting you are waiting on tool approval \(status in_review\)\. You will be woken when it is decided; if approved, the action runs automatically and your wake includes the result\.$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function soleInputText(value: unknown): string | null {
  const response = record(value);
  if (!response || Object.keys(response).sort().join(",") !== "contentItems,success" || response.success !== false ||
    !Array.isArray(response.contentItems) || response.contentItems.length !== 1) return null;
  const item = record(response.contentItems[0]);
  return item && Object.keys(item).sort().join(",") === "text,type" && item.type === "inputText" &&
    typeof item.text === "string" ? item.text : null;
}

export function openCodeProxyAssignedMcpApprovalError(tool: string, result: unknown): string | null {
  // Only provider names of assigned app tools (and the on-demand caller).
  if (!/^app_[A-Za-z0-9_.-]{1,200}$/.test(tool) && tool !== "call_assigned_tool") return null;
  const outer = soleInputText(result);
  if (outer === null) return null;
  let inner: unknown;
  try { inner = JSON.parse(outer); } catch { return null; }
  const instructions = soleInputText(inner);
  return instructions !== null && APPROVAL_REQUIRED.test(instructions) ? instructions : null;
}
