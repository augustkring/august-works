import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { workflowWaits } from "@paperclipai/db";
import type {
  WorkflowWait,
  WorkflowWaitKind,
  WorkflowWaitStatus,
} from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";

type WorkflowWaitRow = typeof workflowWaits.$inferSelect;

export interface CreateWorkflowWaitInput {
  companyId: string;
  workflowRunId: string;
  nodeId: string;
  waitKey: string;
  kind: WorkflowWaitKind;
  wakeAt?: Date | null;
  timeoutAt?: Date | null;
  referenceType?: string | null;
  referenceId?: string | null;
  signalTokenHash?: string | null;
}

export interface ResolveWorkflowWaitInput {
  status: Extract<WorkflowWaitStatus, "resolved" | "timed_out" | "cancelled">;
  resolutionJson?: unknown;
  resolvedByType?: string | null;
  resolvedById?: string | null;
  resolvedAt?: Date;
}

function mapWait(row: WorkflowWaitRow): WorkflowWait {
  return {
    ...row,
    kind: row.kind as WorkflowWaitKind,
    status: row.status as WorkflowWaitStatus,
    resolutionJson: row.resolutionJson ?? null,
  };
}

function sameInstant(left: Date | null, right: Date | null) {
  return left === right ||
    (left !== null && right !== null && left.getTime() === right.getTime());
}

function assertSameWait(
  existing: WorkflowWaitRow,
  input: CreateWorkflowWaitInput,
) {
  const wakeAt = input.wakeAt ?? null;
  const timeoutAt = input.timeoutAt ?? null;
  const matches =
    existing.kind === input.kind &&
    sameInstant(existing.wakeAt, wakeAt) &&
    sameInstant(existing.timeoutAt, timeoutAt) &&
    existing.referenceType === (input.referenceType ?? null) &&
    existing.referenceId === (input.referenceId ?? null) &&
    existing.signalTokenHash === (input.signalTokenHash ?? null);
  if (!matches) {
    throw conflict("Workflow wait key already identifies a different wait", {
      code: "workflow_wait_key_conflict",
      workflowRunId: input.workflowRunId,
      nodeId: input.nodeId,
      waitKey: input.waitKey,
    });
  }
}

export function hashWorkflowWaitSignalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createWorkflowWaitSignalToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashWorkflowWaitSignalToken(token) };
}

export function workflowWaitService(db: Db) {
  async function activeByKey(
    companyId: string,
    workflowRunId: string,
    nodeId: string,
    waitKey: string,
  ) {
    return db
      .select()
      .from(workflowWaits)
      .where(
        and(
          eq(workflowWaits.companyId, companyId),
          eq(workflowWaits.workflowRunId, workflowRunId),
          eq(workflowWaits.nodeId, nodeId),
          eq(workflowWaits.waitKey, waitKey),
          eq(workflowWaits.status, "active"),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  return {
    listForRun: async (
      companyId: string,
      workflowRunId: string,
    ): Promise<WorkflowWait[]> => {
      const rows = await db
        .select()
        .from(workflowWaits)
        .where(
          and(
            eq(workflowWaits.companyId, companyId),
            eq(workflowWaits.workflowRunId, workflowRunId),
          ),
        )
        .orderBy(asc(workflowWaits.createdAt));
      return rows.map(mapWait);
    },

    activeForRun: async (
      companyId: string,
      workflowRunId: string,
    ): Promise<WorkflowWait | null> => {
      const row = await db
        .select()
        .from(workflowWaits)
        .where(
          and(
            eq(workflowWaits.companyId, companyId),
            eq(workflowWaits.workflowRunId, workflowRunId),
            eq(workflowWaits.status, "active"),
          ),
        )
        .orderBy(asc(workflowWaits.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return row ? mapWait(row) : null;
    },

    get: async (
      companyId: string,
      waitId: string,
    ): Promise<WorkflowWait | null> => {
      const row = await db
        .select()
        .from(workflowWaits)
        .where(
          and(
            eq(workflowWaits.companyId, companyId),
            eq(workflowWaits.id, waitId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      return row ? mapWait(row) : null;
    },

    createActive: async (
      input: CreateWorkflowWaitInput,
    ): Promise<WorkflowWait> => {
      const existing = await activeByKey(
        input.companyId,
        input.workflowRunId,
        input.nodeId,
        input.waitKey,
      );
      if (existing) {
        assertSameWait(existing, input);
        return mapWait(existing);
      }

      const now = new Date();
      const [created] = await db
        .insert(workflowWaits)
        .values({
          companyId: input.companyId,
          workflowRunId: input.workflowRunId,
          nodeId: input.nodeId,
          waitKey: input.waitKey,
          kind: input.kind,
          status: "active",
          wakeAt: input.wakeAt ?? null,
          timeoutAt: input.timeoutAt ?? null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          signalTokenHash: input.signalTokenHash ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return mapWait(created);

      const raced = await activeByKey(
        input.companyId,
        input.workflowRunId,
        input.nodeId,
        input.waitKey,
      );
      if (!raced) {
        throw conflict("Workflow wait could not be created because its unique signal identity is already in use", {
          code: "workflow_wait_signal_conflict",
          workflowRunId: input.workflowRunId,
          nodeId: input.nodeId,
          waitKey: input.waitKey,
        });
      }
      assertSameWait(raced, input);
      return mapWait(raced);
    },

    resolveActive: async (
      companyId: string,
      waitId: string,
      input: ResolveWorkflowWaitInput,
    ): Promise<{ wait: WorkflowWait; changed: boolean }> => {
      const resolvedAt = input.resolvedAt ?? new Date();
      const [updated] = await db
        .update(workflowWaits)
        .set({
          status: input.status,
          resolutionJson: input.resolutionJson ?? null,
          resolvedByType: input.resolvedByType ?? null,
          resolvedById: input.resolvedById ?? null,
          resolvedAt,
          updatedAt: resolvedAt,
        })
        .where(
          and(
            eq(workflowWaits.companyId, companyId),
            eq(workflowWaits.id, waitId),
            eq(workflowWaits.status, "active"),
          ),
        )
        .returning();
      if (updated) return { wait: mapWait(updated), changed: true };

      const existing = await db
        .select()
        .from(workflowWaits)
        .where(
          and(
            eq(workflowWaits.companyId, companyId),
            eq(workflowWaits.id, waitId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Workflow wait not found");
      return { wait: mapWait(existing), changed: false };
    },

    findBySignalToken: async (
      token: string,
    ): Promise<WorkflowWait | null> => {
      const tokenHash = hashWorkflowWaitSignalToken(token);
      const row = await db
        .select()
        .from(workflowWaits)
        .where(eq(workflowWaits.signalTokenHash, tokenHash))
        .then((rows) => rows[0] ?? null);
      return row ? mapWait(row) : null;
    },
  };
}
