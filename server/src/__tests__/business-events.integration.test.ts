import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, businessEvents, businessEventObjects, businessEventSuppressions, businessEventBackfillRuns, companies, createDb, applyPendingMigrations, issues, projects } from "@paperclipai/db";
import { businessEventBackfillSchema } from "@paperclipai/shared";
import { businessEventService } from "../services/business-events.js";
import { issueService } from "../services/issues.js";
import { projectService } from "../services/projects.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { assertDatabaseRestoreAdmission, prepareRestoredQuarantine } from "../services/saas/quarantine.js";
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

  it("reapplies post-backup suppression in native restore quarantine while flags are disabled, preserving unrelated sources", async () => {
    const erased = await source();
    const retained = await source({ status: "done" });
    await service().backfill(companyId, actor, window);
    await db.update(activityLog).set({ details: { status: "in_progress" } }).where(eq(activityLog.id, erased.id));
    await service().backfill(companyId, actor, window);
    const backupEvents = await stored();
    const backupObjects = await db.select().from(businessEventObjects).where(eq(businessEventObjects.companyId, companyId));
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`;
    const target = new URL(database.connectionString); target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const restored = createDb(target.toString());
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(await db.select().from(companies).where(sql`${companies.id} in (${companyId}::uuid, ${otherCompanyId}::uuid)`));
      await restored.insert(projects).values(await db.select().from(projects).where(eq(projects.companyId, companyId)));
      await restored.insert(issues).values(await db.select().from(issues).where(eq(issues.companyId, companyId)));
      await restored.insert(activityLog).values(await db.select().from(activityLog).where(eq(activityLog.companyId, companyId)));
      for (const event of backupEvents.sort((a, b) => a.revision - b.revision)) await restored.insert(businessEvents).values(event);
      await restored.insert(businessEventObjects).values(backupObjects);
      // The old backup has projections, but no post-backup suppression register.
      const suppressedAt = new Date().toISOString();
      const marker = { company_id: companyId, source_ref: erased.id, suppressed_at: suppressedAt };
      const ledger = { companies: [], memory: [], businessEvents: [marker, marker,
        { ...marker, company_id: otherCompanyId, source_ref: retained.id },
        { ...marker, company_id: randomUUID() }] };
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await instanceSettingsService(restored).getExperimental()).business_events_v8).toBe(false);
      expect(await restored.select().from(businessEvents).where(eq(businessEvents.sourceRef, erased.id))).toHaveLength(0);
      expect(await restored.select().from(businessEventObjects).where(eq(businessEventObjects.eventId, erased.id))).toHaveLength(0);
      expect(await restored.select().from(businessEvents).where(eq(businessEvents.sourceRef, retained.id))).toHaveLength(1);
      expect(await restored.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId))).toHaveLength(1);
      await instanceSettingsService(restored, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true });
      expect((await businessEventService(restored).backfill(companyId, actor, window)).projected).toBe(0);
      expect((await businessEventService(restored).list(companyId, actor, window)).items.map(event => event.source.ref)).toEqual([retained.id]);
    } finally {
      await restored.$client.end({ timeout: 1 });
      await db.execute(sql`drop database ${sql.identifier(name)}`);
    }
  }, 30000);

  it("erases issue projections and unprojected identities through the native owner with rollout disabled", async () => {
    const erased = await source();
    await service().backfill(companyId, actor, window);
    const unprojected = await source({ status: "done" });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: false });
    try {
      expect((await issueService(db).remove(issueId))?.id).toBe(issueId);
      expect(await stored()).toHaveLength(0);
      expect(await db.select().from(businessEventObjects).where(eq(businessEventObjects.companyId, companyId))).toHaveLength(0);
      const guards = await db.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId));
      expect(guards.map(row => row.sourceRef).sort()).toEqual([erased.id, unprojected.id].sort());
    } finally {
      await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true });
    }
    // Recreate a pre-deletion source object as a restore might; retained guards
    // prevent analytical resurrection even though the source history remains.
    await db.insert(issues).values({ id: issueId, companyId, projectId, title: "Restored issue" });
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
  });

  it("suppresses historical project relations during concurrent projection without deleting unrelated issue work", async () => {
    const linked = await source({ projectId, status: "todo" });
    await source({}, { entityType: "project", entityId: projectId, action: "project.updated" });
    const retained = await source({ status: "done" });
    await service().backfill(companyId, actor, window);
    // Native project deletion already requires resolving operational references.
    await db.update(issues).set({ projectId: null }).where(eq(issues.id, issueId));
    const unprojected = await source({ projectId, status: "blocked" });
    await Promise.all([projectService(db).remove(projectId), service().backfill(companyId, actor, window)]);
    expect((await stored()).map(row => row.sourceRef)).toEqual([retained.id]);
    expect(await db.select().from(issues).where(eq(issues.id, issueId))).toHaveLength(1);
    const guards = await db.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId));
    expect(guards.map(row => row.sourceRef)).toEqual(expect.arrayContaining([linked.id, unprojected.id]));
    expect(guards.some(row => row.sourceRef === retained.id)).toBe(false);
  });

  it("rolls back native deletion and preserves projection history when a canonical reference blocks erasure", async () => {
    await source();
    await service().backfill(companyId, actor, window);
    await db.insert(issues).values({ companyId, parentId: issueId, title: "Dependent issue" });
    await expect(issueService(db).remove(issueId)).rejects.toMatchObject({ status: 409 });
    expect(await stored()).toHaveLength(1);
    expect(await db.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.id, issueId))).toHaveLength(1);
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
