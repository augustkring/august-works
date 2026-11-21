import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, memoryEvidence, memoryRecords } from "@paperclipai/db";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { contextManifestService } from "../services/context/context-manifest.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native Memory resolution preserves private lineage without self-corruption", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, aliceId: string, bobId: string, agentId: string, otherAgentId: string;
  let runId: string, bobRunId: string, otherAgentRunId: string;
  let service: ReturnType<typeof memoryService>;
  const actor = (): MemoryMutationActor => ({ principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId });
  const human = (): MemoryMutationActor => ({ principal: { type: "user", userId: aliceId } });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-memory-resolver-lineage-");
    db = createDb(database.connectionString, { maxConnections: 3 }); service = memoryService(db);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    companyId = randomUUID(); aliceId = randomUUID(); bobId = randomUUID(); agentId = randomUUID(); otherAgentId = randomUUID();
    runId = randomUUID(); bobRunId = randomUUID(); otherAgentRunId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Resolver lineage", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Reader", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId, principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(agents).values([agentId, otherAgentId].map(id => ({ id, companyId, name: "Worker", role: "engineer", status: "idle", adapterType: "paperclip_runner" })));
    await db.insert(heartbeatRuns).values([
      { id: runId, companyId, agentId, responsibleUserId: aliceId, status: "running", runtimeMode: "native" },
      { id: bobRunId, companyId, agentId, responsibleUserId: bobId, status: "running", runtimeMode: "native" },
      { id: otherAgentRunId, companyId, agentId: otherAgentId, responsibleUserId: aliceId, status: "running", runtimeMode: "native" },
    ]);
  });
  function evidence(label: string) {
    return { sourceClass: "task" as const, sourceProvider: "native_resolver_fixture", sourceType: "reviewed_outcome", sourceRef: `outcome://${label}`,
      sourceVersion: "1", sourceUpdatedAt: null, observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(label).digest("hex"),
      citation: { label }, trustLevel: "low" as const, relation: "supports" as const };
  }
  async function sharedPrivate(content = "PRIVATE original lesson") {
    const binding = await service.createCompanyBinding(companyId, { key: randomUUID(), name: "Native fixture", providerKey: "local" }, human());
    await service.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, human());
    const original = await service.createPrivateMemory(companyId, agentId, {
      bindingId: binding.id, memoryType: "lesson", title: content, content, summary: null, sensitivity: "internal",
      validFrom: null, validUntil: null, expiresAt: null, observedAt: new Date().toISOString(), createdByOperationId: randomUUID(), evidence: [evidence(content)],
    }, actor());
    const shared = await service.sharePrivateMemory(companyId, original.record.id, {
      targetBindingId: binding.id, targetScope: { type: "company", id: null }, reason: "Human review without source release", createdByOperationId: randomUUID(),
    }, actor());
    const accepted = await service.reviewCandidate(companyId, shared.record.id, { decision: "accept" }, human());
    return { original: original.record, detail: accepted };
  }
  type Detail = NonNullable<Awaited<ReturnType<typeof service.get>>>;
  function candidate(detail: Detail, novel = false) {
    const row = detail.record;
    return { bindingId: row.bindingId, memoryType: row.memoryType, scope: { type: row.scopeType, id: row.scopeId }, ownerAgentId: null,
      subject: row.subjectType ? { type: row.subjectType, id: row.subjectId! } : null,
      title: row.title, content: row.content, summary: row.summary, sensitivity: row.sensitivityLabel,
      validFrom: row.validFrom?.toISOString() ?? null, validUntil: row.validUntil?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
      observedAt: row.observedAt.toISOString(), createdByOperationId: null,
      evidence: [...detail.evidence.map(item => ({ sourceClass: item.sourceClass, sourceProvider: item.sourceProvider, sourceType: item.sourceType,
        sourceRef: item.sourceRef, sourceVersion: item.sourceVersion, sourceUpdatedAt: item.sourceUpdatedAt?.toISOString() ?? null,
        observedAt: item.observedAt.toISOString(), excerptHash: item.excerptHash, citation: item.citationJson, trustLevel: item.trustLevel, relation: item.supportsOrContradicts })),
        ...(novel ? [evidence("independent corroboration")] : [])],
    };
  }
  async function selectMemory(detail: Detail) {
    const row = detail.record;
    const decision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority", evidence: {
      id: `memory:${row.id}`, companyId, sourceClass: "accepted_memory", sourceProvider: "august_works_memory", sourceType: "memory_record",
      sourceRef: `memory://record/${row.id}`, sourceVersion: row.updatedAt.toISOString(), sourceUpdatedAt: row.updatedAt.toISOString(),
      title: row.title, excerpt: row.content, observedAt: row.observedAt.toISOString(), validFrom: null, validUntil: null,
      authorityDomain: null, trustLevel: "high", sensitivity: "internal", citation: { label: "Reviewed Memory" }, metadata: {},
    } };
    await contextManifestService(db).create({ companyId, agentId, runId, responsibleUserId: aliceId, query: "Native retained Memory", policySnapshot: {}, selected: [{ decision }] });
  }
  async function retainedPrivateReaders(id: string, originalId: string) {
    await expect(service.get(companyId, id, actor())).resolves.toMatchObject({ record: { id, sourceMemoryIds: expect.arrayContaining([originalId]) } });
    await expect(service.get(companyId, id, { principal: { type: "agent", agentId, responsibleUserId: bobId }, runId: bobRunId })).resolves.toBeNull();
    await expect(service.get(companyId, id, { principal: { type: "agent", agentId: otherAgentId, responsibleUserId: aliceId }, runId: otherAgentRunId })).resolves.toBeNull();
  }

  it.each([false, true])("does not commit a self-root after native Context then duplicate/corroboration (novel=%s)", async novel => {
    const { original, detail } = await sharedPrivate();
    await selectMemory(detail);
    const outcome = await service.createCandidate(companyId, candidate(detail, novel), actor()).then(value => ({ value }), error => ({ error }));
    const [persisted] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, detail.record.id));
    // Inspect the committed row even when the post-transaction response fails.
    expect(persisted!.sourceMemoryIds).not.toContain(persisted!.id);
    expect(outcome).toMatchObject({ value: { record: { id: detail.record.id }, resolution: { kind: novel ? "corroboration" : "duplicate" } } });
    if (!novel) expect(persisted!.updatedAt).toEqual(detail.record.updatedAt);
    const storedEvidence = await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, detail.record.id));
    expect(storedEvidence).toHaveLength(detail.evidence.length + (novel ? 1 : 0));
    await retainedPrivateReaders(detail.record.id, original.id);
  });

  it("keeps fresh private authority consequences even when the claim and evidence duplicate", async () => {
    const first = await sharedPrivate(), extra = await sharedPrivate("PRIVATE additional authority root");
    await selectMemory(first.detail); await selectMemory(extra.detail);
    const outcome = await service.createCandidate(companyId, candidate(first.detail), actor()).then(value => ({ value }), error => ({ error }));
    const [persisted] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, first.detail.record.id));
    expect(persisted!.sourceMemoryIds).not.toContain(persisted!.id);
    expect(persisted!.sourceMemoryIds).toContain(extra.detail.record.id);
    expect(outcome).toMatchObject({ value: { record: { id: first.detail.record.id } } });
    await retainedPrivateReaders(first.detail.record.id, first.original.id);
    await service.forget(companyId, extra.detail.record.id, human());
    expect(await service.get(companyId, first.detail.record.id, actor())).toBeNull();
  });

  it("rejects in-place attachment through a distinct native descendant without corrupting the target", async () => {
    const { original, detail } = await sharedPrivate();
    await selectMemory(detail);
    const descendant = await service.createCandidate(companyId, {
      ...candidate(detail), title: "A distinct descendant", content: "Different PRIVATE descendant payload", evidence: [evidence("descendant")],
    }, actor());
    expect(descendant.record.sourceMemoryIds).toContain(detail.record.id);
    const accepted = await service.reviewCandidate(companyId, descendant.record.id, { decision: "accept" }, human());
    await selectMemory(accepted);
    const beforeEvidence = await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, detail.record.id));
    const outcome = await service.createCandidate(companyId, candidate(detail, true), actor()).then(value => ({ value }), error => ({ error }));
    const [persisted] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, detail.record.id));
    expect(persisted).toEqual(detail.record);
    expect(await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, detail.record.id))).toEqual(beforeEvidence);
    expect(outcome).toMatchObject({ error: { status: 409 } });
    await retainedPrivateReaders(detail.record.id, original.id);
  });

  it("does not treat an internal target UUID as a native selected-target receipt", async () => {
    const { original, detail } = await sharedPrivate();
    const outcome = await service.createCandidate(companyId, candidate(detail), actor(), [detail.record.id])
      .then(value => ({ value }), error => ({ error }));
    const [persisted] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, detail.record.id));
    expect(outcome).toMatchObject({ error: { status: 409, details: { code: "memory_resolution_source_conflict" } } });
    expect(persisted).toEqual(detail.record);
    expect(await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, detail.record.id))).toEqual(detail.evidence);
    await retainedPrivateReaders(detail.record.id, original.id);
  });

  it("refuses an older Context receipt after actual native corroboration on another run", async () => {
    const { original, detail } = await sharedPrivate();
    await selectMemory(detail);
    const secondRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: secondRunId, companyId, agentId, responsibleUserId: aliceId,
      status: "running", runtimeMode: "native" });
    const updated = await service.createCandidate(companyId, candidate(detail, true), {
      principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId: secondRunId,
    });
    expect(updated.resolution.kind).toBe("corroboration");
    expect(updated.record.updatedAt.getTime()).toBeGreaterThan(detail.record.updatedAt.getTime());
    const outcome = await service.createCandidate(companyId, candidate(updated), actor())
      .then(value => ({ value }), error => ({ error }));
    const [persisted] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, detail.record.id));
    expect(outcome).toMatchObject({ error: { status: 409, details: { code: "memory_resolution_source_conflict" } } });
    expect(persisted).toEqual(updated.record);
    expect(await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, detail.record.id))).toEqual(updated.evidence);
    await retainedPrivateReaders(detail.record.id, original.id);
  });
});
