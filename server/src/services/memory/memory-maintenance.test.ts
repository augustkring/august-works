import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, memoryBindings, memoryBindingTargets, memoryEvidence, memoryJobs, memoryRecords } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService } from "./memory-service.js";
import { memoryJobService } from "./memory-jobs.js";
import { readMemoryMaintenanceHistory } from "../experience/memory-maintenance-history.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
suite("Governed native Memory maintenance", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const fixtureCompanies = new Set<string>();
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-memory-maintenance-"); db = createDb(temp.connectionString);
    await enableHistory(); }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => temp?.cleanup());
  afterEach(async () => {
    // Preserve assertions and receipts, but do not let a failed disposable
    // fixture leave work in the original global queue for the next case.
    if (fixtureCompanies.size) await db.update(memoryJobs).set({ status: "cancelled", finishedAt: new Date(),
      executionOwnerId: null, leaseExpiresAt: null }).where(and(
        inArray(memoryJobs.companyId, [...fixtureCompanies]), inArray(memoryJobs.status, ["queued", "running"])));
    fixtureCompanies.clear();
  });
  async function seed(duplicate = false) {
    const [company] = await db.insert(companies).values({ name: "Maintenance", issuePrefix: `M${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const companyId = company!.id, userId = `owner-${randomUUID()}`;
    fixtureCompanies.add(companyId);
    await db.insert(authUsers).values({id:userId,name:"Maintenance owner",email:`${randomUUID()}@example.test`,createdAt:new Date(),updatedAt:new Date()});
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "shared", name: "Local Memory", providerKey: "local", enabled: true, config: {} }).returning();
    await db.insert(memoryBindingTargets).values({ companyId, bindingId: binding!.id, targetType: "company", targetId: companyId });
    const records = await db.insert(memoryRecords).values([0, 1].map((index) => ({ companyId, bindingId: binding!.id, providerKey: "local",
      sourceProvenanceQualified:true, memoryType: "observation" as const, scopeType: "company" as const, scopeId: null, title: duplicate ? "Same reviewed claim" : `Reviewed claim ${index}`,
      content: duplicate ? "An identical reviewed claim with preserved supporting evidence." : `Reviewed claim ${index}. ${"Full source detail. ".repeat(20)}`,
      summary: duplicate ? "Same summary" : `Reviewed summary ${index}.`, observedAt: new Date(), reviewState: "accepted" as const,
      verificationState: "human_verified" as const, createdByActorType: "user" as const, createdByActorId: userId }))).returning();
    await db.insert(memoryEvidence).values(records.map((record, index) => ({ companyId, memoryRecordId: record.id, sourceClass: "task" as const,
      sourceProvider: "fixture", sourceType: "issue", sourceRef: `issue://fixture-${record.id}`, observedAt: new Date(), excerptHash: String(index).repeat(64),
      citationJson: { label: "Reviewed fixture", href: "/tasks" }, trustLevel: "low" as const, supportsOrContradicts: "supports" as const })));
    return { companyId, records, actor: { principal: { type: "user" as const, userId } } };
  }
  async function execute(companyId: string, jobId: string) {
    const svc = memoryJobService(db);
    const claimed = await svc.claimNext(new Date());
    expect(claimed?.id).toBe(jobId);
    await svc.executeClaimed(claimed!);
    return (await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.id, jobId))))[0]!;
  }
  async function enableHistory() {
    await instanceSettingsService(db).updateExperimental({
      enableFoundationV1: true, enableContextEngineV1: true, agent_identities_v5: true,
      agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true, role_packs_v5: true,
      skill_resolver_v5: true, skill_lifecycle_v5: true, playbooks_v5: true,
      saas_deployment_profile_v6: true, billing_v6: true,
      enableCollectiveMemoryV1: true, readiness_engine_v7: true, cognitive_memory_v7: true,
      memory_observations_v7: true, learning_engine_v7: true, ai_use_cases_v7: true,
      governance_evidence_v7: true, core_stewards_v7: true,
      experience_projection_v9: true, maintenance_autopilot_v9: true,
    });
  }
  function historyActor(seeded: Awaited<ReturnType<typeof seed>>) {
    return { type: "board" as const, source: "session" as const, userId: seeded.actor.principal.userId, isInstanceAdmin: false };
  }
  it("projects the actual atomic native index receipt without exposing sources or creating more work", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, "history-index");
    expect((await execute(seeded.companyId, job.id)).status).toBe("succeeded");
    const before = await db.select().from(activityLog).where(eq(activityLog.companyId, seeded.companyId));
    const view = await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ jobId: job.id, maintenanceClass: "M1", outcome: "verified_index_check", indexedRecordCount: 1,
      receiptId: before.find((row) => row.action === "memory.index_refresh_completed")!.id });
    expect(JSON.stringify(view)).not.toContain(seeded.records[0]!.id);
    expect(JSON.stringify(view)).not.toContain(seeded.actor.principal.userId);
    expect(JSON.stringify(view)).not.toContain("Full source detail");
    await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, seeded.companyId))).toEqual(before);
    expect(await db.select().from(memoryJobs).where(eq(memoryJobs.companyId, seeded.companyId))).toHaveLength(1);
  });
  it("refuses success when a native job lacks or disagrees with its original postcondition receipt", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, "history-missing");
    const completed = await execute(seeded.companyId, job.id);
    const scope = and(eq(activityLog.companyId, seeded.companyId), eq(activityLog.entityId, job.id));
    const [receipt] = await db.select().from(activityLog).where(scope);
    await db.delete(activityLog).where(eq(activityLog.id, receipt!.id));
    expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries[0])
      .toMatchObject({ outcome: "verification_unavailable", receiptId: null, indexedRecordCount: null });
    await db.insert(activityLog).values(receipt!);
    await db.update(memoryJobs).set({ resultJson: { ...completed.resultJson, indexedRecordCount: 2 } }).where(eq(memoryJobs.id, job.id));
    expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries[0]?.outcome).toBe("verification_unavailable");
    await db.update(memoryJobs).set({ resultJson: completed.resultJson }).where(eq(memoryJobs.id, job.id));
    await db.insert(activityLog).values({ ...receipt!, id: randomUUID() });
    expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries[0]?.outcome).toBe("verification_unavailable");
  });
  it("honors original source erasure instead of re-emitting an old verified receipt", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, "history-erasure");
    await execute(seeded.companyId, job.id);
    await memoryService(db).forget(seeded.companyId, seeded.records[0]!.id, seeded.actor);
    expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries[0])
      .toMatchObject({ outcome: "source_unavailable", receiptId: null, indexedRecordCount: null });
    const [receipt]=await db.select({id:activityLog.id}).from(activityLog).where(and(eq(activityLog.companyId,seeded.companyId),
      eq(activityLog.entityType,"memory_job"),eq(activityLog.entityId,job.id),eq(activityLog.action,"memory.index_refresh_completed")));
    expect(receipt).toBeTruthy();
    await db.delete(activityLog).where(eq(activityLog.id,receipt!.id));
    expect((await readMemoryMaintenanceHistory(db,historyActor(seeded),seeded.companyId)).entries).toHaveLength(0);
  });
  it("retains only the original local operator's content-free index receipt after erasure", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    const local = { principal: { type: "system" as const, service: "local-board" } };
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh",
      recordIds: [seeded.records[0]!.id] }, local, "local-history-erasure");
    await execute(seeded.companyId, job.id);
    await memoryService(db).forget(seeded.companyId, seeded.records[0]!.id, local);
    const view = await readMemoryMaintenanceHistory(db, { type: "board", source: "local_implicit" }, seeded.companyId);
    expect(view.entries).toEqual([expect.objectContaining({ jobId: job.id, outcome: "source_unavailable",
      receiptId: null, indexedRecordCount: null })]);
    expect(JSON.stringify(view)).not.toContain(seeded.records[0]!.id);
    expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries).toEqual([]);
    await db.delete(activityLog).where(and(eq(activityLog.companyId, seeded.companyId),
      eq(activityLog.entityType, "memory_job"), eq(activityLog.entityId, job.id)));
    expect((await readMemoryMaintenanceHistory(db, { type: "board", source: "local_implicit" }, seeded.companyId)).entries).toEqual([]);
  });
  it("repeats native company and Memory owner admission rather than trusting an instance-admin claim", async () => {
    const seeded = await seed();
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(eq(companyMemberships.companyId, seeded.companyId));
    await expect(readMemoryMaintenanceHistory(db, { ...historyActor(seeded), isInstanceAdmin: true }, seeded.companyId)).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ membershipRole: "owner" }).where(eq(companyMemberships.companyId, seeded.companyId));
    const foreign = await seed();
    await expect(readMemoryMaintenanceHistory(db, historyActor(seeded), foreign.companyId)).rejects.toMatchObject({ status: 403 });
    await expect(readMemoryMaintenanceHistory(db, { type: "agent", agentId: randomUUID(), companyId: seeded.companyId }, seeded.companyId)).rejects.toMatchObject({ status: 403 });
    await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: false });
    try { await expect(readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).rejects.toMatchObject({ status: 404 }); }
    finally { await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: true }); }
  });
  it("bounds history to ten original index attempts and excludes material Memory changes", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    for (let index = 0; index < 12; index++) await svc.enqueueMaintenance(seeded.companyId,
      { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, `history-bound-${index}`);
    await svc.enqueueMaintenance(seeded.companyId, { operationType: "dedupe", recordIds: seeded.records.map((row) => row.id) }, seeded.actor, "history-material");
    const view = await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId);
    expect(view.hasMore).toBe(true);
    expect(view.entries).toHaveLength(10);
    expect(view.entries.every((entry) => entry.maintenanceClass === "M1" && entry.outcome === "queued")).toBe(true);
  });
  it.each(["indisvalid", "indisready", "indislive"])("refuses an unusable native index (%s) before recording a successful check", async (flag) => {
    const seeded = await seed(), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, `invalid-index-${flag}`);
    // Actual PostgreSQL catalog fault in this throwaway test database.
    await db.execute(sql`update pg_index set ${sql.identifier(flag)} = false where indexrelid = 'public.memory_records_search_idx'::regclass`);
    try {
      const completed = await execute(seeded.companyId, job.id);
      expect(completed.status).toBe("failed");
      expect(completed.resultJson).toBeNull();
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, seeded.companyId), eq(activityLog.action, "memory.index_refresh_completed")))).toHaveLength(0);
      expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries[0]?.outcome).toBe("review_required");
    } finally {
      await db.execute(sql`update pg_index set ${sql.identifier(flag)} = true where indexrelid = 'public.memory_records_search_idx'::regclass`);
    }
  });
  it("keeps an expired execution unconfirmed and does not enqueue a retry from a read", async () => {
    const seeded = await seed(), svc = memoryJobService(db, { leaseMs: 1 });
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, "history-unconfirmed");
    const claimed = await svc.claimNext(new Date());
    expect(claimed?.id).toBe(job.id);
    await db.execute(sql`select pg_sleep(0.01)`);
    const view = await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId);
    expect(view.entries[0]).toMatchObject({ outcome: "unconfirmed", receiptId: null, indexedRecordCount: null });
    expect(await db.select().from(memoryJobs).where(eq(memoryJobs.companyId, seeded.companyId))).toHaveLength(1);
    await svc.executeClaimed(claimed!);
    expect((await readMemoryMaintenanceHistory(db, historyActor(seeded), seeded.companyId)).entries[0]?.outcome).toBe("review_required");
  });
  it("consolidates exact duplicates with evidence and replays the immutable job receipt", async () => {
    const seeded = await seed(true), svc = memoryJobService(db);
    const input = { operationType: "dedupe", recordIds: seeded.records.map((record) => record.id) };
    const job = await svc.enqueueMaintenance(seeded.companyId, input, seeded.actor, "dedupe");
    expect((await execute(seeded.companyId, job.id)).resultJson).toMatchObject({ supersededCount: 1, canonicalRecordCount: 1 });
    const rows = await db.select().from(memoryRecords).where(eq(memoryRecords.companyId, seeded.companyId));
    const canonical = rows.find((row) => !row.supersededByRecordId)!;
    expect(rows.find((row) => row.id !== canonical.id)?.retentionState).toBe("superseded");
    expect(await db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryRecordId, canonical.id))).toHaveLength(2);
    expect((await svc.enqueueMaintenance(seeded.companyId, input, seeded.actor, "dedupe")).id).toBe(job.id);
    await expect(svc.enqueueMaintenance(seeded.companyId, { ...input, operationType: "index_refresh" }, seeded.actor, "dedupe")).rejects.toMatchObject({ status: 409 });
  });
  it("proposes a compact candidate and erases derived content when a source is deleted", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "compaction", recordIds: seeded.records.map((row) => row.id) }, seeded.actor, "compact");
    const completed = await execute(seeded.companyId, job.id);
    expect(completed.status).toBe("succeeded");
    expect(completed.resultJson?.reviewState).toBe("pending");
    const candidateId = String(completed.resultJson?.proposedRecordId);
    const candidate = await memoryService(db).getShared(seeded.companyId, candidateId, seeded.actor);
    expect(candidate?.record.content).toContain("Reviewed summary 0.");
    expect(candidate?.evidence).toHaveLength(2);
    await memoryService(db).forget(seeded.companyId, seeded.records[0]!.id, seeded.actor);
    expect(await memoryService(db).getShared(seeded.companyId, candidateId, seeded.actor)).toBeNull();
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job.id)))[0]?.resultJson).toBeNull();
  });
  it("creates a pending lesson from an explicit operator proposal and erases its source lineage", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    // Accepted source records need not have a summary. Reflection cites the
    // reviewed content in that case; compaction still requires summaries.
    await db.update(memoryRecords).set({ summary: null }).where(eq(memoryRecords.id, seeded.records[0]!.id));
    const input = { operationType: "reflection", recordIds: seeded.records.map((record) => record.id), proposedLesson: { title: "Check supporting records", content: "Verify the reviewed evidence before applying this lesson." } };
    await expect(svc.enqueueMaintenance(seeded.companyId, { ...input, proposedLesson: undefined }, seeded.actor, "missing-lesson")).rejects.toBeTruthy();
    const job = await svc.enqueueMaintenance(seeded.companyId, input, seeded.actor, "reflect");
    await expect(svc.enqueueMaintenance(seeded.companyId, { ...input, proposedLesson: { ...input.proposedLesson, content: "Different proposal" } }, seeded.actor, "reflect")).rejects.toMatchObject({ status: 409 });
    const completed = await execute(seeded.companyId, job.id);
    expect(completed.status).toBe("succeeded");
    const candidateId = String(completed.resultJson?.proposedRecordId);
    const candidate = await memoryService(db).getShared(seeded.companyId, candidateId, seeded.actor);
    expect(candidate?.record).toMatchObject({ memoryType: "lesson", reviewState: "pending", content: input.proposedLesson.content });
    expect(candidate?.evidence).toHaveLength(2);
    await memoryService(db).forget(seeded.companyId, seeded.records[0]!.id, seeded.actor);
    expect(await memoryService(db).getShared(seeded.companyId, candidateId, seeded.actor)).toBeNull();
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job.id)))[0]?.sourceRefJson).toEqual({});
  });
  it("uses the native GIN index and checks current permission before executing", async () => {
    const seeded = await seed(), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, "index");
    expect((await execute(seeded.companyId, job.id)).resultJson).toMatchObject({ provider: "native_postgres", nativeIndexCurrent: true });
    const denied = await svc.enqueueMaintenance(seeded.companyId, { operationType: "index_refresh", recordIds: [seeded.records[0]!.id] }, seeded.actor, "revoked");
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(eq(companyMemberships.companyId, seeded.companyId));
    expect((await execute(seeded.companyId, denied.id)).status).toBe("failed");
  });
  it("rolls back dedupe when its durable success receipt cannot commit", async () => {
    const seeded = await seed(true), svc = memoryJobService(db);
    const job = await svc.enqueueMaintenance(seeded.companyId, { operationType: "dedupe", recordIds: seeded.records.map((row) => row.id) }, seeded.actor, "receipt-fault");
    await db.execute(sql`create function fail_memory_success_receipt() returns trigger language plpgsql as $$ begin if NEW.status = 'succeeded' then raise exception 'injected receipt fault'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger memory_receipt_fault before update on memory_jobs for each row execute function fail_memory_success_receipt()`);
    try {
      expect((await execute(seeded.companyId, job.id)).status).toBe("failed");
      const rows = await db.select().from(memoryRecords).where(eq(memoryRecords.companyId, seeded.companyId));
      expect(rows.every((row) => row.retentionState === "active" && row.supersededByRecordId === null)).toBe(true);
    } finally {
      await db.execute(sql`drop trigger memory_receipt_fault on memory_jobs`);
      await db.execute(sql`drop function fail_memory_success_receipt()`);
    }
  });
});
