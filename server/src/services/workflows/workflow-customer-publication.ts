import { and, desc, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import {
  activityLog,
  workflowRevisions,
  workflows,
  type Db,
} from "@paperclipai/db";
import {
  workflowPublicationCommandSchema,
  workflowPublicationReceiptSchema,
  workflowPublicationReviewSchema,
  type WorkflowPublicationCommand,
  type WorkflowPublicationReceipt,
  type WorkflowRevision,
} from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { v5HumanActorId } from "../v5-authorization.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { lockCustomerWorkflowControlAuthority } from "./workflow-customer-authority.js";
import { readCustomerWorkflowTestReceipt } from "./workflow-customer-test.js";
import { customerWorkflowTestReady } from "./workflow-customer-launch.js";
import { workflowService } from "./workflow-service.js";
import { workflowExecutorService } from "./workflow-executor.js";

const action = "workflow.customer_publication_recorded";
const permissions = [
  "workflows:read",
  "workflows:edit",
  "workflows:run",
  "workflows:publish",
] as const;
function currentActor(authority: AuthorizationActor) {
  const id = v5HumanActorId(authority);
  const principal =
    authority.source === "local_implicit"
      ? { type: "system" as const, service: "local-board" }
      : { type: "user" as const, userId: id };
  return { id, principal, authority: { ...authority, isInstanceAdmin: false } };
}
async function historicalReceipt(
  tx: Db,
  companyId: string,
  workflowId: string,
  actorId: string,
  event: typeof activityLog.$inferSelect,
  authority: AuthorizationActor,
) {
  const details = event.details as {
    command?: unknown;
    receipt?: unknown;
  } | null;
  const command = workflowPublicationCommandSchema.safeParse(details?.command),
    receipt = workflowPublicationReceiptSchema.safeParse(details?.receipt);
  if (
    !command.success ||
    !receipt.success ||
    event.actorType !== "user" ||
    event.actorId !== actorId ||
    command.data.requestId !== receipt.data.requestId ||
    command.data.expectedWorkflowId !== workflowId ||
    receipt.data.companyId !== companyId ||
    receipt.data.workflowId !== workflowId ||
    receipt.data.revisionId !== command.data.expectedDraftRevisionId ||
    receipt.data.testRunId !== command.data.expectedTestRunId
  )
    throw notFound("Original publication receipt is unavailable");
  const [revision] = await tx
    .select()
    .from(workflowRevisions)
    .where(
      and(
        eq(workflowRevisions.companyId, companyId),
        eq(workflowRevisions.workflowId, workflowId),
        eq(workflowRevisions.id, receipt.data.revisionId),
      ),
    )
    .for("share");
  if (!revision || !["published", "superseded"].includes(revision.state))
    throw notFound("Original publication source is unavailable");
  const run = await workflowExecutorService(tx).getRun(
    companyId,
    receipt.data.testRunId,
    authority,
  );
  if (
    !run ||
    run.run.source !== "test" ||
    run.run.workflowId !== workflowId ||
    run.run.workflowRevisionId !== receipt.data.revisionId ||
    run.run.status !== "succeeded"
  )
    throw notFound("Original publication test source is unavailable");
  return { command: command.data, receipt: receipt.data };
}
/** Publication facts are recovered from the native audit owner, not browser persistence. */
export async function readCustomerWorkflowPublication(
  db: Db,
  companyId: string,
  workflowId: string,
  authority: AuthorizationActor,
) {
  const actor = currentActor(authority);
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await lockCustomerWorkflowControlAuthority(
      tx,
      companyId,
      actor.authority,
      permissions,
    );
    const [workflow] = await tx
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)),
      )
      .for("share");
    if (!workflow) throw notFound("Workflow not found");
    const [event] = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "workflow"),
          eq(activityLog.entityId, workflowId),
          eq(activityLog.action, action),
          eq(activityLog.actorType, "user"),
          eq(activityLog.actorId, actor.id),
        ),
      )
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(1);
    const receipt = event
      ? (
          await historicalReceipt(
            tx,
            companyId,
            workflowId,
            actor.id,
            event,
            actor.authority,
          )
        ).receipt
      : null;
    const [draft] = workflow.draftRevisionId
      ? await tx
          .select()
          .from(workflowRevisions)
          .where(
            and(
              eq(workflowRevisions.companyId, companyId),
              eq(workflowRevisions.workflowId, workflowId),
              eq(workflowRevisions.id, workflow.draftRevisionId),
            ),
          )
          .for("share")
      : [];
    const nativeTest = await readCustomerWorkflowTestReceipt(
      tx,
      companyId,
      workflowId,
      actor.authority,
    );
    const test =
      nativeTest && nativeTest.revisionId === draft?.id
        ? ((
            await workflowExecutorService(tx).getRun(
              companyId,
              nativeTest.runId,
              actor.authority,
            )
          )?.run ?? null)
        : null;
    const ready =
      draft &&
      customerWorkflowTestReady({
        ...draft,
        state: draft.state as WorkflowRevision["state"],
      });
    return workflowPublicationReviewSchema.parse({
      companyId,
      workflowId,
      updatedAt: workflow.updatedAt.toISOString(),
      draftRevisionId: workflow.draftRevisionId,
      publishedRevisionId: workflow.publishedRevisionId,
      draftVersion: draft?.revisionNumber ?? null,
      testedRunId:
        test?.source === "test" &&
        test.status === "succeeded" &&
        test.workflowRevisionId === draft?.id
          ? test.id
          : null,
      availability:
        workflow.status !== "active"
          ? "not_active"
          : !draft
            ? "no_draft"
            : !ready
              ? "review_required"
              : test?.status === "succeeded"
                ? "internal_ready"
                : "test_required",
      receipt,
    });
  });
}
/** One native publication transaction and immutable original-request receipt. */
export async function admitCustomerWorkflowPublication(
  db: Db,
  companyId: string,
  workflowId: string,
  authority: AuthorizationActor,
  raw: WorkflowPublicationCommand,
): Promise<WorkflowPublicationReceipt> {
  const command = workflowPublicationCommandSchema.parse(raw),
    actor = currentActor(authority),
    started = performance.now();
  if (command.expectedWorkflowId !== workflowId)
    throw conflict("Workflow publication context changed", {
      code: "workflow_publication_conflict",
    });
  function budget() {
    if (performance.now() - started > 30000)
      throw conflict("Publication source review expired", {
        code: "workflow_publication_conflict",
      });
  }
  const publication = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await lockCustomerWorkflowControlAuthority(
      tx,
      companyId,
      actor.authority,
      permissions,
    );
    const [workflow] = await tx
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)),
      )
      .for("update");
    if (!workflow) throw notFound("Workflow not found");
    const events = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "workflow"),
          eq(activityLog.entityId, workflowId),
          eq(activityLog.action, action),
          sql`${activityLog.details}->'command'->>'requestId'=${command.requestId}`,
        ),
      )
      .limit(2);
    if (events.length) {
      if (
        events.length !== 1 ||
        events[0]!.actorId !== actor.id ||
        !isDeepStrictEqual(
          (events[0]!.details as { command?: unknown })?.command,
          command,
        )
      )
        throw conflict("Original publication request has different content", {
          code: "workflow_publication_request_conflict",
        });
      const original = await historicalReceipt(
        tx,
        companyId,
        workflowId,
        actor.id,
        events[0]!,
        actor.authority,
      );
      budget();
      return { receipt: original.receipt, publication: null };
    }
    const review = await readCustomerWorkflowPublication(
      tx,
      companyId,
      workflowId,
      actor.authority,
    );
    budget();
    if (
      review.availability !== "internal_ready" ||
      review.updatedAt !== command.expectedUpdatedAt ||
      review.draftRevisionId !== command.expectedDraftRevisionId ||
      review.publishedRevisionId !== command.expectedPublishedRevisionId ||
      review.testedRunId !== command.expectedTestRunId
    )
      throw conflict(
        "Review and test the current internal draft before publication",
        { code: "workflow_publication_conflict" },
      );
    const published = await workflowService(tx).publish(
      companyId,
      workflowId,
      {
        expectedDraftRevisionId: command.expectedDraftRevisionId,
        expectedPublishedRevisionId: command.expectedPublishedRevisionId,
      },
      { principal: actor.principal },
    );
    if (published.publishedRevisionId !== command.expectedDraftRevisionId)
      throw notFound("Native publication binding changed");
    const receipt = workflowPublicationReceiptSchema.parse({
      companyId,
      workflowId,
      requestId: command.requestId,
      revisionId: command.expectedDraftRevisionId,
      testRunId: command.expectedTestRunId,
      disposition: "published",
    });
    const recorded = await persistActivity(tx, {
      companyId,
      actorType: "user",
      actorId: actor.id,
      action,
      entityType: "workflow",
      entityId: workflowId,
      details: { command, receipt },
    });
    budget();
    return { receipt, publication: recorded.publication };
  });
  if (publication.publication) publishActivity(publication.publication);
  return publication.receipt;
}
