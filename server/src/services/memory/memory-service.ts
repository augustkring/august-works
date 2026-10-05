import { invalidateCognitiveRecords } from "./cognitive-privacy.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  heartbeatRuns,
  memoryBindings,
  memoryBindingTargets,
  memoryEvidence,
  memoryRecords,
  memoryDeletionMarkers,
  memoryRetentionPolicies,
  projects,
} from "@paperclipai/db";
import {
  executionPrincipalToActivityActor,
  memoryBindingInputSchema,
  memoryBindingTargetInputSchema,
  memoryCandidateInputSchema,
  memoryCorrectionInputSchema,
  memoryPrivateInputSchema,
  memoryPrivateCorrectionInputSchema,
  memoryReviewInputSchema,
  memoryRevokeInputSchema,
  memoryShareInputSchema,
  memoryRetentionPolicyInputSchema,
  memorySourceDeletionInputSchema,
  memoryDeletionLedgerInputSchema,
  type ExecutionPrincipal,
  type MemoryCandidateInputParsed,
  type MemoryResolutionMetadata,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";
import { lockMemoryPrivacy, assertMemoryOperationRetained, assertMemorySourcesRetained,
  purgeMemoryRecords, memoryDeletionKey, memoryPayloadVisible, reapplyMemoryDeletionMarkers } from "./memory-privacy.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import {
  lockMemoryResolution,
  resolveMemoryCandidate,
} from "./memory-resolution.js";

export interface MemoryMutationActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
}

interface SharePrivateMemoryInternalContext {
  operationContextFingerprint?: string | null;
  additionalEvidence?: MemoryCandidateInputParsed["evidence"];
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

async function assertPrivacyManagement(db: Db, companyId: string, actor: MemoryMutationActor) {
  await assertActorCompanyScope(db, companyId, actor);
  if (actor.principal.type === "system") return;
  if (actor.principal.type !== "user") throw forbidden("Company privacy management requires a human administrator");
  const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
    eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.principal.userId), eq(companyMemberships.status, "active")));
  if (!membership || !["owner", "admin"].includes(membership.membershipRole ?? "")) throw forbidden("Company privacy management requires an owner or administrator", {
    code: "memory_privacy_management_denied" });
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
  if (target.targetType === "company") {
    return (
      target.targetId === companyId &&
      (input.scope.type === "company" || input.scope.type === "subject")
    );
  }
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

function assertPrivateMemoryWriter(
  ownerAgentId: string,
  actor: MemoryMutationActor,
) {
  if (actor.principal.type === "system") return;
  if (
    actor.principal.type === "agent" &&
    actor.principal.agentId === ownerAgentId
  ) {
    return;
  }
  throw forbidden("Private agent memory can only be written by its owning agent or the system", {
    code: "private_memory_write_denied",
    ownerAgentId,
  });
}

function privateMemoryEvidenceTrust(
  verificationState: string,
): "high" | "medium" | "low" {
  if (
    verificationState === "human_verified" ||
    verificationState === "system_verified"
  ) {
    return "high";
  }
  return verificationState === "corroborated" ? "medium" : "low";
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalMemoryOperationValue(value: unknown): CanonicalValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Memory operation input contains a non-finite number");
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(canonicalMemoryOperationValue);
  }
  if (typeof value === "object") {
    const result: Record<string, CanonicalValue> = Object.create(null) as Record<
      string,
      CanonicalValue
    >;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalMemoryOperationValue(entry);
    }
    return result;
  }
  throw unprocessable("Memory operation input must be JSON-compatible");
}

function memoryOperationFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalMemoryOperationValue(value)))
    .digest("hex");
}

function metadataForOperationFingerprint(
  rawInput: unknown,
  parsedMetadata: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    Array.isArray(rawInput)
  ) {
    return parsedMetadata;
  }
  const metadataDescriptor = Object.getOwnPropertyDescriptor(rawInput, "metadata");
  const rawMetadata =
    metadataDescriptor && "value" in metadataDescriptor
      ? metadataDescriptor.value
      : null;
  if (
    typeof rawMetadata !== "object" ||
    rawMetadata === null ||
    Array.isArray(rawMetadata)
  ) {
    return parsedMetadata;
  }

  // Zod deliberately normalizes potentially dangerous object keys. The
  // persisted metadata stays normalized, but idempotency must still distinguish
  // two validated requests that differed in an own JSON metadata key such as
  // "__proto__". A null-prototype record avoids invoking prototype setters.
  const fingerprintMetadata = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(parsedMetadata)) {
    fingerprintMetadata[key] = parsedMetadata[key];
  }
  for (const key of Object.keys(rawMetadata as Record<string, unknown>)) {
    const descriptor = Object.getOwnPropertyDescriptor(rawMetadata, key);
    if (!descriptor || !("value" in descriptor) || descriptor.value === undefined) {
      continue;
    }
    fingerprintMetadata[key] = descriptor.value;
  }
  return fingerprintMetadata;
}

async function lockMemoryOperation(
  db: Db,
  companyId: string,
  operationId: string,
) {
  await lockMemoryPrivacy(db, companyId);
  await db.execute(
    sql`select pg_advisory_xact_lock(
      hashtextextended(${`memory:operation:${companyId}:${operationId}`}, 0)
    )`,
  );
}

async function memoryRecordForOperation(
  db: Db,
  companyId: string,
  operationId: string,
) {
  await assertMemoryOperationRetained(db, companyId, operationId);
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.createdByOperationId, operationId),
        memoryPayloadVisible(),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw conflict("Memory operation id is already associated with multiple records", {
      code: "memory_operation_ambiguous",
      operationId,
    });
  }
  return rows[0] ?? null;
}

function metadataFingerprint(
  record: typeof memoryRecords.$inferSelect,
  key: string,
): string | null {
  const value = record.metadata[key];
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? value
    : null;
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
        memoryPayloadVisible(),
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

async function persistedActivityRunId(
  db: Db,
  companyId: string,
  runId: string | null,
): Promise<string | null> {
  if (!runId) return null;
  return db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)))
    .then((rows) => rows[0]?.id ?? null);
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
  const runId = await persistedActivityRunId(
    db,
    input.companyId,
    identity.runId,
  );
  const result = await persistActivity(db, {
    companyId: input.companyId,
    actorType: identity.actorType,
    actorId: identity.actorId,
    agentId: identity.agentId,
    runId,
    responsibleUserIdOverride: identity.responsibleUserId,
    action: input.action,
    entityType: "memory_record",
    entityId: input.recordId,
    details: input.details ?? null,
  });
  return result.publication;
}

async function insertEvidenceRows(
  tx: Db,
  companyId: string,
  memoryRecordId: string,
  evidence: MemoryCandidateInputParsed["evidence"],
): Promise<void> {
  if (evidence.length === 0) return;
  await tx.insert(memoryEvidence).values(
    evidence.map((item) => ({
      companyId,
      memoryRecordId,
      sourceClass: item.sourceClass,
      sourceProvider: item.sourceProvider,
      sourceType: item.sourceType,
      sourceRef: item.sourceRef,
      sourceVersion: item.sourceVersion,
      sourceUpdatedAt: item.sourceUpdatedAt
        ? new Date(item.sourceUpdatedAt)
        : null,
      observedAt: new Date(item.observedAt),
      excerptHash: item.excerptHash,
      citationJson: item.citation,
      trustLevel: item.trustLevel,
      supportsOrContradicts: item.relation,
    })),
  );
}

function withResolution<T extends { record: unknown; evidence: unknown[] }>(
  detail: T,
  resolution: MemoryResolutionMetadata,
) {
  return { ...detail, resolution };
}

async function insertCandidate(
  tx: Db,
  companyId: string,
  input: MemoryCandidateInputParsed,
  actor: MemoryMutationActor,
  supersedesRecordId: string | null,
  state: {
    reviewState?: "pending" | "accepted";
    verificationState?:
      | "unverified"
      | "corroborated"
      | "human_verified"
      | "system_verified";
  } = {},
) {
  await assertMemorySourcesRetained(tx, companyId, input.evidence);
  await assertActorCompanyScope(tx, companyId, actor);
  await assertSaasDomainAdmission(tx, companyId, "memory.use");
  await assertScopeReferences(tx, companyId, input);
  await assertAgentPrivateOwnership(input, actor);
  const binding = await assertBindingAllowsCandidate(tx, companyId, input);
  if (input.createdByOperationId) {
    await lockMemoryOperation(tx, companyId, input.createdByOperationId);
    const existingOperation = await memoryRecordForOperation(
      tx,
      companyId,
      input.createdByOperationId,
    );
    if (existingOperation) {
      throw conflict("Memory operation id is already associated with a record", {
        code: "memory_operation_conflict",
        operationId: input.createdByOperationId,
        existingRecordId: existingOperation.id,
      });
    }
  }
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
      reviewState: state.reviewState ?? "pending",
      verificationState: state.verificationState ?? "unverified",
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

  await insertEvidenceRows(tx, companyId, record.id, input.evidence);

  return record;
}

export function memoryService(db: Db) {
  return {
    exportDeletionLedger: async (companyId: string, actor: MemoryMutationActor) => {
      await assertPrivacyManagement(db, companyId, actor);
      const rows = await db.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId, companyId));
      return { schema: "memory_deletion_ledger.v1" as const, companyId, markers: rows.map((row) => ({
        key: row.key, kind: row.kind, recordId: row.recordId, deletedAt: row.deletedAt.toISOString(),
      })) };
    },
    restoreDeletionLedger: async (companyId: string, input: unknown, actor: MemoryMutationActor) => {
      const ledger = memoryDeletionLedgerInputSchema.parse(input);
      if (ledger.companyId !== companyId) throw forbidden("Deletion ledger belongs to another company", { code: "company_boundary_denied" });
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertPrivacyManagement(scopedDb, companyId, actor);
        await lockMemoryPrivacy(scopedDb, companyId);
        for (const marker of ledger.markers) {
          if (marker.kind === "record" ? !marker.recordId || marker.key !== memoryDeletionKey(companyId, "record", marker.recordId) : marker.recordId !== null) {
            throw unprocessable("Deletion marker identity is invalid", { code: "memory_deletion_marker_invalid" });
          }
        }
        if (ledger.markers.length) await scopedDb.insert(memoryDeletionMarkers).values(ledger.markers.map((marker) => ({
          ...marker, companyId, deletedAt: new Date(marker.deletedAt),
        }))).onConflictDoNothing();
        const erased = await reapplyMemoryDeletionMarkers(scopedDb, companyId);
        publications.push(await persistMemoryActivity(scopedDb, actor, { companyId, action: "memory.deletion_ledger_restored", recordId: companyId,
          details: { markerCount: ledger.markers.length, deletedRecordCount: erased.deletedRecordCount } }));
        return { importedMarkerCount: ledger.markers.length, deletedRecordCount: erased.deletedRecordCount };
      });
      publications.forEach(publishActivity);
      return result;
    },
    forget: async (companyId: string, recordId: string, actor: MemoryMutationActor) => {
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertActorCompanyScope(scopedDb, companyId, actor);
        await lockMemoryPrivacy(scopedDb, companyId);
        const [record] = await scopedDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, recordId))).for("update");
        if (!record) throw notFound("Memory record not found");
        assertPrivateMemoryReadAllowed(record, actor);
        if (record.scopeType === "agent") assertPrivateMemoryWriter(record.ownerAgentId!, actor);
        else requireHumanOrSystem(actor, "delete");
        const deleted = await purgeMemoryRecords(scopedDb, companyId, [recordId]);
        if (deleted.deletedRecordCount) publications.push(await persistMemoryActivity(scopedDb, actor, {
          companyId, action: "memory.deleted", recordId,
          details: { deletedRecordCount: deleted.deletedRecordCount, includesDerivedRecords: true },
        }));
        return deleted;
      });
      publications.forEach(publishActivity);
      return result;
    },

    export: async (companyId: string, actor: MemoryMutationActor) => {
      return db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertActorCompanyScope(scopedDb, companyId, actor);
        const records = await scopedDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), memoryPayloadVisible(),
          actor.principal.type === "agent" ? and(eq(memoryRecords.scopeType, "agent"), eq(memoryRecords.ownerAgentId, actor.principal.agentId)) : ne(memoryRecords.scopeType, "agent")));
        const evidence = records.length ? await scopedDb.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId),
          inArray(memoryEvidence.memoryRecordId, records.map((row) => row.id)))) : [];
        return { schema: "memory_export.v1" as const, companyId, exportedAt: new Date().toISOString(), records, evidence };
      });
    },

    forgetSource: async (companyId: string, input: unknown, actor: MemoryMutationActor) => {
      requireHumanOrSystem(actor, "delete source-derived");
      const parsed = memorySourceDeletionInputSchema.parse(input);
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertPrivacyManagement(scopedDb, companyId, actor);
        await lockMemoryPrivacy(scopedDb, companyId);
        const key = memoryDeletionKey(companyId, "source", [parsed.sourceProvider, parsed.sourceRef]);
        await scopedDb.insert(memoryDeletionMarkers).values({ companyId, key, kind: "source" }).onConflictDoNothing();
        const evidence = await scopedDb.select({ id: memoryEvidence.memoryRecordId }).from(memoryEvidence).where(and(
          eq(memoryEvidence.companyId, companyId), eq(memoryEvidence.sourceProvider, parsed.sourceProvider), eq(memoryEvidence.sourceRef, parsed.sourceRef)));
        const deleted = await purgeMemoryRecords(scopedDb, companyId, evidence.map((row) => row.id));
        publications.push(await persistMemoryActivity(scopedDb, actor, { companyId, action: "memory.source_deleted", recordId: companyId,
          details: { sourceDigest: key, deletedRecordCount: deleted.deletedRecordCount } }));
        return { deletedRecordCount: deleted.deletedRecordCount, sourceDigest: key };
      });
      publications.forEach(publishActivity);
      return result;
    },

    getRetentionPolicy: async (companyId: string, actor: MemoryMutationActor) => {
      requireHumanOrSystem(actor, "inspect retention for");
      await assertActorCompanyScope(db, companyId, actor);
      const [policy] = await db.select().from(memoryRetentionPolicies).where(eq(memoryRetentionPolicies.companyId, companyId));
      let canManage = actor.principal.type === "system";
      if (actor.principal.type === "user") {
        const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.principal.userId), eq(companyMemberships.status, "active")));
        canManage = ["owner", "admin"].includes(membership?.membershipRole ?? "");
      }
      return { companyId, maxAgeDays: policy?.maxAgeDays ?? null, canManage };
    },

    setRetentionPolicy: async (companyId: string, input: unknown, actor: MemoryMutationActor) => {
      requireHumanOrSystem(actor, "configure retention for");
      const policy = memoryRetentionPolicyInputSchema.parse(input);
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async (tx) => {
        const scopedDb = tx as unknown as Db;
        await assertPrivacyManagement(scopedDb, companyId, actor);
        await lockMemoryPrivacy(scopedDb, companyId);
        const [stored] = await scopedDb.insert(memoryRetentionPolicies).values({ companyId, ...policy })
          .onConflictDoUpdate({ target: memoryRetentionPolicies.companyId, set: { ...policy, updatedAt: new Date() } }).returning();
        publications.push(await persistMemoryActivity(scopedDb, actor, { companyId, action: "memory.retention_policy_updated", recordId: companyId,
          details: { maxAgeDays: stored!.maxAgeDays } }));
        return stored!;
      });
      publications.forEach(publishActivity);
      return result;
    },

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
            memoryPayloadVisible(),
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
            memoryPayloadVisible(),
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

    createCompanyBinding: async (
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
      await assertSaasDomainAdmission(db, companyId, "memory.use");

      try {
        return await db.transaction(async (tx) => {
          const [binding] = await tx
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
          if (!binding) {
            throw new Error("Memory binding insert returned no row");
          }
          await tx.insert(memoryBindingTargets).values({
            companyId,
            bindingId: binding.id,
            targetType: "company",
            targetId: companyId,
          });
          return binding;
        });
      } catch (error) {
        if (isUniqueViolation(error, "memory_bindings_company_key_uq")) {
          throw conflict("Memory binding key already exists", {
            code: "memory_binding_key_conflict",
          });
        }
        throw error;
      }
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
      await assertSaasDomainAdmission(db, companyId, "memory.use");
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
      await assertSaasDomainAdmission(db, companyId, "memory.use");
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

    createPrivateMemory: async (
      companyId: string,
      ownerAgentId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryPrivateInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid private memory", parsed.error.issues);
      }
      assertPrivateMemoryWriter(ownerAgentId, actor);

      const operationFingerprint = memoryOperationFingerprint({
        ownerAgentId,
        input: {
          ...parsed.data,
          metadata: metadataForOperationFingerprint(
            rawInput,
            parsed.data.metadata,
          ),
        },
      });
      const candidate: MemoryCandidateInputParsed = {
        ...parsed.data,
        scope: { type: "agent", id: ownerAgentId },
        ownerAgentId,
        metadata: {
          ...parsed.data.metadata,
          privateOperationFingerprint: operationFingerprint,
        },
      };

      const publications: ActivityPublication[] = [];
      const record = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockMemoryOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        const existing = await memoryRecordForOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        if (existing) {
          if (
            existing.scopeType !== "agent" ||
            existing.ownerAgentId !== ownerAgentId ||
            metadataFingerprint(existing, "privateOperationFingerprint") !==
              operationFingerprint
          ) {
            throw conflict("Memory operation id was reused with different private-memory input", {
              code: "memory_operation_conflict",
              operationId: parsed.data.createdByOperationId,
            });
          }
          return existing;
        }

        const created = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          null,
          {
            reviewState: "accepted",
            verificationState: "unverified",
          },
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.private_created",
            recordId: created.id,
            details: {
              ownerAgentId,
              memoryType: created.memoryType,
            },
          }),
        );
        return created;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, record.id))!;
    },

    correctPrivateMemory: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
    ) => {
      const parsed = memoryPrivateCorrectionInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid private memory correction", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const corrected = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");

        const source = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              eq(memoryRecords.scopeType, "agent"),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!source) throw notFound("Private memory record not found");
        assertPrivateMemoryReadAllowed(source, actor);
        if (!source.ownerAgentId) {
          throw conflict("Private memory owner is missing", {
            code: "private_memory_owner_missing",
          });
        }
        assertPrivateMemoryWriter(source.ownerAgentId, actor);

        const operationFingerprint = memoryOperationFingerprint({
          sourceRecordId: source.id,
          input: {
            ...parsed.data,
            metadata: metadataForOperationFingerprint(
              rawInput,
              parsed.data.metadata,
            ),
          },
        });
        await lockMemoryOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        const existing = await memoryRecordForOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        if (existing) {
          if (
            existing.scopeType !== "agent" ||
            existing.ownerAgentId !== source.ownerAgentId ||
            existing.supersedesRecordId !== source.id ||
            metadataFingerprint(existing, "privateCorrectionFingerprint") !==
              operationFingerprint
          ) {
            throw conflict("Memory operation id was reused with different private correction input", {
              code: "memory_operation_conflict",
              operationId: parsed.data.createdByOperationId,
            });
          }
          return existing;
        }

        const now = new Date();
        if (
          source.reviewState !== "accepted" ||
          source.retentionState !== "active" ||
          source.revokedAt ||
          source.supersededByRecordId ||
          (source.validFrom && source.validFrom.getTime() > now.getTime()) ||
          (source.validUntil && source.validUntil.getTime() <= now.getTime()) ||
          (source.expiresAt && source.expiresAt.getTime() <= now.getTime())
        ) {
          throw conflict("Only current active private memory can be corrected", {
            code: "private_memory_not_correctable",
          });
        }

        const candidate: MemoryCandidateInputParsed = {
          bindingId: source.bindingId,
          memoryType: parsed.data.memoryType,
          scope: { type: "agent", id: source.ownerAgentId },
          subject: parsed.data.subject,
          ownerAgentId: source.ownerAgentId,
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
            privateCorrectionFingerprint: operationFingerprint,
          },
          evidence: parsed.data.evidence,
        };

        const next = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          source.id,
          {
            reviewState: "accepted",
            verificationState: "unverified",
          },
        );
        const [superseded] = await txDb
          .update(memoryRecords)
          .set({
            supersededByRecordId: next.id,
            retentionState: "superseded",
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, source.id),
              isNull(memoryRecords.supersededByRecordId),
              eq(memoryRecords.retentionState, "active"),
            ),
          )
          .returning({ id: memoryRecords.id });
        if (!superseded) {
          throw conflict("Private memory changed before correction could commit", {
            code: "private_memory_correction_conflict",
          });
        }

        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.private_corrected",
            recordId: next.id,
            details: {
              supersedesRecordId: source.id,
              ownerAgentId: source.ownerAgentId,
            },
          }),
        );
        return next;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, corrected.id))!;
    },

    sharePrivateMemory: async (
      companyId: string,
      recordId: string,
      rawInput: unknown,
      actor: MemoryMutationActor,
      internalContext: SharePrivateMemoryInternalContext = {},
    ) => {
      const parsed = memoryShareInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable("Invalid private memory share", parsed.error.issues);
      }

      const publications: ActivityPublication[] = [];
      const shared = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");

        const source = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              eq(memoryRecords.scopeType, "agent"),
              memoryPayloadVisible(),
            ),
          )
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!source) throw notFound("Private memory record not found");

        assertPrivateMemoryReadAllowed(source, actor);
        if (!source.ownerAgentId) {
          throw conflict("Private memory owner is missing", {
            code: "private_memory_owner_missing",
          });
        }

        const operationFingerprint = memoryOperationFingerprint({
          sourceRecordId: source.id,
          targetBindingId: parsed.data.targetBindingId,
          targetScope: parsed.data.targetScope,
          reason: parsed.data.reason,
          createdByOperationId: parsed.data.createdByOperationId,
          operationContextFingerprint:
            internalContext.operationContextFingerprint ?? null,
        });
        await lockMemoryOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        const existing = await memoryRecordForOperation(
          txDb,
          companyId,
          parsed.data.createdByOperationId,
        );
        if (existing) {
          if (
            existing.scopeType === "agent" ||
            metadataFingerprint(existing, "shareOperationFingerprint") !==
              operationFingerprint
          ) {
            throw conflict("Memory operation id was reused with different share input", {
              code: "memory_operation_conflict",
              operationId: parsed.data.createdByOperationId,
            });
          }
          return existing;
        }

        const now = new Date();
        if (
          source.reviewState !== "accepted" ||
          source.retentionState !== "active" ||
          source.revokedAt ||
          source.supersededByRecordId ||
          (source.validFrom && source.validFrom.getTime() > now.getTime()) ||
          (source.validUntil && source.validUntil.getTime() <= now.getTime()) ||
          (source.expiresAt && source.expiresAt.getTime() <= now.getTime())
        ) {
          throw conflict("Only current active private memory can be shared", {
            code: "private_memory_not_shareable",
          });
        }
        const candidate: MemoryCandidateInputParsed = {
          bindingId: parsed.data.targetBindingId,
          memoryType: source.memoryType as MemoryCandidateInputParsed["memoryType"],
          scope: parsed.data.targetScope,
          subject:
            source.subjectType && source.subjectId
              ? { type: source.subjectType, id: source.subjectId }
              : null,
          ownerAgentId: null,
          title: source.title,
          content: source.content,
          summary: source.summary,
          sensitivity:
            source.sensitivityLabel as MemoryCandidateInputParsed["sensitivity"],
          importance: source.importance,
          confidenceScore: source.confidenceScore,
          validFrom: source.validFrom?.toISOString() ?? null,
          validUntil: source.validUntil?.toISOString() ?? null,
          observedAt: source.observedAt.toISOString(),
          retentionPolicy: source.retentionPolicy,
          expiresAt: source.expiresAt?.toISOString() ?? null,
          createdByOperationId: parsed.data.createdByOperationId,
          metadata: {
            promotedFromPrivateRecordId: source.id,
            promotedFromOwnerAgentId: source.ownerAgentId,
            promotionReason: parsed.data.reason,
            shareOperationFingerprint: operationFingerprint,
            shareOperationContextFingerprint:
              internalContext.operationContextFingerprint ?? null,
          },
          evidence: [
            {
              sourceClass: "private_memory",
              sourceProvider: "august_works_memory",
              sourceType: "memory_record",
              sourceRef: `memory://private/${source.id}`,
              sourceVersion: source.updatedAt.toISOString(),
              sourceUpdatedAt: source.updatedAt.toISOString(),
              observedAt: now.toISOString(),
              excerptHash: createHash("sha256")
                .update(source.content)
                .digest("hex"),
              citation: { label: "Agent-private memory" },
              trustLevel: privateMemoryEvidenceTrust(source.verificationState),
              relation: "supports",
            },
            ...(internalContext.additionalEvidence ?? []),
          ],
        };

        const created = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          null,
        );
        publications.push(
          await persistMemoryActivity(txDb, actor, {
            companyId,
            action: "memory.share_candidate_created",
            recordId: created.id,
            details: {
              sourcePrivateRecordId: source.id,
              ownerAgentId: source.ownerAgentId,
              targetScopeType: created.scopeType,
              targetScopeId: created.scopeId,
            },
          }),
        );
        return created;
      });
      publications.forEach(publishActivity);
      return (await getRecordDetail(db, companyId, shared.id))!;
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
      const outcome = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;

        // Authorize before classification so the resolver can never become a
        // cross-tenant or cross-scope record oracle.
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertScopeReferences(txDb, companyId, parsed.data);
        await assertAgentPrivateOwnership(parsed.data, actor);
        await assertBindingAllowsCandidate(txDb, companyId, parsed.data);
        await assertMemorySourcesRetained(txDb, companyId, parsed.data.evidence);

        // Preserve the existing operation-id contract before semantic
        // resolution. Reusing one operation id with any prior persisted record
        // remains a conflict even when the new payload happens to be similar.
        if (parsed.data.createdByOperationId) {
          await lockMemoryOperation(
            txDb,
            companyId,
            parsed.data.createdByOperationId,
          );
          const existingOperation = await memoryRecordForOperation(
            txDb,
            companyId,
            parsed.data.createdByOperationId,
          );
          if (existingOperation) {
            throw conflict(
              "Memory operation id is already associated with a record",
              {
                code: "memory_operation_conflict",
                operationId: parsed.data.createdByOperationId,
                existingRecordId: existingOperation.id,
              },
            );
          }
        }

        await lockMemoryResolution(txDb, companyId, parsed.data);
        const resolution = await resolveMemoryCandidate(
          txDb,
          companyId,
          parsed.data,
        );

        const attachesToExistingPendingContradiction =
          resolution.metadata.kind === "contradiction" &&
          resolution.metadata.reasonCode ===
            "contradicting_evidence_against_pending_equivalent_claim";

        if (
          resolution.metadata.kind === "duplicate" ||
          resolution.metadata.kind === "corroboration" ||
          attachesToExistingPendingContradiction
        ) {
          const target = resolution.target;
          if (!target) {
            throw new Error(
              `Memory ${resolution.metadata.kind} resolution is missing its target record`,
            );
          }

          if (
            resolution.metadata.kind === "corroboration" ||
            attachesToExistingPendingContradiction
          ) {
            await insertEvidenceRows(
              txDb,
              companyId,
              target.id,
              resolution.novelEvidence,
            );

            publications.push(
              await persistMemoryActivity(txDb, actor, {
                companyId,
                action:
                  resolution.metadata.kind === "corroboration"
                    ? "memory.corroborated"
                    : "memory.contradiction_attached",
                recordId: target.id,
                details: { resolution: resolution.metadata },
              }),
            );
          }

          return { recordId: target.id, resolution: resolution.metadata };
        }

        const supersedesRecordId =
          resolution.metadata.kind === "update" ||
          resolution.metadata.kind === "contradiction"
            ? resolution.target?.id ?? null
            : null;
        if (
          (resolution.metadata.kind === "update" ||
            resolution.metadata.kind === "contradiction") &&
          !supersedesRecordId
        ) {
          throw new Error(
            `Memory ${resolution.metadata.kind} resolution is missing its target record`,
          );
        }

        const candidate: MemoryCandidateInputParsed = {
          ...parsed.data,
          metadata: {
            ...parsed.data.metadata,
            memoryResolution: resolution.metadata,
          },
        };
        const created = await insertCandidate(
          txDb,
          companyId,
          candidate,
          actor,
          supersedesRecordId,
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
              resolution: resolution.metadata,
            },
          }),
        );
        return { recordId: created.id, resolution: resolution.metadata };
      });
      publications.forEach(publishActivity);

      const detail = await getRecordDetail(db, companyId, outcome.recordId);
      if (!detail) {
        throw new Error("Resolved Memory candidate record is unavailable");
      }
      return withResolution(detail, outcome.resolution);
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
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");
        const existing = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              memoryPayloadVisible(),
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
      await assertSaasDomainAdmission(txDb, companyId, "memory.use");
        const record = await txDb
          .select()
          .from(memoryRecords)
          .where(
            and(
              eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.id, recordId),
              memoryPayloadVisible(),
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
                memoryPayloadVisible(),
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
            .set({
              supersededByRecordId: record.id,
              retentionState: "superseded",
              updatedAt: now,
            })
            .where(
              and(
                eq(memoryRecords.companyId, companyId),
                eq(memoryRecords.id, prior.id),
              ),
            );
          await invalidateCognitiveRecords(txDb, companyId, [prior.id]);
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
              memoryPayloadVisible(),
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
          await invalidateCognitiveRecords(txDb, companyId, [record.id]);
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
            memoryPayloadVisible(),
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
        .orderBy(desc(memoryRecords.observedAt))
        .limit(limit);
    },
  };
}
