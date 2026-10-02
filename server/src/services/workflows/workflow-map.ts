import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { WorkflowNodeDefinitionDescriptor } from "@paperclipai/shared";
import { unprocessable } from "../../errors.js";
import { evaluateWorkflowTransformMapping, parseWorkflowTransformExpression } from "./workflow-transform-expression.js";
import { assertWorkflowOutputSchema, validateWorkflowOutput } from "./workflow-output-schema.js";

export const workflowMapConfig = z.object({
  collection: z.string().min(1).max(10_000),
  mapping: z.record(z.string(), z.string().min(1).max(10_000)).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 32),
  maxItems: z.number().int().min(1).max(128),
  perItemTimeoutSeconds: z.number().int().min(1).max(5).default(1),
  concurrency: z.literal(1).default(1),
  failurePolicy: z.enum(["fail_workflow", "continue_with_null"]).default("fail_workflow"),
  outputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().superRefine((config, ctx) => {
  try {
    for (const expression of [config.collection, ...Object.values(config.mapping)]) parseWorkflowTransformExpression(expression);
    if (config.outputSchema) {
      assertWorkflowOutputSchema(config.outputSchema);
      if (config.failurePolicy === "continue_with_null") validateWorkflowOutput(config.outputSchema, null);
    }
  } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Invalid map contract" }); }
});

export const workflowMapNode = {
  configValidator: workflowMapConfig,
  descriptor: {
    type: "core.map", version: 1, category: "transform", displayName: "Map collection",
    description: "Maps a bounded collection with deterministic expressions, one item at a time. Each mapping receives input.item, input.index and input.source.",
    inputSchema: null, outputSchema: { type: "object", required: ["results", "errors"], properties: {
      results: { type: "array", maxItems: 128 }, errors: { type: "array", maxItems: 128 } }, additionalProperties: false },
    configSchema: { type: "object", required: ["collection", "mapping", "maxItems"], properties: {
      collection: { type: "string" }, mapping: { type: "object", additionalProperties: { type: "string" } },
      maxItems: { type: "integer", minimum: 1, maximum: 128 }, perItemTimeoutSeconds: { type: "integer", minimum: 1, maximum: 5 },
      concurrency: { const: 1 }, failurePolicy: { enum: ["fail_workflow", "continue_with_null"] }, outputSchema: { type: ["object", "null"] },
    }, additionalProperties: false },
    sideEffectClass: "pure", riskDefault: "C0", authorizationRequirements: [], timeoutDefaultSeconds: 5,
    retryPolicyDefault: { mode: "none", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    idempotencyStrategy: "not_required", cancellationSupport: "cooperative", testMode: "safe",
    failureOutputs: ["workflow_map_collection_invalid", "workflow_map_limit_exceeded", "workflow_map_item_failed"],
    auditEvents: ["workflow.step_completed"], uiComponent: "map", accessibilityContract: { label: "Map collection",
      description: "Edit the collection and per-item mapping through labeled fields.", supportsKeyboardInsert: true, supportsOutlineEdit: true },
    publishState: "ready", publishBlockedReason: null,
  } satisfies WorkflowNodeDefinitionDescriptor,
};

export async function executeWorkflowMap(config: unknown, context: Parameters<typeof evaluateWorkflowTransformMapping>[1], timeoutMs: number, signal: AbortSignal) {
  const parsed = workflowMapConfig.parse(config);
  const items = evaluateWorkflowTransformMapping({ collection: parsed.collection }, context).collection;
  if (!Array.isArray(items)) throw unprocessable("Map collection must resolve to an array", { code: "workflow_map_collection_invalid" });
  if (items.length > parsed.maxItems) throw unprocessable("Map collection exceeds its published item limit", { code: "workflow_map_limit_exceeded" });
  const deadline = performance.now() + timeoutMs;
  const results: unknown[] = []; const errors: Array<{ index: number; code: string }> = [];
  for (let index = 0; index < items.length; index++) {
    signal.throwIfAborted();
    if (performance.now() >= deadline) throw unprocessable("Map total timeout exceeded", { code: "workflow_map_timeout" });
    const started = performance.now();
    try {
      const result = evaluateWorkflowTransformMapping(parsed.mapping, { ...context, input: { item: items[index], index, source: context.input } });
      if (performance.now() - started > parsed.perItemTimeoutSeconds * 1_000) throw new Error("Item timeout");
      validateWorkflowOutput(parsed.outputSchema, result);
      results.push(result);
    } catch {
      if (parsed.failurePolicy === "fail_workflow") throw unprocessable("Map item did not meet its contract", { code: "workflow_map_item_failed", index });
      results.push(null); errors.push({ index, code: "workflow_map_item_failed" });
    }
    // Let cancellation and lease renewal run between bounded, pure items.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  signal.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify({ results, errors }), "utf8") > 1_000_000) throw unprocessable("Map output exceeds the size limit", { code: "workflow_map_limit_exceeded" });
  return { results, errors };
}
