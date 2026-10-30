import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issues, memoryJobs, memoryRecords } from "@paperclipai/db";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { issueService } from "../services/issues.js";
import { memoryRoutes } from "../routes/memory.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService } from "../services/memory/memory-service.js";
import { canActorReadMemoryJob, memoryJobService } from "../services/memory/memory-jobs.js";
import { canActorReadHeartbeatRunPrivacy } from "../services/authorization.js";
import { contextManifestService } from "../services/context/context-manifest.js";
import { derivedMemoryService } from "../services/memory/derived-memory.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
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
      memory_observations_v7: true, memory_models_v7: true, learning_engine_v7: true, ai_use_cases_v7: true,
      enableMemoryPostRunExtractionV1: true,
      governance_evidence_v7: true, core_stewards_v7: true,
      experience_projection_v9: true, maintenance_autopilot_v9: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function seed(taskBound = false) {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Current job readers", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Actual Human", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId, principalType: "user", principalId, membershipRole: "admin", status: "active" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Private producer", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    const alice = { type: "board" as const, source: "session" as const, userId: aliceId,
      sessionId: await seedNativePasskeySession(db, aliceId), companyIds: [companyId] };
    let issueId: string | null = null;
    if (taskBound) {
      await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
      const task = await issueService(db).create(companyId, { title: "Public native Task", visibility: "open",
        responsibleUserId: aliceId, createdByUserId: aliceId, assigneeAgentId: agentId }, undefined, undefined,
        { manualInputActor: alice });
      issueId = task.id;
    }
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId, runtimeMode: "native", status: "running",
      ...(issueId ? { nativeIssueId: issueId, contextSnapshot: { issueId } } : {}) });
    const service = memoryService(db), human = { principal: { type: "user" as const, userId: aliceId } };
    const binding = await service.createCompanyBinding(companyId, { key: randomUUID(), name: "Native Memory", providerKey: "local" }, human);
    await service.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, human);
    const actor = (userId: string) => ({ type: "board" as const, source: "session" as const, userId, companyIds: [companyId] });
    return { companyId, aliceId, bobId, agentId, runId, issueId, service, human, binding, alice, bob: actor(bobId) };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  async function evidence(s: Seed, text: string) {
    const task = await issueService(db).create(s.companyId, { title: "Reviewed Memory evidence", description: text,
      createdByUserId: s.aliceId }, undefined, undefined, { manualInputActor: s.alice });
    const version = task.updatedAt.toISOString();
    return { sourceClass: "task" as const, sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${task.id}`,
      sourceVersion: version, sourceUpdatedAt: version, observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(text).digest("hex"),
      citation: { label: "Native outcome" }, trustLevel: "low" as const, relation: "supports" as const };
  }
  async function source(s: Seed, privateRoot: boolean, longDistinctContent = false) {
    const text = `Reviewed claim ${randomUUID()}`;
    const payload = { bindingId: s.binding.id, memoryType: "lesson" as const, title: text,
      content: longDistinctContent ? `${text}. ${Array.from({ length: 16 }, () => randomUUID()).join(" ")}` : `${text}. Full reviewed supporting text.`, summary: text,
      sensitivity: "internal" as const, observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
      createdByOperationId: randomUUID(), evidence: [await evidence(s, text)] };
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
    return job!;
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
    // Sealed payloads reject an unbound body replacement. Advance only the
    // retained source version to isolate this job's stale-version guard.
    await expect(db.update(memoryRecords).set({ content: "A later changed payload" })
      .where(and(eq(memoryRecords.companyId, s.companyId), eq(memoryRecords.id, row.id))))
      .rejects.toMatchObject({ cause: { code: "23514",
        message: "Native payload source snapshot does not bind its owner and body" } });
    await db.update(memoryRecords).set({ updatedAt: new Date(row.updatedAt.getTime() + 1000) })
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

  it("qualifies actual capture enqueue and leased worker through private Context even when its native Task is public", async () => {
    const s = await seed(true), row = await source(s, true);
    expect(await canActorReadHeartbeatRunPrivacy(db, s.bob, { companyId: s.companyId, id: s.runId })).toBe(true);
    const version = row.updatedAt.toISOString();
    const decision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority", evidence: {
      id: `memory:${row.id}`, companyId: s.companyId, sourceClass: "accepted_memory", sourceProvider: "august_works_memory", sourceType: "memory_record",
      sourceRef: `memory://record/${row.id}`, sourceVersion: version, sourceUpdatedAt: version, title: row.title, excerpt: row.content,
      observedAt: row.observedAt.toISOString(), validFrom: null, validUntil: null, authorityDomain: null, trustLevel: "high", sensitivity: "internal",
      citation: { label: "Actual retained Memory" }, metadata: {} } };
    await contextManifestService(db).create({ companyId: s.companyId, agentId: s.agentId, runId: s.runId, issueId: s.issueId,
      responsibleUserId: s.aliceId, query: "Retain actual private Context", policySnapshot: {}, selected: [{ decision }] });
    // This persisted semantic envelope is a software enqueue/extractor fixture,
    // not proof of native-runner/provider acceptance. Actual Context supplies ACL.
    const [run] = await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date(), resultJson: { nativeResult: {
      schema: "paperclip.run_result.v1", reportedWorkDisposition: "done", summary: "Completed native software fixture",
      completionClaim: { contractRevision: "1", objectiveSatisfied: true, criteria: [], remainingWork: [] }, evidence: [{ ref: "task" }],
      verification: [], attentionRequests: [], artifacts: [], memoryCandidates: [{ memoryType: "lesson", title: "Distinct captured lesson",
        content: "Future software captures retain their exact private Context roots.", subjectType: null, subjectId: null, proposedScopeType: "org",
        proposedScopeId: null, sensitivity: "internal", validFrom: null, validUntil: null, evidenceRefs: ["task"], rationale: "Durable fixture lesson" }],
    } } }).where(eq(heartbeatRuns.id, s.runId)).returning();
    const job = await memoryJobService(db).enqueuePostRunCapture(run!); expect(job?.status).toBe("queued");
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job!.id)).toBe(true);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job!.id)).toBe(false);
    const completed = await execute(s, job!.id);
    expect(completed.resultJson).toMatchObject({ runId: s.runId, proposed: 1, persisted: 1 });
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job!.id)).toBe(true);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job!.id)).toBe(false);
    const original = completed.sourceRefJson;
    await db.update(memoryJobs).set({ sourceRefJson: { ...original, runId: randomUUID() } }).where(eq(memoryJobs.id, job!.id));
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job!.id)).toBe(false);
    await db.update(memoryJobs).set({ sourceRefJson: original }).where(eq(memoryJobs.id, job!.id));
  });

  it("qualifies queued and successful native model rebuilds and rejects missing, foreign, unknown and stale bindings", async () => {
    const s = await seed(), root = await source(s, true), models = derivedMemoryService(db);
    const input = { modelKey: `job.${randomUUID()}`, name: "Private-root model", scope: { type: "company" as const, id: null },
      purpose: "general_work", sourceQuery: "Current retained source", memoryRecordIds: [root.id], observationIds: [] };
    const model = await models.createModel(s.alice, s.companyId, input);
    const job = await models.rebuildModel(s.alice, s.companyId, model.id, { expectedVersion: 1, memoryRecordIds: [root.id], observationIds: [] });
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(true);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(false);
    const completed = await execute(s, job.id), originalResult = completed.resultJson!;
    expect(originalResult).toMatchObject({ modelId: model.id, version: 2, sourceWatermark: job.sourceRefJson.sourceWatermark });
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(true);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(false);
    const foreign = await seed(), foreignRoot = await source(foreign, false);
    const foreignModel = await models.createModel(foreign.alice, foreign.companyId, { ...input, modelKey: `job.${randomUUID()}`, memoryRecordIds: [foreignRoot.id] });
    for (const result of [{ ...originalResult, modelId: randomUUID() }, { ...originalResult, modelId: foreignModel.id },
      { ...originalResult, version: 3 }, { ...originalResult, sourceWatermark: "0".repeat(64) }, { ...originalResult, unknown: "Untrusted extra result" }]) {
      await db.update(memoryJobs).set({ resultJson: result }).where(eq(memoryJobs.id, job.id));
      expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(false);
    }
    await db.update(memoryJobs).set({ resultJson: originalResult }).where(eq(memoryJobs.id, job.id));
    for (const modelId of [randomUUID(), foreignModel.id]) {
      await db.update(memoryJobs).set({ sourceRefJson: { ...job.sourceRefJson, modelId },
        jobKey: `model-rebuild:${modelId}:1:${job.sourceRefJson.sourceWatermark}` }).where(eq(memoryJobs.id, job.id));
      expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(false);
    }
    await db.update(memoryJobs).set({ sourceRefJson: job.sourceRefJson, jobKey: job.jobKey }).where(eq(memoryJobs.id, job.id));
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(true);
    await db.update(memoryRecords).set({ updatedAt: new Date(root.updatedAt.getTime() + 1000) }).where(eq(memoryRecords.id, root.id));
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(false);
  });

  it("checks an actual compaction result record independently of its still-current readable inputs", async () => {
    const s = await seed(), first = await source(s, false, true), second = await source(s, false, true);
    expect(first.id).not.toBe(second.id);
    const job = await memoryJobService(db).enqueueMaintenance(s.companyId, { operationType: "compaction", recordIds: [first.id, second.id] }, s.human, randomUUID());
    const completed = await execute(s, job.id), proposedId = completed.resultJson!.proposedRecordId as string;
    expect(proposedId).toBeTypeOf("string");
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(true);
    await s.service.forget(s.companyId, proposedId, s.human);
    // Purging the result does not clear an unrelated input-root array.
    const [current] = await db.select().from(memoryJobs).where(eq(memoryJobs.id, job.id));
    expect(current!.sourceRefJson).toEqual(job.sourceRefJson);
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(false);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(false);
  });

  it("checks every root and rejects malformed, missing, foreign and unknown retention sources", async () => {
    const s = await seed(), first = await source(s, false), privateRoot = await source(s, true);
    const job = await memoryJobService(db).enqueueMaintenance(s.companyId, { operationType: "index_refresh", recordIds: [first.id, privateRoot.id] }, s.human, randomUUID());
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(true);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(false);
    const foreign = await seed(), foreignRoot = await source(foreign, false), missingId = randomUUID();
    for (const sourceRefJson of [{ ...job.sourceRefJson, unknown: "Caller metadata" }, { ...job.sourceRefJson, recordVersions: {} },
      { ...job.sourceRefJson, recordIds: [first.id, missingId], recordVersions: { [first.id]: first.updatedAt.toISOString(), [missingId]: first.updatedAt.toISOString() } },
      { ...job.sourceRefJson, recordIds: [first.id, foreignRoot.id], recordVersions: { [first.id]: first.updatedAt.toISOString(), [foreignRoot.id]: foreignRoot.updatedAt.toISOString() } },
      { ...job.sourceRefJson, recordIds: ["not-a-uuid"] }, {}]) {
      await db.update(memoryJobs).set({ sourceRefJson }).where(eq(memoryJobs.id, job.id));
      expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(false);
    }
    await db.update(memoryJobs).set({ sourceRefJson: job.sourceRefJson }).where(eq(memoryJobs.id, job.id));
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, job.id)).toBe(true);
    await s.service.setRetentionPolicy(s.companyId, { maxAgeDays: 1 }, s.human);
    await db.update(memoryRecords).set({ observedAt: new Date(Date.now() - 2 * 86400000) }).where(eq(memoryRecords.id, first.id));
    await memoryJobService(db).enqueueDueRetentionJobs();
    const [retention] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, s.companyId), eq(memoryJobs.operationType, "retention")));
    expect(retention!.sourceRefJson.kind).toBe("retention_sweep");
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, retention!.id)).toBe(false);
    const completed = await execute(s, retention!.id);
    expect(completed.resultJson!.expiredRecordCount).toBeGreaterThanOrEqual(1);
    expect(await canActorReadMemoryJob(db, s.companyId, s.alice, retention!.id)).toBe(false);
  });

  it("rechecks current management after an actual Memory lock wait and returns no old job", async () => {
    const s = await seed(), root = await source(s, false), job = await enqueue(s, root.id);
    expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(true);
    let release!: () => void, ready!: () => void, blockerPid = 0;
    const gate = new Promise<void>(resolve => { release = resolve; }), held = new Promise<void>(resolve => { ready = resolve; });
    const holder = db.transaction(async tx => {
      await lockMemoryPrivacy(tx, s.companyId);
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`); blockerPid = backend!.pid;
      ready(); await gate;
    });
    await held;
    const request = http(s).get(`/api/companies/${s.companyId}/memory/jobs`).then(value => value);
    try {
      let waiter: number | undefined;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const [blocked] = await db.execute<{ pid: number }>(sql`select pid from pg_stat_activity where datname=current_database() and ${blockerPid}=any(pg_blocking_pids(pid)) limit 1`);
        if (blocked) { waiter = blocked.pid; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiter).toBeDefined(); console.info("Actual Memory jobs read blocker", { blockerPid, waiter });
      await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, s.companyId), eq(companyMemberships.principalId, s.bobId)));
      release(); await holder;
      const response = await request;
      expect(response.status).toBe(403); expect(JSON.stringify(response.body)).not.toContain(job.id);
      expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(false);
      await db.update(companyMemberships).set({ membershipRole: "admin" }).where(and(eq(companyMemberships.companyId, s.companyId), eq(companyMemberships.principalId, s.bobId)));
      expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(true);
      await db.delete(authUsers).where(eq(authUsers.id, s.bobId));
      expect(await canActorReadMemoryJob(db, s.companyId, s.bob, job.id)).toBe(false);
    } finally { release(); await holder; await request; }
  });
});
