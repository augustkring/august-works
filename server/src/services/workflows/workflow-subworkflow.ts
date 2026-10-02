import { and, eq } from "drizzle-orm";
import { workflowRevisions, workflows, type Db } from "@paperclipai/db";
import type { WorkflowGraphV1, WorkflowNodeDefinitionDescriptor } from "@paperclipai/shared";
import { z } from "zod";
import { unprocessable } from "../../errors.js";
import { parseWorkflowTransformExpression } from "./workflow-transform-expression.js";

export const subworkflowConfig = z.object({
  workflowId: z.string().guid(), revisionId: z.string().guid(),
  inputMapping: z.record(z.string(), z.string().max(10_000)).default({}),
  timeoutSeconds: z.number().int().min(1).max(86_400).default(3_600),
  cancellationPolicy: z.literal("propagate").default("propagate"),
}).strict().superRefine((value, ctx) => {
  for (const expression of Object.values(value.inputMapping)) {
    try { parseWorkflowTransformExpression(expression); }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid child input expression" }); }
  }
});

export async function requireSubworkflowRevision(db: Db, companyId: string, workflowId: string, revisionId: string) {
  const [child] = await db.select({ workflow: workflows, revision: workflowRevisions }).from(workflows)
    .innerJoin(workflowRevisions, and(eq(workflowRevisions.workflowId, workflows.id), eq(workflowRevisions.companyId, workflows.companyId)))
    .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId), eq(workflows.status, "active"),
      eq(workflowRevisions.id, revisionId), eq(workflowRevisions.state, "published"), eq(workflows.publishedRevisionId, revisionId)));
  if (!child) throw unprocessable("Subworkflow must bind to the child's current published revision", { code: "workflow_subworkflow_revision_unavailable" });
  return child.revision;
}

/** Check the complete pinned invocation graph, not just the canvas DAG. */
export async function assertSubworkflowGraph(db: Db, companyId: string, graph: WorkflowGraphV1, ownerWorkflowId?: string) {
  let inspected = 0;
  const walk = async (next: WorkflowGraphV1, ancestors: Set<string>) => {
    for (const node of next.nodes.filter((item) => item.type === "core.subworkflow")) {
      if (++inspected > 128 || ancestors.size >= 16) throw unprocessable("Subworkflow nesting exceeds its bounded limit", { code: "workflow_subworkflow_depth_exceeded" });
      const config = subworkflowConfig.parse(node.config);
      if (ancestors.has(config.workflowId)) throw unprocessable("Recursive subworkflow invocation is forbidden", { code: "workflow_subworkflow_recursion" });
      const revision = await requireSubworkflowRevision(db, companyId, config.workflowId, config.revisionId);
      await walk(revision.graph, new Set([...ancestors, config.workflowId]));
    }
  };
  await walk(graph, new Set(ownerWorkflowId ? [ownerWorkflowId] : []));
}

export const workflowSubworkflowNode = {
  configValidator: subworkflowConfig,
  validateReferences: async (db: Db, companyId: string, _nodeId: string, config: Record<string, unknown>) => {
    const parsed = subworkflowConfig.parse(config);
    await requireSubworkflowRevision(db, companyId, parsed.workflowId, parsed.revisionId);
  },
  descriptor: {
    type: "core.subworkflow", version: 1, category: "control", displayName: "Subworkflow",
    description: "Invokes a pinned published workflow as a durable child run and propagates cancellation. Recursive invocation is forbidden.",
    inputSchema: null, outputSchema: { type: "object", additionalProperties: true },
    configSchema: { type: "object", required: ["workflowId", "revisionId"], properties: {
      workflowId: { type: "string", format: "uuid" }, revisionId: { type: "string", format: "uuid" },
      inputMapping: { type: "object", additionalProperties: { type: "string" } },
      timeoutSeconds: { type: "integer", minimum: 1, maximum: 86_400 }, cancellationPolicy: { const: "propagate" },
    }, additionalProperties: false }, sideEffectClass: "write", riskDefault: "C2",
    authorizationRequirements: [], timeoutDefaultSeconds: 3_600,
    retryPolicyDefault: { mode: "none", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    idempotencyStrategy: "workflow_step_key", cancellationSupport: "cooperative", testMode: "live_only",
    failureOutputs: ["workflow_subworkflow_failed", "workflow_subworkflow_timeout", "workflow_subworkflow_recursion"],
    auditEvents: ["workflow.child_run_created", "workflow.child_run_resolved"], uiComponent: "subworkflow",
    accessibilityContract: { label: "Subworkflow", description: "Select a workflow and immutable published revision through labeled fields.", supportsKeyboardInsert: true, supportsOutlineEdit: true },
    publishState: "ready", publishBlockedReason: null,
  } satisfies WorkflowNodeDefinitionDescriptor,
};
