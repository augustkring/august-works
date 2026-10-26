import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, authUsers, companies, companyMemberships, createDb, heartbeatRuns, memoryBindingTargets, memoryBindings,
  memoryEvidence, memoryRecords, principalPermissionGrants } from "@paperclipai/db";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import type { ContextAuthorityDecision, MemoryCandidateInputParsed } from "@paperclipai/shared";
import { contextManifestService } from "../services/context/context-manifest.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService } from "../services/memory/memory-service.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Memory revocation preserves only a still-valid body snapshot", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-memory-revocation-source-binding-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function bindMemory(companyId: string, recordId: string) {
    // Structural body binding only; this does not claim source completeness.
    await db.execute(sql`update memory_records target set payload_source_snapshot=(
      select content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) from (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','memory_record','companyId',target.company_id,
          'id',target.id,'contentHash',public.aw_native_payload_body_hash('memory_record',to_jsonb(target))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as content
      ) body
    ) where target.company_id=${companyId}::uuid and target.id=${recordId}::uuid`);
  }

  async function seed() {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Memory revocation binding", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Memory owner", email: `${userId}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Memory fixture agent", role: "engineer",
      status: "idle", adapterType: "paperclip_runner" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId,
      status: "active", membershipRole: "member" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: agentId,
      permissionKey: "company_scope:read" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: userId,
      status: "running", runtimeMode: "native" });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: randomUUID(), name: "Native binding", providerKey: "local" }).returning();
    await db.insert(memoryBindingTargets).values([
      { companyId, bindingId: binding!.id, targetType: "company", targetId: companyId },
      { companyId, bindingId: binding!.id, targetType: "agent", targetId: agentId },
    ]);

    const records = await db.insert(memoryRecords).values([
      { companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson", scopeType: "company",
        title: "Changed revocation reason", content: "A reviewed memory claim", summary: "Reviewed claim",
        reviewState: "accepted", verificationState: "human_verified", observedAt: new Date(), sourceProvenanceQualified: true,
        createdByActorType: "user", createdByActorId: userId, payloadSourceProtocolVersion: 1 },
      { companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson", scopeType: "company",
        title: "Unchanged revocation reason", content: "Another reviewed memory claim", summary: "Reviewed claim",
        reviewState: "accepted", verificationState: "human_verified", revokedAt: new Date(),
        revokedByActorType: "user", revokedByActorId: userId, revocationReason: "Already reviewed",
        observedAt: new Date(), sourceProvenanceQualified: true, createdByActorType: "user", createdByActorId: userId,
        payloadSourceProtocolVersion: 1 },
    ]).returning();

    for (const record of records) await bindMemory(companyId, record.id);
    const current = await db.select().from(memoryRecords).where(eq(memoryRecords.companyId, companyId));
    return { companyId, userId, agentId, runId, bindingId: binding!.id,
      changed: current.find(row => row.title === "Changed revocation reason")!,
      unchanged: current.find(row => row.title === "Unchanged revocation reason")! };
  }

  it("clears the snapshot on first revocation and preserves it on an idempotent repeat", async () => {
    const { companyId, userId, changed, unchanged } = await seed();
    const service = memoryService(db);
    const actor = { principal: { type: "user" as const, userId } };
    const preserved = unchanged.payloadSourceSnapshot;
    expect(preserved).not.toBeNull();
    const unchangedResult = await service.revoke(companyId, unchanged.id, { reason: "Repeated request" }, actor);
    expect(unchangedResult.record.revokedAt).toBeInstanceOf(Date);
    expect(unchangedResult.record).toMatchObject({ revocationReason: "Already reviewed", payloadSourceSnapshot: preserved,
      payloadSourceSnapshotInvalidated: false });
    expect(unchangedResult.record.payloadSourceSnapshot).not.toBeNull();

    const changedResult = await service.revoke(companyId, changed.id, { reason: "New reviewed reason" }, actor);
    expect(changedResult.record.revokedAt).toBeInstanceOf(Date);
    expect(changedResult.record).toMatchObject({ revocationReason: "New reviewed reason", payloadSourceSnapshot: null,
      payloadSourceSnapshotInvalidated: true });
  });

  it("rolls back an ordinary duplicate when a new native Context root would invalidate its claim snapshot", async () => {
    const { companyId, userId, agentId, runId, bindingId } = await seed();
    const observedAt = new Date();
    const [target] = await db.insert(memoryRecords).values({ companyId, bindingId, providerKey: "local", memoryType: "lesson",
      scopeType: "company", title: "Retained target claim", content: "The exact reviewed claim", summary: "Target summary",
      reviewState: "accepted", verificationState: "human_verified", sensitivityLabel: "internal", observedAt,
      sourceProvenanceQualified: true, createdByActorType: "user", createdByActorId: userId, payloadSourceProtocolVersion: 1 }).returning();
    const [extra] = await db.insert(memoryRecords).values({ companyId, bindingId, providerKey: "local", memoryType: "lesson",
      scopeType: "company", title: "Separate selected source", content: "A different selected Memory source", summary: "Source summary",
      reviewState: "accepted", verificationState: "human_verified", sensitivityLabel: "internal", observedAt,
      sourceProvenanceQualified: true, createdByActorType: "user", createdByActorId: userId }).returning();
    const evidence = { sourceClass: "task" as const, sourceProvider: "native_memory_binding_fixture", sourceType: "reviewed_outcome",
      sourceRef: `outcome://${target!.id}`, sourceVersion: "1", observedAt, excerptHash: "a".repeat(64),
      citationJson: { label: "Existing reviewed support" }, trustLevel: "low" as const, supportsOrContradicts: "supports" as const };
    await db.insert(memoryEvidence).values({ companyId, memoryRecordId: target!.id, ...evidence });
    const actor = { principal: { type: "agent" as const, agentId, responsibleUserId: userId }, runId };
    const manifestDecision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority",
      evidence: { id: `memory:${extra!.id}`, companyId, sourceClass: "accepted_memory", sourceProvider: "august_works_memory",
      sourceType: "memory_record", sourceRef: `memory://record/${extra!.id}`, sourceVersion: extra!.updatedAt.toISOString(),
      sourceUpdatedAt: extra!.updatedAt.toISOString(), title: extra!.title!, excerpt: extra!.content,
      observedAt: extra!.observedAt.toISOString(), validFrom: null, validUntil: null, authorityDomain: null, trustLevel: "high",
      sensitivity: "internal", citation: { label: "Actual selected Memory" }, metadata: {} } };
    await contextManifestService(db).create({ companyId, agentId, runId, responsibleUserId: userId, query: "Select another Memory root",
      policySnapshot: {}, selected: [{ decision: manifestDecision }] });
    await bindMemory(companyId, target!.id);

    const candidate: MemoryCandidateInputParsed = { bindingId, memoryType: "lesson", scope: { type: "company", id: null }, subject: null, ownerAgentId: null,
      title: target!.title!, content: target!.content, summary: target!.summary, sensitivity: "internal", importance: target!.importance,
      confidenceScore: target!.confidenceScore, validFrom: null, validUntil: null, observedAt: observedAt.toISOString(),
      retentionPolicy: "standard", expiresAt: null, createdByOperationId: null, metadata: {}, evidence: [{
        sourceClass: evidence.sourceClass, sourceProvider: evidence.sourceProvider, sourceType: evidence.sourceType,
        sourceRef: evidence.sourceRef, sourceVersion: evidence.sourceVersion, sourceUpdatedAt: null,
        observedAt: evidence.observedAt.toISOString(), excerptHash: evidence.excerptHash, citation: evidence.citationJson,
        trustLevel: evidence.trustLevel, relation: "supports",
      }] };
    const [before] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, target!.id));
    const evidenceBefore = await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, target!.id));
    const activityBefore = await db.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.companyId, companyId));
    await expect(memoryService(db).createCandidate(companyId, candidate, actor)).rejects.toMatchObject({
      status: 409, details: { code: "memory_resolution_source_conflict" },
    });
    const [updated] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, target!.id));
    const evidenceAfter = await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, target!.id));
    const activityAfter = await db.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.companyId, companyId));
    expect(updated).toEqual(before);
    expect(updated!.sourceMemoryIds).not.toContain(extra!.id);
    expect(updated!.payloadSourceSnapshot).toEqual(before!.payloadSourceSnapshot);
    expect(updated!.payloadSourceSnapshotInvalidated).toBe(false);
    expect(evidenceAfter).toEqual(evidenceBefore);
    expect(activityAfter).toEqual(activityBefore);
  });

  it("preserves the exact snapshot when a duplicate does not change retained roots", async () => {
    const { companyId, userId, bindingId } = await seed();
    const observedAt = new Date();
    const [target] = await db.insert(memoryRecords).values({ companyId, bindingId, providerKey: "local", memoryType: "lesson",
      scopeType: "company", title: "Unchanged duplicate", content: "Same claim and roots", summary: "Same summary",
      reviewState: "accepted", verificationState: "human_verified", sensitivityLabel: "internal", observedAt,
      sourceProvenanceQualified: true, createdByActorType: "user", createdByActorId: userId, payloadSourceProtocolVersion: 1 }).returning();
    const evidence = { sourceClass: "task" as const, sourceProvider: "native_memory_binding_fixture", sourceType: "reviewed_outcome",
      sourceRef: `outcome://${target!.id}`, sourceVersion: "1", observedAt, excerptHash: "b".repeat(64),
      citationJson: { label: "Existing reviewed support" }, trustLevel: "low" as const, supportsOrContradicts: "supports" as const };
    await db.insert(memoryEvidence).values({ companyId, memoryRecordId: target!.id, ...evidence });
    await bindMemory(companyId, target!.id);
    const [before] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, target!.id));
    expect(before!.payloadSourceSnapshot).not.toBeNull();
    const result = await memoryService(db).createCandidate(companyId, { bindingId, memoryType: "lesson",
      scope: { type: "company", id: null }, subject: null, ownerAgentId: null, title: target!.title!, content: target!.content,
      summary: target!.summary, sensitivity: "internal", importance: target!.importance, confidenceScore: target!.confidenceScore,
      validFrom: null, validUntil: null, observedAt: observedAt.toISOString(), retentionPolicy: "standard", expiresAt: null,
      createdByOperationId: null, metadata: {}, evidence: [{ sourceClass: evidence.sourceClass, sourceProvider: evidence.sourceProvider,
        sourceType: evidence.sourceType, sourceRef: evidence.sourceRef, sourceVersion: evidence.sourceVersion, sourceUpdatedAt: null,
        observedAt: evidence.observedAt.toISOString(), excerptHash: evidence.excerptHash, citation: evidence.citationJson,
        trustLevel: evidence.trustLevel, relation: "supports" }] }, { principal: { type: "user", userId } });
    expect(result.resolution.kind).toBe("duplicate");
    const [after] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, target!.id));
    expect(after!.payloadSourceSnapshot).not.toBeNull();
    expect(after!.payloadSourceSnapshot).toEqual(before!.payloadSourceSnapshot);
    expect(after!.payloadSourceSnapshotInvalidated).toBe(false);
  });
});
