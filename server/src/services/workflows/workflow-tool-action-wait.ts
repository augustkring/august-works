import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { toolActionRequests, toolInvocations, workflowRuns, workflowStepRuns, workflowWaits, type Db } from "@paperclipai/db";
import type { WorkflowRunActor } from "./workflow-executor.js";
import { conflict } from "../../errors.js";
import { persistActivity, publishActivity } from "../activity-log.js";

type Run = typeof workflowRuns.$inferSelect;
type Step = typeof workflowStepRuns.$inferSelect;
type Wait = typeof workflowWaits.$inferSelect;

export async function scheduleToolActionWait(db: Db, run: Run, step: Step,
  invocationId: string, actionRequestId: string, actor: WorkflowRunActor) {
  const now = new Date();
  const publications: Awaited<ReturnType<typeof persistActivity>>["publication"][] = [];
  await db.transaction(async (tx) => {
    const [owned] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.id, run.id),
      eq(workflowRuns.companyId, run.companyId))).for("update");
    if (owned?.status !== "running" || owned.executionOwnerId !== run.executionOwnerId ||
      !owned.leaseExpiresAt || owned.leaseExpiresAt <= now) {
      throw conflict("Workflow execution ownership changed", { code: "workflow_run_claim_lost" });
    }
    const [request] = await tx.select().from(toolActionRequests).where(and(
      eq(toolActionRequests.id, actionRequestId), eq(toolActionRequests.companyId, run.companyId),
      eq(toolActionRequests.invocationId, invocationId), eq(toolActionRequests.status, "pending")));
    const [invocation] = await tx.select().from(toolInvocations).where(and(eq(toolInvocations.id, invocationId),
      eq(toolInvocations.companyId, run.companyId), eq(toolInvocations.workflowRunId, run.id),
      eq(toolInvocations.workflowNodeId, step.nodeId), eq(toolInvocations.status, "awaiting_approval")));
    if (!request?.signedArguments || !invocation) {
      throw conflict("Workflow tool review binding is unavailable", { code: "workflow_approval_binding_invalid" });
    }
    const [waitingStep] = await tx.update(workflowStepRuns).set({ status: "waiting", toolInvocationId: invocationId,
      updatedAt: now }).where(and(eq(workflowStepRuns.id, step.id), eq(workflowStepRuns.companyId, run.companyId),
      eq(workflowStepRuns.workflowRunId, run.id), eq(workflowStepRuns.status, "running"))).returning();
    if (!waitingStep) throw conflict("Workflow step changed during review", { code: "workflow_wait_create_conflict" });
    const [wait] = await tx.insert(workflowWaits).values({ companyId: run.companyId, workflowRunId: run.id,
      nodeId: step.nodeId, waitKey: "primary", kind: "tool_action", status: "active", referenceType: "tool_invocation",
      referenceId: invocation.id, timeoutAt: request.expiresAt, createdAt: now, updatedAt: now }).returning();
    await tx.update(workflowRuns).set({ status: "waiting", executionOwnerId: null, leaseExpiresAt: null,
      ownerHeartbeatAt: null, updatedAt: now }).where(eq(workflowRuns.id, run.id));
    const { publication } = await persistActivity(tx as unknown as Db, {
      companyId: run.companyId, actorType: actor.principal.type,
      actorId: actor.principal.type === "user" ? actor.principal.userId : actor.principal.type === "agent" ? actor.principal.agentId : actor.principal.service,
      agentId: actor.principal.type === "agent" ? actor.principal.agentId : null,
      runId: actor.runId ?? null, action: "workflow.tool_action_requested", entityType: "workflow_wait", entityId: wait.id,
      details: { workflowRunId: run.id, nodeId: step.nodeId, invocationId, actionRequestId,
        approvalId: request.approvalId, waitKind: "tool_action" },
    });
    publications.push(publication);
  });
  for (const publication of publications) publishActivity(publication);
}

/** Consume the existing gateway receipt; recovery never calls the provider again. */
export async function resolveToolActionWait(db: Db, run: Run, wait: Wait, now: Date) {
  const [invocation] = await db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, run.companyId),
    eq(toolInvocations.workflowRunId, run.id), eq(toolInvocations.workflowNodeId, wait.nodeId),
    eq(toolInvocations.id, wait.referenceId ?? "00000000-0000-0000-0000-000000000000")));
  const [request] = invocation ? await db.select().from(toolActionRequests).where(and(
    eq(toolActionRequests.companyId, run.companyId), eq(toolActionRequests.invocationId, invocation.id))) : [];
  const succeeded = invocation?.status === "succeeded" && request?.status === "executed";
  const expired = Boolean(wait.timeoutAt && wait.timeoutAt <= now);
  if (request && ["pending", "approved", "executing"].includes(request.status) && !expired) return null;
  const errorCode = !invocation || !request ? "workflow_approval_binding_invalid"
    : expired && !succeeded ? "workflow_tool_review_expired"
      : request.status === "rejected" ? "workflow_tool_review_declined"
        : invocation.errorCode ?? "workflow_tool_review_failed";
  let publication: Awaited<ReturnType<typeof persistActivity>>["publication"] | null = null;
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.id, run.id),
      eq(workflowRuns.companyId, run.companyId))).for("update");
    if (current?.status !== "waiting" || current.executionOwnerId !== null) return null;
    const [resolved] = await tx.update(workflowWaits).set({ status: succeeded ? "resolved" : expired ? "timed_out" : "resolved",
      resolutionJson: { invocationId: invocation?.id ?? null, actionRequestId: request?.id ?? null,
        outcome: succeeded ? "succeeded" : "failed", errorCode: succeeded ? null : errorCode },
      resolvedAt: now, resolvedByType: "system", resolvedById: "workflow-tool-review", updatedAt: now,
    }).where(and(eq(workflowWaits.id, wait.id), eq(workflowWaits.workflowRunId, run.id),
      eq(workflowWaits.status, "active"))).returning();
    if (!resolved) return null;
    if (!succeeded && request) await tx.update(toolActionRequests).set({ status: expired ? "expired" : "cancelled",
      resolvedAt: now, updatedAt: now }).where(and(eq(toolActionRequests.id, request.id),
      inArray(toolActionRequests.status, ["pending", "approved"])));
    const [step] = await tx.update(workflowStepRuns).set({ status: succeeded ? "succeeded" : "failed",
      outputJson: succeeded ? invocation!.workflowResultJson : null, errorCode: succeeded ? null : errorCode,
      errorMessage: succeeded ? null : "The governed tool review did not complete successfully",
      finishedAt: now, updatedAt: now,
    }).where(and(eq(workflowStepRuns.companyId, run.companyId), eq(workflowStepRuns.workflowRunId, run.id),
      eq(workflowStepRuns.nodeId, wait.nodeId), eq(workflowStepRuns.status, "waiting"),
      invocation ? eq(workflowStepRuns.toolInvocationId, invocation.id) : undefined)).returning();
    if (!step) throw conflict("Workflow review checkpoint changed", { code: "workflow_wait_resolution_conflict" });
    const [resumed] = await tx.update(workflowRuns).set({ status: "running", executionOwnerId: `tool-review:${randomUUID()}`,
      ownerHeartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + 30_000), updatedAt: now,
    }).where(eq(workflowRuns.id, run.id)).returning();
    const audit = await persistActivity(tx as unknown as Db, {
      companyId: run.companyId, actorType: "system", actorId: "workflow-tool-review",
      action: "workflow.tool_action_resolved", entityType: "workflow_wait", entityId: wait.id,
      details: { workflowRunId: run.id, nodeId: wait.nodeId, invocationId: invocation?.id ?? null,
        actionRequestId: request?.id ?? null, outcome: succeeded ? "succeeded" : "failed",
        errorCode: succeeded ? null : errorCode },
    });
    publication = audit.publication;
    return { run: resumed, succeeded, errorCode };
  });
  if (publication) publishActivity(publication);
  return result;
}
