import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, agentIdentities, companies, companyMemberships, createDb, cognitiveProviderOperations, memoryBindings, memoryRecords, principalPermissionGrants } from "@paperclipai/db";
import { cognitiveMemoryService } from "../services/memory/cognitive-memory.js";
import { assertCognitiveRecallUniverse, localCognitiveProvider } from "../services/memory/cognitive-provider.js";
import { memoryService } from "../services/memory/memory-service.js";
import { purgeMemoryRecords } from "../services/memory/memory-privacy.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 governed cognitive provider", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, agentId: string, memoryId: string;
  const owner = { type: "board" as const, source: "local_implicit" as const };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-cognitive-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true, enableContextEngineV1: true, cognitive_memory_v7: true }); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); agentId = randomUUID(); memoryId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Cognitive fixture", issuePrefix: `C${companyId.slice(0, 7)}` });
    const [identity] = await db.insert(agentIdentities).values({ name: "Memory agent", homeCompanyId: companyId }).returning();
    await db.insert(agents).values({ id: agentId, companyId, agentIdentityId: identity!.id, name: "Memory agent" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: agentId, permissionKey: "company_scope:read" });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "test", name: "Governed memory", providerKey: "local" }).returning();
    await db.insert(memoryRecords).values({ id: memoryId, companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson", scopeType: "company",
      content: "Customer onboarding needs verified evidence", observedAt: new Date(), reviewState: "accepted", verificationState: "human_verified", createdByActorType: "system", createdByActorId: "fixture" });
  });
  const recall = { query: "customer onboarding", purpose: "general_work", sensitivityCeiling: "internal" as const, topK: 10 };
  async function binding() { return cognitiveMemoryService(db).createBinding(owner, companyId, { bindingKey: "local", providerKey: "local_baseline", scope: { type: "company", id: null }, purpose: "general_work" }); }
  it("recalls accepted governed records only and binds purpose and sensitivity before ranking", async () => {
    const service = cognitiveMemoryService(db), configured = await binding();
    expect((await service.recall(owner, companyId, configured.id, recall)).map((hit) => hit.record.id)).toEqual([memoryId]);
    expect(await service.recall(owner, companyId, configured.id, { ...recall, purpose: "person_decision" })).toEqual([]);
    await db.update(memoryRecords).set({ reviewState: "pending" }).where(eq(memoryRecords.id, memoryId));
    expect(await service.recall(owner, companyId, configured.id, recall)).toEqual([]);
    await db.update(memoryRecords).set({ reviewState: "accepted", sensitivityLabel: "restricted" }).where(eq(memoryRecords.id, memoryId));
    expect(await service.recall(owner, companyId, configured.id, recall)).toEqual([]);
  });
  it("keeps deletion receipts content-free and propagates revocation with V7 disabled", async () => {
    const service = cognitiveMemoryService(db), configured = await binding();
    expect((await service.reconcile(owner, companyId, configured.id)).status).toBe("succeeded");
    await instanceSettingsService(db).updateExperimental({ cognitive_memory_v7: false });
    await memoryService(db).revoke(companyId, memoryId, { reason: "Incorrect outcome" }, { principal: { type: "system", service: "fixture" } });
    const receipts = await db.select().from(cognitiveProviderOperations).where(eq(cognitiveProviderOperations.companyId, companyId));
    expect(receipts.some((receipt) => receipt.operationType === "delete" && receipt.status === "succeeded")).toBe(true);
    expect(JSON.stringify(receipts)).not.toContain("Customer onboarding");
    await instanceSettingsService(db).updateExperimental({ cognitive_memory_v7: true });
    expect(await service.recall(owner, companyId, configured.id, recall)).toEqual([]);
    await db.transaction(async (tx) => { await purgeMemoryRecords(tx as unknown as typeof db, companyId, [memoryId]); });
    expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id, memoryId)))[0]!.content).toBe("");
  });
  it("rejects provider tenant violations, stale versions, duplicates and hallucinated identifiers", async () => {
    const scope = { companyId, bindingId: randomUUID(), scopeType: "company" as const, scopeId: null, purpose: "general_work" };
    const source = { id: memoryId, companyId, version: "1", content: "Customer onboarding", sensitivity: "internal" as const, validFrom: null, validUntil: null, sourceRefs: [] };
    const input = { scope, allowedRecords: [source], query: "customer", topK: 10 };
    await expect(localCognitiveProvider().recall({ ...input, allowedRecords: [{ ...source, companyId: randomUUID() }] })).rejects.toMatchObject({ status: 403 });
    for (const hit of [{ id: randomUUID(), companyId, version: "1", score: 1 }, { id: memoryId, companyId: randomUUID(), version: "1", score: 1 }, { id: memoryId, companyId, version: "0", score: 1 }]) {
      expect(() => assertCognitiveRecallUniverse(input, [hit])).toThrow("authorized universe");
    }
    const hit = { id: memoryId, companyId, version: "1", score: 1 };
    expect(() => assertCognitiveRecallUniverse(input, [hit, hit])).toThrow("authorized universe");
    expect(await localCognitiveProvider("noop").recall(input)).toEqual([]);
  });
  it("preserves private scope and rejects foreign binding references and agent configuration", async () => {
    const service = cognitiveMemoryService(db), configured = await binding();
    await expect(service.recall(owner, randomUUID(), configured.id, recall)).rejects.toMatchObject({ status: 404 });
    const actor = { type: "agent" as const, companyId, agentId, source: "agent_key" as const };
    await expect(service.createBinding(actor, companyId, { bindingKey: "forbidden", providerKey: "local_baseline", scope: { type: "company", id: null }, purpose: "general_work" })).rejects.toMatchObject({ status: 403 });
    const privateBinding = await service.createBinding(owner, companyId, { bindingKey: "private", providerKey: "local_baseline", scope: { type: "agent", id: agentId }, purpose: "general_work", approvedPrivateProjection: true });
    expect((await service.status(owner, companyId)).bindings.some((row) => row.id === privateBinding.id)).toBe(false);
    await db.update(memoryRecords).set({ scopeType: "agent", scopeId: agentId, ownerAgentId: agentId, verificationState: "unverified" }).where(eq(memoryRecords.id, memoryId));
    expect(await service.recall(actor, companyId, privateBinding.id, recall)).toEqual([]);
    await expect(service.recall(owner, companyId, privateBinding.id, recall)).rejects.toMatchObject({ status: 404 });
  });
  it("keeps V4 Memory functional with the cognitive flag off", async () => {
    const configured = await binding(); await instanceSettingsService(db).updateExperimental({ cognitive_memory_v7: false });
    expect(await cognitiveMemoryService(db).recall(owner, companyId, configured.id, recall)).toEqual([]);
    expect(await memoryService(db).listEligible(companyId, { scopeType: "company", scopeId: null }, { principal: { type: "system", service: "fixture" } })).toHaveLength(1);
    await instanceSettingsService(db).updateExperimental({ cognitive_memory_v7: true });
  });
});
