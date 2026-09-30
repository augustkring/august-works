import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  issues,
  memoryBindings,
  memoryBindingTargets,
  memoryRecords,
} from "@paperclipai/db";
import {
  memoryAgentCorrectInputSchema,
  memoryAgentRecallInputSchema,
  memoryAgentRememberInputSchema,
  memoryAgentShareInputSchema,
  type MemoryRecord,
  type MemoryRecordDetail,
} from "@paperclipai/shared";
import {
  conflict,
  forbidden,
  HttpError,
  notFound,
  unprocessable,
} from "../../errors.js";
import { logActivity } from "../activity-log.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";

const ELIGIBLE_SCOPE_SCAN_LIMIT = 100;
const TOOL_FINGERPRINT_KEY = "agentMemoryToolFingerprint";

export interface MemoryAgentToolContext {
  companyId: string;
  agentId: string;
  runId: string | null;
  issueId: string | null;
  projectId: string | null;
  responsibleUserId?: string | null;
  allowShared: boolean;
  allowPrivate: boolean;
}

type ScopeKind = "private" | "company" | "project" | "subject";

function actorFor(context: MemoryAgentToolContext): MemoryMutationActor {
  return {
    principal: {
      type: "agent",
      agentId: context.agentId,
      responsibleUserId: context.responsibleUserId ?? null,
    },
    runId: context.runId,
  };
}

function subjectScopeId(subject: { type: string; id: string }): string {
  const value = `${subject.type}:${subject.id}`;
  if (value.length > 500) {
    throw unprocessable("Memory subject scope identifier is too long", {
      code: "memory_subject_scope_too_long",
    });
  }
  return value;
}

function canonicalOperationValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Memory tool input contains a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalOperationValue);
  if (typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalOperationValue(entry);
    }
    return result;
  }
  throw unprocessable("Memory tool input must be JSON-compatible");
}

function operationFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalOperationValue(value)))
    .digest("hex");
}

async function existingOperationRecord(
  db: Db,
  companyId: string,
  operationId: string,
) {
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.createdByOperationId, operationId),
        isNull(memoryRecords.deletedAt),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw conflict("Memory operation id is associated with multiple records", {
      code: "memory_operation_ambiguous",
      operationId,
    });
  }
  return rows[0] ?? null;
}

function recordFingerprint(record: typeof memoryRecords.$inferSelect): string | null {
  const value = record.metadata[TOOL_FINGERPRINT_KEY];
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? value
    : null;
}

async function resolveReplay(
  db: Db,
  service: ReturnType<typeof memoryService>,
  context: MemoryAgentToolContext,
  operationId: string,
  fingerprint: string,
): Promise<MemoryRecordDetail | null> {
  const existing = await existingOperationRecord(
    db,
    context.companyId,
    operationId,
  );
  if (!existing) return null;
  if (recordFingerprint(existing) !== fingerprint) {
    throw conflict("Memory operation id was reused with different tool input", {
      code: "memory_operation_conflict",
      operationId,
      existingRecordId: existing.id,
    });
  }
  const detail = await service.get(
    context.companyId,
    existing.id,
    actorFor(context),
  );
  if (!detail) {
    throw conflict("Existing memory operation record is unavailable", {
      code: "memory_operation_record_unavailable",
      operationId,
    });
  }
  return detail;
}

async function resolveBinding(
  db: Db,
  context: MemoryAgentToolContext,
  input: {
    scope: ScopeKind;
    bindingKey?: string;
  },
) {
  const target =
    input.scope === "private"
      ? { type: "agent" as const, id: context.agentId }
      : input.scope === "project"
        ? {
            type: "project" as const,
            id:
              context.projectId ??
              (() => {
                throw unprocessable(
                  "Project-scoped memory requires a project-scoped task",
                  { code: "memory_project_scope_unavailable" },
                );
              })(),
          }
        : { type: "company" as const, id: context.companyId };

  const rows = await db
    .select({
      id: memoryBindings.id,
      key: memoryBindings.key,
      providerKey: memoryBindings.providerKey,
    })
    .from(memoryBindings)
    .innerJoin(
      memoryBindingTargets,
      and(
        eq(memoryBindingTargets.companyId, memoryBindings.companyId),
        eq(memoryBindingTargets.bindingId, memoryBindings.id),
      ),
    )
    .where(
      and(
        eq(memoryBindings.companyId, context.companyId),
        eq(memoryBindings.enabled, true),
        eq(memoryBindingTargets.targetType, target.type),
        eq(memoryBindingTargets.targetId, target.id),
        ...(input.bindingKey
          ? [eq(memoryBindings.key, input.bindingKey)]
          : []),
      ),
    )
    .orderBy(memoryBindings.key);

  if (rows.length === 0) {
    throw unprocessable("No enabled Memory binding is configured for this scope", {
      code: "memory_binding_unavailable",
      scope: input.scope,
      ...(input.bindingKey ? { bindingKey: input.bindingKey } : {}),
    });
  }
  if (rows.length > 1 && !input.bindingKey) {
    throw conflict("Multiple Memory bindings match this scope; choose a bindingKey", {
      code: "memory_binding_ambiguous",
      scope: input.scope,
      bindingKeys: rows.map((row) => row.key),
    });
  }
  return rows[0]!;
}

async function taskEvidence(
  db: Db,
  context: MemoryAgentToolContext,
  content: string,
  observedAt: string | undefined,
) {
  if (!context.runId || !context.issueId) {
    throw forbidden("Remembering or correcting memory requires a task-bound agent run", {
      code: "memory_task_context_required",
    });
  }
  const issue = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      projectId: issues.projectId,
      updatedAt: issues.updatedAt,
    })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, context.companyId),
        eq(issues.id, context.issueId),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!issue) {
    throw notFound("Memory source task not found", {
      code: "memory_source_task_not_found",
    });
  }
  if (
    context.projectId &&
    issue.projectId &&
    issue.projectId !== context.projectId
  ) {
    throw forbidden("Memory source task no longer matches the active project", {
      code: "memory_source_project_mismatch",
    });
  }

  const observed = observedAt ?? issue.updatedAt.toISOString();
  return {
    observedAt: observed,
    evidence: [
      {
        sourceClass: "task" as const,
        sourceProvider: "august_works_memory_agent_tool",
        sourceType: "agent_run_observation",
        sourceRef: `run://${context.runId}/issue/${issue.id}`,
        sourceVersion: issue.updatedAt.toISOString(),
        sourceUpdatedAt: issue.updatedAt.toISOString(),
        observedAt: observed,
        excerptHash: createHash("sha256").update(content).digest("hex"),
        citation: {
          label: issue.identifier
            ? `${issue.identifier}: ${issue.title}`
            : issue.title,
        },
        trustLevel: "low" as const,
        relation: "supports" as const,
      },
    ],
  };
}

function sensitivityAllowed(record: typeof memoryRecords.$inferSelect): boolean {
  // Agent Memory tools never expose restricted records. Confidential remains
  // eligible only when the underlying scope/owner checks have already passed.
  return record.sensitivityLabel !== "restricted";
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function queryTokens(query: string): string[] {
  return [
    ...new Set(
      normalized(query)
        .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)
        ?.filter((token) => token.length > 1) ?? [],
    ),
  ].slice(0, 32);
}

function relevanceScore(record: typeof memoryRecords.$inferSelect, query: string) {
  const phrase = normalized(query);
  const tokens = queryTokens(query);
  const title = normalized(record.title ?? "");
  const summary = normalized(record.summary ?? "");
  const content = normalized(record.content);
  const subject = normalized(
    [record.subjectType, record.subjectId, record.scopeId]
      .filter(Boolean)
      .join(" "),
  );

  let score = 0;
  if (phrase && title.includes(phrase)) score += 18;
  if (phrase && summary.includes(phrase)) score += 14;
  if (phrase && content.includes(phrase)) score += 10;
  if (phrase && subject.includes(phrase)) score += 12;

  for (const token of tokens) {
    if (title.includes(token)) score += 5;
    if (summary.includes(token)) score += 4;
    if (subject.includes(token)) score += 4;
    if (content.includes(token)) score += 2;
  }

  if (score > 0) {
    score += Math.min(1, record.importance / 100);
    score += Math.min(0.5, record.confidenceScore / 2);
  }
  return score;
}

function recallRecord(detail: MemoryRecordDetail, score: number) {
  const record = detail.record;
  return {
    id: record.id,
    content: record.content,
    title: record.title,
    summary: record.summary,
    memoryType: record.memoryType,
    scope: { type: record.scopeType, id: record.scopeId },
    subject:
      record.subjectType && record.subjectId
        ? { type: record.subjectType, id: record.subjectId }
        : null,
    observedAt: record.observedAt.toISOString(),
    validFrom: record.validFrom?.toISOString() ?? null,
    validUntil: record.validUntil?.toISOString() ?? null,
    verificationState: record.verificationState,
    sensitivity: record.sensitivityLabel,
    relevanceScore: Number(score.toFixed(3)),
    evidence: detail.evidence.map((item) => ({
      sourceClass: item.sourceClass,
      sourceProvider: item.sourceProvider,
      sourceType: item.sourceType,
      sourceRef: item.sourceRef,
      sourceVersion: item.sourceVersion,
      sourceUpdatedAt: item.sourceUpdatedAt?.toISOString() ?? null,
      observedAt: item.observedAt.toISOString(),
      excerptHash: item.excerptHash,
      citation: item.citationJson,
      trustLevel: item.trustLevel,
      relation: item.supportsOrContradicts,
    })),
  };
}

function assertRecordToolAccess(
  record: MemoryRecord,
  context: MemoryAgentToolContext,
) {
  if (record.sensitivityLabel === "restricted") {
    throw forbidden("Restricted Memory is not exposed to agent Memory tools", {
      code: "memory_sensitivity_denied",
      recordId: record.id,
    });
  }
  if (record.scopeType === "agent") {
    if (!context.allowPrivate || record.ownerAgentId !== context.agentId) {
      throw forbidden("Private Memory is not available to this agent", {
        code: "private_memory_read_denied",
        recordId: record.id,
      });
    }
    return;
  }
  if (!context.allowShared) {
    throw forbidden("Shared Memory tools are not enabled", {
      code: "shared_memory_disabled",
    });
  }
  if (
    record.scopeType === "project" &&
    (!context.projectId || record.scopeId !== context.projectId)
  ) {
    throw forbidden("Project Memory is outside the active project", {
      code: "memory_project_scope_denied",
      recordId: record.id,
    });
  }
}

function memoryResult(
  detail: MemoryRecordDetail,
  status: "pending" | "accepted" | "rejected" | "duplicate",
) {
  return {
    status,
    record: {
      id: detail.record.id,
      reviewState: detail.record.reviewState,
      verificationState: detail.record.verificationState,
      scope: {
        type: detail.record.scopeType,
        id: detail.record.scopeId,
      },
      ownerAgentId: detail.record.ownerAgentId,
      content: detail.record.content,
      supersedesRecordId: detail.record.supersedesRecordId,
      supersededByRecordId: detail.record.supersededByRecordId,
    },
  };
}

export function memoryAgentToolsService(db: Db) {
  const service = memoryService(db);

  return {
    recall: async (context: MemoryAgentToolContext, rawInput: unknown) => {
      const parsed = memoryAgentRecallInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid Memory recall input", parsed.error.issues);
      }
      if (!context.allowShared && !context.allowPrivate) {
        throw forbidden("Memory tools are not enabled", {
          code: "memory_tools_disabled",
        });
      }

      const actor = actorFor(context);
      const asOf = parsed.data.asOf ? new Date(parsed.data.asOf) : new Date();
      const scopes: Array<{
        scopeType: "company" | "agent" | "project" | "subject";
        scopeId: string | null;
      }> = [];

      if (context.allowShared) {
        scopes.push({ scopeType: "company", scopeId: null });
        if (context.projectId) {
          scopes.push({ scopeType: "project", scopeId: context.projectId });
        }
        for (const subject of parsed.data.subjects) {
          const canonical = subjectScopeId(subject);
          scopes.push({ scopeType: "subject", scopeId: canonical });
          if (subject.id !== canonical) {
            scopes.push({ scopeType: "subject", scopeId: subject.id });
          }
        }
      }
      if (context.allowPrivate) {
        scopes.push({ scopeType: "agent", scopeId: context.agentId });
      }

      const recordsById = new Map<string, typeof memoryRecords.$inferSelect>();
      for (const scope of scopes) {
        const rows = await service.listEligible(
          context.companyId,
          {
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            asOf,
            limit: ELIGIBLE_SCOPE_SCAN_LIMIT,
          },
          actor,
        );
        for (const row of rows) {
          if (sensitivityAllowed(row)) recordsById.set(row.id, row);
        }
      }

      const ranked = [...recordsById.values()]
        .map((record) => ({
          record,
          score: relevanceScore(record, parsed.data.query),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.record.observedAt.getTime() - left.record.observedAt.getTime(),
        )
        .slice(0, parsed.data.topK);

      const records = [];
      for (const { record, score } of ranked) {
        const detail = await service.get(
          context.companyId,
          record.id,
          actor,
        );
        if (detail) records.push(recallRecord(detail, score));
      }

      await logActivity(db, {
        companyId: context.companyId,
        actorType: "agent",
        actorId: context.agentId,
        agentId: context.agentId,
        runId: context.runId,
        issueId: context.issueId,
        action: "memory.recalled",
        entityType: "company",
        entityId: context.companyId,
        details: {
          queryHash: createHash("sha256")
            .update(parsed.data.query)
            .digest("hex"),
          resultCount: records.length,
          requestedTopK: parsed.data.topK,
          asOf: asOf.toISOString(),
          scopes: scopes.map((scope) => ({
            type: scope.scopeType,
            id: scope.scopeId,
          })),
        },
      });

      return { records };
    },

    remember: async (context: MemoryAgentToolContext, rawInput: unknown) => {
      const parsed = memoryAgentRememberInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid Memory remember input", parsed.error.issues);
      }

      if (parsed.data.scope === "private" && !context.allowPrivate) {
        throw forbidden("Private Memory is not enabled", {
          code: "private_memory_disabled",
        });
      }
      if (parsed.data.scope !== "private" && !context.allowShared) {
        throw forbidden("Shared Memory is not enabled", {
          code: "shared_memory_disabled",
        });
      }
      if (parsed.data.scope === "project" && !context.projectId) {
        throw unprocessable(
          "Project-scoped memory requires a project-scoped task",
          { code: "memory_project_scope_unavailable" },
        );
      }

      const binding = await resolveBinding(db, context, {
        scope: parsed.data.scope,
        bindingKey: parsed.data.bindingKey,
      });
      const source = await taskEvidence(
        db,
        context,
        parsed.data.content,
        parsed.data.observedAt,
      );
      const scope =
        parsed.data.scope === "private"
          ? { type: "agent" as const, id: context.agentId }
          : parsed.data.scope === "company"
            ? { type: "company" as const, id: null }
            : parsed.data.scope === "project"
              ? { type: "project" as const, id: context.projectId! }
              : {
                  type: "subject" as const,
                  id: subjectScopeId(parsed.data.subject!),
                };

      const fingerprint = operationFingerprint({
        tool: "remember",
        companyId: context.companyId,
        agentId: context.agentId,
        runId: context.runId,
        issueId: context.issueId,
        bindingId: binding.id,
        scope,
        subject: parsed.data.subject ?? null,
        memoryType: parsed.data.memoryType,
        title: parsed.data.title,
        content: parsed.data.content,
        summary: parsed.data.summary,
        sensitivity: parsed.data.sensitivity,
        importance: parsed.data.importance,
        confidenceScore: parsed.data.confidenceScore,
        validFrom: parsed.data.validFrom,
        validUntil: parsed.data.validUntil,
        retentionPolicy: parsed.data.retentionPolicy,
        expiresAt: parsed.data.expiresAt,
      });

      const replay = await resolveReplay(
        db,
        service,
        context,
        parsed.data.idempotencyKey,
        fingerprint,
      );
      if (replay) return memoryResult(replay, "duplicate");

      const candidate = {
        bindingId: binding.id,
        memoryType: parsed.data.memoryType,
        scope,
        subject: parsed.data.subject ?? null,
        ownerAgentId:
          parsed.data.scope === "private" ? context.agentId : null,
        title: parsed.data.title,
        content: parsed.data.content,
        summary: parsed.data.summary,
        sensitivity: parsed.data.sensitivity,
        importance: parsed.data.importance,
        confidenceScore: parsed.data.confidenceScore,
        validFrom: parsed.data.validFrom,
        validUntil: parsed.data.validUntil,
        observedAt: source.observedAt,
        retentionPolicy: parsed.data.retentionPolicy,
        expiresAt: parsed.data.expiresAt,
        createdByOperationId: parsed.data.idempotencyKey,
        metadata: {
          createdVia: "agent_memory_tool",
          [TOOL_FINGERPRINT_KEY]: fingerprint,
        },
        evidence: source.evidence,
      };

      if (parsed.data.scope === "private") {
        const {
          scope: _scope,
          ownerAgentId: _ownerAgentId,
          ...privateInput
        } = candidate;
        const detail = await service.createPrivateMemory(
          context.companyId,
          context.agentId,
          privateInput,
          actorFor(context),
        );
        return memoryResult(detail, "accepted");
      }

      try {
        const detail = await service.createCandidate(
          context.companyId,
          candidate,
          actorFor(context),
        );
        return memoryResult(detail, "pending");
      } catch (error) {
        if (
          error instanceof HttpError &&
          error.status === 409 &&
          (error.details as Record<string, unknown> | null)?.code ===
            "memory_operation_conflict"
        ) {
          const racedReplay = await resolveReplay(
            db,
            service,
            context,
            parsed.data.idempotencyKey,
            fingerprint,
          );
          if (racedReplay) return memoryResult(racedReplay, "duplicate");
        }
        throw error;
      }
    },

    correct: async (context: MemoryAgentToolContext, rawInput: unknown) => {
      const parsed = memoryAgentCorrectInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid Memory correction input", parsed.error.issues);
      }

      const sourceDetail = await service.get(
        context.companyId,
        parsed.data.recordId,
        actorFor(context),
      );
      if (!sourceDetail) {
        throw notFound("Memory record not found", {
          code: "memory_record_not_found",
        });
      }
      assertRecordToolAccess(sourceDetail.record, context);

      const evidence = await taskEvidence(
        db,
        context,
        parsed.data.content,
        parsed.data.observedAt,
      );
      const record = sourceDetail.record;
      const fingerprint = operationFingerprint({
        tool: "correct_memory",
        companyId: context.companyId,
        agentId: context.agentId,
        sourceRecordId: record.id,
        reason: parsed.data.reason,
        content: parsed.data.content,
        memoryType: parsed.data.memoryType ?? record.memoryType,
        subject:
          parsed.data.subject === undefined
            ? record.subjectType && record.subjectId
              ? { type: record.subjectType, id: record.subjectId }
              : null
            : parsed.data.subject,
        title:
          parsed.data.title === undefined ? record.title : parsed.data.title,
        summary:
          parsed.data.summary === undefined
            ? record.summary
            : parsed.data.summary,
        sensitivity:
          parsed.data.sensitivity ?? record.sensitivityLabel,
        importance: parsed.data.importance ?? record.importance,
        confidenceScore:
          parsed.data.confidenceScore ?? record.confidenceScore,
        validFrom:
          parsed.data.validFrom === undefined
            ? record.validFrom?.toISOString() ?? null
            : parsed.data.validFrom,
        validUntil:
          parsed.data.validUntil === undefined
            ? record.validUntil?.toISOString() ?? null
            : parsed.data.validUntil,
        retentionPolicy:
          parsed.data.retentionPolicy ?? record.retentionPolicy,
        expiresAt:
          parsed.data.expiresAt === undefined
            ? record.expiresAt?.toISOString() ?? null
            : parsed.data.expiresAt,
      });

      const replay = await resolveReplay(
        db,
        service,
        context,
        parsed.data.idempotencyKey,
        fingerprint,
      );
      if (replay) return memoryResult(replay, "duplicate");

      const correctionInput = {
        memoryType: parsed.data.memoryType ?? record.memoryType,
        subject:
          parsed.data.subject === undefined
            ? record.subjectType && record.subjectId
              ? { type: record.subjectType, id: record.subjectId }
              : null
            : parsed.data.subject,
        title:
          parsed.data.title === undefined ? record.title : parsed.data.title,
        content: parsed.data.content,
        summary:
          parsed.data.summary === undefined
            ? record.summary
            : parsed.data.summary,
        sensitivity:
          parsed.data.sensitivity ?? record.sensitivityLabel,
        importance: parsed.data.importance ?? record.importance,
        confidenceScore:
          parsed.data.confidenceScore ?? record.confidenceScore,
        validFrom:
          parsed.data.validFrom === undefined
            ? record.validFrom?.toISOString() ?? null
            : parsed.data.validFrom,
        validUntil:
          parsed.data.validUntil === undefined
            ? record.validUntil?.toISOString() ?? null
            : parsed.data.validUntil,
        observedAt: evidence.observedAt,
        retentionPolicy:
          parsed.data.retentionPolicy ?? record.retentionPolicy,
        expiresAt:
          parsed.data.expiresAt === undefined
            ? record.expiresAt?.toISOString() ?? null
            : parsed.data.expiresAt,
        createdByOperationId: parsed.data.idempotencyKey,
        metadata: {
          createdVia: "agent_memory_tool",
          [TOOL_FINGERPRINT_KEY]: fingerprint,
        },
        evidence: evidence.evidence,
        reason: parsed.data.reason,
      };

      if (record.scopeType === "agent") {
        const detail = await service.correctPrivateMemory(
          context.companyId,
          record.id,
          correctionInput,
          actorFor(context),
        );
        return memoryResult(detail, "accepted");
      }

      try {
        const detail = await service.createCorrectionCandidate(
          context.companyId,
          record.id,
          correctionInput,
          actorFor(context),
        );
        return memoryResult(detail, "pending");
      } catch (error) {
        if (
          error instanceof HttpError &&
          error.status === 409 &&
          (error.details as Record<string, unknown> | null)?.code ===
            "memory_operation_conflict"
        ) {
          const racedReplay = await resolveReplay(
            db,
            service,
            context,
            parsed.data.idempotencyKey,
            fingerprint,
          );
          if (racedReplay) return memoryResult(racedReplay, "duplicate");
        }
        throw error;
      }
    },

    share: async (context: MemoryAgentToolContext, rawInput: unknown) => {
      const parsed = memoryAgentShareInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid Memory share input", parsed.error.issues);
      }
      if (!context.allowShared || !context.allowPrivate) {
        throw forbidden("Sharing Memory requires private and shared Memory to be enabled", {
          code: "memory_share_disabled",
        });
      }

      const source = await service.get(
        context.companyId,
        parsed.data.recordId,
        actorFor(context),
      );
      if (!source) {
        throw notFound("Private Memory record not found", {
          code: "private_memory_record_not_found",
        });
      }
      if (
        source.record.scopeType !== "agent" ||
        source.record.ownerAgentId !== context.agentId
      ) {
        throw forbidden("Only owner-private Memory can be shared", {
          code: "private_memory_share_denied",
        });
      }

      if (parsed.data.targetScope === "project" && !context.projectId) {
        throw unprocessable(
          "Project-scoped sharing requires a project-scoped task",
          { code: "memory_project_scope_unavailable" },
        );
      }
      const binding = await resolveBinding(db, context, {
        scope:
          parsed.data.targetScope === "project"
            ? "project"
            : parsed.data.targetScope === "subject"
              ? "subject"
              : "company",
        bindingKey: parsed.data.bindingKey,
      });
      const targetScope =
        parsed.data.targetScope === "company"
          ? { type: "company" as const, id: null }
          : parsed.data.targetScope === "project"
            ? { type: "project" as const, id: context.projectId! }
            : {
                type: "subject" as const,
                id: subjectScopeId(parsed.data.subject!),
              };

      const existing = await existingOperationRecord(
        db,
        context.companyId,
        parsed.data.idempotencyKey,
      );
      if (existing) {
        const duplicate =
          existing.scopeType === targetScope.type &&
          existing.scopeId === targetScope.id &&
          existing.bindingId === binding.id &&
          existing.metadata.promotedFromPrivateRecordId === source.record.id &&
          existing.metadata.promotionReason === parsed.data.reason;
        if (!duplicate) {
          throw conflict("Memory operation id was reused with different share input", {
            code: "memory_operation_conflict",
            operationId: parsed.data.idempotencyKey,
          });
        }
        const detail = await service.get(
          context.companyId,
          existing.id,
          actorFor(context),
        );
        if (!detail) {
          throw conflict("Shared Memory replay target is unavailable", {
            code: "memory_operation_record_unavailable",
          });
        }
        return memoryResult(detail, "duplicate");
      }

      const detail = await service.sharePrivateMemory(
        context.companyId,
        source.record.id,
        {
          targetBindingId: binding.id,
          targetScope,
          reason: parsed.data.reason,
          createdByOperationId: parsed.data.idempotencyKey,
        },
        actorFor(context),
      );
      return memoryResult(detail, "pending");
    },
  };
}
