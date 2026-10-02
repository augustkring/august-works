import { z } from "zod";
import type { WorkflowNodeDefinitionDescriptor } from "@paperclipai/shared";
import { unprocessable } from "../../errors.js";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { validateWorkflowOutput } from "./workflow-output-schema.js";

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
    description: "Reads an explicit public HTTPS endpoint with bounded response, timeout and schema validation.",
    inputSchema: null, outputSchema: { type: "object", additionalProperties: true },
    configSchema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" },
      method: { enum: ["GET", "HEAD"] }, responseMode: { enum: ["json", "text"] },
      maxResponseBytes: { type: "integer", minimum: 1, maximum: 1_048_576 }, responseSchema: { type: ["object", "null"] } }, additionalProperties: false },
    sideEffectClass: "read", riskDefault: "C1", authorizationRequirements: [], timeoutDefaultSeconds: 15,
    retryPolicyDefault: { mode: "none", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    idempotencyStrategy: "not_required", cancellationSupport: "cooperative", testMode: "dry_run",
    failureOutputs: ["workflow_http_egress_denied", "workflow_http_response_too_large", "workflow_http_timeout", "workflow_http_failed"],
    auditEvents: ["workflow.step_completed", "workflow.step_failed"], uiComponent: "http_request",
    accessibilityContract: { label: "HTTP request", description: "Read an approved public URL without forwarding credentials.",
      supportsKeyboardInsert: true, supportsOutlineEdit: true }, publishState: "ready", publishBlockedReason: null,
  } satisfies WorkflowNodeDefinitionDescriptor,
};

export async function executeWorkflowHttpRequest(rawConfig: unknown, timeoutMs: number, parentSignal: AbortSignal) {
  const config = workflowHttpConfig.parse(rawConfig);
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abort, { once: true });
  if (parentSignal.aborted) abort();
  const timer = setTimeout(() => controller.abort(unprocessable("HTTP request reached its timeout", {
    code: "workflow_http_timeout" })), Math.min(30_000, Math.max(1, timeoutMs)));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await guardedRemoteHttpFetch(new URL(config.url), { method: config.method,
      headers: { accept: config.responseMode === "json" ? "application/json" : "text/plain" },
      redirect: "manual", credentials: "omit", signal: controller.signal }, {
      // No local/private-network override or unpinned transport seam.
      allowPrivateNetwork: false,
      responseTimeoutMs: Math.min(30_000, timeoutMs),
      error: () => unprocessable("The published URL is blocked by the outbound network policy", {
        code: "workflow_http_egress_denied" }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw unprocessable(response.status >= 300 && response.status < 400 ? "HTTP redirects require a newly published URL" : "HTTP endpoint returned an unsuccessful status", {
        code: "workflow_http_failed", status: response.status });
    }
    const length = response.headers.get("content-length");
    if (length && Number(length) > config.maxResponseBytes) {
      await response.body?.cancel();
      throw unprocessable("HTTP response exceeded its byte limit", { code: "workflow_http_response_too_large" });
    }
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        controller.signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > config.maxResponseBytes) throw unprocessable("HTTP response exceeded its byte limit", {
          code: "workflow_http_response_too_large" });
        chunks.push(part.value);
      }
    }
    controller.signal.throwIfAborted();
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown = text;
    if (config.responseMode === "json" && config.method !== "HEAD") {
      try { body = JSON.parse(text); }
      catch { throw unprocessable("HTTP endpoint did not return valid JSON", { code: "workflow_http_response_invalid" }); }
    }
    validateWorkflowOutput(config.responseSchema, body);
    return { status: response.status, body, sizeBytes: size };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => {});
  }
}
