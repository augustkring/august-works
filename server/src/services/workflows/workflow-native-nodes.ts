import { z } from "zod";
import type { Db } from "@paperclipai/db";
import type { WorkflowNodeDefinitionDescriptor, WorkflowNodeV1 } from "@paperclipai/shared";
import { forbidden, unprocessable } from "../../errors.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { foundationIndexService } from "../foundation/foundation-index.js";
import { retrieveEligibleMemory } from "../memory/memory-retrieval.js";
import { instanceSettingsService } from "../instance-settings.js";
import { parseWorkflowTransformExpression } from "./workflow-transform-expression.js";
import type { WorkflowRunActor } from "./workflow-executor.js";

export const nativeQueryConfig = z.object({
  query: z.string().trim().min(1).max(4_000),
  limit: z.number().int().min(1).max(20).default(8),
}).strict().superRefine((value, ctx) => {
  try { parseWorkflowTransformExpression(value.query); }
  catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"],
    message: error instanceof Error ? error.message : "Invalid query expression" }); }
});

export const workflowNativeQueryNodes = [
  { type: "native.foundation_query", name: "Query Foundation", permission: "foundation:read" as const,
    description: "Searches current approved Foundation sections and returns their immutable revision citations." },
  { type: "native.memory_recall", name: "Recall collective Memory", permission: null,
    description: "Recalls accepted, active company Memory with the normal temporal, sensitivity and evidence filters." },
].map((item) => ({
  configValidator: nativeQueryConfig,
  descriptor: {
    type: item.type, version: 1, category: "native", displayName: item.name, description: item.description,
    inputSchema: null, outputSchema: { type: "object", additionalProperties: true },
    configSchema: { type: "object", required: ["query"], properties: { query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    sideEffectClass: "read", riskDefault: "C1", authorizationRequirements: item.permission ? [{
      permission: item.permission, timing: "execution", description: "Current company read authority is required." }] : [],
    timeoutDefaultSeconds: 10, retryPolicyDefault: { mode: "none", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    idempotencyStrategy: "not_required", cancellationSupport: "none", testMode: "safe",
    failureOutputs: ["permission_denied", "feature_disabled"], auditEvents: ["workflow.step_completed"],
    uiComponent: "native_query", accessibilityContract: { label: item.name, description: item.description,
      supportsKeyboardInsert: true, supportsOutlineEdit: true }, publishState: "ready", publishBlockedReason: null,
  } satisfies WorkflowNodeDefinitionDescriptor,
}));

function authorizationActor(companyId: string, actor: WorkflowRunActor): AuthorizationActor {
  const principal = actor.principal;
  if (principal.type === "agent") return { type: "agent", agentId: principal.agentId, companyId,
    runId: actor.runId ?? null, source: "agent_jwt", onBehalfOfUserId: actor.responsibleUserId ?? principal.responsibleUserId };
  if (principal.type === "user") return { type: "board", userId: principal.userId, companyIds: [companyId], source: "session" };
  if (principal.service === "local-board") return { type: "board", source: "local_implicit" };
  throw forbidden("Native workflow reads require an initiating user or agent", { code: "workflow_execution_principal_required" });
}

export async function executeNativeWorkflowQuery(db: Db, companyId: string, node: WorkflowNodeV1,
  query: unknown, actor: WorkflowRunActor) {
  if (typeof query !== "string" || !query.trim() || query.length > 4_000) throw unprocessable("Workflow query must resolve to bounded text", {
    code: "workflow_native_query_invalid" });
  const config = nativeQueryConfig.parse(node.config);
  authorizationActor(companyId, actor);
  const flags = await instanceSettingsService(db).getExperimental();
  if (node.type === "native.foundation_query") {
    if (!flags.enableFoundationV1) throw forbidden("Foundation is disabled", { code: "foundation_disabled" });
    const decision = await authorizationService(db).decide({ actor: authorizationActor(companyId, actor),
      action: "foundation:read", resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation, { code: "permission_denied" });
    const asOf = Date.now();
    const sections = (await foundationIndexService(db).search(companyId, { query: query.slice(0, 500),
      limit: config.limit, scope: "approved" })).filter((row) => row.sensitivity !== "restricted" &&
      (!row.validFrom || Date.parse(row.validFrom) <= asOf) && (!row.validUntil || Date.parse(row.validUntil) > asOf));
    return { sections: sections.map((row) => ({ ...row,
      sourceRef: `foundation://${row.foundationDocumentId}/${row.documentRevisionId}/${row.ordinal}` })) };
  }
  if (!flags.enableCollectiveMemoryV1) throw forbidden("Collective Memory is disabled", { code: "collective_memory_disabled" });
  const records = await retrieveEligibleMemory(db, { companyId,
    agentId: actor.principal.type === "agent" ? actor.principal.agentId : null, actor,
    runId: actor.runId, allowShared: true, allowPrivate: false,
    query, topK: config.limit, sensitivityCeiling: "confidential" });
  return { records: records.map(({ detail, relevanceScore }) => ({ record: detail.record, evidence: detail.evidence,
    relevanceScore, sourceRef: `memory://shared/${detail.record.id}` })) };
}
