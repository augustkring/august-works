import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
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
  type WorkflowGraphV1,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowStepRun,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import {
  evaluateWorkflowConditionExpression,
  WorkflowConditionExpressionError,
} from "./workflow-condition-expression.js";

const WORKFLOW_EXECUTION_LEASE_MS = 30_000;
const ABANDONED_QUEUED_RUN_AGE_MS = 30_000;

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
        attempt,
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
    const leaseExpiresAt = new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS);
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

type WorkflowNode = WorkflowGraphV1["nodes"][number];

function graphVariables(graph: WorkflowGraphV1): Record<string, unknown> {
  return Object.fromEntries(
    graph.variables
      .filter((variable) => variable.defaultValue !== undefined)
      .map((variable) => [variable.name, variable.defaultValue]),
  );
}

function conditionBranchKey(
  edge: WorkflowGraphV1["edges"][number],
): "true" | "false" | null {
  const normalized = (edge.sourceHandle ?? edge.label ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "false") return normalized;
  return null;
}

function reachableFrom(
  graph: WorkflowGraphV1,
  startNodeId: string,
): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const reached = new Set<string>();
  const stack = [startNodeId];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (reached.has(nodeId)) continue;
    reached.add(nodeId);
    stack.push(...(outgoing.get(nodeId) ?? []));
  }
  return reached;
}

async function createPendingStep(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
  inputJson: unknown,
  attempt = 1,
) {
  const now = new Date();
  const [created] = await db
    .insert(workflowStepRuns)
    .values({
      companyId: run.companyId,
      workflowRunId: run.id,
      nodeId,
      attempt,
      status: "pending",
      inputJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const existing = await db
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.companyId, run.companyId),
        eq(workflowStepRuns.workflowRunId, run.id),
        eq(workflowStepRuns.nodeId, nodeId),
        eq(workflowStepRuns.attempt, attempt),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!existing || existing.status !== "pending") {
    throw conflict("Workflow step already exists in a non-pending state", {
      code: "workflow_step_claim_conflict",
      workflowRunId: run.id,
      nodeId,
    });
  }
  return existing;
}

async function startPendingStep(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
  actor: WorkflowRunActor,
  attempt = 1,
) {
  const publications: ActivityPublication[] = [];
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
          eq(workflowStepRuns.attempt, attempt),
          eq(workflowStepRuns.status, "pending"),
        ),
      )
      .returning();
    if (!row) {
      throw conflict("Workflow step could not be claimed", {
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
          attempt,
        },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return runningStep;
}

async function completeRunningStep(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  runningStep: typeof workflowStepRuns.$inferSelect,
  outputJson: unknown,
  actor: WorkflowRunActor,
) {
  const finishedAt = new Date();
  const durationMs = Math.max(
    0,
    finishedAt.getTime() - (runningStep.startedAt ?? finishedAt).getTime(),
  );
  const publications: ActivityPublication[] = [];
  const finished = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workflowStepRuns)
      .set({
        status: "succeeded",
        outputJson,
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
    if (!row) {
      throw conflict("Workflow step changed during completion", {
        code: "workflow_step_completion_conflict",
        workflowRunId: run.id,
        nodeId: runningStep.nodeId,
      });
    }
    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_completed",
        entityType: "workflow_step_run",
        entityId: row.id,
        details: {
          workflowRunId: run.id,
          nodeId: row.nodeId,
          attempt: row.attempt,
          durationMs,
        },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return finished;
}

async function recordSkippedStep(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
  actor: WorkflowRunActor,
) {
  const publications: ActivityPublication[] = [];
  await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(workflowStepRuns)
      .values({
        companyId: run.companyId,
        workflowRunId: run.id,
        nodeId,
        attempt: 1,
        status: "skipped",
        finishedAt: now,
        durationMs: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return;
    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_skipped",
        entityType: "workflow_step_run",
        entityId: row.id,
        details: {
          workflowRunId: run.id,
          nodeId,
          attempt: 1,
          reason: "branch_not_selected",
        },
      },
    );
    publications.push(publication);
  });
  publishActivities(publications);
}

async function markSkippedBranch(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  graph: WorkflowGraphV1,
  startNodeId: string,
  protectedNodeIds: Set<string>,
  actor: WorkflowRunActor,
) {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const visited = new Set<string>();
  const stack = [startNodeId];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (visited.has(nodeId) || protectedNodeIds.has(nodeId)) continue;
    visited.add(nodeId);
    await recordSkippedStep(db, run, nodeId, actor);
    stack.push(...(outgoing.get(nodeId) ?? []));
  }
}

async function finishRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
) {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }
  const publications: ActivityPublication[] = [];
  await db.transaction(async (tx) => {
    const finishedAt = new Date();
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
          eq(workflowRuns.executionOwnerId, run.executionOwnerId),
        ),
      )
      .returning();
    if (!finishedRun) {
      throw conflict("Workflow run ownership changed during completion", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }
    const { publication } = await persistWorkflowActivity(
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
    publications.push(publication);
  });
  publishActivities(publications);
}

async function failRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
  errorCode: string,
  errorMessage: string,
  runningStep?: typeof workflowStepRuns.$inferSelect,
) {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }
  const publications: ActivityPublication[] = [];
  await db.transaction(async (tx) => {
    const now = new Date();
    if (runningStep) {
      const durationMs = Math.max(
        0,
        now.getTime() - (runningStep.startedAt ?? now).getTime(),
      );
      const [failedStep] = await tx
        .update(workflowStepRuns)
        .set({
          status: "failed",
          finishedAt: now,
          durationMs,
          errorCode,
          errorMessage,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowStepRuns.id, runningStep.id),
            eq(workflowStepRuns.status, "running"),
          ),
        )
        .returning();
      if (failedStep) {
        const { publication } = await persistWorkflowActivity(
          tx as unknown as Db,
          actor,
          {
            companyId: run.companyId,
            action: "workflow.step_failed",
            entityType: "workflow_step_run",
            entityId: failedStep.id,
            details: {
              workflowRunId: run.id,
              nodeId: failedStep.nodeId,
              attempt: failedStep.attempt,
              errorCode,
            },
          },
        );
        publications.push(publication);
      }
    }

    const [failedRun] = await tx
      .update(workflowRuns)
      .set({
        status: "failed",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
        finishedAt: now,
        failureCode: errorCode,
        failureMessage: errorMessage,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "running"),
          eq(workflowRuns.executionOwnerId, run.executionOwnerId),
        ),
      )
      .returning();
    if (!failedRun) {
      throw conflict("Workflow run ownership changed during failure handling", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }
    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_failed",
        entityType: "workflow_run",
        entityId: failedRun.id,
        details: {
          workflowId: failedRun.workflowId,
          workflowRevisionId: failedRun.workflowRevisionId,
          source: failedRun.source,
          errorCode,
        },
      },
    );
    publications.push(publication);
  });
  publishActivities(publications);
}

function conditionExpression(node: WorkflowNode): string {
  const config = node.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new WorkflowConditionExpressionError(
      "workflow_condition_expression_invalid",
      "Published condition node is missing its expression",
    );
  }
  const expression = Reflect.get(config, "expression");
  if (typeof expression !== "string") {
    throw new WorkflowConditionExpressionError(
      "workflow_condition_expression_invalid",
      "Published condition node is missing its expression",
    );
  }
  return expression;
}

type WorkflowStepRow = typeof workflowStepRuns.$inferSelect;

class WorkflowCheckpointError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkflowCheckpointError";
    this.code = code;
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkpointConditionResult(step: WorkflowStepRow): boolean {
  const output = step.outputJson;
  if (!isRecordValue(output) || typeof output.result !== "boolean") {
    throw new WorkflowCheckpointError(
      "workflow_checkpoint_invalid",
      `Condition checkpoint for node ${step.nodeId} has no boolean result`,
    );
  }
  return output.result;
}

async function nodeAttempts(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
): Promise<WorkflowStepRow[]> {
  return db
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.companyId, run.companyId),
        eq(workflowStepRuns.workflowRunId, run.id),
        eq(workflowStepRuns.nodeId, nodeId),
      ),
    )
    .orderBy(desc(workflowStepRuns.attempt));
}

async function renewRunLease(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
) {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }
  const now = new Date();
  const [renewed] = await db
    .update(workflowRuns)
    .set({
      ownerHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowRuns.id, run.id),
        eq(workflowRuns.companyId, run.companyId),
        eq(workflowRuns.status, "running"),
        eq(workflowRuns.executionOwnerId, run.executionOwnerId),
      ),
    )
    .returning();
  if (!renewed) {
    throw conflict("Workflow run ownership changed while renewing its lease", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }
  return renewed;
}

async function interruptRunningStep(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  step: WorkflowStepRow,
  actor: WorkflowRunActor,
): Promise<WorkflowStepRow> {
  const publications: ActivityPublication[] = [];
  const interrupted = await db.transaction(async (tx) => {
    const now = new Date();
    const durationMs = Math.max(
      0,
      now.getTime() - (step.startedAt ?? now).getTime(),
    );
    const [row] = await tx
      .update(workflowStepRuns)
      .set({
        status: "failed",
        finishedAt: now,
        durationMs,
        errorCode: "workflow_execution_interrupted",
        errorMessage: "Previous executor lease expired before step completion",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, step.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!row) {
      throw conflict("Workflow step changed while recovery was taking ownership", {
        code: "workflow_step_claim_conflict",
        workflowRunId: run.id,
        nodeId: step.nodeId,
        attempt: step.attempt,
      });
    }
    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_interrupted",
        entityType: "workflow_step_run",
        entityId: row.id,
        details: {
          workflowRunId: run.id,
          nodeId: row.nodeId,
          attempt: row.attempt,
          errorCode: "workflow_execution_interrupted",
        },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return interrupted;
}

async function prepareRunnableStep(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
  inputJson: unknown,
  actor: WorkflowRunActor,
): Promise<{ checkpoint: WorkflowStepRow | null; running: WorkflowStepRow | null }> {
  const attempts = await nodeAttempts(db, run, nodeId);
  const succeeded = attempts.find((step) => step.status === "succeeded") ?? null;
  if (succeeded) return { checkpoint: succeeded, running: null };

  let latest = attempts[0] ?? null;
  if (latest?.status === "skipped") {
    throw new WorkflowCheckpointError(
      "workflow_checkpoint_path_conflict",
      `Selected workflow path reached previously skipped node ${nodeId}`,
    );
  }

  if (latest?.status === "running") {
    latest = await interruptRunningStep(db, run, latest, actor);
  }

  let pending: WorkflowStepRow;
  if (latest?.status === "pending") {
    pending = latest;
  } else if (
    latest === null ||
    (latest.status === "failed" &&
      latest.errorCode === "workflow_execution_interrupted")
  ) {
    const attempt = latest ? latest.attempt + 1 : 1;
    pending = await createPendingStep(db, run, nodeId, inputJson, attempt);
  } else {
    throw new WorkflowCheckpointError(
      "workflow_checkpoint_state_invalid",
      `Workflow node ${nodeId} cannot resume from step state ${latest.status}`,
    );
  }

  const running = await startPendingStep(
    db,
    run,
    nodeId,
    actor,
    pending.attempt,
  );
  return { checkpoint: null, running };
}

async function claimExpiredRunForRecovery(
  db: Db,
  candidate: typeof workflowRuns.$inferSelect,
  ownerId: string,
  now: Date,
  actor: WorkflowRunActor,
) {
  const publications: ActivityPublication[] = [];
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workflowRuns)
      .set({
        status: "recovering",
        executionOwnerId: ownerId,
        ownerHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, candidate.id),
          eq(workflowRuns.companyId, candidate.companyId),
          inArray(workflowRuns.status, ["running", "recovering"]),
          lt(workflowRuns.leaseExpiresAt, now),
        ),
      )
      .returning();
    if (!row) return null;

    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: row.companyId,
        action: "workflow.run_recovery_started",
        entityType: "workflow_run",
        entityId: row.id,
        details: {
          workflowId: row.workflowId,
          workflowRevisionId: row.workflowRevisionId,
          previousExecutionOwnerId: candidate.executionOwnerId,
          recoveryExecutionOwnerId: ownerId,
        },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return claimed;
}

async function resumeRecoveredRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
) {
  if (!run.executionOwnerId) {
    throw conflict("Recovering workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }
  const publications: ActivityPublication[] = [];
  const resumed = await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        ownerHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "recovering"),
          eq(workflowRuns.executionOwnerId, run.executionOwnerId),
        ),
      )
      .returning();
    if (!row) {
      throw conflict("Workflow recovery ownership changed before resume", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: row.companyId,
        action: "workflow.run_recovered",
        entityType: "workflow_run",
        entityId: row.id,
        details: {
          workflowId: row.workflowId,
          workflowRevisionId: row.workflowRevisionId,
          executionOwnerId: row.executionOwnerId,
        },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return resumed;
}

async function revisionForRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
) {
  return db
    .select()
    .from(workflowRevisions)
    .where(
      and(
        eq(workflowRevisions.id, run.workflowRevisionId),
        eq(workflowRevisions.companyId, run.companyId),
        eq(workflowRevisions.workflowId, run.workflowId),
        inArray(workflowRevisions.state, ["published", "superseded"]),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

async function executeWorkflowGraph(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  graph: WorkflowGraphV1,
  actor: WorkflowRunActor,
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const trigger = graph.nodes.find((node) => node.type === "core.manual_trigger");
  if (!trigger) {
    await failRun(
      db,
      run,
      actor,
      "workflow_trigger_missing",
      "Published workflow has no manual trigger",
    );
    return;
  }

  const outputs: Record<string, unknown> = {};
  const variables = graphVariables(graph);
  let current: WorkflowNode | null = trigger;
  let ownedRun = run;

  while (current) {
    ownedRun = await renewRunLease(db, ownedRun);
    let output: unknown;
    let conditionResult: boolean | null = null;
    let runningStep: WorkflowStepRow | undefined;

    try {
      if (current.type === "core.manual_trigger") {
        const prepared = await prepareRunnableStep(
          db,
          ownedRun,
          current.id,
          ownedRun.triggerPayload ?? {},
          actor,
        );
        if (prepared.checkpoint) {
          output = prepared.checkpoint.outputJson ?? ownedRun.triggerPayload ?? {};
        } else {
          runningStep = prepared.running ?? undefined;
          if (!runningStep) {
            throw new WorkflowCheckpointError(
              "workflow_checkpoint_state_invalid",
              `Manual trigger ${current.id} produced no runnable attempt`,
            );
          }
          output = ownedRun.triggerPayload ?? {};
          await completeRunningStep(db, ownedRun, runningStep, output, actor);
        }
      } else if (current.type === "core.condition") {
        const expression = conditionExpression(current);
        const prepared = await prepareRunnableStep(
          db,
          ownedRun,
          current.id,
          { expression },
          actor,
        );
        if (prepared.checkpoint) {
          output = prepared.checkpoint.outputJson;
          conditionResult = checkpointConditionResult(prepared.checkpoint);
        } else {
          runningStep = prepared.running ?? undefined;
          if (!runningStep) {
            throw new WorkflowCheckpointError(
              "workflow_checkpoint_state_invalid",
              `Condition ${current.id} produced no runnable attempt`,
            );
          }
          conditionResult = evaluateWorkflowConditionExpression(expression, {
            trigger: ownedRun.triggerPayload ?? {},
            variables,
            steps: outputs,
          });
          output = { result: conditionResult };
          await completeRunningStep(db, ownedRun, runningStep, output, actor);
        }
      } else {
        await failRun(
          db,
          ownedRun,
          actor,
          "workflow_executor_capability_not_ready",
          `Workflow node type ${current.type} is not executable yet`,
        );
        return;
      }
    } catch (error) {
      if (
        error instanceof WorkflowConditionExpressionError ||
        error instanceof WorkflowCheckpointError
      ) {
        await failRun(
          db,
          ownedRun,
          actor,
          error.code,
          error.message,
          runningStep,
        );
        return;
      }
      throw error;
    }

    outputs[current.id] = output;
    const outgoing = graph.edges.filter((edge) => edge.source === current!.id);
    if (outgoing.length === 0) {
      current = null;
      continue;
    }

    if (current.type === "core.condition") {
      const selectedKey = conditionResult ? "true" : "false";
      const selected = outgoing.find((edge) => conditionBranchKey(edge) === selectedKey);
      if (!selected) {
        await failRun(
          db,
          ownedRun,
          actor,
          "workflow_condition_branch_missing",
          `Condition node ${current.id} has no ${selectedKey} branch`,
        );
        return;
      }

      const protectedNodeIds = reachableFrom(graph, selected.target);
      for (const edge of outgoing) {
        if (edge.id === selected.id) continue;
        await markSkippedBranch(
          db,
          ownedRun,
          graph,
          edge.target,
          protectedNodeIds,
          actor,
        );
      }
      current = nodes.get(selected.target) ?? null;
      continue;
    }

    if (outgoing.length !== 1) {
      await failRun(
        db,
        ownedRun,
        actor,
        "workflow_implicit_parallel_unsupported",
        `Workflow node ${current.id} has an unsupported number of outgoing paths`,
      );
      return;
    }
    current = nodes.get(outgoing[0]!.target) ?? null;
  }

  await finishRun(db, ownedRun, actor);
}

async function executeClaimedRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
) {
  const revision = await revisionForRun(db, run);
  if (!revision) {
    await failRun(
      db,
      run,
      actor,
      "workflow_revision_unavailable_for_recovery",
      "Workflow revision bound to this run is unavailable for execution",
    );
    return;
  }

  const unsupportedNodeTypes = [
    ...new Set(
      revision.graph.nodes
        .filter(
          (node) =>
            node.type !== "core.manual_trigger" &&
            node.type !== "core.condition",
        )
        .map((node) => node.type),
    ),
  ].sort();
  if (unsupportedNodeTypes.length > 0) {
    await failRun(
      db,
      run,
      actor,
      "workflow_executor_capability_not_ready",
      `Workflow revision contains unsupported node types: ${unsupportedNodeTypes.join(", ")}`,
    );
    return;
  }

  await executeWorkflowGraph(db, run, revision.graph, actor);
}

async function recoverCandidate(
  db: Db,
  candidate: typeof workflowRuns.$inferSelect,
  now: Date,
) {
  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-recovery" },
  };
  const ownerId = `recovery:${randomUUID()}`;

  if (candidate.status === "queued") {
    const claimed = await claimQueuedRun(
      db,
      candidate.companyId,
      candidate.id,
      ownerId,
      actor,
    );
    if (!claimed) return false;
    await executeClaimedRun(db, claimed, actor);
    return true;
  }

  const recovering = await claimExpiredRunForRecovery(
    db,
    candidate,
    ownerId,
    now,
    actor,
  );
  if (!recovering) return false;
  const resumed = await resumeRecoveredRun(db, recovering, actor);
  await executeClaimedRun(db, resumed, actor);
  return true;
}


export function workflowExecutorService(db: Db) {
  return {
    getRun: (companyId: string, runId: string) =>
      getRunDetail(db, companyId, runId),

    listRuns: async (
      companyId: string,
      workflowId: string,
      limit: number,
    ): Promise<WorkflowRun[]> => {
      const workflow = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)))
        .then((rows) => rows[0] ?? null);
      if (!workflow) throw notFound("Workflow not found");

      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            eq(workflowRuns.workflowId, workflowId),
          ),
        )
        .orderBy(desc(workflowRuns.createdAt))
        .limit(safeLimit);
      return rows.map(mapRun);
    },

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
        (node) =>
          node.type !== "core.manual_trigger" &&
          node.type !== "core.condition",
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
        await executeClaimedRun(db, claimed, actor);
      }

      const detail = await getRunDetail(db, companyId, queued.run.id);
      if (!detail) throw new Error("Workflow run disappeared after execution");
      return detail;
    },

    recoverExpiredRuns: async (
      limit = 20,
      now = new Date(),
    ): Promise<{ checked: number; recovered: number; raced: number; failedRunIds: string[] }> => {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const queuedBefore = new Date(now.getTime() - ABANDONED_QUEUED_RUN_AGE_MS);
      const candidates = await db
        .select()
        .from(workflowRuns)
        .where(
          or(
            and(
              eq(workflowRuns.status, "queued"),
              lt(workflowRuns.updatedAt, queuedBefore),
            ),
            and(
              inArray(workflowRuns.status, ["running", "recovering"]),
              lt(workflowRuns.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(asc(workflowRuns.updatedAt))
        .limit(safeLimit);

      let recovered = 0;
      let raced = 0;
      const failedRunIds: string[] = [];
      for (const candidate of candidates) {
        try {
          const didRecover = await recoverCandidate(db, candidate, now);
          if (didRecover) recovered += 1;
          else raced += 1;
        } catch {
          failedRunIds.push(candidate.id);
        }
      }
      return {
        checked: candidates.length,
        recovered,
        raced,
        failedRunIds,
      };
    },
  };
}
