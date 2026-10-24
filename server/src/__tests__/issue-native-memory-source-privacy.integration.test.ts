import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, contextManifestMemoryRoots, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issuePrivacySources, issues } from "@paperclipai/db";
import { companySearchExtractQuerySchema, companySearchQuerySchema, type ContextAuthorityDecision } from "@paperclipai/shared";
import { contextManifestService } from "../services/context/context-manifest.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { canActorReadMemorySources } from "../services/memory/memory-privacy.js";
import { authorizationService, canActorReadIssuePrivacy, issueReadSqlCondition, projectReadSqlCondition } from "../services/authorization.js";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { issueService } from "../services/issues.js";
import { companySearchService } from "../services/company-search.js";
import { companySearchExtractService } from "../services/company-search-extract.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native Task derivatives retain their producer's selected private Memory restriction", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-task-private-memory-source-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  it("withholds copied private Memory content from another Human before list, count, search and extraction", async () => {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
    const agentId = randomUUID(), runId = randomUUID(), sourceTaskId = randomUUID();
    const canary = `privatememorycopy${randomUUID().replaceAll("-", "")}`;
    await db.insert(companies).values({ id: companyId, name: "Retained Memory derivative", issuePrefix: `PM${companyId.slice(0, 6)}` });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Current Human",
      email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId,
      principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Native producer", role: "engineer",
      status: "idle", adapterType: "paperclip_runner" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(issues).values({ id: sourceTaskId, companyId, title: "Public native source task",
      visibility: "open", responsibleUserId: aliceId, createdByUserId: aliceId, assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId,
      nativeIssueId: sourceTaskId, contextSnapshot: { issueId: sourceTaskId }, runtimeMode: "native", status: "running" });
    await initializeRunIdentity(db, { companyId, runId, responsibleUserId: aliceId, issueId: sourceTaskId, cause: "dispatch" });
    const memory = memoryService(db);
    const alice = { principal: { type: "user" as const, userId: aliceId } };
    const producer: MemoryMutationActor = { principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId };
    const binding = await memory.createCompanyBinding(companyId, { key: randomUUID(), name: "Private source", providerKey: "local" }, alice);
    await memory.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, alice);
    const source = await memory.createPrivateMemory(companyId, agentId, { bindingId: binding.id,
      memoryType: "lesson", title: "Private source lesson", content: canary, summary: null, sensitivity: "internal",
      observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
      createdByOperationId: randomUUID(), evidence: [{ sourceClass: "task", sourceProvider: "fixture",
        sourceType: "verified_fixture", sourceRef: `issue://${sourceTaskId}`, sourceVersion: "1", sourceUpdatedAt: null,
        observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(canary).digest("hex"),
        citation: { label: "Verified native source" }, trustLevel: "low", relation: "supports" }] }, producer);
    const version = source.record.updatedAt.toISOString();
    const decision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority",
      evidence: { id: `memory:${source.record.id}`, companyId, sourceClass: "private_memory",
        sourceProvider: "august_works_memory", sourceType: "memory_record", sourceRef: `memory://record/${source.record.id}`,
        sourceVersion: version, sourceUpdatedAt: version, title: source.record.title, excerpt: source.record.content,
        observedAt: source.record.observedAt.toISOString(), validFrom: null, validUntil: null, authorityDomain: null,
        trustLevel: "low", sensitivity: "internal", citation: { label: "Actual private Memory" }, metadata: {} } };
    await contextManifestService(db).create({ companyId, agentId, runId, issueId: sourceTaskId,
      responsibleUserId: aliceId, query: "Actual selected private source", policySnapshot: {}, selected: [{ decision }] });
    const roots = await db.select().from(contextManifestMemoryRoots).where(and(
      eq(contextManifestMemoryRoots.companyId, companyId), eq(contextManifestMemoryRoots.memoryRecordId, source.record.id)));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.sourceVersion).toBe(version);
    const bob = { type: "board" as const, userId: bobId, source: "session" as const };
    expect(await canActorReadMemorySources(db, companyId, bob, source.record.id)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, bob, { companyId, id: sourceTaskId })).toBe(true);
    const selected = await memory.get(companyId, source.record.id, producer);
    expect(selected?.record.content).toBe(canary);
    const tasks = issueService(db);
    const child = await tasks.create(companyId, { title: `Derived ${selected!.record.content}`,
      description: `Copied retained source: ${selected!.record.content}`, status: "todo",
      createdByAgentId: agentId, actorRunId: runId, actorResponsibleUserId: aliceId });
    const retained = await db.select().from(issuePrivacySources).where(and(
      eq(issuePrivacySources.companyId, companyId), eq(issuePrivacySources.issueId, child.id)));
    expect(child.originRunId).toBe(runId);
    expect(retained).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKind: "run", sourceId: runId })]));
    const aliceReader = { type: "board" as const, source: "session" as const, userId: aliceId };
    expect(await canActorReadIssuePrivacy(db, aliceReader, child)).toBe(true);
    const ownerSearch = await companySearchService(db).search(companyId,
      companySearchQuerySchema.parse({ q: "privatememorycopy", scope: "issues" }),
      { issueReadCondition: await issueReadSqlCondition(db, aliceReader) });
    expect(ownerSearch.results.map(row => row.id)).toContain(child.id);
    expect(JSON.stringify(ownerSearch.results)).toContain(canary);

    // Qualify actual native provenance before asserting any read leak. No client
    // metadata, guessed privacy label, or fabricated retained edge supplies it.
    const readCondition = await issueReadSqlCondition(db, bob);
    const listed = await tasks.list(companyId, { readCondition });
    const count = await tasks.count(companyId, { readCondition });
    const search = await companySearchService(db).search(companyId,
      // Search for the public prefix, so the full secret cannot appear merely
      // because the response echoes the caller's own query.
      companySearchQuerySchema.parse({ q: "privatememorycopy", scope: "issues" }), { issueReadCondition: readCondition,
        projectReadCondition: await projectReadSqlCondition(db, bob) });
    const extracted = await companySearchExtractService(db).extract(companyId,
      companySearchExtractQuerySchema.parse({ contains: canary }), { issueReadCondition: readCondition });
    expect.soft(listed.map(row => row.id)).not.toContain(child.id);
    expect.soft(JSON.stringify(listed)).not.toContain(canary);
    expect.soft(count).toBe(1);
    expect.soft(search.countsByType.issue).toBe(0);
    expect.soft(search.results).toEqual([]);
    expect.soft(JSON.stringify(search)).not.toContain(canary);
    expect.soft(extracted.results).toEqual([]);
    expect.soft(extracted.hasMore).toBe(false);
    const detailAllowed = (await authorizationService(db).decide({ actor: bob, action: "issue:read",
      resource: { type: "issue", companyId, issueId: child.id }, enforceResponsibleUserIntersection: true })).allowed;
    expect.soft(detailAllowed).toBe(false);
    if (detailAllowed) {
      // This is the original detail payload owner, not an HTTP status assertion.
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, bob, { issueId: child.id }))
        .rejects.toMatchObject({ status: 403 });
    }
  });
});
