import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyMemberships, createDb, memoryBindings, memoryBindingTargets, memoryEvidence, memoryJobs, memoryRecords } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService } from "./memory-service.js";
import { memoryJobService } from "./memory-jobs.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
suite("Governed native Memory maintenance", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-memory-maintenance-"); db = createDb(temp.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true }); }, 30_000);
  afterAll(async () => temp?.cleanup());
  async function seed(duplicate = false) {
    const [company] = await db.insert(companies).values({ name: "Maintenance", issuePrefix: `M${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const companyId = company!.id, userId = `owner-${randomUUID()}`;
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "shared", name: "Local Memory", providerKey: "local", enabled: true, config: {} }).returning();
    await db.insert(memoryBindingTargets).values({ companyId, bindingId: binding!.id, targetType: "company", targetId: companyId });
    const records = await db.insert(memoryRecords).values([0, 1].map((index) => ({ companyId, bindingId: binding!.id, providerKey: "local",
      memoryType: "observation" as const, scopeType: "company" as const, scopeId: null, title: duplicate ? "Same reviewed claim" : `Reviewed claim ${index}`,
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
