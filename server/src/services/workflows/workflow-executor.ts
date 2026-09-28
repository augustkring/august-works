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

const MANUAL_EXECUTION_LEASE_MS = 30_000;

export interface WorkflowRunActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
  responsibleUserId?: string | null;
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
      return { run: run!, created: true };
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
) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + MANUAL_EXECUTION_LEASE_MS);
  const [claimed] = await db
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
  return claimed ?? null;
}

async function executeManualTrigger(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
) {
  const stepStartedAt = new Date();
  const [runningStep] = await db
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
  if (!runningStep) {
    throw conflict("Workflow trigger step could not be claimed", {
      code: "workflow_step_claim_conflict",
      workflowRunId: run.id,
      nodeId,
    });
  }

  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - stepStartedAt.getTime());
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
  });
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
      });

      if (queued.created) {
        const ownerId = `inline:${randomUUID()}`;
        const claimed = await claimQueuedRun(db, companyId, queued.run.id, ownerId);
        if (!claimed) {
          throw conflict("Workflow run could not be claimed", {
            code: "workflow_run_claim_conflict",
            workflowRunId: queued.run.id,
          });
        }
        await executeManualTrigger(db, claimed, triggers[0]!.id);
      }

      const detail = await getRunDetail(db, companyId, queued.run.id);
      if (!detail) throw new Error("Workflow run disappeared after execution");
      return detail;
    },
  };
}
