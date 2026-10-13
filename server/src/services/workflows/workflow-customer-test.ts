import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  workflowRevisions,
  workflowRuns,
  workflows,
  type Db,
} from "@paperclipai/db";
import {
  workflowTestCommandSchema,
  workflowTestReceiptSchema,
  type WorkflowRevision,
  type WorkflowTestCommand,
  type WorkflowTestReceipt,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { v5HumanActorId } from "../v5-authorization.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { assertLearnedAssetAnalyticalSources } from "../learning/learning-analytical-sources.js";
import { assertLearnedWorkflowPayloadAccess } from "../analytical-context-authority.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockCustomerWorkflowControlAuthority, lockCustomerWorkflowReceiptAuthority } from "./workflow-customer-authority.js";
import { customerWorkflowTestReady } from "./workflow-customer-launch.js";
import { workflowNodeRegistryService } from "./workflow-node-registry.js";
import { enqueueWorkflowRunInTransaction } from "./workflow-executor.js";

/** A fresh page recovers only this human's actual native admission. No browser
 * persistence or inferred completion is needed after a lost HTTP response. */
export async function readCustomerWorkflowTestReceipt(
  db: Db,
  companyId: string,
  workflowId: string,
  authority: AuthorizationActor,
  requestId?: string,
): Promise<WorkflowTestReceipt | null> {
  if (requestId !== undefined) workflowTestReceiptSchema.shape.requestId.parse(requestId);
  const deadline = performance.now() + 30_000;
  return db.transaction(async (tx) => {
    const nativeDb = tx as unknown as Db;
    const lock = requestId === undefined ? lockCustomerWorkflowControlAuthority : lockCustomerWorkflowReceiptAuthority;
    await lock(nativeDb, companyId, authority, [
      "workflows:read",
      "workflows:edit",
      "workflows:run",
    ]);
    const [workflow] = await tx
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)),
      )
      .for("share");
    if (!workflow) throw notFound("Workflow not found");
    const events = await tx
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "workflow"),
          eq(activityLog.entityId, workflowId),
          eq(activityLog.action, "workflow.customer_test_admitted"),
          eq(activityLog.actorType, "user"),
          eq(activityLog.actorId, v5HumanActorId(authority)),
          requestId === undefined ? undefined : sql`${activityLog.details}->>'requestId'=${requestId}`,
        ),
      )
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(requestId === undefined ? 1 : 2);
    if (requestId !== undefined && events.length > 1) throw notFound("The Original test request is ambiguous");
    const event = events[0];
    if (!event) return null;
    const receipt = workflowTestReceiptSchema.safeParse(event.details?.receipt);
    const command = workflowTestCommandSchema.safeParse(event.details?.command);
    if (
      !receipt.success ||
      !command.success ||
      receipt.data.companyId !== companyId ||
      receipt.data.workflowId !== workflowId ||
      receipt.data.requestId !== event.details?.requestId ||
      receipt.data.requestId !== command.data.requestId ||
      command.data.expectedWorkflowId !== workflowId ||
      command.data.expectedDraftRevisionId !== receipt.data.revisionId
    )
      throw notFound("Original workflow test receipt is unavailable");
    const [run] = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.companyId, companyId),
          eq(workflowRuns.workflowId, workflowId),
          eq(workflowRuns.id, receipt.data.runId),
          eq(workflowRuns.workflowRevisionId, receipt.data.revisionId),
          eq(workflowRuns.source, "test"),
        ),
      )
      .for("share");
    const [revision] = await tx
      .select({ id: workflowRevisions.id })
      .from(workflowRevisions)
      .where(
        and(
          eq(workflowRevisions.companyId, companyId),
          eq(workflowRevisions.workflowId, workflowId),
          eq(workflowRevisions.id, receipt.data.revisionId),
        ),
      )
      .for("share");
    if (!run || !revision)
      throw notFound("Original workflow test source is unavailable");
    await assertLearnedAssetAnalyticalSources(
      nativeDb,
      companyId,
      "workflow_revision",
      revision.id,
      authority,
    );
    await assertLearnedWorkflowPayloadAccess(nativeDb, companyId, authority, {
      workflowRunId: run.id,
    });
    if (performance.now() > deadline)
      throw unprocessable("Workflow test source review exceeded its budget");
    return receipt.data;
  });
}

/** A native unpublished test is a separate canonical run source. Admission
 * neither publishes a revision nor claims execution/business verification. */
export async function admitCustomerWorkflowTest(
  db: Db,
  companyId: string,
  workflowId: string,
  rawInput: WorkflowTestCommand,
  authority: AuthorizationActor,
) {
  const command = workflowTestCommandSchema.parse(rawInput);
  const principal = v5HumanActorId(authority);
  if (command.expectedWorkflowId !== workflowId)
    throw conflict("Workflow test context changed", {
      code: "workflow_test_conflict",
    });
  const deadline = performance.now() + 30_000;
  const budget = () => {
    if (performance.now() > deadline)
      throw unprocessable("Workflow test source review exceeded its budget");
  };
  const admitted = await db.transaction(async (tx) => {
    const nativeDb = tx as unknown as Db;
    await lockCustomerWorkflowControlAuthority(nativeDb, companyId, authority, [
      "workflows:read",
      "workflows:edit",
      "workflows:run",
    ]);
    const [workflow] = await tx
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)),
      )
      .for("update");
    if (!workflow) throw notFound("Workflow not found");
    const [revision] = await tx
      .select()
      .from(workflowRevisions)
      .where(
        and(
          eq(workflowRevisions.companyId, companyId),
          eq(workflowRevisions.workflowId, workflowId),
          eq(workflowRevisions.id, command.expectedDraftRevisionId),
        ),
      )
      .for("share");
    if (!revision) throw notFound("Workflow test revision not found");
    await assertLearnedAssetAnalyticalSources(
      nativeDb,
      companyId,
      "workflow_revision",
      revision.id,
      authority,
    );
    const prior = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "workflow"),
          eq(activityLog.entityId, workflowId),
          eq(activityLog.action, "workflow.customer_test_admitted"),
          sql`${activityLog.details}->>'requestId' = ${command.requestId}`,
        ),
      )
      .limit(2);
    if (prior.length > 1)
      throw notFound("Original workflow test receipt is unavailable");
    if (prior[0]) {
      if (
        prior[0].actorId !== principal ||
        prior[0].actorType !== "user" ||
        !isDeepStrictEqual(prior[0].details?.command, command)
      )
        throw conflict("Original workflow test request changed", {
          code: "workflow_test_request_conflict",
        });
      const receipt = workflowTestReceiptSchema.safeParse(
        prior[0].details?.receipt,
      );
      if (
        !receipt.success ||
        receipt.data.companyId !== companyId ||
        receipt.data.workflowId !== workflowId ||
        receipt.data.revisionId !== revision.id ||
        receipt.data.requestId !== command.requestId
      )
        throw notFound("Original workflow test receipt is unavailable");
      const [run] = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            eq(workflowRuns.workflowId, workflowId),
            eq(workflowRuns.id, receipt.data.runId),
            eq(workflowRuns.workflowRevisionId, revision.id),
            eq(workflowRuns.source, "test"),
          ),
        )
        .for("share");
      if (!run) throw notFound("Original workflow test run is unavailable");
      await assertLearnedWorkflowPayloadAccess(nativeDb, companyId, authority, {
        workflowRunId: run.id,
      });
      budget();
      return { receipt: receipt.data, publications: [] };
    }
    if (
      workflow.status !== "active" ||
      workflow.updatedAt.toISOString() !== command.expectedUpdatedAt ||
      workflow.draftRevisionId !== revision.id ||
      revision.state !== "draft"
    )
      throw conflict("Workflow changed; review the current draft", {
        code: "workflow_test_conflict",
      });
    if (
      !customerWorkflowTestReady({
        ...revision,
        state: revision.state as WorkflowRevision["state"],
      })
    )
      throw conflict("This draft requires a separately qualified test", {
        code: "workflow_test_review_required",
      });
    const graph = await workflowNodeRegistryService(
      nativeDb,
    ).validatePublishGraph(companyId, revision.graph, workflowId);
    const trigger = graph.nodes.find(
      (node) => node.type === "core.manual_trigger",
    );
    if (!trigger)
      throw conflict("This test has no internal manual start", {
        code: "workflow_test_review_required",
      });
    await assertSaasDomainAdmission(nativeDb, companyId, "workflows.use");
    budget();
    const queued = await enqueueWorkflowRunInTransaction(nativeDb, {
      companyId,
      workflowId,
      revisionId: revision.id,
      nodeId: trigger.id,
      source: "test",
      triggerPayload: {},
      customerTestCommand: command,
      responsibleUserId:
        authority.source === "local_implicit" ? null : principal,
      idempotencyKey: `v9-test:${nativeSha256({ principal, workflowId, requestId: command.requestId })}`,
      correlationId: command.requestId,
      actor: {
        principal:
          authority.source === "local_implicit"
            ? { type: "system", service: "local-board" }
            : { type: "user", userId: principal },
      },
    });
    const receipt = workflowTestReceiptSchema.parse({
      companyId,
      workflowId,
      requestId: command.requestId,
      runId: queued.run.id,
      revisionId: revision.id,
      purpose: "test",
      disposition: "admitted",
    });
    const event = await persistActivity(nativeDb, {
      companyId,
      actorType: "user",
      actorId: principal,
      action: "workflow.customer_test_admitted",
      entityType: "workflow",
      entityId: workflowId,
      details: { requestId: command.requestId, command, receipt },
    });
    budget();
    return {
      receipt,
      publications: [...queued.publications, event.publication],
    };
  });
  for (const publication of admitted.publications) publishActivity(publication);
  return admitted.receipt;
}
