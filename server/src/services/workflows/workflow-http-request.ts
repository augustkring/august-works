import { z } from "zod";
import type { WorkflowNodeDefinitionDescriptor } from "@paperclipai/shared";
import { unprocessable } from "../../errors.js";
import { ToolModelEffectAdmissionError } from "../native-runtime/paid-transport-admission.js";

export const workflowHttpConfig = z.object({
  url: z.string().url().max(2_048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
      ![...url.searchParams.keys()].some((key) => /^(access_token|api_key|apikey|authorization|password|secret|token)$/i.test(key));
  }, "Use an explicit HTTPS URL without embedded credentials"),
  method: z.enum(["GET", "HEAD"]).default("GET"),
  responseMode: z.enum(["json", "text"]).default("json"),
  maxResponseBytes: z.number().int().min(1).max(1_048_576).default(65_536),
  responseSchema: z.record(z.string(), z.unknown()).nullable().optional().default(null),
}).strict();

export const workflowHttpNode = {
  configValidator: workflowHttpConfig,
  descriptor: {
    type: "core.http_request", version: 1, category: "connector", displayName: "HTTP Request",
    description: "This action is unavailable. Keep this draft or choose an available connector action.",
    inputSchema: null, outputSchema: { type: "object", additionalProperties: true },
    configSchema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" },
      method: { enum: ["GET", "HEAD"] }, responseMode: { enum: ["json", "text"] },
      maxResponseBytes: { type: "integer", minimum: 1, maximum: 1_048_576 }, responseSchema: { type: ["object", "null"] } }, additionalProperties: false },
    sideEffectClass: "read", riskDefault: "C1", authorizationRequirements: [], timeoutDefaultSeconds: 15,
    retryPolicyDefault: { mode: "none", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    idempotencyStrategy: "not_required", cancellationSupport: "cooperative", testMode: "dry_run",
    failureOutputs: ["configuration_incomplete"],
    auditEvents: ["workflow.step_completed", "workflow.step_failed"], uiComponent: "http_request",
    accessibilityContract: { label: "HTTP request", description: "Keep this draft or choose an available connector action.",
      supportsKeyboardInsert: true, supportsOutlineEdit: true }, publishState: "draft_only", publishBlockedReason: "This HTTP action is unavailable. Choose an available connector action.",
  } satisfies WorkflowNodeDefinitionDescriptor,
};

export async function executeWorkflowHttpRequest(rawConfig: unknown, timeoutMs: number, parentSignal: AbortSignal) {
  workflowHttpConfig.parse(rawConfig);
  // An editable public GET endpoint can itself launch inference. HTTP method,
  // read risk and missing credentials do not bound the remote implementation.
  // Keep the node editable, but do not advertise or invoke an unqualified action.
  void timeoutMs; void parentSignal;
  const error = new ToolModelEffectAdmissionError("workflow_http_request");
  throw unprocessable(error.message, { code: "configuration_incomplete", ...error.resultJson });
}
