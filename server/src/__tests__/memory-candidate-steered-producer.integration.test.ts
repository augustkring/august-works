import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issueComments, issues, memoryRecords } from "@paperclipai/db";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { contextManifestService } from "../services/context/context-manifest.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { initializeRunIdentity, reserveSteeredIdentity, acceptSteeredIdentity } from "../services/run-identity.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("New Memory candidate producer cannot copy an earlier Human's retained private Context", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-memory-steered-producer-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  it("withholds Alice's source UUID and rolls back a new derived candidate after actual native steering to Bob", async () => {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
    const agentId = randomUUID(), runId = randomUUID(), issueId = randomUUID(), operationId = randomUUID();
    const secret = "PRIVATE Alice producer-context canary";
    await db.insert(companies).values({ id: companyId, name: "Steered producer", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Human", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId, principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Native worker", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Open native work", responsibleUserId: aliceId, assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId,
      nativeIssueId: issueId, contextSnapshot: { issueId }, runtimeMode: "native", status: "running" });
    await initializeRunIdentity(db, { companyId, runId, responsibleUserId: aliceId, issueId, cause: "dispatch" });
    const actor = (responsibleUserId: string): MemoryMutationActor => ({ principal: { type: "agent", agentId, responsibleUserId }, runId });
    const service = memoryService(db);
    const binding = await service.createCompanyBinding(companyId, { key: randomUUID(), name: "Native binding", providerKey: "local" },
      { principal: { type: "user", userId: aliceId } });
    await service.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, { principal: { type: "user", userId: aliceId } });
    const source = await service.createPrivateMemory(companyId, agentId, {
      bindingId: binding.id, memoryType: "lesson", title: "Alice private lesson", content: secret, summary: null, sensitivity: "internal",
      validFrom: null, validUntil: null, expiresAt: null, observedAt: new Date().toISOString(), createdByOperationId: randomUUID(),
      evidence: [{ sourceClass: "task", sourceProvider: "native_fixture", sourceType: "issue", sourceRef: `issue://${issueId}`,
        sourceVersion: "1", sourceUpdatedAt: null, observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(secret).digest("hex"),
        citation: { label: "Native outcome" }, trustLevel: "low", relation: "supports" }],
    }, actor(aliceId));
    const version = source.record.updatedAt.toISOString();
    const decision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority", evidence: {
      id: `memory:${source.record.id}`, companyId, sourceClass: "private_memory", sourceProvider: "august_works_memory", sourceType: "memory_record",
      sourceRef: `memory://record/${source.record.id}`, sourceVersion: version, sourceUpdatedAt: version,
      title: source.record.title, excerpt: secret, observedAt: source.record.observedAt.toISOString(), validFrom: null, validUntil: null,
      authorityDomain: null, trustLevel: "low", sensitivity: "internal", citation: { label: "Private native Memory" }, metadata: {},
    } };
    await contextManifestService(db).create({ companyId, runId, agentId, issueId, responsibleUserId: aliceId,
      query: "Alice private context", policySnapshot: {}, selected: [{ decision }] });
    const [message] = await db.insert(issueComments).values({ companyId, issueId, authorUserId: bobId, body: "Bob's new native instruction" }).returning();
    const steering = await reserveSteeredIdentity(db, { companyId, runId, issueId, messageId: message!.id });
    expect(steering?.status).toBe("pending");
    // Exercise the actual native acknowledgement effect owner, without claiming
    // a physical provider transport acknowledgement in this software fixture.
    await db.transaction(async tx => acceptSteeredIdentity(tx, steering!));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run!.responsibleUserId).toBe(bobId);
    await expect(service.get(companyId, source.record.id, actor(bobId))).resolves.toBeNull();

    const ownInput = "Bob's distinct input-only lesson";
    const outcome = await service.createCandidate(companyId, {
      bindingId: binding.id, memoryType: "lesson", scope: { type: "company", id: null }, title: "Bob's new lesson", content: ownInput,
      summary: null, sensitivity: "internal", validFrom: null, validUntil: null, expiresAt: null,
      observedAt: new Date().toISOString(), createdByOperationId: operationId,
      evidence: [{ sourceClass: "task", sourceProvider: "native_fixture", sourceType: "issue", sourceRef: `issue://${issueId}`,
        sourceVersion: "1", sourceUpdatedAt: null, observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(ownInput).digest("hex"),
        citation: { label: "Bob's input" }, trustLevel: "low", relation: "supports" }],
    }, actor(bobId)).then(value => ({ value }), error => ({ error }));
    const committed = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.createdByOperationId, operationId)));
    // Check output and committed state independently: suppressing the DTO alone
    // must not leave an unauthorized durable derivative behind.
    expect.soft(JSON.stringify(outcome)).not.toContain(source.record.id);
    expect.soft(JSON.stringify(outcome)).not.toContain(secret);
    expect.soft(committed).toHaveLength(0);
    expect(outcome).toHaveProperty("error");
  });
});
