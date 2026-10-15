import { randomUUID } from "node:crypto";
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
    const recordId = randomUUID(), row = await job(fixture.home, {
      sourceRefJson: { recordIds: [recordId], requester: { type: "user", userId: fixture.userId },
        recordVersions: { [recordId]: new Date().toISOString() } }, submittedAt: new Date(Date.now() - 60000) });
    for (let index = 0; index < 12; index++) await job(fixture.home, { status: "queued", executionOwnerId: null, leaseExpiresAt: null, startedAt: null });
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
