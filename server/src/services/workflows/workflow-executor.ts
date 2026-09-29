import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  companyMemberships,
  heartbeatRuns,
  issues,
  routineRuns,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflowWaits,
  workflows,
} from "@paperclipai/db";
import {
  startWorkflowRunSchema,
  type ExecutionPrincipal,
  type StartWorkflowRun,
  type WorkflowGraphV1,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunSource,
  type WorkflowStepRun,
  type WorkflowWait,
} from "@paperclipai/shared";
import {
  queueIssueAssignmentWakeup,
  type IssueAssignmentWakeupDeps,
} from "../issue-assignment-wakeup.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import {
  authorizationService,
  type AuthorizationActor,
} from "../authorization.js";
import { issueService } from "../issues.js";
import {
  evaluateWorkflowConditionExpression,
  WorkflowConditionExpressionError,
} from "./workflow-condition-expression.js";
import {
  decideWorkflowRetry,
  effectiveWorkflowRetryPolicy,
  workflowRetryDelayMs,
  workflowStepIdempotencyKey,
} from "./workflow-execution-policy.js";
import { workflowNodeDefinitions } from "./workflow-node-registry.js";
import {
  validateWorkflowOutput,
  WorkflowOutputSchemaError,
} from "./workflow-output-schema.js";

const WORKFLOW_EXECUTION_LEASE_MS = 30_000;
const ABANDONED_QUEUED_RUN_AGE_MS = 30_000;

export class WorkflowRetryableNodeError extends Error {
  readonly code: string;
  readonly sideEffectSafeToRepeat: boolean;
  readonly providerAllowsRetry: boolean;

  constructor(input: {
    code: string;
    message: string;
    sideEffectSafeToRepeat: boolean;
    providerAllowsRetry: boolean;
  }) {
    super(input.message);
    this.name = "WorkflowRetryableNodeError";
    this.code = input.code;
    this.sideEffectSafeToRepeat = input.sideEffectSafeToRepeat;
    this.providerAllowsRetry = input.providerAllowsRetry;
  }
}

export interface WorkflowRunActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
  responsibleUserId?: string | null;
}

type WorkflowHeartbeatRuntime = IssueAssignmentWakeupDeps & {
  cancelRun?: (
    runId: string,
    reason?: string,
    options?: { errorCode?: string },
  ) => Promise<unknown>;
};

export interface WorkflowExecutorRuntimeDeps {
  heartbeat?: WorkflowHeartbeatRuntime;
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

function mapWait(row: typeof workflowWaits.$inferSelect): WorkflowWait {
  return {
    ...row,
    kind: row.kind as WorkflowWait["kind"],
    status: row.status as WorkflowWait["status"],
    resolutionJson: row.resolutionJson ?? null,
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
  const [steps, waits] = await Promise.all([
    db
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.companyId, companyId),
          eq(workflowStepRuns.workflowRunId, runId),
        ),
      )
      .orderBy(asc(workflowStepRuns.createdAt), asc(workflowStepRuns.attempt)),
    db
      .select()
      .from(workflowWaits)
      .where(
        and(
          eq(workflowWaits.companyId, companyId),
          eq(workflowWaits.workflowRunId, runId),
        ),
      )
      .orderBy(asc(workflowWaits.createdAt)),
  ]);
  return {
    run: mapRun(run),
    steps: steps.map(mapStep),
    waits: waits.map(mapWait),
  };
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
    source: WorkflowRunSource;
    triggerId?: string | null;
    triggerPayload: Record<string, unknown>;
  },
) {
  if (
    existing.workflowId !== input.workflowId ||
    existing.workflowRevisionId !== input.revisionId ||
    existing.source !== input.source ||
    existing.triggerId !== (input.triggerId ?? null) ||
    !isDeepStrictEqual(existing.triggerPayload ?? {}, input.triggerPayload)
  ) {
    throw conflict("Idempotency key was already used for a different workflow run request", {
      code: "idempotency_key_reused",
      workflowRunId: existing.id,
    });
  }
}

export interface EnqueueWorkflowRunInput {
  companyId: string;
  workflowId: string;
  revisionId: string;
  nodeId: string;
  triggerId?: string | null;
  source: WorkflowRunSource;
  triggerPayload: Record<string, unknown>;
  responsibleUserId: string | null;
  idempotencyKey: string | null;
  correlationId: string;
  actor: WorkflowRunActor;
}

export async function enqueueWorkflowRunInTransaction(
  executor: Db,
  input: EnqueueWorkflowRunInput,
): Promise<{
  run: typeof workflowRuns.$inferSelect;
  created: boolean;
  publications: ActivityPublication[];
}> {
  if (input.idempotencyKey) {
    const existing = await getIdempotentRun(
      executor,
      input.companyId,
      input.idempotencyKey,
    );
    if (existing) {
      assertIdempotentRequestMatches(existing, input);
      return { run: existing, created: false, publications: [] };
    }
  }

  const now = new Date();
  const [run] = await executor
    .insert(workflowRuns)
    .values({
      companyId: input.companyId,
      workflowId: input.workflowId,
      workflowRevisionId: input.revisionId,
      triggerId: input.triggerId ?? null,
      status: "queued",
      source: input.source,
      triggerPayload: input.triggerPayload,
      responsibleUserId: input.responsibleUserId,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!run) throw new Error("Workflow run insert returned no row");

  await executor.insert(workflowStepRuns).values({
    companyId: input.companyId,
    workflowRunId: run.id,
    nodeId: input.nodeId,
    attempt: 1,
    status: "pending",
    inputJson: input.triggerPayload,
    createdAt: now,
    updatedAt: now,
  });

  const { publication } = await persistWorkflowActivity(
    executor,
    input.actor,
    {
      companyId: input.companyId,
      action: "workflow.run_queued",
      entityType: "workflow_run",
      entityId: run.id,
      details: {
        workflowId: input.workflowId,
        workflowRevisionId: input.revisionId,
        source: input.source,
        triggerId: input.triggerId ?? null,
      },
    },
  );
  return { run, created: true, publications: [publication] };
}

async function createQueuedRun(
  db: Db,
  input: EnqueueWorkflowRunInput,
) {
  try {
    const result = await db.transaction(async (tx) =>
      enqueueWorkflowRunInTransaction(tx as unknown as Db, input)
    );
    publishActivities(result.publications);
    return { run: result.run, created: result.created };
  } catch (error) {
    if (
      input.idempotencyKey &&
      isUniqueViolation(error, "workflow_runs_company_idempotency_uq")
    ) {
      const existing = await getIdempotentRun(
        db,
        input.companyId,
        input.idempotencyKey,
      );
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

const WORKFLOW_NODE_DEFINITIONS = new Map(
  workflowNodeDefinitions().map((definition) => [definition.type, definition]),
);

function workflowNodeDefinition(node: WorkflowNode) {
  const definition = WORKFLOW_NODE_DEFINITIONS.get(node.type);
  if (!definition) {
    throw new WorkflowCheckpointError(
      "workflow_node_definition_missing",
      `Workflow node definition is unavailable for ${node.type}`,
    );
  }
  return definition;
}

function remainingWorkflowDeadlineMs(
  run: typeof workflowRuns.$inferSelect,
  graph: WorkflowGraphV1,
  now: Date,
): number | null {
  const totalDeadlineSeconds = graph.settings.totalDeadlineSeconds;
  if (!totalDeadlineSeconds || !run.startedAt) return null;
  return Math.max(
    0,
    run.startedAt.getTime() + totalDeadlineSeconds * 1_000 - now.getTime(),
  );
}

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

async function finalizeLinkedRoutineRun(
  executor: Db,
  run: typeof workflowRuns.$inferSelect,
  outcome: {
    status: "completed" | "failed";
    failureReason: string | null;
    completedAt: Date;
  },
) {
  if (run.source !== "routine") return;
  await executor
    .update(routineRuns)
    .set({
      status: outcome.status,
      failureReason: outcome.failureReason,
      completedAt: outcome.completedAt,
      updatedAt: outcome.completedAt,
    })
    .where(
      and(
        eq(routineRuns.companyId, run.companyId),
        eq(routineRuns.linkedWorkflowRunId, run.id),
        eq(routineRuns.status, "workflow_started"),
      ),
    );
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
    await finalizeLinkedRoutineRun(
      tx as unknown as Db,
      finishedRun,
      {
        status: "completed",
        failureReason: null,
        completedAt: finishedAt,
      },
    );
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
    await finalizeLinkedRoutineRun(
      tx as unknown as Db,
      failedRun,
      {
        status: "failed",
        failureReason: errorMessage,
        completedAt: now,
      },
    );
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
    latest.status === "retried" ||
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


export async function scheduleWorkflowStepRetry(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  graph: WorkflowGraphV1,
  node: WorkflowNode,
  runningStep: WorkflowStepRow,
  actor: WorkflowRunActor,
  error: WorkflowRetryableNodeError,
): Promise<boolean> {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }

  const definition = workflowNodeDefinition(node);
  const policy = effectiveWorkflowRetryPolicy(node.retryPolicy, definition);
  const now = new Date();
  const decision = decideWorkflowRetry({
    policy,
    currentAttempt: runningStep.attempt,
    errorRetryable: true,
    sideEffectSafeToRepeat: error.sideEffectSafeToRepeat,
    remainingDeadlineMs: remainingWorkflowDeadlineMs(run, graph, now),
    parentCancelled: false,
    providerAllowsRetry: error.providerAllowsRetry,
  });
  if (!decision.retry || decision.delayMs === null) return false;

  const finishedAt = now;
  const durationMs = Math.max(
    0,
    finishedAt.getTime() - (runningStep.startedAt ?? finishedAt).getTime(),
  );
  const nextAttempt = runningStep.attempt + 1;
  const idempotencyKey = workflowStepIdempotencyKey(run.id, node.id);
  const publications: ActivityPublication[] = [];

  await db.transaction(async (tx) => {
    const [scheduledStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "retry_scheduled",
        finishedAt,
        durationMs,
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(workflowStepRuns.id, runningStep.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!scheduledStep) {
      throw conflict("Workflow step changed while retry was being scheduled", {
        code: "workflow_step_retry_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
        attempt: runningStep.attempt,
      });
    }

    const [waitingRun] = await tx
      .update(workflowRuns)
      .set({
        status: "waiting",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
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
    if (!waitingRun) {
      throw conflict("Workflow run ownership changed while retry was being scheduled", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_retry_scheduled",
        entityType: "workflow_step_run",
        entityId: scheduledStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          attempt: runningStep.attempt,
          nextAttempt,
          delayMs: decision.delayMs,
          errorCode: error.code,
          idempotencyKey,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_waiting",
        entityType: "workflow_run",
        entityId: waitingRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "retry_backoff",
          nodeId: node.id,
          nextAttempt,
          delayMs: decision.delayMs,
        },
      },
    );
    publications.push(stepActivity.publication, runActivity.publication);
  });
  publishActivities(publications);
  return true;
}

function retryDueAt(
  step: WorkflowStepRow,
  node: WorkflowNode,
): Date {
  const definition = workflowNodeDefinition(node);
  const policy = effectiveWorkflowRetryPolicy(node.retryPolicy, definition);
  const delayMs = workflowRetryDelayMs(policy, step.attempt + 1);
  if (delayMs === null) {
    throw new WorkflowCheckpointError(
      "workflow_step_retry_unsafe",
      `Retry policy no longer permits attempt ${step.attempt + 1} for node ${node.id}`,
    );
  }
  const scheduledAt = step.finishedAt ?? step.updatedAt;
  return new Date(scheduledAt.getTime() + delayMs);
}

async function claimDueRetryRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  scheduledStep: WorkflowStepRow,
  ownerId: string,
  now: Date,
  actor: WorkflowRunActor,
) {
  const publications: ActivityPublication[] = [];
  const claimed = await db.transaction(async (tx) => {
    const [runningRun] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        executionOwnerId: ownerId,
        ownerHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "waiting"),
          sql`${workflowRuns.executionOwnerId} is null`,
          sql`${workflowRuns.leaseExpiresAt} is null`,
        ),
      )
      .returning();
    if (!runningRun) return null;

    const [retriedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "retried",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, scheduledStep.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "retry_scheduled"),
        ),
      )
      .returning();
    if (!retriedStep) {
      throw conflict("Workflow retry state changed before resume", {
        code: "workflow_step_retry_conflict",
        workflowRunId: run.id,
        nodeId: scheduledStep.nodeId,
        attempt: scheduledStep.attempt,
      });
    }

    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_retried",
        entityType: "workflow_step_run",
        entityId: retriedStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: retriedStep.nodeId,
          attempt: retriedStep.attempt,
          nextAttempt: retriedStep.attempt + 1,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_resumed",
        entityType: "workflow_run",
        entityId: runningRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "retry_backoff_elapsed",
          executionOwnerId: ownerId,
        },
      },
    );
    publications.push(stepActivity.publication, runActivity.publication);
    return runningRun;
  });
  publishActivities(publications);
  return claimed;
}

async function retryScheduledStepForRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
): Promise<WorkflowStepRow | null> {
  return db
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.companyId, run.companyId),
        eq(workflowStepRuns.workflowRunId, run.id),
        eq(workflowStepRuns.status, "retry_scheduled"),
      ),
    )
    .orderBy(desc(workflowStepRuns.attempt), desc(workflowStepRuns.updatedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
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

function waitDurationSeconds(node: WorkflowNode): number {
  const config = node.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new WorkflowCheckpointError(
      "workflow_wait_config_invalid",
      "Published Wait node is missing its duration",
    );
  }
  const raw = Reflect.get(config, "durationSeconds");
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 604_800
  ) {
    throw new WorkflowCheckpointError(
      "workflow_wait_config_invalid",
      "Published Wait node duration is invalid",
    );
  }
  return raw;
}

async function scheduleDelayWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  graph: WorkflowGraphV1,
  node: WorkflowNode,
  runningStep: WorkflowStepRow,
  actor: WorkflowRunActor,
): Promise<void> {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }

  const durationSeconds = waitDurationSeconds(node);
  const now = new Date();
  const delayMs = durationSeconds * 1_000;
  const remainingDeadlineMs = remainingWorkflowDeadlineMs(run, graph, now);
  if (remainingDeadlineMs !== null && remainingDeadlineMs < delayMs) {
    throw new WorkflowCheckpointError(
      "workflow_wait_deadline_exceeded",
      `Wait node ${node.id} would exceed the workflow deadline`,
    );
  }
  const wakeAt = new Date(now.getTime() + delayMs);
  const waitKey = "primary";
  const publications: ActivityPublication[] = [];

  await db.transaction(async (tx) => {
    const [wait] = await tx
      .insert(workflowWaits)
      .values({
        companyId: run.companyId,
        workflowRunId: run.id,
        nodeId: node.id,
        waitKey,
        kind: "delay",
        status: "active",
        wakeAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!wait) {
      throw conflict("Workflow delay wait could not be created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "waiting",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, runningStep.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!waitingStep) {
      throw conflict("Workflow step changed while wait was being created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingRun] = await tx
      .update(workflowRuns)
      .set({
        status: "waiting",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
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
    if (!waitingRun) {
      throw conflict("Workflow run ownership changed while wait was being created", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    const waitActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.wait_created",
        entityType: "workflow_wait",
        entityId: wait.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          kind: "delay",
          wakeAt: wakeAt.toISOString(),
        },
      },
    );
    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_waiting",
        entityType: "workflow_step_run",
        entityId: waitingStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          attempt: waitingStep.attempt,
          waitId: wait.id,
          waitKind: "delay",
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_waiting",
        entityType: "workflow_run",
        entityId: waitingRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "delay",
          nodeId: node.id,
          waitId: wait.id,
          wakeAt: wakeAt.toISOString(),
        },
      },
    );
    publications.push(
      waitActivity.publication,
      stepActivity.publication,
      runActivity.publication,
    );
  });
  publishActivities(publications);
}

async function activeWaitForRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
) {
  return db
    .select()
    .from(workflowWaits)
    .where(
      and(
        eq(workflowWaits.companyId, run.companyId),
        eq(workflowWaits.workflowRunId, run.id),
        eq(workflowWaits.status, "active"),
      ),
    )
    .orderBy(asc(workflowWaits.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

async function resolveDueDelayWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  now: Date,
): Promise<typeof workflowRuns.$inferSelect | null> {
  if (wait.kind !== "delay" || !wait.wakeAt || wait.wakeAt.getTime() > now.getTime()) {
    return null;
  }
  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-wait" },
  };
  const ownerId = `wait:${randomUUID()}`;
  const publications: ActivityPublication[] = [];

  const resumed = await db.transaction(async (tx) => {
    const [resolvedWait] = await tx
      .update(workflowWaits)
      .set({
        status: "resolved",
        resolutionJson: {
          reason: "delay_elapsed",
          resumedAt: now.toISOString(),
        },
        resolvedByType: "system",
        resolvedById: "workflow-wait",
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowWaits.id, wait.id),
          eq(workflowWaits.companyId, run.companyId),
          eq(workflowWaits.workflowRunId, run.id),
          eq(workflowWaits.status, "active"),
        ),
      )
      .returning();
    if (!resolvedWait) return null;

    const waitingStep = await tx
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.nodeId, wait.nodeId),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!waitingStep) {
      throw conflict("Workflow wait step changed before delay resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }
    const durationMs = Math.max(
      0,
      now.getTime() - (waitingStep.startedAt ?? now).getTime(),
    );
    const [completedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "succeeded",
        outputJson: resolvedWait.resolutionJson,
        finishedAt: now,
        durationMs,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, waitingStep.id),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .returning();
    if (!completedStep) {
      throw conflict("Workflow wait step changed during delay resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }

    const [runningRun] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        executionOwnerId: ownerId,
        ownerHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "waiting"),
          sql`${workflowRuns.executionOwnerId} is null`,
          sql`${workflowRuns.leaseExpiresAt} is null`,
        ),
      )
      .returning();
    if (!runningRun) {
      throw conflict("Workflow run changed before delay resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        waitId: wait.id,
      });
    }

    const waitActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.wait_resolved",
        entityType: "workflow_wait",
        entityId: resolvedWait.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          kind: wait.kind,
          resolution: "delay_elapsed",
        },
      },
    );
    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_completed",
        entityType: "workflow_step_run",
        entityId: completedStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: completedStep.nodeId,
          attempt: completedStep.attempt,
          waitId: resolvedWait.id,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_resumed",
        entityType: "workflow_run",
        entityId: runningRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "delay_elapsed",
          waitId: resolvedWait.id,
          executionOwnerId: ownerId,
        },
      },
    );
    publications.push(
      waitActivity.publication,
      stepActivity.publication,
      runActivity.publication,
    );
    return runningRun;
  });
  publishActivities(publications);
  return resumed;
}

type CreateTaskConfig = {
  title: string;
  description: string | null;
  projectId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  waitForCompletion: boolean;
};

function createTaskNodeConfig(node: WorkflowNode): CreateTaskConfig {
  const config = node.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new WorkflowCheckpointError(
      "workflow_task_config_invalid",
      "Published Create Task node is missing its configuration",
    );
  }
  const title = Reflect.get(config, "title");
  const description = Reflect.get(config, "description");
  const projectId = Reflect.get(config, "projectId");
  const assigneeAgentId = Reflect.get(config, "assigneeAgentId");
  const assigneeUserId = Reflect.get(config, "assigneeUserId");
  const waitForCompletion = Reflect.get(config, "waitForCompletion");

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new WorkflowCheckpointError(
      "workflow_task_config_invalid",
      "Published Create Task node requires a title",
    );
  }
  const nullableString = (
    value: unknown,
    field: string,
  ): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new WorkflowCheckpointError(
        "workflow_task_config_invalid",
        `Published Create Task node has invalid ${field}`,
      );
    }
    return value.trim();
  };
  const parsedDescription =
    description === null || description === undefined
      ? null
      : typeof description === "string"
        ? description
        : null;
  if (
    description !== null &&
    description !== undefined &&
    typeof description !== "string"
  ) {
    throw new WorkflowCheckpointError(
      "workflow_task_config_invalid",
      "Published Create Task node has invalid description",
    );
  }

  const parsedAgentId = nullableString(assigneeAgentId, "assigneeAgentId");
  const parsedUserId = nullableString(assigneeUserId, "assigneeUserId");
  if (parsedAgentId && parsedUserId) {
    throw new WorkflowCheckpointError(
      "workflow_task_config_invalid",
      "Create Task cannot assign both an agent and a user",
    );
  }
  if (
    waitForCompletion !== undefined &&
    typeof waitForCompletion !== "boolean"
  ) {
    throw new WorkflowCheckpointError(
      "workflow_task_config_invalid",
      "Published Create Task node has invalid waitForCompletion",
    );
  }

  return {
    title: title.trim(),
    description: parsedDescription,
    projectId: nullableString(projectId, "projectId"),
    assigneeAgentId: parsedAgentId,
    assigneeUserId: parsedUserId,
    waitForCompletion: waitForCompletion === true,
  };
}

function workflowTaskAuthorizationActor(
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
): AuthorizationActor {
  const responsibleUserId =
    run.responsibleUserId ??
    actor.responsibleUserId ??
    (actor.principal.type === "agent"
      ? actor.principal.responsibleUserId
      : null);

  if (actor.principal.type === "agent") {
    return {
      type: "agent",
      agentId: actor.principal.agentId,
      companyId: run.companyId,
      source: "agent_jwt",
      runId: actor.runId ?? run.id,
      onBehalfOfUserId: responsibleUserId,
    };
  }
  if (actor.principal.type === "user") {
    return {
      type: "board",
      userId: actor.principal.userId,
      companyIds: [run.companyId],
      source: "session",
    };
  }
  if (responsibleUserId) {
    return {
      type: "board",
      userId: responsibleUserId,
      companyIds: [run.companyId],
      source: "session",
      ignoreInstanceAdmin: true,
    };
  }
  throw new WorkflowCheckpointError(
    "workflow_task_responsible_user_required",
    "Create Task requires an attributable user or agent responsible-user context",
  );
}

async function assertWorkflowTaskAssignmentAuthorized(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
  config: CreateTaskConfig,
) {
  const decision = await authorizationService(db).decide({
    actor: workflowTaskAuthorizationActor(run, actor),
    action: "tasks:assign",
    resource: {
      type: "issue",
      companyId: run.companyId,
      projectId: config.projectId,
      parentIssueId: null,
      assigneeAgentId: config.assigneeAgentId,
      assigneeUserId: config.assigneeUserId,
      originKind: "workflow_task",
      originId: run.workflowId,
      status: config.assigneeAgentId || config.assigneeUserId ? "todo" : "backlog",
    },
    scope: {
      projectId: config.projectId,
      assigneeAgentId: config.assigneeAgentId,
      assigneeUserId: config.assigneeUserId,
    },
  });
  if (!decision.allowed) {
    throw new WorkflowCheckpointError(
      "workflow_task_permission_denied",
      decision.explanation,
    );
  }
}

function workflowTaskActorFields(
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
) {
  if (actor.principal.type === "user") {
    return {
      createdByAgentId: null,
      createdByUserId: actor.principal.userId,
    };
  }
  if (actor.principal.type === "agent") {
    return {
      createdByAgentId: actor.principal.agentId,
      createdByUserId: null,
    };
  }
  return {
    createdByAgentId: null,
    createdByUserId: run.responsibleUserId ?? actor.responsibleUserId ?? null,
  };
}

function workflowTaskOutput(
  issue: {
    id: string;
    identifier: string | null;
    status: string;
  },
  execution?: {
    agentId: string | null;
    heartbeatRunId: string | null;
  } | null,
) {
  return {
    issueId: issue.id,
    identifier: issue.identifier,
    status: issue.status,
    ...(execution?.agentId
      ? {
          agentId: execution.agentId,
          heartbeatRunId: execution.heartbeatRunId,
        }
      : {}),
  };
}

async function createWorkflowTask(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  actor: WorkflowRunActor,
) {
  const config = createTaskNodeConfig(node);
  await assertWorkflowTaskAssignmentAuthorized(db, run, actor, config);
  const idempotencyKey = workflowStepIdempotencyKey(run.id, node.id);
  const actorFields = workflowTaskActorFields(run, actor);
  const responsibleUserId =
    run.responsibleUserId ??
    actor.responsibleUserId ??
    (actor.principal.type === "agent"
      ? actor.principal.responsibleUserId
      : actor.principal.type === "user"
        ? actor.principal.userId
        : null);
  let deduplicated = false;
  const publications: ActivityPublication[] = [];

  const issue = await db.transaction(async (tx) => {
    const created = await issueService(db).create(
      run.companyId,
      {
        title: config.title,
        description: config.description,
        projectId: config.projectId,
        assigneeAgentId: config.assigneeAgentId,
        assigneeUserId: config.assigneeUserId,
        status: "backlog",
        originKind: "workflow_task",
        originId: run.workflowId,
        originRunId: run.id,
        originFingerprint: idempotencyKey,
        responsibleUserId,
        ...actorFields,
        actorResponsibleUserId: responsibleUserId,
        trustExplicitResponsibleUserId: Boolean(responsibleUserId),
        idempotencyKey,
        allowDuplicate: true,
        onDeduplicated: () => {
          deduplicated = true;
        },
      },
      tx as unknown as Db,
    );

    if (!deduplicated) {
      const { publication } = await persistWorkflowActivity(
        tx as unknown as Db,
        actor,
        {
          companyId: run.companyId,
          action: "workflow.task_created",
          entityType: "issue",
          entityId: created.id,
          details: {
            workflowRunId: run.id,
            workflowId: run.workflowId,
            nodeId: node.id,
            issueId: created.id,
            identifier: created.identifier,
            waitForCompletion: config.waitForCompletion,
            idempotencyKey,
          },
        },
      );
      publications.push(publication);
    }
    return created;
  });
  publishActivities(publications);
  return { issue, config, idempotencyKey };
}

type AgentTaskConfig = {
  agentId: string;
  objective: string;
  waitForCompletion: boolean;
  expectedOutputSchema: Record<string, unknown> | null;
};

function agentTaskNodeConfig(node: WorkflowNode): AgentTaskConfig {
  const config = node.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new WorkflowCheckpointError(
      "workflow_agent_task_config_invalid",
      "Published Agent Task node is missing its configuration",
    );
  }
  const agentId = Reflect.get(config, "agentId");
  const objective = Reflect.get(config, "objective");
  const waitForCompletion = Reflect.get(config, "waitForCompletion");
  const expectedOutputSchema = Reflect.get(config, "expectedOutputSchema");

  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new WorkflowCheckpointError(
      "workflow_agent_task_config_invalid",
      "Published Agent Task node requires an agent",
    );
  }
  if (typeof objective !== "string" || objective.trim().length === 0) {
    throw new WorkflowCheckpointError(
      "workflow_agent_task_config_invalid",
      "Published Agent Task node requires an objective",
    );
  }
  if (
    waitForCompletion !== undefined &&
    typeof waitForCompletion !== "boolean"
  ) {
    throw new WorkflowCheckpointError(
      "workflow_agent_task_config_invalid",
      "Published Agent Task node has invalid waitForCompletion",
    );
  }
  if (expectedOutputSchema != null) {
    throw new WorkflowCheckpointError(
      "workflow_agent_task_structured_output_not_ready",
      "Structured Agent Task output requires an authoritative task result channel",
    );
  }

  return {
    agentId: agentId.trim(),
    objective: objective.trim(),
    waitForCompletion: waitForCompletion !== false,
    expectedOutputSchema: null,
  };
}

function agentTaskTitle(objective: string): string {
  const compact = objective.replace(/\s+/g, " ").trim();
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
}

function agentTaskAsCreateTaskConfig(config: AgentTaskConfig): CreateTaskConfig {
  return {
    title: agentTaskTitle(config.objective),
    description: config.objective,
    projectId: null,
    assigneeAgentId: config.agentId,
    assigneeUserId: null,
    waitForCompletion: config.waitForCompletion,
  };
}

function workflowWakeRequester(actor: WorkflowRunActor): {
  requestedByActorType: "user" | "agent" | "system";
  requestedByActorId: string;
} {
  if (actor.principal.type === "user") {
    return {
      requestedByActorType: "user",
      requestedByActorId: actor.principal.userId,
    };
  }
  if (actor.principal.type === "agent") {
    return {
      requestedByActorType: "agent",
      requestedByActorId: actor.principal.agentId,
    };
  }
  return {
    requestedByActorType: "system",
    requestedByActorId: actor.principal.service,
  };
}

async function workflowAgentHeartbeat(
  db: Db,
  runtimeDeps: WorkflowExecutorRuntimeDeps,
): Promise<WorkflowHeartbeatRuntime> {
  if (runtimeDeps.heartbeat) return runtimeDeps.heartbeat;
  const { heartbeatService } = await import("../heartbeat.js");
  return heartbeatService(db);
}

async function createWorkflowAgentTaskIssueInTransaction(
  executor: Db,
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  config: AgentTaskConfig,
  actor: WorkflowRunActor,
): Promise<{
  issue: Awaited<ReturnType<ReturnType<typeof issueService>["create"]>>;
  deduplicated: boolean;
  publications: ActivityPublication[];
}> {
  const taskConfig = agentTaskAsCreateTaskConfig(config);
  const idempotencyKey = workflowStepIdempotencyKey(run.id, node.id);
  const actorFields = workflowTaskActorFields(run, actor);
  const responsibleUserId =
    run.responsibleUserId ??
    actor.responsibleUserId ??
    (actor.principal.type === "agent"
      ? actor.principal.responsibleUserId
      : actor.principal.type === "user"
        ? actor.principal.userId
        : null);
  let deduplicated = false;
  const issue = await issueService(db).create(
    run.companyId,
    {
      title: taskConfig.title,
      description: config.objective,
      projectId: null,
      assigneeAgentId: config.agentId,
      assigneeUserId: null,
      status: "todo",
      originKind: "workflow_task",
      originId: run.workflowId,
      originRunId: run.id,
      originFingerprint: idempotencyKey,
      responsibleUserId,
      ...actorFields,
      actorResponsibleUserId: responsibleUserId,
      trustExplicitResponsibleUserId: Boolean(responsibleUserId),
      idempotencyKey,
      allowDuplicate: true,
      onDeduplicated: () => {
        deduplicated = true;
      },
    },
    executor,
  );

  const publications: ActivityPublication[] = [];
  if (!deduplicated) {
    const { publication } = await persistWorkflowActivity(
      executor,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.agent_task_created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          workflowRunId: run.id,
          workflowId: run.workflowId,
          nodeId: node.id,
          issueId: issue.id,
          agentId: config.agentId,
          waitForCompletion: config.waitForCompletion,
          idempotencyKey,
        },
      },
    );
    publications.push(publication);
  }

  return { issue, deduplicated, publications };
}

async function bindAgentTaskExecution(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  step: WorkflowStepRow,
  issueId: string,
  agentId: string,
  heartbeatRunId: string,
  actor: WorkflowRunActor,
) {
  const publications: ActivityPublication[] = [];
  const updated = await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(workflowStepRuns)
      .set({
        agentId,
        heartbeatRunId,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, step.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          inArray(workflowStepRuns.status, ["running", "waiting"]),
        ),
      )
      .returning();
    if (!row) {
      throw conflict("Agent Task step changed before runtime binding", {
        code: "workflow_agent_task_binding_conflict",
        workflowRunId: run.id,
        nodeId: step.nodeId,
        issueId,
      });
    }

    const { publication } = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.agent_task_delegated",
        entityType: "workflow_step_run",
        entityId: row.id,
        details: {
          workflowRunId: run.id,
          nodeId: row.nodeId,
          attempt: row.attempt,
          issueId,
          agentId,
          heartbeatRunId,
        },
      },
    );
    publications.push(publication);
    return row;
  });
  publishActivities(publications);
  return updated;
}

async function wakeWorkflowAgentTask(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  nodeId: string,
  issue: {
    id: string;
    status: string;
    assigneeAgentId: string | null;
  },
  agentId: string,
  actor: WorkflowRunActor,
  runtimeDeps: WorkflowExecutorRuntimeDeps,
): Promise<string> {
  if (issue.assigneeAgentId !== agentId) {
    throw new WorkflowCheckpointError(
      "workflow_agent_task_assignment_changed",
      "Agent Task ownership changed before delegation could start",
    );
  }

  const heartbeat = await workflowAgentHeartbeat(db, runtimeDeps);
  const requester = workflowWakeRequester(actor);
  const stepKey = workflowStepIdempotencyKey(run.id, nodeId);

  try {
    const response = await queueIssueAssignmentWakeup({
      heartbeat,
      issue,
      reason: "workflow_agent_task",
      mutation: "workflow_delegate",
      contextSource: "workflow.agent_task",
      requestedByActorType: requester.requestedByActorType,
      requestedByActorId: requester.requestedByActorId,
      taskKey: stepKey,
      idempotencyKey: `workflow-agent-task:${stepKey}`,
      allowRunCoalescing: false,
      rethrowOnError: true,
    });

    if (!response) {
      throw new WorkflowCheckpointError(
        "workflow_agent_unavailable",
        "Agent Task wakeup was not accepted",
      );
    }
    if (response.status === "skipped") {
      if (
        response.executionRunId &&
        (!response.executionAgentId || response.executionAgentId === agentId)
      ) {
        return response.executionRunId;
      }
      throw new WorkflowCheckpointError(
        "workflow_agent_unavailable",
        response.message ?? response.reason ?? "Agent Task wakeup was skipped",
      );
    }
    if (response.agentId !== agentId) {
      throw new WorkflowCheckpointError(
        "workflow_agent_unavailable",
        "Agent Task wakeup resolved to an unexpected agent",
      );
    }
    return response.id;
  } catch (error) {
    if (error instanceof WorkflowCheckpointError) throw error;
    const statusValue =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "status")
        : null;
    const status =
      typeof statusValue === "number" ? statusValue : null;
    if (status !== null && status >= 400 && status < 500) {
      throw new WorkflowCheckpointError(
        "workflow_agent_unavailable",
        error instanceof Error ? error.message : "Agent Task was rejected",
      );
    }
    throw new WorkflowRetryableNodeError({
      code: "workflow_agent_wakeup_failed",
      message:
        error instanceof Error ? error.message : "Agent Task wakeup failed",
      sideEffectSafeToRepeat: true,
      providerAllowsRetry: true,
    });
  }
}

async function executeWorkflowAgentTask(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  runningStep: WorkflowStepRow,
  actor: WorkflowRunActor,
  runtimeDeps: WorkflowExecutorRuntimeDeps,
) {
  const config = agentTaskNodeConfig(node);
  await assertWorkflowTaskAssignmentAuthorized(
    db,
    run,
    actor,
    agentTaskAsCreateTaskConfig(config),
  );

  const created = await db.transaction(async (tx) =>
    createWorkflowAgentTaskIssueInTransaction(
      tx as unknown as Db,
      db,
      run,
      node,
      config,
      actor,
    )
  );
  publishActivities(created.publications);

  const heartbeatRunId = await wakeWorkflowAgentTask(
    db,
    run,
    node.id,
    {
      id: created.issue.id,
      status: created.issue.status,
      assigneeAgentId: created.issue.assigneeAgentId,
    },
    config.agentId,
    actor,
    runtimeDeps,
  );
  const boundStep = await bindAgentTaskExecution(
    db,
    run,
    runningStep,
    created.issue.id,
    config.agentId,
    heartbeatRunId,
    actor,
  );

  return {
    issue: created.issue,
    step: boundStep,
    config,
    output: workflowTaskOutput(created.issue, {
      agentId: config.agentId,
      heartbeatRunId,
    }),
  };
}

async function scheduleAgentTaskCompletionWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  runningStep: WorkflowStepRow,
  actor: WorkflowRunActor,
  runtimeDeps: WorkflowExecutorRuntimeDeps,
): Promise<void> {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }

  const config = agentTaskNodeConfig(node);
  await assertWorkflowTaskAssignmentAuthorized(
    db,
    run,
    actor,
    agentTaskAsCreateTaskConfig(config),
  );
  const publications: ActivityPublication[] = [];

  const scheduled = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const created = await createWorkflowAgentTaskIssueInTransaction(
      txDb,
      db,
      run,
      node,
      config,
      actor,
    );
    publications.push(...created.publications);
    const now = new Date();

    const [wait] = await tx
      .insert(workflowWaits)
      .values({
        companyId: run.companyId,
        workflowRunId: run.id,
        nodeId: node.id,
        waitKey: "primary",
        kind: "task_completion",
        status: "active",
        referenceType: "issue",
        referenceId: created.issue.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!wait) {
      throw conflict("Agent Task wait could not be created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "waiting",
        agentId: config.agentId,
        outputJson: workflowTaskOutput(created.issue, {
          agentId: config.agentId,
          heartbeatRunId: null,
        }),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, runningStep.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!waitingStep) {
      throw conflict("Agent Task step changed while wait was being created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingRun] = await tx
      .update(workflowRuns)
      .set({
        status: "waiting",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
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
    if (!waitingRun) {
      throw conflict("Workflow run ownership changed while Agent Task wait was created", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    const waitActivity = await persistWorkflowActivity(
      txDb,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.wait_created",
        entityType: "workflow_wait",
        entityId: wait.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          kind: "task_completion",
          issueId: created.issue.id,
          agentId: config.agentId,
        },
      },
    );
    const taskWaiting = await persistWorkflowActivity(
      txDb,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.task_waiting",
        entityType: "workflow_step_run",
        entityId: waitingStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          attempt: waitingStep.attempt,
          issueId: created.issue.id,
          agentId: config.agentId,
          waitId: wait.id,
        },
      },
    );
    const runWaiting = await persistWorkflowActivity(
      txDb,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_waiting",
        entityType: "workflow_run",
        entityId: waitingRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "agent_task_completion",
          nodeId: node.id,
          issueId: created.issue.id,
          agentId: config.agentId,
          waitId: wait.id,
        },
      },
    );
    publications.push(
      waitActivity.publication,
      taskWaiting.publication,
      runWaiting.publication,
    );
    return {
      issue: created.issue,
      wait,
      waitingStep,
    };
  });
  publishActivities(publications);

  try {
    const heartbeatRunId = await wakeWorkflowAgentTask(
      db,
      run,
      node.id,
      {
        id: scheduled.issue.id,
        status: scheduled.issue.status,
        assigneeAgentId: scheduled.issue.assigneeAgentId,
      },
      config.agentId,
      actor,
      runtimeDeps,
    );
    await bindAgentTaskExecution(
      db,
      run,
      scheduled.waitingStep,
      scheduled.issue.id,
      config.agentId,
      heartbeatRunId,
      actor,
    );
  } catch (error) {
    if (error instanceof WorkflowCheckpointError) {
      await failTaskWait(
        db,
        run,
        scheduled.wait,
        scheduled.issue,
        new Date(),
        "workflow_agent_unavailable",
        error.message,
      );
      return;
    }

    const deferred = await persistWorkflowActivity(
      db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.agent_task_wakeup_deferred",
        entityType: "workflow_step_run",
        entityId: scheduled.waitingStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          issueId: scheduled.issue.id,
          agentId: config.agentId,
          error: error instanceof Error ? error.message : String(error),
        },
      },
    );
    publishActivity(deferred.publication);
  }
}

async function scheduleTaskCompletionWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  runningStep: WorkflowStepRow,
  actor: WorkflowRunActor,
): Promise<void> {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }

  const config = createTaskNodeConfig(node);
  await assertWorkflowTaskAssignmentAuthorized(db, run, actor, config);
  const idempotencyKey = workflowStepIdempotencyKey(run.id, node.id);
  const actorFields = workflowTaskActorFields(run, actor);
  const responsibleUserId =
    run.responsibleUserId ??
    actor.responsibleUserId ??
    (actor.principal.type === "agent"
      ? actor.principal.responsibleUserId
      : actor.principal.type === "user"
        ? actor.principal.userId
        : null);
  const publications: ActivityPublication[] = [];

  await db.transaction(async (tx) => {
    let deduplicated = false;
    const issue = await issueService(db).create(
      run.companyId,
      {
        title: config.title,
        description: config.description,
        projectId: config.projectId,
        assigneeAgentId: config.assigneeAgentId,
        assigneeUserId: config.assigneeUserId,
        status: "backlog",
        originKind: "workflow_task",
        originId: run.workflowId,
        originRunId: run.id,
        originFingerprint: idempotencyKey,
        responsibleUserId,
        ...actorFields,
        actorResponsibleUserId: responsibleUserId,
        trustExplicitResponsibleUserId: Boolean(responsibleUserId),
        idempotencyKey,
        allowDuplicate: true,
        onDeduplicated: () => {
          deduplicated = true;
        },
      },
      tx as unknown as Db,
    );

    const now = new Date();
    const [wait] = await tx
      .insert(workflowWaits)
      .values({
        companyId: run.companyId,
        workflowRunId: run.id,
        nodeId: node.id,
        waitKey: "primary",
        kind: "task_completion",
        status: "active",
        referenceType: "issue",
        referenceId: issue.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!wait) {
      throw conflict("Workflow task wait could not be created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "waiting",
        outputJson: workflowTaskOutput(issue),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, runningStep.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!waitingStep) {
      throw conflict("Workflow task step changed while wait was being created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingRun] = await tx
      .update(workflowRuns)
      .set({
        status: "waiting",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
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
    if (!waitingRun) {
      throw conflict("Workflow run ownership changed while task wait was created", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    if (!deduplicated) {
      const taskCreated = await persistWorkflowActivity(
        tx as unknown as Db,
        actor,
        {
          companyId: run.companyId,
          action: "workflow.task_created",
          entityType: "issue",
          entityId: issue.id,
          details: {
            workflowRunId: run.id,
            workflowId: run.workflowId,
            nodeId: node.id,
            issueId: issue.id,
            identifier: issue.identifier,
            waitForCompletion: true,
            idempotencyKey,
          },
        },
      );
      publications.push(taskCreated.publication);
    }
    const waitCreated = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.wait_created",
        entityType: "workflow_wait",
        entityId: wait.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          kind: "task_completion",
          issueId: issue.id,
        },
      },
    );
    const taskWaiting = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.task_waiting",
        entityType: "workflow_step_run",
        entityId: waitingStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          attempt: waitingStep.attempt,
          issueId: issue.id,
          waitId: wait.id,
        },
      },
    );
    const runWaiting = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_waiting",
        entityType: "workflow_run",
        entityId: waitingRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "task_completion",
          nodeId: node.id,
          issueId: issue.id,
          waitId: wait.id,
        },
      },
    );
    publications.push(
      waitCreated.publication,
      taskWaiting.publication,
      runWaiting.publication,
    );
  });
  publishActivities(publications);
}

async function issueForTaskWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
) {
  if (wait.referenceType !== "issue" || !wait.referenceId) return null;
  return db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      status: issues.status,
      title: issues.title,
      assigneeAgentId: issues.assigneeAgentId,
    })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, run.companyId),
        eq(issues.id, wait.referenceId),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

async function ensureAgentTaskWakeupForWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  issue: {
    id: string;
    status: string;
    assigneeAgentId: string | null;
  },
  now: Date,
  runtimeDeps: WorkflowExecutorRuntimeDeps,
): Promise<"ready" | "deferred" | "failed"> {
  const waitingStep = await db
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.companyId, run.companyId),
        eq(workflowStepRuns.workflowRunId, run.id),
        eq(workflowStepRuns.nodeId, wait.nodeId),
        eq(workflowStepRuns.status, "waiting"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!waitingStep || !waitingStep.agentId) return "ready";
  if (waitingStep.heartbeatRunId) return "ready";

  if (issue.assigneeAgentId !== waitingStep.agentId) {
    const changed = await failTaskWait(
      db,
      run,
      wait,
      issue,
      now,
      "workflow_agent_unavailable",
      "Agent Task ownership changed before delegation could start",
    );
    return changed ? "failed" : "deferred";
  }

  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-agent-task" },
    responsibleUserId: run.responsibleUserId,
  };

  try {
    const heartbeatRunId = await wakeWorkflowAgentTask(
      db,
      run,
      wait.nodeId,
      {
        id: issue.id,
        status: issue.status,
        assigneeAgentId: issue.assigneeAgentId,
      },
      waitingStep.agentId,
      actor,
      runtimeDeps,
    );
    await bindAgentTaskExecution(
      db,
      run,
      waitingStep,
      issue.id,
      waitingStep.agentId,
      heartbeatRunId,
      actor,
    );
    return "ready";
  } catch (error) {
    if (error instanceof WorkflowCheckpointError) {
      const changed = await failTaskWait(
        db,
        run,
        wait,
        issue,
        now,
        "workflow_agent_unavailable",
        error.message,
      );
      return changed ? "failed" : "deferred";
    }

    const deferred = await persistWorkflowActivity(
      db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.agent_task_wakeup_deferred",
        entityType: "workflow_step_run",
        entityId: waitingStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          issueId: issue.id,
          agentId: waitingStep.agentId,
          error: error instanceof Error ? error.message : String(error),
        },
      },
    );
    publishActivity(deferred.publication);
    return "deferred";
  }
}

async function resumeCompletedTaskWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  issue: { id: string; identifier: string | null; status: string },
  now: Date,
) {
  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-task" },
    responsibleUserId: run.responsibleUserId,
  };
  const ownerId = `task:${randomUUID()}`;
  const publications: ActivityPublication[] = [];

  const resumed = await db.transaction(async (tx) => {
    const [resolvedWait] = await tx
      .update(workflowWaits)
      .set({
        status: "resolved",
        resolutionJson: workflowTaskOutput(issue),
        resolvedByType: "system",
        resolvedById: "workflow-task",
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowWaits.id, wait.id),
          eq(workflowWaits.companyId, run.companyId),
          eq(workflowWaits.workflowRunId, run.id),
          eq(workflowWaits.status, "active"),
        ),
      )
      .returning();
    if (!resolvedWait) return null;

    const waitingStep = await tx
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.nodeId, wait.nodeId),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!waitingStep) {
      throw conflict("Workflow task step changed before completion", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }
    const durationMs = Math.max(
      0,
      now.getTime() - (waitingStep.startedAt ?? now).getTime(),
    );
    const [completedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "succeeded",
        outputJson: workflowTaskOutput(issue, {
          agentId: waitingStep.agentId,
          heartbeatRunId: waitingStep.heartbeatRunId,
        }),
        finishedAt: now,
        durationMs,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, waitingStep.id),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .returning();
    if (!completedStep) {
      throw conflict("Workflow task step changed during completion", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }

    const [runningRun] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        executionOwnerId: ownerId,
        ownerHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "waiting"),
          sql`${workflowRuns.executionOwnerId} is null`,
          sql`${workflowRuns.leaseExpiresAt} is null`,
        ),
      )
      .returning();
    if (!runningRun) {
      throw conflict("Workflow run changed before task completion resume", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        waitId: wait.id,
      });
    }

    const taskCompleted = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.task_completed",
        entityType: "issue",
        entityId: issue.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          issueId: issue.id,
          identifier: issue.identifier,
        },
      },
    );
    const agentTaskCompleted = waitingStep.agentId
      ? await persistWorkflowActivity(
          tx as unknown as Db,
          actor,
          {
            companyId: run.companyId,
            action: "workflow.agent_task_completed",
            entityType: "workflow_step_run",
            entityId: completedStep.id,
            details: {
              workflowRunId: run.id,
              nodeId: completedStep.nodeId,
              attempt: completedStep.attempt,
              issueId: issue.id,
              agentId: waitingStep.agentId,
              heartbeatRunId: waitingStep.heartbeatRunId,
            },
          },
        )
      : null;
    const waitResolved = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.wait_resolved",
        entityType: "workflow_wait",
        entityId: resolvedWait.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          kind: "task_completion",
          issueId: issue.id,
          resolution: "done",
        },
      },
    );
    const stepCompleted = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_completed",
        entityType: "workflow_step_run",
        entityId: completedStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: completedStep.nodeId,
          attempt: completedStep.attempt,
          issueId: issue.id,
        },
      },
    );
    const runResumed = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_resumed",
        entityType: "workflow_run",
        entityId: runningRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "task_completed",
          issueId: issue.id,
          executionOwnerId: ownerId,
        },
      },
    );
    publications.push(
      taskCompleted.publication,
      ...(agentTaskCompleted ? [agentTaskCompleted.publication] : []),
      waitResolved.publication,
      stepCompleted.publication,
      runResumed.publication,
    );
    return runningRun;
  });
  publishActivities(publications);
  return resumed;
}

async function failTaskWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  issue: { id: string; identifier: string | null; status: string } | null,
  now: Date,
  errorCode:
    | "workflow_task_cancelled"
    | "workflow_task_missing"
    | "workflow_agent_unavailable",
  errorMessage: string,
) {
  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-task" },
    responsibleUserId: run.responsibleUserId,
  };
  const publications: ActivityPublication[] = [];

  const changed = await db.transaction(async (tx) => {
    const [resolvedWait] = await tx
      .update(workflowWaits)
      .set({
        status: errorCode === "workflow_task_cancelled" ? "cancelled" : "timed_out",
        resolutionJson: issue ? workflowTaskOutput(issue) : { errorCode },
        resolvedByType: "system",
        resolvedById: "workflow-task",
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowWaits.id, wait.id),
          eq(workflowWaits.companyId, run.companyId),
          eq(workflowWaits.workflowRunId, run.id),
          eq(workflowWaits.status, "active"),
        ),
      )
      .returning();
    if (!resolvedWait) return false;

    const waitingStep = await tx
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.nodeId, wait.nodeId),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!waitingStep) {
      throw conflict("Workflow task step changed before failure resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }
    const durationMs = Math.max(
      0,
      now.getTime() - (waitingStep.startedAt ?? now).getTime(),
    );
    const [failedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "failed",
        outputJson: issue ? workflowTaskOutput(issue) : null,
        finishedAt: now,
        durationMs,
        errorCode,
        errorMessage,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, waitingStep.id),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .returning();
    if (!failedStep) {
      throw conflict("Workflow task step changed during failure resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }

    const [failedRun] = await tx
      .update(workflowRuns)
      .set({
        status: "failed",
        finishedAt: now,
        failureCode: errorCode,
        failureMessage: errorMessage,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "waiting"),
          sql`${workflowRuns.executionOwnerId} is null`,
          sql`${workflowRuns.leaseExpiresAt} is null`,
        ),
      )
      .returning();
    if (!failedRun) {
      throw conflict("Workflow run changed during task failure resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        waitId: wait.id,
      });
    }
    await finalizeLinkedRoutineRun(
      tx as unknown as Db,
      failedRun,
      {
        status: "failed",
        failureReason: errorMessage,
        completedAt: now,
      },
    );

    const waitResolved = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.wait_resolved",
        entityType: "workflow_wait",
        entityId: resolvedWait.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          kind: "task_completion",
          issueId: issue?.id ?? wait.referenceId,
          resolution: errorCode,
        },
      },
    );
    const stepFailed = await persistWorkflowActivity(
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
          issueId: issue?.id ?? wait.referenceId,
          errorCode,
        },
      },
    );
    const runFailed = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_failed",
        entityType: "workflow_run",
        entityId: failedRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          errorCode,
          issueId: issue?.id ?? wait.referenceId,
        },
      },
    );
    publications.push(
      waitResolved.publication,
      stepFailed.publication,
      runFailed.publication,
    );
    return true;
  });
  publishActivities(publications);
  return changed;
}

async function resolveTaskCompletionWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  now: Date,
  runtimeDeps: WorkflowExecutorRuntimeDeps = {},
): Promise<"recovered" | "raced" | "deferred"> {
  const issue = await issueForTaskWait(db, run, wait);
  if (!issue) {
    const changed = await failTaskWait(
      db,
      run,
      wait,
      null,
      now,
      "workflow_task_missing",
      "Task referenced by the workflow wait no longer exists",
    );
    return changed ? "recovered" : "raced";
  }
  if (issue.status === "done") {
    const resumed = await resumeCompletedTaskWait(db, run, wait, issue, now);
    if (!resumed) return "raced";
    await executeClaimedRun(
      db,
      resumed,
      {
        principal: { type: "system", service: "workflow-task" },
        responsibleUserId: run.responsibleUserId,
      },
      runtimeDeps,
    );
    return "recovered";
  }
  if (issue.status === "cancelled") {
    const changed = await failTaskWait(
      db,
      run,
      wait,
      issue,
      now,
      "workflow_task_cancelled",
      "Task was cancelled before workflow continuation",
    );
    return changed ? "recovered" : "raced";
  }

  const wakeup = await ensureAgentTaskWakeupForWait(
    db,
    run,
    wait,
    issue,
    now,
    runtimeDeps,
  );
  return wakeup === "failed" ? "recovered" : "deferred";
}

type HumanApprovalConfig = {
  summary: string;
  consequence: string;
};

function humanApprovalConfig(node: WorkflowNode): HumanApprovalConfig {
  const config = node.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new WorkflowCheckpointError(
      "workflow_human_approval_config_invalid",
      "Published Human Approval node is missing its configuration",
    );
  }
  const summary = Reflect.get(config, "summary");
  const consequence = Reflect.get(config, "consequence");
  if (
    typeof summary !== "string" ||
    summary.trim().length === 0 ||
    typeof consequence !== "string" ||
    consequence.trim().length === 0
  ) {
    throw new WorkflowCheckpointError(
      "workflow_human_approval_config_invalid",
      "Published Human Approval node requires a summary and consequence",
    );
  }
  return {
    summary: summary.trim(),
    consequence: consequence.trim(),
  };
}

function approvalRequester(
  actor: WorkflowRunActor,
): { requestedByUserId: string | null; requestedByPrincipal: string } {
  if (actor.principal.type === "user") {
    return {
      requestedByUserId: actor.principal.userId,
      requestedByPrincipal: `user:${actor.principal.userId}`,
    };
  }
  if (actor.principal.type === "agent") {
    return {
      requestedByUserId: actor.responsibleUserId ?? actor.principal.responsibleUserId ?? null,
      requestedByPrincipal: `agent:${actor.principal.agentId}`,
    };
  }
  return {
    requestedByUserId: actor.responsibleUserId ?? null,
    requestedByPrincipal: `system:${actor.principal.service}`,
  };
}

async function scheduleHumanApprovalWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  node: WorkflowNode,
  runningStep: WorkflowStepRow,
  actor: WorkflowRunActor,
): Promise<void> {
  if (!run.executionOwnerId) {
    throw conflict("Workflow run has no execution owner", {
      code: "workflow_run_claim_lost",
      workflowRunId: run.id,
    });
  }

  const config = humanApprovalConfig(node);
  const requester = approvalRequester(actor);
  const now = new Date();
  const approvalId = randomUUID();
  const waitKey = "primary";
  const publications: ActivityPublication[] = [];

  await db.transaction(async (tx) => {
    const [approval] = await tx
      .insert(approvals)
      .values({
        id: approvalId,
        companyId: run.companyId,
        type: "workflow_step_approval",
        requestedByAgentId: null,
        requestedByUserId: requester.requestedByUserId,
        status: "pending",
        payload: {
          title: config.summary,
          summary: config.summary,
          consequence: config.consequence,
          recommendedAction: "Approve only if the described workflow consequence should proceed.",
          nextActionOnApproval: config.consequence,
          risks: [
            "Approval resumes this workflow from the exact published revision bound to the run.",
          ],
          riskLevel: "C3",
          reversibility: "No rollback is implied. Review the consequence before approving.",
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          workflowRunId: run.id,
          workflowNodeId: node.id,
          requestedByPrincipal: requester.requestedByPrincipal,
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!approval) {
      throw conflict("Workflow approval could not be created", {
        code: "workflow_human_approval_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [wait] = await tx
      .insert(workflowWaits)
      .values({
        companyId: run.companyId,
        workflowRunId: run.id,
        nodeId: node.id,
        waitKey,
        kind: "human_interaction",
        status: "active",
        referenceType: "approval",
        referenceId: approval.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!wait) {
      throw conflict("Workflow human wait could not be created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "waiting",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, runningStep.id),
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.status, "running"),
        ),
      )
      .returning();
    if (!waitingStep) {
      throw conflict("Workflow step changed while human approval was created", {
        code: "workflow_wait_create_conflict",
        workflowRunId: run.id,
        nodeId: node.id,
      });
    }

    const [waitingRun] = await tx
      .update(workflowRuns)
      .set({
        status: "waiting",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
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
    if (!waitingRun) {
      throw conflict("Workflow run ownership changed while human approval was created", {
        code: "workflow_run_claim_lost",
        workflowRunId: run.id,
      });
    }

    const waitActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.human_interaction_requested",
        entityType: "workflow_wait",
        entityId: wait.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          approvalId: approval.id,
          consequence: config.consequence,
          riskLevel: "C3",
        },
      },
    );
    const approvalActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "approval.created",
        entityType: "approval",
        entityId: approval.id,
        details: {
          type: approval.type,
          workflowRunId: run.id,
          workflowNodeId: node.id,
        },
      },
    );
    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_waiting",
        entityType: "workflow_step_run",
        entityId: waitingStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: node.id,
          attempt: waitingStep.attempt,
          waitId: wait.id,
          waitKind: "human_interaction",
          approvalId: approval.id,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_waiting",
        entityType: "workflow_run",
        entityId: waitingRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "human_interaction",
          nodeId: node.id,
          waitId: wait.id,
          approvalId: approval.id,
        },
      },
    );
    publications.push(
      waitActivity.publication,
      approvalActivity.publication,
      stepActivity.publication,
      runActivity.publication,
    );
  });
  publishActivities(publications);
}

async function approvalForHumanWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
) {
  if (wait.referenceType !== "approval" || !wait.referenceId) return null;
  return db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.companyId, run.companyId),
        eq(approvals.id, wait.referenceId),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

async function resumeApprovedHumanWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  approval: typeof approvals.$inferSelect,
  now: Date,
): Promise<typeof workflowRuns.$inferSelect | null> {
  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-human-approval" },
    responsibleUserId: approval.decidedByUserId ?? null,
  };
  const ownerId = `approval:${randomUUID()}`;
  const publications: ActivityPublication[] = [];

  const resumed = await db.transaction(async (tx) => {
    const [resolvedWait] = await tx
      .update(workflowWaits)
      .set({
        status: "resolved",
        resolutionJson: {
          decision: "approved",
          approvalId: approval.id,
          decidedByUserId: approval.decidedByUserId,
          decidedAt: approval.decidedAt?.toISOString() ?? null,
        },
        resolvedByType: "user",
        resolvedById: approval.decidedByUserId,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowWaits.id, wait.id),
          eq(workflowWaits.companyId, run.companyId),
          eq(workflowWaits.workflowRunId, run.id),
          eq(workflowWaits.status, "active"),
        ),
      )
      .returning();
    if (!resolvedWait) return null;

    const waitingStep = await tx
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.nodeId, wait.nodeId),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!waitingStep) {
      throw conflict("Workflow approval step changed before resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }
    const durationMs = Math.max(
      0,
      now.getTime() - (waitingStep.startedAt ?? now).getTime(),
    );
    const [completedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "succeeded",
        outputJson: resolvedWait.resolutionJson,
        finishedAt: now,
        durationMs,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, waitingStep.id),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .returning();
    if (!completedStep) {
      throw conflict("Workflow approval step changed during resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }

    const [runningRun] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        executionOwnerId: ownerId,
        ownerHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + WORKFLOW_EXECUTION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "waiting"),
          sql`${workflowRuns.executionOwnerId} is null`,
          sql`${workflowRuns.leaseExpiresAt} is null`,
        ),
      )
      .returning();
    if (!runningRun) {
      throw conflict("Workflow run changed before approval resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        waitId: wait.id,
      });
    }

    const waitActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.human_interaction_resolved",
        entityType: "workflow_wait",
        entityId: resolvedWait.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          approvalId: approval.id,
          decision: "approved",
        },
      },
    );
    const stepActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.step_completed",
        entityType: "workflow_step_run",
        entityId: completedStep.id,
        details: {
          workflowRunId: run.id,
          nodeId: completedStep.nodeId,
          attempt: completedStep.attempt,
          approvalId: approval.id,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_resumed",
        entityType: "workflow_run",
        entityId: runningRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          reason: "human_approval_approved",
          approvalId: approval.id,
          executionOwnerId: ownerId,
        },
      },
    );
    publications.push(
      waitActivity.publication,
      stepActivity.publication,
      runActivity.publication,
    );
    return runningRun;
  });
  publishActivities(publications);
  return resumed;
}

async function rejectHumanWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  approval: typeof approvals.$inferSelect,
  now: Date,
): Promise<boolean> {
  const decision =
    approval.status === "cancelled" ? "cancelled" : "rejected";
  const waitStatus = decision === "cancelled" ? "cancelled" : "resolved";
  const errorCode =
    decision === "cancelled"
      ? "workflow_human_approval_cancelled"
      : "workflow_human_approval_rejected";
  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-human-approval" },
    responsibleUserId: approval.decidedByUserId ?? null,
  };
  const publications: ActivityPublication[] = [];

  const changed = await db.transaction(async (tx) => {
    const [resolvedWait] = await tx
      .update(workflowWaits)
      .set({
        status: waitStatus,
        resolutionJson: {
          decision,
          approvalId: approval.id,
          decidedByUserId: approval.decidedByUserId,
          decidedAt: approval.decidedAt?.toISOString() ?? null,
        },
        resolvedByType: approval.decidedByUserId ? "user" : "system",
        resolvedById: approval.decidedByUserId,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowWaits.id, wait.id),
          eq(workflowWaits.companyId, run.companyId),
          eq(workflowWaits.workflowRunId, run.id),
          eq(workflowWaits.status, "active"),
        ),
      )
      .returning();
    if (!resolvedWait) return false;

    const waitingStep = await tx
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.companyId, run.companyId),
          eq(workflowStepRuns.workflowRunId, run.id),
          eq(workflowStepRuns.nodeId, wait.nodeId),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!waitingStep) {
      throw conflict("Workflow approval step changed before rejection resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }
    const durationMs = Math.max(
      0,
      now.getTime() - (waitingStep.startedAt ?? now).getTime(),
    );
    const [failedStep] = await tx
      .update(workflowStepRuns)
      .set({
        status: "failed",
        finishedAt: now,
        durationMs,
        errorCode,
        errorMessage:
          decision === "cancelled"
            ? "Human approval was cancelled"
            : "Human approval was rejected",
        outputJson: resolvedWait.resolutionJson,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowStepRuns.id, waitingStep.id),
          eq(workflowStepRuns.status, "waiting"),
        ),
      )
      .returning();
    if (!failedStep) {
      throw conflict("Workflow approval step changed during rejection resolution", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        nodeId: wait.nodeId,
        waitId: wait.id,
      });
    }

    const [failedRun] = await tx
      .update(workflowRuns)
      .set({
        status: "failed",
        finishedAt: now,
        failureCode: errorCode,
        failureMessage: failedStep.errorMessage,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.id, run.id),
          eq(workflowRuns.companyId, run.companyId),
          eq(workflowRuns.status, "waiting"),
          sql`${workflowRuns.executionOwnerId} is null`,
          sql`${workflowRuns.leaseExpiresAt} is null`,
        ),
      )
      .returning();
    if (!failedRun) {
      throw conflict("Workflow run changed during approval rejection", {
        code: "workflow_wait_resolution_conflict",
        workflowRunId: run.id,
        waitId: wait.id,
      });
    }
    await finalizeLinkedRoutineRun(
      tx as unknown as Db,
      failedRun,
      {
        status: "failed",
        failureReason: failedStep.errorMessage,
        completedAt: now,
      },
    );

    const waitActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.human_interaction_resolved",
        entityType: "workflow_wait",
        entityId: resolvedWait.id,
        details: {
          workflowRunId: run.id,
          nodeId: wait.nodeId,
          approvalId: approval.id,
          decision,
        },
      },
    );
    const stepActivity = await persistWorkflowActivity(
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
          approvalId: approval.id,
          errorCode,
        },
      },
    );
    const runActivity = await persistWorkflowActivity(
      tx as unknown as Db,
      actor,
      {
        companyId: run.companyId,
        action: "workflow.run_failed",
        entityType: "workflow_run",
        entityId: failedRun.id,
        details: {
          workflowId: run.workflowId,
          workflowRevisionId: run.workflowRevisionId,
          approvalId: approval.id,
          errorCode,
        },
      },
    );
    publications.push(
      waitActivity.publication,
      stepActivity.publication,
      runActivity.publication,
    );
    return true;
  });
  publishActivities(publications);
  return changed;
}

async function resolveHumanApprovalWait(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  wait: typeof workflowWaits.$inferSelect,
  now: Date,
): Promise<"recovered" | "raced" | "deferred"> {
  const approval = await approvalForHumanWait(db, run, wait);
  if (!approval) return "deferred";
  if (approval.status === "pending" || approval.status === "revision_requested") {
    return "deferred";
  }
  if (approval.status === "approved") {
    const resumed = await resumeApprovedHumanWait(db, run, wait, approval, now);
    if (!resumed) return "raced";
    await executeClaimedRun(
      db,
      resumed,
      { principal: { type: "system", service: "workflow-human-approval" } },
    );
    return "recovered";
  }
  if (approval.status === "rejected" || approval.status === "cancelled") {
    const changed = await rejectHumanWait(db, run, wait, approval, now);
    return changed ? "recovered" : "raced";
  }
  return "deferred";
}

async function executeWorkflowGraph(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  graph: WorkflowGraphV1,
  actor: WorkflowRunActor,
  runtimeDeps: WorkflowExecutorRuntimeDeps = {},
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
      } else if (current.type === "work.create_task") {
        const config = createTaskNodeConfig(current);
        const prepared = await prepareRunnableStep(
          db,
          ownedRun,
          current.id,
          {
            title: config.title,
            description: config.description,
            projectId: config.projectId,
            assigneeAgentId: config.assigneeAgentId,
            assigneeUserId: config.assigneeUserId,
            waitForCompletion: config.waitForCompletion,
          },
          actor,
        );
        if (prepared.checkpoint) {
          output = prepared.checkpoint.outputJson;
        } else {
          runningStep = prepared.running ?? undefined;
          if (!runningStep) {
            throw new WorkflowCheckpointError(
              "workflow_checkpoint_state_invalid",
              `Create Task ${current.id} produced no runnable attempt`,
            );
          }
          try {
            if (config.waitForCompletion) {
              await scheduleTaskCompletionWait(
                db,
                ownedRun,
                current,
                runningStep,
                actor,
              );
              return;
            }
            const created = await createWorkflowTask(
              db,
              ownedRun,
              current,
              actor,
            );
            output = workflowTaskOutput(created.issue);
            await completeRunningStep(
              db,
              ownedRun,
              runningStep,
              output,
              actor,
            );
          } catch (error) {
            if (
              error instanceof WorkflowCheckpointError ||
              error instanceof WorkflowRetryableNodeError
            ) {
              throw error;
            }
            const statusValue =
              typeof error === "object" && error !== null
                ? Reflect.get(error, "status")
                : null;
            const status =
              typeof statusValue === "number" ? statusValue : null;
            if (status !== null && status >= 400 && status < 500) {
              throw new WorkflowCheckpointError(
                "workflow_task_create_failed",
                error instanceof Error
                  ? error.message
                  : "Task creation was rejected",
              );
            }
            throw new WorkflowRetryableNodeError({
              code: "workflow_task_create_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Task creation failed",
              sideEffectSafeToRepeat: true,
              providerAllowsRetry: true,
            });
          }
        }
      } else if (current.type === "agent.task") {
        const config = agentTaskNodeConfig(current);
        const prepared = await prepareRunnableStep(
          db,
          ownedRun,
          current.id,
          {
            agentId: config.agentId,
            objective: config.objective,
            waitForCompletion: config.waitForCompletion,
            expectedOutputSchema: null,
          },
          actor,
        );
        if (prepared.checkpoint) {
          output = prepared.checkpoint.outputJson;
        } else {
          runningStep = prepared.running ?? undefined;
          if (!runningStep) {
            throw new WorkflowCheckpointError(
              "workflow_checkpoint_state_invalid",
              `Agent Task ${current.id} produced no runnable attempt`,
            );
          }

          if (config.waitForCompletion) {
            await scheduleAgentTaskCompletionWait(
              db,
              ownedRun,
              current,
              runningStep,
              actor,
              runtimeDeps,
            );
            return;
          }

          const delegated = await executeWorkflowAgentTask(
            db,
            ownedRun,
            current,
            runningStep,
            actor,
            runtimeDeps,
          );
          runningStep = delegated.step;
          output = delegated.output;
          await completeRunningStep(
            db,
            ownedRun,
            runningStep,
            output,
            actor,
          );
        }
      } else if (current.type === "human.approval") {
        const config = humanApprovalConfig(current);
        const prepared = await prepareRunnableStep(
          db,
          ownedRun,
          current.id,
          {
            summary: config.summary,
            consequence: config.consequence,
          },
          actor,
        );
        if (prepared.checkpoint) {
          output = prepared.checkpoint.outputJson;
        } else {
          runningStep = prepared.running ?? undefined;
          if (!runningStep) {
            throw new WorkflowCheckpointError(
              "workflow_checkpoint_state_invalid",
              `Human Approval ${current.id} produced no runnable attempt`,
            );
          }
          await scheduleHumanApprovalWait(
            db,
            ownedRun,
            current,
            runningStep,
            actor,
          );
          return;
        }
      } else if (current.type === "core.wait") {
        const durationSeconds = waitDurationSeconds(current);
        const prepared = await prepareRunnableStep(
          db,
          ownedRun,
          current.id,
          { durationSeconds },
          actor,
        );
        if (prepared.checkpoint) {
          output = prepared.checkpoint.outputJson;
        } else {
          runningStep = prepared.running ?? undefined;
          if (!runningStep) {
            throw new WorkflowCheckpointError(
              "workflow_checkpoint_state_invalid",
              `Wait ${current.id} produced no runnable attempt`,
            );
          }
          await scheduleDelayWait(
            db,
            ownedRun,
            graph,
            current,
            runningStep,
            actor,
          );
          return;
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
      if (error instanceof WorkflowRetryableNodeError && runningStep) {
        const scheduled = await scheduleWorkflowStepRetry(
          db,
          ownedRun,
          graph,
          current,
          runningStep,
          actor,
          error,
        );
        if (scheduled) return;
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
  runtimeDeps: WorkflowExecutorRuntimeDeps = {},
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
            node.type !== "core.condition" &&
            node.type !== "core.wait" &&
            node.type !== "human.approval" &&
            node.type !== "work.create_task" &&
            node.type !== "agent.task",
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

  await executeWorkflowGraph(db, run, revision.graph, actor, runtimeDeps);
}

async function recoverWaitingCandidate(
  db: Db,
  candidate: typeof workflowRuns.$inferSelect,
  now: Date,
  runtimeDeps: WorkflowExecutorRuntimeDeps = {},
): Promise<"recovered" | "raced" | "deferred"> {
  const scheduledStep = await retryScheduledStepForRun(db, candidate);
  if (!scheduledStep) {
    const wait = await activeWaitForRun(db, candidate);
    if (!wait) return "deferred";
    if (wait.timeoutAt && wait.timeoutAt.getTime() <= now.getTime()) {
      return "deferred";
    }
    if (wait.kind === "human_interaction") {
      return resolveHumanApprovalWait(db, candidate, wait, now);
    }
    if (wait.kind === "task_completion") {
      return resolveTaskCompletionWait(
        db,
        candidate,
        wait,
        now,
        runtimeDeps,
      );
    }
    if (wait.kind !== "delay" || !wait.wakeAt || wait.wakeAt.getTime() > now.getTime()) {
      return "deferred";
    }
    const resumed = await resolveDueDelayWait(db, candidate, wait, now);
    if (!resumed) return "raced";
    await executeClaimedRun(
      db,
      resumed,
      { principal: { type: "system", service: "workflow-wait" } },
      runtimeDeps,
    );
    return "recovered";
  }

  const revision = await revisionForRun(db, candidate);
  if (!revision) {
    const actor: WorkflowRunActor = {
      principal: { type: "system", service: "workflow-retry" },
    };
    const claimed = await claimDueRetryRun(
      db,
      candidate,
      scheduledStep,
      `retry:${randomUUID()}`,
      now,
      actor,
    );
    if (!claimed) return "raced";
    await failRun(
      db,
      claimed,
      actor,
      "workflow_revision_unavailable_for_recovery",
      "Workflow revision bound to this retry is unavailable",
    );
    return "recovered";
  }

  const node = revision.graph.nodes.find((item) => item.id === scheduledStep.nodeId);
  if (!node) {
    const actor: WorkflowRunActor = {
      principal: { type: "system", service: "workflow-retry" },
    };
    const claimed = await claimDueRetryRun(
      db,
      candidate,
      scheduledStep,
      `retry:${randomUUID()}`,
      now,
      actor,
    );
    if (!claimed) return "raced";
    await failRun(
      db,
      claimed,
      actor,
      "workflow_checkpoint_invalid",
      `Retry references missing workflow node ${scheduledStep.nodeId}`,
    );
    return "recovered";
  }

  let dueAt: Date;
  try {
    dueAt = retryDueAt(scheduledStep, node);
  } catch (error) {
    const actor: WorkflowRunActor = {
      principal: { type: "system", service: "workflow-retry" },
    };
    const claimed = await claimDueRetryRun(
      db,
      candidate,
      scheduledStep,
      `retry:${randomUUID()}`,
      now,
      actor,
    );
    if (!claimed) return "raced";
    await failRun(
      db,
      claimed,
      actor,
      error instanceof WorkflowCheckpointError
        ? error.code
        : "workflow_step_retry_unsafe",
      error instanceof Error ? error.message : "Workflow retry policy is invalid",
    );
    return "recovered";
  }
  if (dueAt.getTime() > now.getTime()) return "deferred";

  const actor: WorkflowRunActor = {
    principal: { type: "system", service: "workflow-retry" },
  };
  const claimed = await claimDueRetryRun(
    db,
    candidate,
    scheduledStep,
    `retry:${randomUUID()}`,
    now,
    actor,
  );
  if (!claimed) return "raced";
  await executeClaimedRun(db, claimed, actor, runtimeDeps);
  return "recovered";
}

async function recoverCandidate(
  db: Db,
  candidate: typeof workflowRuns.$inferSelect,
  now: Date,
  runtimeDeps: WorkflowExecutorRuntimeDeps = {},
): Promise<"recovered" | "raced" | "deferred"> {
  if (candidate.status === "waiting") {
    return recoverWaitingCandidate(db, candidate, now, runtimeDeps);
  }

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
    if (!claimed) return "raced";
    await executeClaimedRun(db, claimed, actor, runtimeDeps);
    return "recovered";
  }

  const recovering = await claimExpiredRunForRecovery(
    db,
    candidate,
    ownerId,
    now,
    actor,
  );
  if (!recovering) return "raced";
  const resumed = await resumeRecoveredRun(db, recovering, actor);
  await executeClaimedRun(db, resumed, actor, runtimeDeps);
  return "recovered";
}


export async function resolveWorkflowExecutionRevision(
  executor: Db,
  companyId: string,
  workflowId: string,
  requestedRevisionId: string | null = null,
) {
  const workflow = await executor
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

  const revisionId = requestedRevisionId ?? workflow.publishedRevisionId;
  if (revisionId !== workflow.publishedRevisionId) {
    throw unprocessable("Live runs must use the current published revision", {
      code: "workflow_revision_not_published",
      revisionId,
      currentPublishedRevisionId: workflow.publishedRevisionId,
    });
  }
  const revision = await executor
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

  const unsupportedNodeTypes = [
    ...new Set(
      revision.graph.nodes
        .filter(
          (node) =>
            node.type !== "core.manual_trigger" &&
            node.type !== "core.condition" &&
            node.type !== "core.wait" &&
            node.type !== "human.approval" &&
            node.type !== "work.create_task" &&
            node.type !== "agent.task",
        )
        .map((node) => node.type),
    ),
  ].sort();
  const triggers = revision.graph.nodes.filter(
    (node) => node.type === "core.manual_trigger",
  );
  if (triggers.length !== 1 || unsupportedNodeTypes.length > 0) {
    throw unprocessable(
      "This workflow revision requires executor capabilities that are not enabled yet",
      {
        code: "workflow_executor_capability_not_ready",
        triggerCount: triggers.length,
        unsupportedNodeTypes,
      },
    );
  }

  return {
    workflow,
    revision,
    triggerNodeId: triggers[0]!.id,
  };
}

export function workflowExecutorService(
  db: Db,
  runtimeDeps: WorkflowExecutorRuntimeDeps = {},
) {
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

    executeQueuedRun: async (
      companyId: string,
      runId: string,
      actor: WorkflowRunActor,
    ): Promise<WorkflowRunDetail> => {
      await assertActorCompanyScope(db, companyId, actor);
      const existing = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            eq(workflowRuns.id, runId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Workflow run not found");

      if (existing.status === "queued") {
        const ownerId = `inline:${randomUUID()}`;
        const claimed = await claimQueuedRun(
          db,
          companyId,
          existing.id,
          ownerId,
          actor,
        );
        if (claimed) {
          await executeClaimedRun(db, claimed, actor, runtimeDeps);
        }
      }

      const detail = await getRunDetail(db, companyId, runId);
      if (!detail) throw new Error("Workflow run disappeared after execution");
      return detail;
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

      const resolved = await resolveWorkflowExecutionRevision(
        db,
        companyId,
        workflowId,
        input.revisionId ?? null,
      );
      const revisionId = resolved.revision.id;
      const triggerNodeId = resolved.triggerNodeId;

      const queued = await createQueuedRun(db, {
        companyId,
        workflowId,
        revisionId,
        nodeId: triggerNodeId,
        triggerId: null,
        source: "manual",
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
        await executeClaimedRun(db, claimed, actor, runtimeDeps);
      }

      const detail = await getRunDetail(db, companyId, queued.run.id);
      if (!detail) throw new Error("Workflow run disappeared after execution");
      return detail;
    },

    startTaskRun: async (
      companyId: string,
      issueId: string,
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

      const issue = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          projectId: issues.projectId,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          responsibleUserId: issues.responsibleUserId,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.id, issueId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!issue) throw notFound("Task not found");
      if (issue.status === "done" || issue.status === "cancelled") {
        throw conflict("Task is already terminal", {
          code: "workflow_task_not_active",
          issueId: issue.id,
          status: issue.status,
        });
      }

      const resolved = await resolveWorkflowExecutionRevision(
        db,
        companyId,
        workflowId,
        input.revisionId ?? null,
      );
      const triggerPayload = {
        ...input.input,
        task: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.status,
          projectId: issue.projectId,
          assigneeAgentId: issue.assigneeAgentId,
          assigneeUserId: issue.assigneeUserId,
        },
      };
      const queued = await createQueuedRun(db, {
        companyId,
        workflowId,
        revisionId: resolved.revision.id,
        nodeId: resolved.triggerNodeId,
        triggerId: null,
        source: "task",
        triggerPayload,
        responsibleUserId:
          actor.responsibleUserId ??
          issue.responsibleUserId ??
          (actor.principal.type === "user"
            ? actor.principal.userId
            : actor.principal.type === "agent"
              ? actor.principal.responsibleUserId
              : null),
        idempotencyKey,
        correlationId: `task:${issue.id}:${randomUUID()}`,
        actor,
      });

      if (queued.created) {
        const ownerId = `inline:${randomUUID()}`;
        const claimed = await claimQueuedRun(
          db,
          companyId,
          queued.run.id,
          ownerId,
          actor,
        );
        if (!claimed) {
          throw conflict("Workflow run could not be claimed", {
            code: "workflow_run_claim_conflict",
            workflowRunId: queued.run.id,
          });
        }
        await executeClaimedRun(db, claimed, actor, runtimeDeps);
      }

      const detail = await getRunDetail(db, companyId, queued.run.id);
      if (!detail) throw new Error("Workflow run disappeared after task invocation");
      return detail;
    },

    resumeTaskWaitsForIssue: async (
      companyId: string,
      issueId: string,
      now = new Date(),
    ): Promise<{
      checked: number;
      recovered: number;
      raced: number;
      deferred: number;
      failedRunIds: string[];
    }> => {
      const rows = await db
        .select({
          wait: workflowWaits,
          run: workflowRuns,
        })
        .from(workflowWaits)
        .innerJoin(
          workflowRuns,
          and(
            eq(workflowRuns.companyId, workflowWaits.companyId),
            eq(workflowRuns.id, workflowWaits.workflowRunId),
          ),
        )
        .where(
          and(
            eq(workflowWaits.companyId, companyId),
            eq(workflowWaits.kind, "task_completion"),
            eq(workflowWaits.status, "active"),
            eq(workflowWaits.referenceType, "issue"),
            eq(workflowWaits.referenceId, issueId),
            eq(workflowRuns.status, "waiting"),
          ),
        )
        .orderBy(asc(workflowWaits.createdAt))
        .limit(100);

      let recovered = 0;
      let raced = 0;
      let deferred = 0;
      const failedRunIds: string[] = [];

      for (const row of rows) {
        try {
          const outcome = await resolveTaskCompletionWait(
            db,
            row.run,
            row.wait,
            now,
            runtimeDeps,
          );
          if (outcome === "recovered") recovered += 1;
          else if (outcome === "raced") raced += 1;
          else deferred += 1;
        } catch {
          failedRunIds.push(row.run.id);
        }
      }

      return {
        checked: rows.length,
        recovered,
        raced,
        deferred,
        failedRunIds,
      };
    },

    recoverExpiredRuns: async (
      limit = 20,
      now = new Date(),
    ): Promise<{
      checked: number;
      recovered: number;
      raced: number;
      deferred: number;
      failedRunIds: string[];
    }> => {
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
            eq(workflowRuns.status, "waiting"),
          ),
        )
        .orderBy(asc(workflowRuns.updatedAt))
        .limit(safeLimit);

      let recovered = 0;
      let raced = 0;
      let deferred = 0;
      const failedRunIds: string[] = [];
      for (const candidate of candidates) {
        try {
          const outcome = await recoverCandidate(
            db,
            candidate,
            now,
            runtimeDeps,
          );
          if (outcome === "recovered") recovered += 1;
          else if (outcome === "raced") raced += 1;
          else deferred += 1;
        } catch {
          failedRunIds.push(candidate.id);
        }
      }
      return {
        checked: candidates.length,
        recovered,
        raced,
        deferred,
        failedRunIds,
      };
    },
  };
}
