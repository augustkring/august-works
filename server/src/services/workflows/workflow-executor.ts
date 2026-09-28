import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from "@paperclipai/db";
import {
  startWorkflowRunSchema,
  type ExecutionPrincipal,
  type StartWorkflowRun,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowStepRun,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";

const MANUAL_EXECUTION_LEASE_MS = 30_000;

export interface WorkflowRunActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
  responsibleUserId?: string | null;
}

function workflowActivityActor(actor: WorkflowRunActor) {
  if (actor.principal.type === "user") {
    return {
      actorType: "user" as const,
      actorId: actor.principal.userId,
      agentId: null,
    };
  }
  if (actor.principal.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: actor.principal.agentId,
      agentId: actor.principal.agentId,
    };
  }
  return {
    actorType: "system" as const,
    actorId: actor.principal.service,
    agentId: null,
  };
}

function publishActivities(publications: ActivityPublication[]) {
  for (const publication of publications) publishActivity(publication);
}

async function persistWorkflowActivity(
  db: Db,
  actor: WorkflowRunActor,
  input: {
    companyId: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown> | null;
  },
) {
  const activityActor = workflowActivityActor(actor);
  return persistActivity(db, {
    companyId: input.companyId,
    actorType: activityActor.actorType,
    actorId: activityActor.actorId,
    agentId: activityActor.agentId,
    runId: actor.runId ?? null,
    responsibleUserIdOverride: actor.responsibleUserId ??
      (actor.principal.type === "user" ? actor.principal.userId : null),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details ?? null,
  });
}

function mapRun(row: typeof workflowRuns.$inferSelect): WorkflowRun {
  return {
    ...row,
    status: row.status as WorkflowRun["status"],
    source: row.source as WorkflowRun["source"],
    triggerPayload: (row.triggerPayload ?? {}) as Record<string, unknown>,
  };
}

function mapStep(row: typeof workflowStepRuns.$inferSelect): WorkflowStepRun {
  return {
    ...row,
    status: row.status as WorkflowStepRun["status"],
  };
}

async function assertActorCompanyScope(
  db: Db,
  companyId: string,
  actor: WorkflowRunActor,
) {
  if (actor.principal.type === "system") return;
  if (actor.principal.type === "agent") {
    const agent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.id, actor.principal.agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!agent) {
      throw forbidden("Agent does not belong to this company", {
        code: "company_boundary_denied",
      });
    }
    return;
  }
  const membership = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.principal.userId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!membership) {
    throw forbidden("User does not have an active company membership", {
      code: "company_boundary_denied",
    });
  }
}

async function getRunDetail(
  db: Db,
  companyId: string,
  runId: string,
): Promise<WorkflowRunDetail | null> {
  const run = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId)))
    .then((rows) => rows[0] ?? null);
  if (!run) return null;
  const steps = await db
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.companyId, companyId),
        eq(workflowStepRuns.workflowRunId, runId),
      ),
    )
    .orderBy(asc(workflowStepRuns.createdAt), asc(workflowStepRuns.attempt));
  return { run: mapRun(run), steps: steps.map(mapStep) };
}

async function getIdempotentRun(
  db: Db,
  companyId: string,
  idempotencyKey: string,
) {
  return db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.companyId, companyId),
        eq(workflowRuns.idempotencyKey, idempotencyKey),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

function assertIdempotentRequestMatches(
  existing: typeof workflowRuns.$inferSelect,
  input: {
    workflowId: string;
    revisionId: string;
    triggerPayload: Record<string, unknown>;
  },
) {
  if (
    existing.workflowId !== input.workflowId ||
    existing.workflowRevisionId !== input.revisionId ||
    !isDeepStrictEqual(existing.triggerPayload ?? {}, input.triggerPayload)
  ) {
    throw conflict("Idempotency key was already used for a different workflow run request", {
      code: "idempotency_key_reused",
      workflowRunId: existing.id,
    });
  }
}

async function createQueuedManualRun(
  db: Db,
  input: {
    companyId: string;
    workflowId: string;
    revisionId: string;
    nodeId: string;
    triggerPayload: Record<string, unknown>;
    responsibleUserId: string | null;
    idempotencyKey: string | null;
    correlationId: string;
    actor: WorkflowRunActor;
  },
) {
  if (input.idempotencyKey) {
    const existing = await getIdempotentRun(db, input.companyId, input.idempotencyKey);
    if (existing) {
      assertIdempotentRequestMatches(existing, input);
      return { run: existing, created: false };
    }
  }

  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const [run] = await tx
        .insert(workflowRuns)
        .values({
          companyId: input.companyId,
          workflowId: input.workflowId,
          workflowRevisionId: input.revisionId,
          status: "queued",
          source: "manual",
          triggerPayload: input.triggerPayload,
          responsibleUserId: input.responsibleUserId,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(workflowStepRuns).values({
        companyId: input.companyId,
        workflowRunId: run!.id,
        nodeId: input.nodeId,
        attempt: 1,
        status: "pending",
        inputJson: input.triggerPayload,
        createdAt: now,
        updatedAt: now,
      });
      const { publication } = await persistWorkflowActivity(
        tx as unknown as Db,
        input.actor,
        {
          companyId: input.companyId,
          action: "workflow.run_queued",
          entityType: "workflow_run",
          entityId: run!.id,
          details: {
            workflowId: input.workflowId,
            workflowRevisionId: input.revisionId,
            source: "manual",
          },
        },
      );
      return { run: run!, created: true, publications: [publication] };
    }).then((result) => {
      publishActivities(result.publications);
      return { run: result.run, created: result.created };
    });
  } catch (error) {
    if (input.idempotencyKey && isUniqueViolation(error, "workflow_runs_company_idempotency_uq")) {
      const existing = await getIdempotentRun(db, input.companyId, input.idempotencyKey);
      if (!existing) throw error;
      assertIdempotentRequestMatches(existing, input);
      return { run: existing, created: false };
    }
    throw error;
  }
}

async function claimQueuedRun(
  db: Db,
  companyId: string,
  runId: string,
  ownerId: string,
  actor: WorkflowRunActor,
) {
  const publications: ActivityPublication[] = [];
  const claimed = await db.transaction(async (tx) => {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + MANUAL_EXECUTION_LEASE_MS);
    const [row] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        executionOwnerId: ownerId,
        leaseExpiresAt,
        ownerHeartbeatAt: now,
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.companyId, companyId),
          eq(workflowRuns.id, runId),
          eq(workflowRuns.status, "queued"),
        ),
      )
      .returning();
    if (!row) return null;
    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId,
        action: "workflow.run_started",
        entityType: "workflow_run",
        entityId: runId,
        details: { executionOwnerId: ownerId },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return claimed;
}

async function executeManualTrigger(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
  actor: WorkflowRunActor,
) {
  const startedPublications: ActivityPublication[] = [];
  const runningStep = await db.transaction(async (tx) => {
    const stepStartedAt = new Date();
    const [row] = await tx
      .update(workflowStepRuns)
      .set({
        status: "running",
        startedAt: stepStartedAt,
        updatedAt: stepStartedAt,
      })
      .where(
        and(
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.nodeId, nodeId),
          eq(workflowStepRuns.attempt, 1),
          eq(workflowStepRuns.status, "pending"),
        ),
      )
      .returning();
    if (!row) {
      throw conflict("Workflow trigger step could not be claimed", {
        code: "workflow_step_claim_conflict",
        workflowRunId: run.id,
        nodeId,
      });
    }
    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_started",
        entityType: "workflow_step_run",
        entityId: row.id,
        details: {
          workflowRunId: run.id,
          nodeId,
          attempt: 1,
        },
      },
    );
    startedPublications.push(publication);
    return row;
  });
  publishActivities(startedPublications);

  const finishedAt = new Date();
  const durationMs = Math.max(
    0,
    finishedAt.getTime() - (runningStep.startedAt ?? finishedAt).getTime(),
  );
  const completedPublications: ActivityPublication[] = [];
  await db.transaction(async (tx) => {
    const [finishedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "succeeded",
        outputJson: run.triggerPayload ?? {},
        finishedAt,
        durationMs,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(workflowStepRuns.id, runningStep.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!finishedStep) {
      throw conflict("Workflow trigger step changed during completion", {
        code: "workflow_step_completion_conflict",
        workflowRunId: run.id,
        nodeId,
      });
    }

    const [finishedRun] = await tx
      .update(workflowRuns)
      .set({
        status: "succeeded",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "running"),
          eq(workflowRuns.executionOwnerId, run.executionOwnerId!),
        ),
      )
      .returning();
    if (!finishedRun) {
      throw conflict("Workflow run ownership changed during completion", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_completed",
        entityType: "workflow_step_run",
        entityId: finishedStep.id,
        details: {
          workflowRunId: run.id,
          nodeId,
          attempt: 1,
          durationMs,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_completed",
        entityType: "workflow_run",
        entityId: finishedRun.id,
        details: {
          workflowId: finishedRun.workflowId,
          workflowRevisionId: finishedRun.workflowRevisionId,
          source: finishedRun.source,
        },
      },
    );
    completedPublications.push(stepActivity.publication, runActivity.publication);
  });
  publishActivities(completedPublications);
}

export function workflowExecutorService(db: Db) {
  return {
    getRun: (companyId: string, runId: string) =>
      getRunDetail(db, companyId, runId),

    startManualRun: async (
      companyId: string,
      workflowId: string,
      rawInput: StartWorkflowRun,
      actor: WorkflowRunActor,
      idempotencyKey: string | null,
    ): Promise<WorkflowRunDetail> => {
      const parsed = startWorkflowRunSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid workflow run request", parsed.error.issues);
      }
      const input = parsed.data;
      await assertActorCompanyScope(db, companyId, actor);

      const workflow = await db
        .select({
          id: workflows.id,
          status: workflows.status,
          publishedRevisionId: workflows.publishedRevisionId,
        })
        .from(workflows)
        .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)))
        .then((rows) => rows[0] ?? null);
      if (!workflow) throw notFound("Workflow not found");

      const existingIdempotentRun = idempotencyKey
        ? await getIdempotentRun(db, companyId, idempotencyKey)
        : null;
      if (existingIdempotentRun) {
        if (
          existingIdempotentRun.workflowId !== workflowId ||
          !isDeepStrictEqual(existingIdempotentRun.triggerPayload ?? {}, input.input) ||
          (input.revisionId !== null &&
            input.revisionId !== undefined &&
            existingIdempotentRun.workflowRevisionId !== input.revisionId)
        ) {
          throw conflict(
            "Idempotency key was already used for a different workflow run request",
            {
              code: "idempotency_key_reused",
              workflowRunId: existingIdempotentRun.id,
            },
          );
        }
        const existingDetail = await getRunDetail(
          db,
          companyId,
          existingIdempotentRun.id,
        );
        if (!existingDetail) {
          throw new Error("Idempotent workflow run could not be reloaded");
        }
        return existingDetail;
      }

      if (workflow.status !== "active") {
        throw conflict("Workflow is not active", {
          code: "workflow_invalid_transition",
          status: workflow.status,
        });
      }
      if (!workflow.publishedRevisionId) {
        throw unprocessable("Workflow has no published revision", {
          code: "workflow_revision_not_published",
        });
      }

      const revisionId = input.revisionId ?? workflow.publishedRevisionId;
      if (revisionId !== workflow.publishedRevisionId) {
        throw unprocessable("Manual live runs must use the current published revision", {
          code: "workflow_revision_not_published",
          revisionId,
          currentPublishedRevisionId: workflow.publishedRevisionId,
        });
      }
      const revision = await db
        .select()
        .from(workflowRevisions)
        .where(
          and(
            eq(workflowRevisions.companyId, companyId),
            eq(workflowRevisions.workflowId, workflowId),
            eq(workflowRevisions.id, revisionId),
            eq(workflowRevisions.state, "published"),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!revision) {
        throw unprocessable("Published workflow revision could not be resolved", {
          code: "workflow_revision_not_published",
          revisionId,
        });
      }

      const executableNodes = revision.graph.nodes.filter(
        (node) => node.type !== "core.manual_trigger",
      );
      const triggers = revision.graph.nodes.filter(
        (node) => node.type === "core.manual_trigger",
      );
      if (triggers.length !== 1 || executableNodes.length !== 0) {
        throw unprocessable(
          "This workflow revision requires executor capabilities that are not enabled yet",
          {
            code: "workflow_executor_capability_not_ready",
            unsupportedNodeTypes: [...new Set(executableNodes.map((node) => node.type))].sort(),
          },
        );
      }

      const queued = await createQueuedManualRun(db, {
        companyId,
        workflowId,
        revisionId,
        nodeId: triggers[0]!.id,
        triggerPayload: input.input,
        responsibleUserId:
          actor.responsibleUserId ??
          (actor.principal.type === "user" ? actor.principal.userId : null),
        idempotencyKey,
        correlationId: randomUUID(),
        actor,
      });

      if (queued.created) {
        const ownerId = `inline:${randomUUID()}`;
        const claimed = await claimQueuedRun(db, companyId, queued.run.id, ownerId, actor);
        if (!claimed) {
          throw conflict("Workflow run could not be claimed", {
            code: "workflow_run_claim_conflict",
            workflowRunId: queued.run.id,
          });
        }
        await executeManualTrigger(db, claimed, triggers[0]!.id, actor);
      }

      const detail = await getRunDetail(db, companyId, queued.run.id);
      if (!detail) throw new Error("Workflow run disappeared after execution");
      return detail;
    },
  };
}
