import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import {
  costEvents,
  workflowRevisions,
  workflowRuns,
  workflowRunReviews,
  workflowStepRuns,
} from "@paperclipai/db";
import type {
  OptimizerExecutorType,
  OptimizerStepOutcome,
  OptimizerTrace,
  WorkflowGraphV1,
  WorkflowNodeV1,
} from "@paperclipai/shared";

import { conflict, notFound } from "../../errors.js";
import { workflowNodeDefinitions } from "../workflows/workflow-node-registry.js";

const MAX_SHAPE_DEPTH = 8;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ITEMS = 32;
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

type WorkflowStepRow = typeof workflowStepRuns.$inferSelect;

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function readUuid(value: unknown): string | null {
  const candidate = readNonEmptyString(value);
  return candidate && UUID_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function shapeDescriptor(
  value: unknown,
  depth = 0,
): unknown {
  if (depth >= MAX_SHAPE_DEPTH) return "depth_limit";
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "bigint":
      return "bigint";
    case "undefined":
      return "undefined";
    case "object":
      break;
    default:
      return typeof value;
  }

  if (Array.isArray(value)) {
    const itemShapes = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => JSON.stringify(shapeDescriptor(item, depth + 1)));
    return {
      type: "array",
      itemShapes: [...new Set(itemShapes)].sort(),
      truncated: value.length > MAX_ARRAY_ITEMS,
    };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const retained = keys.slice(0, MAX_OBJECT_KEYS);
  return {
    type: "object",
    fields: Object.fromEntries(
      retained.map((key) => [key, shapeDescriptor(record[key], depth + 1)]),
    ),
    truncated: keys.length > MAX_OBJECT_KEYS,
  };
}

export function optimizerShapeHash(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return createHash("sha256")
    .update(JSON.stringify(shapeDescriptor(value)))
    .digest("hex");
}

function stepOutcome(step: WorkflowStepRow): OptimizerStepOutcome {
  if (step.status === "succeeded") return "success";
  return "failure";
}

function executorTypeForNode(node: WorkflowNodeV1 | null): OptimizerExecutorType {
  if (!node) return "workflow";
  if (node.type === "human.approval") return "human";
  if (node.type.startsWith("agent.")) return "agent";
  if (node.type === "connector.action") return "tool";
  return "workflow";
}

function capabilityRefForStep(
  step: WorkflowStepRow,
  node: WorkflowNodeV1 | null,
): string | null {
  if (step.automationArtifactVersionId) {
    return `artifact_version:${step.automationArtifactVersionId}`;
  }
  const config =
    node?.config && typeof node.config === "object" && !Array.isArray(node.config)
      ? (node.config as Record<string, unknown>)
      : null;
  const toolCatalogEntryId = readUuid(config?.toolCatalogEntryId);
  if (toolCatalogEntryId) return `tool:${toolCatalogEntryId}`;
  const agentId = readUuid(config?.agentId) ?? readUuid(step.agentId);
  if (agentId) return `agent:${agentId}`;
  return null;
}

function runSourceMetadata(
  triggerPayload: Record<string, unknown>,
): { taskId: string | null; routineId: string | null } {
  return {
    taskId:
      readUuid(triggerPayload.taskId) ??
      readUuid(triggerPayload.issueId),
    routineId: readUuid(triggerPayload.routineId),
  };
}

export function optimizerTraceService(db: Db) {
  const descriptors = new Map(
    workflowNodeDefinitions().map((descriptor) => [descriptor.type, descriptor]),
  );

  return {
    normalizeWorkflowRun: async (
      companyId: string,
      runId: string,
    ): Promise<OptimizerTrace> => {
      const run = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            eq(workflowRuns.id, runId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!run) throw notFound("Workflow run not found");

      if (!TERMINAL_RUN_STATUSES.has(run.status) || !run.finishedAt) {
        throw conflict("Optimizer trace requires a terminal workflow run", {
          code: "optimizer_trace_run_not_terminal",
          runId,
          status: run.status,
        });
      }

      const [revision, steps] = await Promise.all([
        db
          .select()
          .from(workflowRevisions)
          .where(
            and(
              eq(workflowRevisions.companyId, companyId),
              eq(workflowRevisions.id, run.workflowRevisionId),
              eq(workflowRevisions.workflowId, run.workflowId),
            ),
          )
          .then((rows) => rows[0] ?? null),
        db
          .select()
          .from(workflowStepRuns)
          .where(
            and(
              eq(workflowStepRuns.companyId, companyId),
              eq(workflowStepRuns.workflowRunId, run.id),
            ),
          ),
      ]);
      if (!revision) {
        throw conflict("Workflow revision for optimizer trace is unavailable", {
          code: "optimizer_trace_revision_missing",
          workflowRevisionId: run.workflowRevisionId,
        });
      }

      const graph = revision.graph as WorkflowGraphV1;
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      const heartbeatRunIds = [
        ...new Set(
          steps
            .map((step) => step.heartbeatRunId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const costs =
        heartbeatRunIds.length === 0
          ? []
          : await db
              .select({
                heartbeatRunId: costEvents.heartbeatRunId,
                costCents: costEvents.costCents,
              })
              .from(costEvents)
              .where(
                and(
                  eq(costEvents.companyId, companyId),
                  inArray(costEvents.heartbeatRunId, heartbeatRunIds),
                ),
              );
      const costByHeartbeatRun = new Map<string, number>();
      for (const row of costs) {
        if (!row.heartbeatRunId) continue;
        costByHeartbeatRun.set(
          row.heartbeatRunId,
          (costByHeartbeatRun.get(row.heartbeatRunId) ?? 0) + row.costCents,
        );
      }

      const ordered = [...steps].sort(
        (left, right) =>
          (left.startedAt?.getTime() ?? left.createdAt.getTime()) -
            (right.startedAt?.getTime() ?? right.createdAt.getTime()) ||
          left.nodeId.localeCompare(right.nodeId) ||
          left.attempt - right.attempt,
      );

      const normalizedSteps = ordered.map((step, index) => {
        const node = nodes.get(step.nodeId) ?? null;
        const descriptor = node ? descriptors.get(node.type) ?? null : null;
        return {
          ordinal: index + 1,
          operationType: node?.type ?? "unknown",
          capabilityRef: capabilityRefForStep(step, node),
          inputShapeHash: optimizerShapeHash(step.inputJson),
          outputShapeHash: optimizerShapeHash(step.outputJson),
          sideEffectClass: descriptor?.sideEffectClass ?? "unknown",
          durationMs: Math.max(0, step.durationMs ?? 0),
          cost: step.heartbeatRunId
            ? (costByHeartbeatRun.get(step.heartbeatRunId) ?? null)
            : null,
          outcome: stepOutcome(step),
        };
      });

      const [review] = await db.select().from(workflowRunReviews).where(and(eq(workflowRunReviews.companyId, companyId), eq(workflowRunReviews.workflowRunId, runId)));
      const metadata = runSourceMetadata(run.triggerPayload);
      return {
        companyId: run.companyId,
        workflowId: run.workflowId,
        workflowRevisionId: run.workflowRevisionId,
        taskId: metadata.taskId,
        routineId: metadata.routineId,
        runId: run.id,
        executorType: "workflow",
        steps: normalizedSteps,
        finalOutcome: run.status,
        ...(review ? { humanCorrection: review.humanCorrection } : {}),
        createdAt: run.finishedAt.toISOString(),
      };
    },
  };
}

export function optimizerExecutorTypeForNodeType(
  nodeType: string,
): OptimizerExecutorType {
  return executorTypeForNode({
    id: "trace",
    type: nodeType,
    name: nodeType,
    position: { x: 0, y: 0 },
    config: {},
  });
}
