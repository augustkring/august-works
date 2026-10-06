import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, businessEvents, businessEventObjects, businessEventSuppressions, businessEventBackfillRuns, companies, createDb, issues, projects } from "@paperclipai/db";
import { businessEventBackfillSchema } from "@paperclipai/shared";
import { businessEventService } from "../services/business-events.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const window = { from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", limit: 100 };
suite("Native V8 business event projection on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  let otherCompanyId: string;
  let issueId: string;
  let projectId: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v8-events-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true });
  });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); otherCompanyId = randomUUID(); issueId = randomUUID(); projectId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "Event test", issuePrefix: randomUUID() },
      { id: otherCompanyId, name: "Other event test", issuePrefix: randomUUID() },
    ]);
    await db.insert(projects).values({ id: projectId, companyId, name: "Project" });
    await db.insert(issues).values({ id: issueId, companyId, projectId, title: "Issue" });
  });
  async function source(details: Record<string, unknown> = { status: "todo" }, overrides: Partial<typeof activityLog.$inferInsert> = {}) {
    const [row] = await db.insert(activityLog).values({ companyId, actorType: "user", actorId: "private-identity", action: "issue.updated", entityType: "issue", entityId: issueId, createdAt: new Date("2026-01-01T12:00:00Z"), details, ...overrides }).returning();
    return row;
  }
  const service = () => businessEventService(db);
  const stored = () => db.select().from(businessEvents).where(eq(businessEvents.companyId, companyId));

  it("deduplicates concurrent replay and keeps typed source facts without copying private payloads", async () => {
    const row = await source({ status: "done", priority: "high", projectId, body: "secret body", actorId: "secret actor", previousStatus: "secret status" });
    const results = await Promise.all([service().backfill(companyId, actor, window), service().backfill(companyId, actor, window)]);
    expect(results.reduce((n, r) => n + r.projected, 0)).toBe(1);
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
    expect(rows[0].attributes).toEqual({ status: "done", priority: "high" });
    const page = await service().list(companyId, actor, window);
    expect(page.items[0].objects).toHaveLength(2);
    expect(page.items[0].sourceUpdatedAt).toBeNull();
    expect(page.items[0].receivedAt).toBeNull();
    expect(JSON.stringify(page)).not.toContain("secret");
    expect(JSON.stringify(page)).not.toContain("private-identity");
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "business_event.projected")))).toHaveLength(1);
  });

  it("hides a changed source immediately, appends correction history, and accepts a later return to the original value", async () => {
    const row = await source();
    await service().backfill(companyId, actor, window);
    await db.update(activityLog).set({ details: { status: "done" } }).where(eq(activityLog.id, row.id));
    expect((await service().list(companyId, actor, window)).items).toHaveLength(0);
    await service().backfill(companyId, actor, window);
    await db.update(activityLog).set({ details: { status: "todo" } }).where(eq(activityLog.id, row.id));
    await service().backfill(companyId, actor, window);
    const rows = (await stored()).sort((a, b) => a.revision - b.revision);
    expect(rows.map(r => r.revision)).toEqual([1, 2, 3]);
    expect(rows[1].supersedesEventId).toBe(rows[0].id);
    expect(rows[2].supersedesEventId).toBe(rows[1].id);
    expect(rows.slice(0, 2).every(r => r.tombstonedAt !== null)).toBe(true);
    expect((await service().list(companyId, actor, window)).items.map(r => r.revision)).toEqual([3]);
  });

  it("deletes the entire correction chain and objects and blocks concurrent or later replay", async () => {
    const row = await source();
    await service().backfill(companyId, actor, window);
    await db.update(activityLog).set({ details: { status: "done" } }).where(eq(activityLog.id, row.id));
    await service().backfill(companyId, actor, window);
    await Promise.all([service().suppressSource(companyId, actor, row.id), service().backfill(companyId, actor, window)]);
    await service().suppressSource(companyId, actor, row.id);
    expect(await stored()).toHaveLength(0);
    expect(await db.select().from(businessEventObjects).where(eq(businessEventObjects.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId))).toHaveLength(1);
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
  });

  it("rejects cross-company source relationships and unauthorized company reads and writes", async () => {
    const otherProjectId = randomUUID();
    await db.insert(projects).values({ id: otherProjectId, companyId: otherCompanyId, name: "Private project" });
    await source({ projectId: otherProjectId, status: "todo" });
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
    const outsider = { type: "agent" as const, source: "agent_key" as const, companyId: otherCompanyId, agentId: randomUUID() };
    await expect(service().list(companyId, outsider, window)).rejects.toMatchObject({ status: 403 });
    await expect(service().backfill(companyId, outsider, window)).rejects.toMatchObject({ status: 403 });
    await expect(service().suppressSource(companyId, outsider, randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it("keeps a restored projection hidden when the suppression register is retained", async () => {
    const row = await source();
    await service().backfill(companyId, actor, window);
    const [backupEvent] = await stored();
    const backupObjects = await db.select().from(businessEventObjects).where(eq(businessEventObjects.eventId, backupEvent.id));
    await service().suppressSource(companyId, actor, row.id);
    await db.insert(businessEvents).values(backupEvent);
    await db.insert(businessEventObjects).values(backupObjects);
    expect((await service().list(companyId, actor, window)).items).toHaveLength(0);
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
  });

  it("uses exact source microseconds and UUID ordering for resumable bounded pages", async () => {
    const first = await source();
    const second = await source();
    await db.execute(sql`update activity_log set created_at = '2026-01-01T12:00:00.123456Z'::timestamptz where id in (${first.id}::uuid, ${second.id}::uuid)`);
    const one = await service().backfill(companyId, actor, { ...window, limit: 1 });
    expect(one.nextCursor?.at).toBe("2026-01-01T12:00:00.123456Z");
    const [checkpoint] = await db.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.id, one.runId));
    expect(checkpoint.lastSourceCursor).toEqual(one.nextCursor);
    expect(checkpoint.status).toBe("batch_limit_reached");
    const two = await service().backfill(companyId, actor, { ...window, limit: 1, cursor: one.nextCursor! });
    expect(two.projected).toBe(1);
    expect(two.nextCursor?.id).not.toBe(one.nextCursor?.id);
    const end = await service().backfill(companyId, actor, { ...window, limit: 1, cursor: two.nextCursor! });
    expect(end.nextCursor).toBeNull();
    expect(await stored()).toHaveLength(2);
  });

  it("removes deleted source visibility and preserves disabled-feature admission", async () => {
    const row = await source();
    await service().backfill(companyId, actor, window);
    await db.delete(activityLog).where(eq(activityLog.id, row.id));
    expect((await service().list(companyId, actor, window)).items).toHaveLength(0);
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: false });
    await expect(service().list(companyId, actor, window)).rejects.toMatchObject({ status: 404 });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true });
  });

  it("keeps composite references company-scoped in the database", async () => {
    await source();
    await service().backfill(companyId, actor, window);
    const [event] = await stored();
    await expect(db.insert(businessEventObjects).values({ companyId: otherCompanyId, eventId: event.id, objectType: "issue", objectId: issueId, qualifier: "primary" })).rejects.toThrow();
  });

  it("validates time windows numerically across ISO fractional formats and caps batch size", () => {
    expect(businessEventBackfillSchema.safeParse({ from: "2026-01-01T00:00:00Z", until: "2026-01-01T00:00:00.100Z", limit: 200 }).success).toBe(true);
    expect(businessEventBackfillSchema.safeParse({ ...window, limit: 201 }).success).toBe(false);
    expect(businessEventBackfillSchema.safeParse({ ...window, from: window.until, until: window.from }).success).toBe(false);
  });
});
