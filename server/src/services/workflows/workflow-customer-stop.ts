import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  companyMemberships,
  instanceSettings,
  principalPermissionGrants,
  workflowRevisions,
  workflowRuns,
  workflows,
  type Db,
} from "@paperclipai/db";
import {
  v9FeatureEnabled,
  workflowStopReceiptSchema,
  workflowStopCommandSchema,
  type WorkflowStopCommand,
  type WorkflowStopReceipt,
  type WorkflowRunDetail,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import {
  hasCurrentInstanceAdminRole,
  type AuthorizationActor,
} from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertLearnedAssetAnalyticalSources } from "../learning/learning-analytical-sources.js";
import { assertLearnedWorkflowPayloadAccess } from "../analytical-context-authority.js";
import { persistActivity } from "../activity-log.js";

export interface CustomerWorkflowStop {
  command: WorkflowStopCommand;
  authority: AuthorizationActor;
  deadline: number;
  receipt: WorkflowStopReceipt | null;
}
type Run = typeof workflowRuns.$inferSelect;
/** Recover only this human's native admission. The route repeats current run,
 * source and read/run authority checks before releasing this private receipt. */
export async function readCustomerWorkflowStopReceipt(
  db: Db,
  run: WorkflowRunDetail["run"],
  authority: AuthorizationActor,
): Promise<WorkflowStopReceipt | null> {
  const [event] = await db
    .select({ details: activityLog.details })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, run.companyId),
        eq(activityLog.entityType, "workflow_run"),
        eq(activityLog.entityId, run.id),
        eq(activityLog.action, "workflow.customer_stop_admitted"),
        eq(activityLog.actorType, "user"),
        eq(activityLog.actorId, v5HumanActorId(authority)),
      ),
    )
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(1);
  if (!event) return null;
  const receipt = workflowStopReceiptSchema.safeParse(event.details?.receipt);
  const command = workflowStopCommandSchema.safeParse(event.details?.command);
  if (
    !receipt.success ||
    !command.success ||
    receipt.data.companyId !== run.companyId ||
    receipt.data.workflowId !== run.workflowId ||
    receipt.data.runId !== run.id ||
    receipt.data.revisionId !== run.workflowRevisionId ||
    receipt.data.requestId !== event.details?.requestId ||
    receipt.data.requestId !== command.data.requestId ||
    command.data.expectedWorkflowId !== run.workflowId ||
    command.data.expectedRevisionId !== run.workflowRevisionId
  )
    throw notFound("Original workflow stop receipt is unavailable");
  return receipt.data;
}
/** The native cancellation route also retains the board viewer write fence.
 * Read the current membership, not the role copied into a request snapshot. */
export async function currentWorkflowStopRoleAllows(
  db: Db,
  companyId: string,
  authority: AuthorizationActor,
) {
  if (authority.source === "local_implicit") return true;
  const principal = v5HumanActorId(authority);
  if (await hasCurrentInstanceAdminRole(db, principal)) return true;
  const [membership] = await db
    .select({ role: companyMemberships.membershipRole })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, principal),
        eq(companyMemberships.status, "active"),
      ),
    );
  return !!membership && membership.role !== "viewer";
}
function budget(request: CustomerWorkflowStop) {
  if (performance.now() > request.deadline)
    throw unprocessable("Workflow stop source review exceeded its budget");
}
/** Called only by the native cancellation transaction, before its run lock. */
export async function lockCustomerWorkflowStop(
  tx: Db,
  companyId: string,
  request: CustomerWorkflowStop,
) {
  const principal = v5HumanActorId(request.authority);
  await lockAnalyticalCompany(tx, companyId);
  await lockMemoryPrivacy(tx, companyId);
  await instanceSettingsService(tx).getExperimental();
  await tx
    .select({ id: instanceSettings.id })
    .from(instanceSettings)
    .for("share");
  const flags = await instanceSettingsService(tx).getExperimental();
  if (
    !flags.enableWorkflowsV1 ||
    !v9FeatureEnabled(flags, "progressive_shell_v9")
  )
    throw notFound("Workflow stop is not enabled");
  if (request.authority.source !== "local_implicit") {
    const currentAdmin = await hasCurrentInstanceAdminRole(tx, principal, true);
    const memberships = await tx
      .select({
        id: companyMemberships.id,
        role: companyMemberships.membershipRole,
      })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, principal),
          eq(companyMemberships.status, "active"),
        ),
      )
      .for("share");
    if (!currentAdmin && memberships[0]?.role === "viewer")
      throw forbidden("Viewer access is read-only");
    await tx
      .select({ id: principalPermissionGrants.id })
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, "user"),
          eq(principalPermissionGrants.principalId, principal),
        ),
      )
      .for("share");
  }
  await assertV5Authorization(
    tx,
    request.authority,
    companyId,
    "workflows:read",
  );
  await assertV5Authorization(
    tx,
    request.authority,
    companyId,
    "workflows:run",
  );
  const [workflow] = await tx
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.companyId, companyId),
        eq(workflows.id, request.command.expectedWorkflowId),
      ),
    )
    .for("share");
  if (!workflow) throw notFound("Workflow not found");
  budget(request);
}
/** Return the original receipt only after current authority and retained sources.
 * A new command must match the reviewed run; publication changes never rebind it. */
export async function inspectCustomerWorkflowStop(
  tx: Db,
  run: Run,
  request: CustomerWorkflowStop,
) {
  const { command, authority } = request;
  const [revision] = await tx
    .select({ id: workflowRevisions.id })
    .from(workflowRevisions)
    .where(
      and(
        eq(workflowRevisions.companyId, run.companyId),
        eq(workflowRevisions.workflowId, run.workflowId),
        eq(workflowRevisions.id, run.workflowRevisionId),
      ),
    )
    .for("share");
  if (!revision) throw notFound("Workflow run revision not found");
  await assertLearnedAssetAnalyticalSources(
    tx,
    run.companyId,
    "workflow_revision",
    revision.id,
    authority,
  );
  await assertLearnedWorkflowPayloadAccess(tx, run.companyId, authority, {
    workflowRunId: run.id,
  });
  if (
    run.workflowId !== command.expectedWorkflowId ||
    run.workflowRevisionId !== command.expectedRevisionId
  )
    throw conflict("Workflow run changed; review the current run", {
      code: "workflow_stop_conflict",
    });
  const prior = await tx
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, run.companyId),
        eq(activityLog.entityType, "workflow_run"),
        eq(activityLog.entityId, run.id),
        eq(activityLog.action, "workflow.customer_stop_admitted"),
        sql`${activityLog.details}->>'requestId' = ${command.requestId}`,
      ),
    )
    .limit(2);
  if (prior.length > 1)
    throw notFound("Original workflow stop receipt is unavailable");
  if (prior[0]) {
    if (
      prior[0].actorId !== v5HumanActorId(authority) ||
      !isDeepStrictEqual(prior[0].details?.command, command)
    )
      throw conflict("Original workflow stop request changed", {
        code: "workflow_stop_request_conflict",
      });
    const receipt = workflowStopReceiptSchema.parse(prior[0].details?.receipt);
    if (
      receipt.companyId !== run.companyId ||
      receipt.workflowId !== run.workflowId ||
      receipt.runId !== run.id ||
      receipt.revisionId !== run.workflowRevisionId ||
      receipt.requestId !== command.requestId
    )
      throw notFound("Original workflow stop receipt is unavailable");
    budget(request);
    request.receipt = receipt;
    return true;
  }
  if (
    run.updatedAt.toISOString() !== command.expectedUpdatedAt ||
    !["queued", "running", "waiting", "recovering", "cancelling"].includes(
      run.status,
    )
  )
    throw conflict("Workflow run changed; review the current run", {
      code: "workflow_stop_conflict",
    });
  budget(request);
  return false;
}
/** The native owner calls this after requesting cancellation in the same transaction. */
export async function recordCustomerWorkflowStop(
  tx: Db,
  run: Run,
  request: CustomerWorkflowStop,
) {
  if (!["cancelling", "cancelled"].includes(run.status))
    throw new Error("Native workflow cancellation was not admitted");
  budget(request);
  const receipt = workflowStopReceiptSchema.parse({
    companyId: run.companyId,
    workflowId: run.workflowId,
    runId: run.id,
    revisionId: run.workflowRevisionId,
    requestId: request.command.requestId,
    disposition: "cancellation_requested",
  });
  const activity = await persistActivity(tx, {
    companyId: run.companyId,
    actorType: "user",
    actorId: v5HumanActorId(request.authority),
    action: "workflow.customer_stop_admitted",
    entityType: "workflow_run",
    entityId: run.id,
    details: {
      requestId: request.command.requestId,
      command: request.command,
      receipt,
    },
  });
  request.receipt = receipt;
  return activity.publication;
}
