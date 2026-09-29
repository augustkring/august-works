import { and, desc, eq, gt, isNull, lte, ne, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  memoryBindings,
  memoryBindingTargets,
  memoryEvidence,
  memoryRecords,
  projects,
} from "@paperclipai/db";
import {
  executionPrincipalToActivityActor,
  memoryBindingInputSchema,
  memoryBindingTargetInputSchema,
  memoryCandidateInputSchema,
  memoryCorrectionInputSchema,
  memoryReviewInputSchema,
  memoryRevokeInputSchema,
  type ExecutionPrincipal,
  type MemoryCandidateInputParsed,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";

export interface MemoryMutationActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
}

function actorIdentity(actor: MemoryMutationActor) {
  const activity = executionPrincipalToActivityActor(actor.principal);
  return {
    actorType: activity.actorType,
    actorId: activity.actorId,
    agentId: actor.principal.type === "agent" ? actor.principal.agentId : null,
    runId: actor.runId ?? null,
    responsibleUserId: activity.responsibleUserId,
  };
}

async function assertActorCompanyScope(
  db: Db,
  companyId: string,
  actor: MemoryMutationActor,
) {
  if (actor.principal.type === "system") return;

  if (actor.principal.type === "agent") {
    const row = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, actor.principal.agentId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw forbidden("Agent does not belong to this company");
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
  if (!membership) throw forbidden("User does not have an active company membership");
}

function requireHumanOrSystem(actor: MemoryMutationActor, action: string) {
  if (actor.principal.type === "agent") {
    throw forbidden(`Agents cannot ${action} durable organizational memory`);
  }
}

function assertPrivateMemoryReadAllowed(
  record: typeof memoryRecords.$inferSelect,
  actor: MemoryMutationActor,
) {
  if (record.scopeType !== "agent") return;
  if (actor.principal.type === "system") return;
  if (
    actor.principal.type === "agent" &&
    record.ownerAgentId === actor.principal.agentId
  ) {
    return;
  }
  throw forbidden("Private agent memory is only visible to its owning agent", {
    code: "private_memory_read_denied",
    ownerAgentId: record.ownerAgentId,
  });
}

async function bindingForCompany(db: Db, companyId: string, bindingId: string) {
  return db
    .select()
    .from(memoryBindings)
    .where(and(eq(memoryBindings.companyId, companyId), eq(memoryBindings.id, bindingId)))
    .then((rows) => rows[0] ?? null);
}

async function assertScopeReferences(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
) {
  if (input.scope.type === "agent") {
    const agent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, input.scope.id!)))
      .then((rows) => rows[0] ?? null);
    if (!agent) throw unprocessable("Memory scope agent must belong to the company");
  }

  if (input.scope.type === "project") {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, input.scope.id!)))
      .then((rows) => rows[0] ?? null);
    if (!project) throw unprocessable("Memory scope project must belong to the company");
  }
}

function targetMatchesScope(
  companyId: string,
  target: typeof memoryBindingTargets.$inferSelect,
  input: MemoryCandidateInputParsed,
) {
  if (target.targetType === "company") return target.targetId === companyId;
  if (target.targetType === "agent") {
    return input.scope.type === "agent" && target.targetId === input.scope.id;
  }
  if (target.targetType === "project") {
    return input.scope.type === "project" && target.targetId === input.scope.id;
  }
  return false;
}

async function assertBindingAllowsCandidate(
  db: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
) {
  const binding = await bindingForCompany(db, companyId, input.bindingId);
  if (!binding || !binding.enabled) {
    throw forbidden("Memory binding is unavailable for this company");
  }
  const targets = await db
    .select()
    .from(memoryBindingTargets)
    .where(
      and(
        eq(memoryBindingTargets.companyId, companyId),
        eq(memoryBindingTargets.bindingId, binding.id),
      ),
    );
  if (!targets.some((target) => targetMatchesScope(companyId, target, input))) {
    throw forbidden("Memory binding is not authorized for the requested scope");
  }
  return binding;
}

async function assertAgentPrivateOwnership(
  input: MemoryCandidateInputParsed,
  actor: MemoryMutationActor,
) {
  if (
    input.scope.type === "agent" &&
    actor.principal.type === "agent" &&
    input.scope.id !== actor.principal.agentId
  ) {
    throw forbidden("An agent can only create private memory for itself");
  }
}

function recordDetail(
  record: typeof memoryRecords.$inferSelect,
  evidence: (typeof memoryEvidence.$inferSelect)[],
) {
  return { record, evidence };
}

async function getRecordDetail(db: Db, companyId: string, recordId: string) {
  const record = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.id, recordId),
        isNull(memoryRecords.deletedAt),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!record) return null;
  const evidence = await db
    .select()
    .from(memoryEvidence)
    .where(
      and(
        eq(memoryEvidence.companyId, companyId),
        eq(memoryEvidence.memoryRecordId, recordId),
      ),
    )
    .orderBy(memoryEvidence.createdAt);
  return recordDetail(record, evidence);
}

async function persistMemoryActivity(
  db: Db,
  actor: MemoryMutationActor,
  input: {
    companyId: string;
    action: string;
    recordId: string;
    details?: Record<string, unknown>;
  },
): Promise<ActivityPublication> {
  const identity = actorIdentity(actor);
  const result = await persistActivity(db, {
    companyId: input.companyId,
    actorType: identity.actorType,
    actorId: identity.actorId,
    agentId: identity.agentId,
    runId: identity.runId,
    responsibleUserIdOverride: identity.responsibleUserId,
    action: input.action,
    entityType: "memory_record",
    entityId: input.recordId,
    details: input.details ?? null,
  });
  return result.publication;
}

async function insertCandidate(
  tx: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
  actor: MemoryMutationActor,
  supersedesRecordId: string | null,
) {
  await assertActorCompanyScope(tx, companyId, actor);
  await assertScopeReferences(tx, companyId, input);
  await assertAgentPrivateOwnership(input, actor);
  const binding = await assertBindingAllowsCandidate(tx, companyId, input);
  const identity = actorIdentity(actor);
  const now = new Date();

  const [record] = await tx
    .insert(memoryRecords)
    .values({
      companyId,
      bindingId: binding.id,
      providerKey: binding.providerKey,
      memoryType: input.memoryType,
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      ownerAgentId: input.ownerAgentId,
      title: input.title,
      content: input.content,
      summary: input.summary,
      reviewState: "pending",
      verificationState: "unverified",
      sensitivityLabel: input.sensitivity,
      importance: input.importance,
      confidenceScore: input.confidenceScore,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      observedAt: new Date(input.observedAt),
      retentionPolicy: input.retentionPolicy,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      retentionState: "active",
      supersedesRecordId,
      supersededByRecordId: null,
      createdByActorType: identity.actorType,
      createdByActorId: identity.actorId,
      createdByOperationId: input.createdByOperationId,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!record) throw new Error("Memory candidate insert returned no row");

  await tx.insert(memoryEvidence).values(
    input.evidence.map((item) => ({
      companyId,
      memoryRecordId: record.id,
      sourceClass: item.sourceClass,
      sourceProvider: item.sourceProvider,
      sourceType: item.sourceType,
      sourceRef: item.sourceRef,
      sourceVersion: item.sourceVersion,
      sourceUpdatedAt: item.sourceUpdatedAt ? new Date(item.sourceUpdatedAt) : null,
      observedAt: new Date(item.observedAt),
      excerptHash: item.excerptHash,
      citationJson: item.citation,
      trustLevel: item.trustLevel,
      supportsOrContradicts: item.relation,
    })),
  );

  return record;
}

export function memoryService(db: Db) {
  return {
    listBindings: async (
      companyId: string,
      actor: MemoryMutationActor,
    ) => {
      requireHumanOrSystem(actor, "inspect");
      await assertActorCompanyScope(db, companyId, actor);
      return db
        .select()
        .from(memoryBindings)
        .where(eq(memoryBindings.companyId, companyId))
        .orderBy(memoryBindings.key);
    },

    listReviewable: async (
      companyId: string,
      input: {
        reviewState?: "pending" | "accepted" | "rejected";
        memoryType?: MemoryCandidateInputParsed["memoryType"];
        limit: number;
      },
      actor: MemoryMutationActor,
    ) => {
      requireHumanOrSystem(actor, "inspect");
      await assertActorCompanyScope(db, companyId, actor);
      return db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, companyId),
            ne(memoryRecords.scopeType, "agent"),
            isNull(memoryRecords.deletedAt),
            ...(input.reviewState
              ? [eq(memoryRecords.reviewState, input.reviewState)]
              : []),
            ...(input.memoryType
              ? [eq(memoryRecords.memoryType, input.memoryType)]
              : []),
          ),
        )
        .orderBy(desc(memoryRecords.updatedAt))
        .limit(input.limit);
    },

    getShared: async (
      companyId: string,
      recordId: string,
      actor: MemoryMutationActor,
    ) => {
      requireHumanOrSystem(actor, "inspect");
      await assertActorCompanyScope(db, companyId, actor);
      const visible = await db
        .select({ id: memoryRecords.id })
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, companyId),
            eq(memoryRecords.id, recordId),
            ne(memoryRecords.scopeType, "agent"),
            isNull(memoryRecords.deletedAt),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!visible) return null;
      return getRecordDetail(db, companyId, visible.id);
    },

    get: async (
      companyId: string,
      recordId: string,
      actor: MemoryMutationActor,
    ) => {
      await assertActorCompanyScope(db, companyId, actor);
      const detail = await getRecordDetail(db, companyId, recordId);
      if (!detail) return null;
      assertPrivateMemoryReadAllowed(detail.record, actor);
      return detail;
    },

    createBinding: async (
      companyId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryBindingInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory binding", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "configure");
      await assertActorCompanyScope(db, companyId, actor);
      try {
        const [binding] = await db
          .insert(memoryBindings)
          .values({
            companyId,
            key: parsed.data.key,
            name: parsed.data.name,
            providerKey: parsed.data.providerKey,
            config: parsed.data.config,
            enabled: parsed.data.enabled,
          })
          .returning();
        return binding!;
      } catch (error) {
        if (isUniqueViolation(error, "memory_bindings_company_key_uq")) {
          throw conflict("Memory binding key already exists", {
            code: "memory_binding_key_conflict",
          });
        }
        throw error;
      }
    },

    addBindingTarget: async (
      companyId: string,
      bindingId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryBindingTargetInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory binding target", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "configure");
      await assertActorCompanyScope(db, companyId, actor);
      const binding = await bindingForCompany(db, companyId, bindingId);
      if (!binding) throw notFound("Memory binding not found");

      if (parsed.data.targetType === "company" && parsed.data.targetId !== companyId) {
        throw unprocessable("Company memory target must reference the current company");
      }
      if (parsed.data.targetType === "agent") {
        const agent = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.companyId, companyId), eq(agents.id, parsed.data.targetId)))
          .then((rows) => rows[0] ?? null);
        if (!agent) throw unprocessable("Memory target agent must belong to the company");
      }
      if (parsed.data.targetType === "project") {
        const project = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.companyId, companyId), eq(projects.id, parsed.data.targetId)))
          .then((rows) => rows[0] ?? null);
        if (!project) throw unprocessable("Memory target project must belong to the company");
      }

      const [target] = await db
        .insert(memoryBindingTargets)
        .values({
          companyId,
          bindingId,
          targetType: parsed.data.targetType,
          targetId: parsed.data.targetId,
        })
        .onConflictDoNothing()
        .returning();
      if (target) return target;
      return db
        .select()
        .from(memoryBindingTargets)
        .where(
          and(
            eq(memoryBindingTargets.companyId, companyId),
            eq(memoryBindingTargets.bindingId, bindingId),
            eq(memoryBindingTargets.targetType, parsed.data.targetType),
            eq(memoryBindingTargets.targetId, parsed.data.targetId),
          ),
        )
        .then((rows) => rows[0]!);
    },

    createCandidate: async (
      companyId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryCandidateInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory candidate", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const record = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const created = await insertCandidate(
          txDb,
          companyId,
          parsed.data,
          actor,
          null,
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.candidate_created",
            recordId: created.id,
            details: {
              memoryType: created.memoryType,
              scopeType: created.scopeType,
              scopeId: created.scopeId,
            },
          }),
        );
        return created;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, record.id))!;
    },

    createCorrectionCandidate: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryCorrectionInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory correction", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const created = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const existing = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              isNull(memoryRecords.deletedAt),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!existing) throw notFound("Memory record not found");
        if (
          existing.reviewState !== "accepted" ||
          existing.revokedAt ||
          existing.retentionState !== "active" ||
          existing.supersededByRecordId
        ) {
          throw conflict("Only active accepted memory can be corrected", {
            code: "memory_not_correctable",
          });
        }

        const candidate: MemoryCandidateInputParsed = {
          bindingId: existing.bindingId,
          memoryType: parsed.data.memoryType,
          scope: { type: existing.scopeType as MemoryCandidateInputParsed["scope"]["type"], id: existing.scopeId },
          subject: parsed.data.subject,
          ownerAgentId: existing.ownerAgentId,
          title: parsed.data.title,
          content: parsed.data.content,
          summary: parsed.data.summary,
          sensitivity: parsed.data.sensitivity,
          importance: parsed.data.importance,
          confidenceScore: parsed.data.confidenceScore,
          validFrom: parsed.data.validFrom,
          validUntil: parsed.data.validUntil,
          observedAt: parsed.data.observedAt,
          retentionPolicy: parsed.data.retentionPolicy,
          expiresAt: parsed.data.expiresAt,
          createdByOperationId: parsed.data.createdByOperationId,
          metadata: {
            ...parsed.data.metadata,
            correctionReason: parsed.data.reason,
          },
          evidence: parsed.data.evidence,
        };
        const next = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          existing.id,
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.corrected",
            recordId: next.id,
            details: {
              supersedesRecordId: existing.id,
              pendingReview: true,
            },
          }),
        );
        return next;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, created.id))!;
    },

    reviewCandidate: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryReviewInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory review", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "review");
      const publications: ActivityPublication[] = [];

      const reviewed = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const record = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              isNull(memoryRecords.deletedAt),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!record) throw notFound("Memory candidate not found");
        if (record.reviewState !== "pending") {
          throw conflict("Memory candidate has already been reviewed", {
            code: "memory_review_conflict",
            reviewState: record.reviewState,
          });
        }

        const nextVerification =
          actor.principal.type === "user"
            ? "human_verified"
            : actor.principal.type === "system"
              ? "system_verified"
              : "unverified";
        const now = new Date();

        if (parsed.data.decision === "accept" && record.supersedesRecordId) {
          const prior = await txDb
            .select()
            .from(memoryRecords)
            .where(
              and(
                eq(memoryRecords.companyId, companyId),
                eq(memoryRecords.id, record.supersedesRecordId),
                isNull(memoryRecords.deletedAt),
              ),
            )
            .for("update")
            .then((rows) => rows[0] ?? null);
          if (
            !prior ||
            prior.reviewState !== "accepted" ||
            prior.revokedAt ||
            prior.retentionState !== "active" ||
            prior.supersededByRecordId
          ) {
            throw conflict("The memory being corrected is no longer current", {
              code: "memory_correction_stale",
            });
          }
          await txDb
            .update(memoryRecords)
            .set({ supersededByRecordId: record.id, updatedAt: now })
            .where(
              and(
                eq(memoryRecords.companyId, companyId),
                eq(memoryRecords.id, prior.id),
              ),
            );
          publications.push(
            await persistMemoryActivity(txDb, actor, {
              companyId,
              action: "memory.superseded",
              recordId: prior.id,
              details: { supersededByRecordId: record.id },
            }),
          );
        }

        const [updated] = await txDb
          .update(memoryRecords)
          .set({
            reviewState: parsed.data.decision === "accept" ? "accepted" : "rejected",
            verificationState:
              parsed.data.decision === "accept" ? nextVerification : record.verificationState,
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, record.id),
              eq(memoryRecords.reviewState, "pending"),
            ),
          )
          .returning();
        if (!updated) throw conflict("Memory candidate review raced with another reviewer");

        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action:
              parsed.data.decision === "accept"
                ? "memory.candidate_accepted"
                : "memory.candidate_rejected",
            recordId: updated.id,
            details: {
              verificationState: updated.verificationState,
              reason: parsed.data.reason ?? null,
            },
          }),
        );
        return updated;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, reviewed.id))!;
    },

    revoke: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryRevokeInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid memory revocation", parsed.error.issues);
      }
      requireHumanOrSystem(actor, "revoke");
      const publications: ActivityPublication[] = [];

      const revoked = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const record = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              isNull(memoryRecords.deletedAt),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!record) throw notFound("Memory record not found");
        if (record.reviewState !== "accepted") {
          throw conflict("Only accepted memory can be revoked");
        }
        if (record.revokedAt) return record;

        const identity = actorIdentity(actor);
        const now = new Date();
        const [updated] = await txDb
          .update(memoryRecords)
          .set({
            revokedAt: now,
            revokedByActorType: identity.actorType,
            revokedByActorId: identity.actorId,
            revocationReason: parsed.data.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, record.id),
              isNull(memoryRecords.revokedAt),
            ),
          )
          .returning();
        const result = updated ?? record;
        if (updated) {
          publications.push(
            await persistMemoryActivity(txDb, actor, {
              companyId,
              action: "memory.revoked",
              recordId: result.id,
              details: { reason: parsed.data.reason },
            }),
          );
        }
        return result;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, revoked.id))!;
    },

    listEligible: async (
      companyId: string,
      input: {
        scopeType?: "company" | "agent" | "project" | "subject";
        scopeId?: string | null;
        asOf?: Date;
        limit?: number;
      },
      actor: MemoryMutationActor,
    ) => {
      await assertActorCompanyScope(db, companyId, actor);
      if (input.scopeId !== undefined && !input.scopeType) {
        throw unprocessable("Memory scope id requires an explicit scope type");
      }
      if (input.scopeType === "agent" && !input.scopeId) {
        throw unprocessable("Agent memory eligibility requires the owning agent id");
      }
      if (
        input.scopeType === "agent" &&
        actor.principal.type !== "system" &&
        !(
          actor.principal.type === "agent" &&
          actor.principal.agentId === input.scopeId
        )
      ) {
        throw forbidden("Private agent memory can only be recalled by its owning agent", {
          code: "private_memory_read_denied",
          scopeId: input.scopeId,
        });
      }

      const asOf = input.asOf ?? new Date();
      const limit = Math.min(100, Math.max(1, input.limit ?? 50));
      return db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, companyId),
            eq(memoryRecords.reviewState, "accepted"),
            eq(memoryRecords.retentionState, "active"),
            isNull(memoryRecords.revokedAt),
            isNull(memoryRecords.deletedAt),
            isNull(memoryRecords.supersededByRecordId),
            or(isNull(memoryRecords.validFrom), lte(memoryRecords.validFrom, asOf)),
            or(isNull(memoryRecords.validUntil), gt(memoryRecords.validUntil, asOf)),
            or(isNull(memoryRecords.expiresAt), gt(memoryRecords.expiresAt, asOf)),
            ...(input.scopeType
              ? [eq(memoryRecords.scopeType, input.scopeType)]
              : [ne(memoryRecords.scopeType, "agent")]),
            ...(input.scopeId !== undefined
              ? input.scopeId === null
                ? [isNull(memoryRecords.scopeId)]
                : [eq(memoryRecords.scopeId, input.scopeId)]
              : []),
          ),
        )
        .orderBy(memoryRecords.observedAt.desc())
        .limit(limit);
    },
  };
}
