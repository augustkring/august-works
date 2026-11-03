import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, authUsers, companyMemberships, createDb, instanceSettings, memoryJobs } from "@paperclipai/db";
import { V5_FEATURE_KEYS, V6_FEATURE_KEYS, V7_FEATURE_KEYS, V9_FEATURE_KEYS } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readMemoryMaintenanceAttention } from "../services/experience/memory-maintenance-attention.js";
import { experienceService } from "../services/experience/service.js";
import * as memory from "../services/experience/memory-maintenance-attention.js";
import { readMemoryMaintenanceHistory } from "../services/experience/memory-maintenance-history.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { issueService } from "../services/issues.js";
import { memoryService } from "../services/memory/memory-service.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";

describe("V9 current unconfirmed M1 index observation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof seedV5Companies>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-memory-attention-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks(); fixture = await seedV5Companies(db);
    fixture.actor = { ...fixture.actor, sessionId: await seedNativePasskeySession(db, fixture.userId) };
    await db.update(instanceSettings).set({ experimental: { ...Object.fromEntries(
      [...V5_FEATURE_KEYS, ...V6_FEATURE_KEYS, ...V7_FEATURE_KEYS, ...V9_FEATURE_KEYS].map(key => [key, true])),
      enableFoundationV1: true, enableContextEngineV1: true, enableCollectiveMemoryV1: true,
      enableWorkflowsV1: true, enableChatConnectors: true } }).where(eq(instanceSettings.singletonKey, "default"));
  });
  const read = () => readMemoryMaintenanceAttention(db, fixture.actor, fixture.home, new AbortController().signal);
  async function job(companyId = fixture.home, overrides: Partial<typeof memoryJobs.$inferInsert> = {}) {
    const [row] = await db.insert(memoryJobs).values({ companyId, operationType: "index_refresh", status: "running",
      jobKey: `maintenance:v1:${randomUUID()}`, executionOwnerId: "PRIVATE-WORKER", submittedAt: new Date(Date.now() - 3000), startedAt: new Date(Date.now() - 2000),
      leaseExpiresAt: new Date(Date.now() - 1000), sourceRefJson: { private: "PRIVATE-SOURCE" },
      resultSummary: "PRIVATE-RESULT", error: "PRIVATE-ERROR", ...overrides }).returning();
    return row!;
  }
  async function actualSharedMemorySource() {
    const human = { principal: { type: "user" as const, userId: fixture.userId } };
    const service = memoryService(db);
    const binding = await service.createCompanyBinding(fixture.home, {
      key: randomUUID(), name: "Maintenance source fixture", providerKey: "local",
    }, human);
    await service.addBindingTarget(fixture.home, binding.id, {
      targetType: "company", targetId: fixture.home,
    }, human);
    const text = `Actual reviewed Memory source ${randomUUID()}`;
    const sourceTask = await issueService(db).create(fixture.home, {
      title: "Actual Memory evidence source", description: text, createdByUserId: fixture.userId,
    }, undefined, undefined, { manualInputActor: fixture.actor });
    const version = sourceTask.updatedAt.toISOString();
    const candidate = await service.createCandidate(fixture.home, {
      bindingId: binding.id,
      memoryType: "lesson",
      scope: { type: "company", id: null },
      title: text,
      content: `${text}. Reviewed outcome details.`,
      summary: text,
      sensitivity: "internal",
      observedAt: new Date().toISOString(),
      validFrom: null,
      validUntil: null,
      expiresAt: null,
      createdByOperationId: randomUUID(),
      evidence: [{
        sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue",
        sourceRef: `issue://${sourceTask.id}`, sourceVersion: version, sourceUpdatedAt: version,
        observedAt: new Date().toISOString(),
        excerptHash: createHash("sha256").update(text).digest("hex"),
        citation: { label: "Reviewed source" }, trustLevel: "low", relation: "supports",
      }],
    }, human);
    return (await service.reviewCandidate(fixture.home, candidate.record.id, {
      decision: "accept",
    }, human)).record;
  }
  it("reads only current expired own-tenant M1 jobs and neither mutates nor claims failure or retry", async () => {
    const row = await job(); await job(fixture.guest);
    await job(fixture.home, { leaseExpiresAt: new Date(Date.now() + 60000) });
    await job(fixture.home, { operationType: "capture" });
    await job(fixture.home, { jobKey: `customer-capture:${randomUUID()}` });
    for (const status of ["queued", "failed", "succeeded", "cancelled"] as const)
      await job(fixture.home, { status, executionOwnerId: null, leaseExpiresAt: null,
        ...(status === "queued" ? {} : { finishedAt: new Date() }) });
    const before = await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home));
    const result = await read(); expect(result.needsYou).toHaveLength(1);
    expect(result.needsYou[0]).toMatchObject({ kind: "maintenance", source: { domain: "memory_job", resourceId: row.id },
      evidence: ["memory_index_outcome_unconfirmed"], actions: [{ operation: "open", criticality: "C2", href: `/memory/maintenance?jobId=${row.id}` }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home))).toEqual(before);
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, row.id)))[0]).toEqual(row);
  });
  it("uses Original owner/admin Memory management and cannot bypass it with instance administration", async () => {
    await job(); await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(
      eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await expect(readMemoryMaintenanceAttention(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home,
      new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ membershipRole: "admin" }).where(and(
      eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    expect((await read()).needsYou).toHaveLength(1);
  });
  it("requires verified active membership and current rollout", async () => {
    await job(); await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, fixture.userId));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, fixture.userId));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(instanceSettings).set({ experimental: { maintenance_autopilot_v9: false } }).where(eq(instanceSettings.singletonKey, "default"));
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
  it("withdraws after an Original lease renewal or completion and fingerprints a changed attempt", async () => {
    const row = await job(), first = (await read()).needsYou[0]!.source.version;
    await db.update(memoryJobs).set({ leaseExpiresAt: new Date(Date.now() - 500), updatedAt: new Date() }).where(eq(memoryJobs.id, row.id));
    expect((await read()).needsYou[0]!.source.version).not.toBe(first);
    await db.update(memoryJobs).set({ leaseExpiresAt: new Date(Date.now() + 60000) }).where(eq(memoryJobs.id, row.id));
    expect((await read()).needsYou).toEqual([]);
    await db.update(memoryJobs).set({ status: "succeeded", executionOwnerId: null, leaseExpiresAt: null, finishedAt: new Date() }).where(eq(memoryJobs.id, row.id));
    expect((await read()).needsYou).toEqual([]);
  });
  it("bounds the observation and reports omitted current jobs without reading payloads", async () => {
    for (let index = 0; index < 12; index++) await job();
    const result = await read(); expect(result.needsYou).toHaveLength(10);
    expect(result.coverage).toEqual({ state: "partial", reason: "more_items_available" });
  });
  it("withdraws renewed source after experience fan-out", async () => {
    const row = await job(), real = memory.readMemoryMaintenanceAttention; let calls = 0;
    vi.spyOn(memory, "readMemoryMaintenanceAttention").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(memoryJobs).set({ leaseExpiresAt: new Date(Date.now() + 60000) }).where(eq(memoryJobs.id, row.id));
      return result;
    });
    const result = await experienceService(db).home(fixture.actor, fixture.home);
    expect(result.needsYou.filter(card => card.source.domain === "memory_job")).toEqual([]);
    expect(result.dependencies.find(entry => entry.domain === "memory-maintenance")).toMatchObject({ state: "partial", reason: "source_stale" });
  });
  it("honors cancellation before a metadata read", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readMemoryMaintenanceAttention(db, fixture.actor, fixture.home, controller.signal)).rejects.toBeDefined();
  });
  it("opens the exact older Original job without substituting the newest history or exposing a foreign tenant", async () => {
    const record = await actualSharedMemorySource();
    const original = await memoryJobService(db).enqueueMaintenance(fixture.home,
      { operationType: "index_refresh", recordIds: [record.id] },
      { principal: { type: "user", userId: fixture.userId } }, randomUUID());
    const row = (await db.update(memoryJobs).set({ status: "running", executionOwnerId: "PRIVATE-WORKER",
      submittedAt: new Date(Date.now() - 60_000), startedAt: new Date(Date.now() - 2_000),
      leaseExpiresAt: new Date(Date.now() - 1_000), updatedAt: new Date() })
      .where(eq(memoryJobs.id, original.id)).returning())[0]!;
    for (let index = 0; index < 12; index++) {
      const newer = await memoryJobService(db).enqueueMaintenance(fixture.home,
        { operationType: "index_refresh", recordIds: [record.id] },
        { principal: { type: "user", userId: fixture.userId } }, randomUUID());
      await db.update(memoryJobs).set({ submittedAt: new Date(Date.now() + index + 1) })
        .where(eq(memoryJobs.id, newer.id));
    }
    expect((await readMemoryMaintenanceHistory(db, fixture.actor, fixture.home)).entries.some(entry => entry.jobId === row.id)).toBe(false);
    const exact = await readMemoryMaintenanceHistory(db, fixture.actor, fixture.home, row.id);
    expect(exact.hasMore).toBe(false); expect(exact.entries).toHaveLength(1);
    expect(exact.entries[0]).toMatchObject({ jobId: row.id, outcome: "unconfirmed", receiptId: null });
    const foreign = await job(fixture.guest);
    expect((await readMemoryMaintenanceHistory(db, fixture.actor, fixture.home, foreign.id)).entries).toEqual([]);
    expect(JSON.stringify(exact)).not.toContain("PRIVATE-");
  });
  it("conceals cards when Original Memory management is withdrawn after fan-out", async () => {
    await job(); const real = memory.readMemoryMaintenanceAttention; let calls = 0;
    vi.spyOn(memory, "readMemoryMaintenanceAttention").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(
        eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
      return result;
    });
    const result = await experienceService(db).home(fixture.actor, fixture.home);
    expect(result.needsYou.filter(card => card.source.domain === "memory_job")).toEqual([]);
    expect(result.dependencies.find(entry => entry.domain === "memory-maintenance")).toMatchObject({ state: "partial", reason: "denied" });
  });
});
