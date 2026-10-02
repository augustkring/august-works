import { and, eq, gt } from "drizzle-orm";
import { agents, companyMemberships, heartbeatRuns, toolCatalogEntries, workflowRevisions, workflowRuns, workflowStepRuns, workflowWaits, type Db } from "@paperclipai/db";
import type { DeploymentMode } from "@paperclipai/shared";
import type { ToolGatewaySession } from "../tool-gateway.js";
import { conflict, forbidden } from "../../errors.js";
import { assertMemoryRecordsRetained } from "../memory/memory-privacy.js";
import { workflowStepIdempotencyKey } from "./workflow-execution-policy.js";

export interface WorkflowGatewayContext {
  companyId: string;
  workflowRunId: string;
  nodeId: string;
  executionOwnerId?: string;
  approvalInvocationId?: string;
}

export async function resolveWorkflowConnectorSession(
  db: Db, context: WorkflowGatewayContext, idempotencyKey: string | null | undefined,
  deploymentMode: DeploymentMode | undefined,
) {
  const [run] = await db.select().from(workflowRuns).where(and(
    eq(workflowRuns.id, context.workflowRunId), eq(workflowRuns.companyId, context.companyId),
    context.approvalInvocationId
      ? eq(workflowRuns.status, "waiting")
      : and(eq(workflowRuns.status, "running"), eq(workflowRuns.executionOwnerId, context.executionOwnerId ?? ""),
        gt(workflowRuns.leaseExpiresAt, new Date()))));
  if (!run?.executionPrincipal) throw forbidden("Workflow execution authority is unavailable", {
    code: "workflow_execution_authority_unavailable" });
  if (context.approvalInvocationId) {
    const [wait] = await db.select().from(workflowWaits).where(and(
      eq(workflowWaits.companyId, run.companyId), eq(workflowWaits.workflowRunId, run.id),
      eq(workflowWaits.nodeId, context.nodeId), eq(workflowWaits.kind, "tool_action"),
      eq(workflowWaits.status, "active"), eq(workflowWaits.referenceType, "tool_invocation"),
      eq(workflowWaits.referenceId, context.approvalInvocationId)));
    const [step] = await db.select().from(workflowStepRuns).where(and(
      eq(workflowStepRuns.companyId, run.companyId), eq(workflowStepRuns.workflowRunId, run.id),
      eq(workflowStepRuns.nodeId, context.nodeId), eq(workflowStepRuns.status, "waiting"),
      eq(workflowStepRuns.toolInvocationId, context.approvalInvocationId)));
    if (!wait || !step || (wait.timeoutAt && wait.timeoutAt <= new Date())) {
      throw forbidden("Workflow review is no longer active", { code: "workflow_approval_inactive" });
    }
  }
  if (idempotencyKey !== workflowStepIdempotencyKey(run.idempotencyRootRunId ?? run.id, context.nodeId)) {
    throw forbidden("Workflow operation key does not match its durable step", { code: "workflow_connector_binding_invalid" });
  }
  const [revision] = await db.select().from(workflowRevisions).where(and(
    eq(workflowRevisions.companyId, run.companyId), eq(workflowRevisions.id, run.workflowRevisionId),
    eq(workflowRevisions.workflowId, run.workflowId)));
  const node = revision?.graph.nodes.find((item) => item.id === context.nodeId);
  const config = node?.config as Record<string, unknown> | undefined;
  if (node?.type !== "connector.action" || !config) throw forbidden("Workflow node is not a connector action", {
    code: "workflow_connector_binding_invalid" });
  const [entry] = await db.select().from(toolCatalogEntries).where(and(
    eq(toolCatalogEntries.companyId, run.companyId), eq(toolCatalogEntries.id, String(config.toolCatalogEntryId))));
  if (!entry || entry.connectionId !== config.connectionId || entry.status !== "active" ||
    entry.versionHash !== config.catalogVersionHash || entry.schemaHash !== config.catalogSchemaHash) {
    throw conflict("Published connector catalogue binding changed", { code: "workflow_connector_drift" });
  }
  const principal = run.executionPrincipal;
  const steps = await db.select({ memoryRecordIds: workflowStepRuns.memoryRecordIds }).from(workflowStepRuns).where(and(
    eq(workflowStepRuns.companyId, run.companyId), eq(workflowStepRuns.workflowRunId, run.id), eq(workflowStepRuns.nodeId, node.id)));
  await assertMemoryRecordsRetained(db, run.companyId, [...new Set(steps.flatMap((step) => step.memoryRecordIds))]);
  if (principal.type === "user") {
    const [membership] = await db.select().from(companyMemberships).where(and(
      eq(companyMemberships.companyId, run.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, principal.userId), eq(companyMemberships.status, "active")));
    if (!membership) throw forbidden("Workflow membership was revoked", { code: "workflow_execution_principal_revoked" });
  } else if (principal.type === "agent") {
    const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, run.companyId), eq(agents.id, principal.agentId)));
    if (!agent || !["active", "idle", "running"].includes(agent.status)) throw forbidden("Workflow agent is no longer active", {
      code: "workflow_execution_principal_revoked" });
  } else if (principal.service !== "local-board" || deploymentMode !== "local_trusted") {
    throw forbidden("Connector execution requires an initiating user or agent", { code: "workflow_execution_principal_required" });
  }
  const [origin] = run.executionAgentRunId ? await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, run.executionAgentRunId))) : [];
  const snapshot = origin?.contextSnapshot as Record<string, unknown> | undefined;
  const session: ToolGatewaySession = {
    id: `workflow:${run.id}:${node.id}`, token: "", companyId: run.companyId,
    agentId: principal.type === "agent" ? principal.agentId : null, runId: run.executionAgentRunId,
    issueId: typeof snapshot?.issueId === "string" ? snapshot.issueId : null,
    projectId: typeof snapshot?.projectId === "string" ? snapshot.projectId : null,
    actorType: principal.type,
    actorId: principal.type === "user" ? principal.userId : principal.type === "agent" ? principal.agentId : principal.service,
    responsibleUserId: principal.type === "user" ? principal.userId : run.responsibleUserId,
    workflowRunId: run.id, workflowNodeId: node.id, createdAt: new Date(),
    expiresAt: run.leaseExpiresAt ?? new Date(Date.now() + 30_000),
  };
  return { session, entry };
}
