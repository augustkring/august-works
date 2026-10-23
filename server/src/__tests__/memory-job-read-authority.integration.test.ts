import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, memoryJobs, memoryRecords } from "@paperclipai/db";
import { memoryRoutes } from "../routes/memory.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService } from "../services/memory/memory-service.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { readMemoryMaintenanceHistory } from "../services/experience/memory-maintenance-history.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Original Memory jobs retain current source read authority", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-memory-job-read-");
    db = createDb(database.connectionString, { maxConnections: 3 });
    await instanceSettingsService(db).updateExperimental({
      enableFoundationV1: true, enableContextEngineV1: true, agent_identities_v5: true,
      agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true, role_packs_v5: true,
      skill_resolver_v5: true, skill_lifecycle_v5: true, playbooks_v5: true,
      saas_deployment_profile_v6: true, billing_v6: true,
      enableCollectiveMemoryV1: true, readiness_engine_v7: true, cognitive_memory_v7: true,
      memory_observations_v7: true, learning_engine_v7: true, ai_use_cases_v7: true,
      governance_evidence_v7: true, core_stewards_v7: true,
      experience_projection_v9: true, maintenance_autopilot_v9: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function seed() {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Current job readers", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Actual Human", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId, principalType: "user", principalId, membershipRole: "admin", status: "active" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Private producer", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId, runtimeMode: "native", status: "running" });
    const service = memoryService(db), human = { principal: { type: "user" as const, userId: aliceId } };
    const binding = await service.createCompanyBinding(companyId, { key: randomUUID(), name: "Native Memory", providerKey: "local" }, human);
    await service.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, human);
    const actor = (userId: string) => ({ type: "board" as const, source: "session" as const, userId, companyIds: [companyId] });
    return { companyId, aliceId, bobId, agentId, runId, service, human, binding, alice: actor(aliceId), bob: actor(bobId) };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  function evidence(text: string) {
    return { sourceClass: "task" as const, sourceProvider: "native_job_fixture", sourceType: "reviewed_outcome", sourceRef: `outcome://${randomUUID()}`,
      sourceVersion: "1", sourceUpdatedAt: null, observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(text).digest("hex"),
      citation: { label: "Native outcome" }, trustLevel: "low" as const, relation: "supports" as const };
  }
  async function source(s: Seed, privateRoot: boolean) {
    const text = `Reviewed claim ${randomUUID()}`;
    const payload = { bindingId: s.binding.id, memoryType: "lesson" as const, title: text, content: `${text}. Full reviewed supporting text.`, summary: text,
      sensitivity: "internal" as const, observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
      createdByOperationId: randomUUID(), evidence: [evidence(text)] };
    let candidate;
    if (privateRoot) {
      const producer = { principal: { type: "agent" as const, agentId: s.agentId, responsibleUserId: s.aliceId }, runId: s.runId };
      const original = await s.service.createPrivateMemory(s.companyId, s.agentId, payload, producer);
      candidate = await s.service.sharePrivateMemory(s.companyId, original.record.id, { targetBindingId: s.binding.id,
        targetScope: { type: "company", id: null }, reason: "Review keeps private source", createdByOperationId: randomUUID() }, producer);
    } else candidate = await s.service.createCandidate(s.companyId, { ...payload, scope: { type: "company", id: null }, ownerAgentId: null }, s.human);
    return (await s.service.reviewCandidate(s.companyId, candidate.record.id, { decision: "accept" }, s.human)).record;
  }
  function http(s: Seed, actor = s.bob) {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", memoryRoutes(db)); app.use(errorHandler);
    return request(app);
  }
  async function enqueue(s: Seed, id: string, suffix = randomUUID()) {
    return memoryJobService(db).enqueueMaintenance(s.companyId, { operationType: "index_refresh", recordIds: [id] }, s.human, suffix);
  }
  async function execute(s: Seed, id: string) {
    // Isolate the original global claim owner from unrelated queued fixture jobs.
    await db.update(memoryJobs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(memoryJobs.status, "queued"));
    await db.update(memoryJobs).set({ status: "queued", finishedAt: null }).where(eq(memoryJobs.id, id));
    const worker = memoryJobService(db), claimed = await worker.claimNext();
    expect(claimed?.id).toBe(id); await worker.executeClaimed(claimed!);
    const [job] = await db.select().from(memoryJobs).where(eq(memoryJobs.id, id)); expect(job!.status).toBe("succeeded");
  }

  it("hides a native private-source job from another current admin on API and maintenance history", async () => {
    const s = await seed(), row = await source(s, true), job = await enqueue(s, row.id);
    expect(await s.service.getShared(s.companyId, row.id, { principal: { type: "user", userId: s.bobId } })).toBeNull();
    expect((await http(s, s.alice).get(`/api/companies/${s.companyId}/memory/jobs`).expect(200)).body.map((item: { id: string }) => item.id)).toContain(job.id);
    const response = await http(s).get(`/api/companies/${s.companyId}/memory/jobs`).expect(200);
    expect.soft(response.body).toEqual([]);
    const history = await readMemoryMaintenanceHistory(db, s.bob, s.companyId);
    expect(history.entries).toEqual([]);
  });

  it("filters before output limits so newer hidden jobs cannot displace an older readable job", async () => {
    const s = await seed(), publicRow = await source(s, false), privateRow = await source(s, true);
    const visible = await enqueue(s, publicRow.id);
    await db.update(memoryJobs).set({ createdAt: new Date(Date.now() - 60000), submittedAt: new Date(Date.now() - 60000) }).where(eq(memoryJobs.id, visible.id));
    for (let i = 0; i < 51; i++) await enqueue(s, privateRow.id);
    const response = await http(s).get(`/api/companies/${s.companyId}/memory/jobs`).expect(200);
    expect.soft(response.body.map((item: { id: string }) => item.id)).toEqual([visible.id]);
    expect((await readMemoryMaintenanceHistory(db, s.bob, s.companyId)).entries.map(item => item.jobId)).toEqual([visible.id]);
  }, 60000);

  it("withholds a source-version-stale job without trusting retained version metadata", async () => {
    const s = await seed(), row = await source(s, false), job = await enqueue(s, row.id);
    await db.update(memoryRecords).set({ content: "A later changed payload", updatedAt: new Date(row.updatedAt.getTime() + 1000) })
      .where(and(eq(memoryRecords.companyId, s.companyId), eq(memoryRecords.id, row.id)));
    expect.soft((await http(s).get(`/api/companies/${s.companyId}/memory/jobs`).expect(200)).body).toEqual([]);
    expect((await readMemoryMaintenanceHistory(db, s.bob, s.companyId)).entries).toEqual([]);
    expect(job.sourceRefJson.recordVersions).toEqual({ [row.id]: row.updatedAt.toISOString() });
  });

  it("keeps only an own original source-free index tombstone after actual source erasure", async () => {
    const s = await seed(), row = await source(s, false), job = await enqueue(s, row.id);
    await execute(s, job.id);
    expect((await readMemoryMaintenanceHistory(db, s.alice, s.companyId)).entries[0]?.outcome).toBe("verified_index_check");
    await s.service.forget(s.companyId, row.id, s.human);
    const own = await readMemoryMaintenanceHistory(db, s.alice, s.companyId);
    expect(own.entries).toMatchObject([{ jobId: job.id, outcome: "source_unavailable", receiptId: null, indexedRecordCount: null }]);
    expect.soft((await readMemoryMaintenanceHistory(db, s.bob, s.companyId)).entries).toEqual([]);
    expect((await http(s, s.alice).get(`/api/companies/${s.companyId}/memory/jobs`).expect(200)).body).toEqual([]);
  });
});
