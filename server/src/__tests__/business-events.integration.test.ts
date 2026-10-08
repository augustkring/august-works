import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { activityLog, analyticalLineageEdges, analyticalLineageManifests, businessEvents, businessEventObjects, businessEventSuppressions, businessEventBackfillRuns, companies, governanceObligations, createDb, applyPendingMigrations, runDatabaseBackup, runDatabaseRestore, issues, projects } from "@paperclipai/db";
import { businessEventBackfillSchema } from "@paperclipai/shared";
import { businessEventService } from "../services/business-events.js";
import { businessEventExportService } from "../services/business-event-export.js";
import { eraseExpiredAnalyticalLineage } from "../services/analytical-retention.js";
import { processDataReadinessService } from "../services/process-data-readiness.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { issueService } from "../services/issues.js";
import { projectService } from "../services/projects.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { eraseBusinessEventObjectUnderMemory } from "../services/business-event-payload-erasure.js";
import { assertDatabaseRestoreAdmission, prepareRestoredQuarantine } from "../services/saas/quarantine.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { disableV8Rollout } from "./helpers/v8-rollout.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const timeWindow = { from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", limit: 100 };
suite("Native V8 business event projection on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  let otherCompanyId: string;
  let issueId: string;
  let projectId: string;
  let policyId: string;
  let window: typeof timeWindow & { governanceObligationRefs: string[]; retentionDays: number };
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v8-events-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true });
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
    const policy = analyticalPurpose(); policy.citation = "Controlled process purpose";
    policy.analyticalPurpose!.purpose = "process_intelligence"; policy.analyticalPurpose!.capabilities = ["process"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
    window = { ...timeWindow, governanceObligationRefs: [policyId], retentionDays: 30 };
  });
  async function source(details: Record<string, unknown> = { status: "todo" }, overrides: Partial<typeof activityLog.$inferInsert> = {}) {
    const [row] = await db.insert(activityLog).values({ companyId, actorType: "user", actorId: "private-identity", action: "issue.updated", entityType: "issue", entityId: issueId, createdAt: new Date("2026-01-01T12:00:00Z"), details, ...overrides }).returning();
    return row;
  }
  const service = () => businessEventService(db);
  const stored = () => db.select().from(businessEvents).where(eq(businessEvents.companyId, companyId));

  it("upgrades the real prior schema by removing ungoverned legacy metadata and redundant audit counters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aw-v8-backfill-prior-migrations-"));
    const name = `aw_backfill_legacy_${randomUUID().replaceAll("-", "")}`;
    const target = new URL(database.connectionString); target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const legacy = createDb(target.toString());
    try {
      const migrationsRoot = new URL("../../../packages/db/src/migrations/", import.meta.url);
      const journal = JSON.parse(await readFile(new URL("meta/_journal.json", migrationsRoot), "utf8"));
      const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 450);
      await mkdir(join(directory, "meta"));
      for (const entry of entries) await copyFile(new URL(`${entry.tag}.sql`, migrationsRoot), join(directory, `${entry.tag}.sql`));
      await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      await migrate(legacy, { migrationsFolder: directory });
      await legacy.insert(companies).values({ id: companyId, name: "Legacy metadata software fixture", issuePrefix: randomUUID() });
      const id = randomUUID();
      await legacy.execute(sql`insert into business_event_backfill_runs
        (id,company_id,projector_version,window_from,window_until,last_source_cursor_json,batch_limit,projected,unchanged,status)
        values (${id}::uuid,${companyId}::uuid,'legacy-software-fixture',${timeWindow.from}::timestamptz,${timeWindow.until}::timestamptz,
          ${JSON.stringify({ at: timeWindow.from, id: randomUUID() })}::jsonb,100,1,0,'window_scan_exhausted')`);
      const [audit] = await legacy.insert(activityLog).values({ companyId, actorType: "user", actorId: "legacy-software-operator",
        action: "business_event.backfill_recorded", entityType: "business_event_backfill", entityId: id,
        details: { projector: "legacy-software-fixture", projected: 1, unchanged: 0 } }).returning();
      await applyPendingMigrations(target.toString());
      expect(await legacy.select().from(businessEventBackfillRuns)).toHaveLength(0);
      const [after] = await legacy.select().from(activityLog).where(eq(activityLog.id, audit.id));
      expect(after).toEqual({ ...audit, details: { projector: "legacy-software-fixture" } });
      expect(await legacy.select().from(companies)).toHaveLength(1);
      await expect(legacy.execute(sql`insert into business_event_backfill_runs
        (id,company_id,projector_version,window_from,window_until,batch_limit,projected,unchanged,status)
        values (${randomUUID()}::uuid,${companyId}::uuid,'legacy-software-fixture',${timeWindow.from}::timestamptz,${timeWindow.until}::timestamptz,100,1,0,'window_scan_exhausted')`))
        .rejects.toMatchObject({ cause: { code: "23502" } });
    } finally {
      await legacy.$client.end({ timeout: 1 });
      await db.execute(sql`drop database ${sql.identifier(name)} with (force)`);
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("erases and expires retained backfill metadata through its original Source lineage with rollout off", async () => {
    const first = await source();
    const second = await source({ status: "done" }, { createdAt: new Date("2026-01-01T12:01:00Z") });
    const one = await service().backfill(companyId, actor, { ...window, until: "2026-01-01T12:00:01Z", retentionDays: 1 });
    const two = await service().backfill(companyId, actor, { ...window, from: "2026-01-01T12:01:00Z", retentionDays: 1 });
    const [metadata] = await db.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.id, one.runId));
    expect(metadata.lineageManifestId).toBeTruthy();
    const [manifest] = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, metadata.lineageManifestId));
    expect(manifest.analysisType).toBe("business_event_backfill");
    expect(manifest.analysisRef).toBe(one.runId);
    const [audit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "business_event.backfill_recorded"), eq(activityLog.entityId, one.runId)));
    expect(audit.details).toEqual({ projector: manifest.engineVersion });
    expect(manifest.expiresAt.getTime() - manifest.createdAt.getTime()).toBeLessThanOrEqual(86_400_000);
    const flags = await instanceSettingsService(db).getExperimental();
    try {
      await disableV8Rollout(db);
      await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
      await service().suppressSource(companyId, actor, first.id);
      expect(await db.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.id, one.runId))).toHaveLength(0);
      expect(await db.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.id, two.runId))).toHaveLength(1);
      await expect(db.insert(businessEventBackfillRuns).values(metadata)).rejects.toThrow();
      await eraseExpiredAnalyticalLineage(db, new Date(Date.now() + 2 * 86_400_000));
      expect(await db.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.companyId, companyId))).toHaveLength(0);
      expect(await db.select().from(activityLog).where(sql`${activityLog.id} in (${first.id}::uuid,${second.id}::uuid)`)).toHaveLength(2);
      expect(await db.select().from(issues).where(eq(issues.id, issueId))).toHaveLength(1);
      // Keep the later bounded expiry fixture's global backlog independent.
      await service().suppressSource(companyId, actor, second.id);
    } finally {
      await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    }
  });

  it("inspects native source coverage before readiness and abstains after Memory erasure or for unqualified external sources", async () => {
    await source({ status: "todo",projectId },{ action:"issue.created" });
    await source({ status: "done",projectId },{ createdAt:new Date("2026-01-01T12:01:00Z") });
    const input={ ...window,analysisKey:"native_task_flow",businessQuestion:"How do native Task activities flow?",requiredSourceProviders:["activity_log"],
      requiredObjectTypes:["issue" as const],requiredActivities:["issue.created" as const,"issue.updated" as const],minimumCoverageSeconds:3600,
      requiresOrdering:true,requiresLifecycle:true,requiresArrivalEvidence:false,maxDuplicateRate:0,maxUnknownObjectRate:0,maxLateArrivalRate:0 };
    const readiness=processDataReadinessService(db);
    const { limit:_limit,...requirements }=input;
    await expect(readiness.assess(companyId,actor,requirements)).rejects.toMatchObject({ status:404 });
    await instanceSettingsService(db,{ runtimeEnv:{} }).updateExperimental({ analytical_lineage_v8:true,process_intelligence_v8:true });
    try {
      expect((await readiness.assess(companyId,actor,requirements)).admission).toBe("DATA_NOT_READY");
      await service().backfill(companyId,actor,window);
      const ready=await readiness.assess(companyId,actor,requirements);
      expect(ready).toMatchObject({companyId,admission:"DATA_READY",authorizedEventCount:2,coverage:"current_native_activity_snapshot"});
      expect((await readiness.assess(companyId,actor,{...requirements,requiredSourceProviders:["activity_log","crm"]})).admission).toBe("DATA_NOT_READY");
      await db.transaction(async rawTx => {
        const tx=rawTx as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);
        await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[issueId]);
        await eraseBusinessEventObjectUnderMemory(tx,companyId,"issue",issueId);
      });
      await expect(readiness.assess(companyId,actor,requirements)).rejects.toMatchObject({status:403});
    } finally { await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({process_intelligence_v8:false}); }
  });

  it("exports only current native business objects with exact time, qualified format and source-erasure lineage", async () => {
    const row = await source({ status: "done", projectId, body: "secret private message" });
    await service().backfill(companyId, actor, window);
    const exporter = businessEventExportService(db);
    await expect(exporter.exportPage(companyId, actor, { ...window, format: "ocel_2_json" })).rejects.toMatchObject({ status: 404 });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ process_ocel_export_v8: true });
    try {
      for (const format of ["native_jsonl", "ocel_2_json", "ocel_2_sqlite"] as const) {
        const artifact = await exporter.exportPage(companyId, actor, { ...window, format });
        expect(artifact.manifest).toMatchObject({ eventCount: 1, objectCount: 2, coverage: "bounded_current_authorized_page", privacy: "current_business_objects_no_person_attributes" });
        const payload = Buffer.from(artifact.payloadBase64,"base64");
        expect(payload.includes(Buffer.from("secret private message"))).toBe(false);
        expect(payload.includes(Buffer.from("private-identity"))).toBe(false);
        if (format === "ocel_2_json") {
          const log = JSON.parse(payload.toString());
          expect(log.events[0].relationships).toEqual(expect.arrayContaining([{ objectId: `issue:${issueId}`, qualifier: "primary" },{ objectId: `project:${projectId}`, qualifier: "related" }]));
          expect(log.objects.every((object: { relationships: unknown[] }) => object.relationships.length === 0)).toBe(true);
        }
        expect((await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,artifact.manifest.lineageManifestId))).some(edge => edge.inputType === "business_event_source" && edge.inputRef === row.id)).toBe(true);
      }
      await service().suppressSource(companyId,actor,row.id);
      expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId,companyId))).toHaveLength(0);
    } finally { await instanceSettingsService(db,{ runtimeEnv: {} }).updateExperimental({ process_ocel_export_v8: false }); }
  });

  it("erases export lineage at its declared expiry without deleting current event facts", async () => {
    await source(); await service().backfill(companyId,actor,window);
    const exporter = businessEventExportService(db);
    const expired = await exporter.exportPage(companyId,actor,{ ...window,retentionDays: 1, format: "native_jsonl" });
    const retained = await exporter.exportPage(companyId,actor,{ ...window,format: "native_jsonl" });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id,companyId));
    await instanceSettingsService(db,{ runtimeEnv: {} }).updateExperimental({ business_events_v8: false });
    try {
      await eraseExpiredAnalyticalLineage(db,new Date(Date.now()+2*86400000));
      expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,expired.manifest.lineageManifestId))).toHaveLength(0);
      expect(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,expired.manifest.lineageManifestId))).toHaveLength(0);
      expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,retained.manifest.lineageManifestId))).toHaveLength(1);
      expect(await stored()).toHaveLength(1);
    } finally {
      await db.update(companies).set({ status: "active" }).where(eq(companies.id,companyId));
      await instanceSettingsService(db,{ runtimeEnv: {} }).updateExperimental({ business_events_v8: true });
    }
  });

  it("requires current process purpose without inheriting metric authority or keeping a suspended source visible", async () => {
    await source();
    const metrics = await aiGovernanceService(db).obligation(actor, companyId, analyticalPurpose());
    await expect(service().backfill(companyId, actor, { ...window, governanceObligationRefs: [metrics.id] })).rejects.toMatchObject({ status: 409 });
    await expect(service().backfill(companyId, actor, { ...window, retentionDays: 31 })).rejects.toMatchObject({ status: 409 });
    expect(await stored()).toHaveLength(0);
    await service().backfill(companyId, actor, window);
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(1);
    const [current] = await db.select().from(governanceObligations).where(eq(governanceObligations.id, policyId));
    await aiGovernanceService(db).obligation(actor, companyId, { ...current.obligation, analyticalPurpose: { ...current.obligation.analyticalPurpose!, status: "suspended" } });
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
    await expect(service().backfill(companyId, actor, window)).rejects.toMatchObject({ status: 409 });
    expect(await stored()).toHaveLength(1);
  });

  it("cannot extend a correction chain's retention and erases expired or legacy payloads with rollout off", async () => {
    const row = await source(); await service().backfill(companyId, actor, { ...window, retentionDays: 1 });
    const [original] = await stored();
    await db.update(activityLog).set({ details: { status: "done" } }).where(eq(activityLog.id, row.id));
    await service().backfill(companyId, actor, window);
    expect((await stored()).every(event => event.expiresAt?.getTime() === original.expiresAt!.getTime())).toBe(true);
    await expect(db.update(businessEvents).set({ expiresAt: new Date(Date.now()+90*86400000) }).where(eq(businessEvents.id, original.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const retained = await source({ status: "in_progress" }); await service().backfill(companyId, actor, window);
    const legacy = await source({ status: "blocked" });
    await db.insert(businessEvents).values({ ...original, id: legacy.id, sourceRef: legacy.id, governanceObligationRefs: null, retentionDays: null, expiresAt: null });
    await db.insert(businessEventObjects).values({ companyId, eventId: legacy.id, objectType: "issue", objectId: issueId, qualifier: "primary" });
    expect((await service().list(companyId, actor, timeWindow)).items.map(event => event.source.ref)).not.toContain(legacy.id);
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: false });
    const now = new Date(Date.now()+2*86400000);
    try {
      expect(await service().expireDueSources(now)).toEqual({ checkedSources: 2, erasedSources: 2 });
      expect((await stored()).map(event => event.sourceRef)).toEqual([retained.id]);
      expect((await db.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId))).map(s => s.sourceRef).sort()).toEqual([row.id,legacy.id].sort());
      expect(await service().expireDueSources(now)).toEqual({ checkedSources: 0, erasedSources: 0 });
    } finally {
      await db.update(companies).set({ status: "active" }).where(eq(companies.id, companyId));
      await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true });
    }
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
    expect((await stored()).map(event => event.sourceRef)).toEqual([retained.id]);
  });

  it("deduplicates concurrent replay and keeps typed source facts without copying private payloads", async () => {
    const row = await source({ status: "done", priority: "high", projectId, body: "secret body", actorId: "secret actor", previousStatus: "secret status" });
    const results = await Promise.all([service().backfill(companyId, actor, window), service().backfill(companyId, actor, window)]);
    expect(results.reduce((n, r) => n + r.projected, 0)).toBe(1);
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
    expect(rows[0].attributes).toEqual({ status: "done", priority: "high" });
    const page = await service().list(companyId, actor, timeWindow);
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
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
    await service().backfill(companyId, actor, window);
    await db.update(activityLog).set({ details: { status: "todo" } }).where(eq(activityLog.id, row.id));
    await service().backfill(companyId, actor, window);
    const rows = (await stored()).sort((a, b) => a.revision - b.revision);
    expect(rows.map(r => r.revision)).toEqual([1, 2, 3]);
    expect(rows[1].supersedesEventId).toBe(rows[0].id);
    expect(rows[2].supersedesEventId).toBe(rows[1].id);
    expect(rows.slice(0, 2).every(r => r.tombstonedAt !== null)).toBe(true);
    expect((await service().list(companyId, actor, timeWindow)).items.map(r => r.revision)).toEqual([3]);
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
    await expect(service().list(companyId, outsider, timeWindow)).rejects.toMatchObject({ status: 403 });
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
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
  });

  it("reapplies post-backup suppression in native restore quarantine while flags are disabled, preserving unrelated sources", async () => {
    const erased = await source();
    const retained = await source({ status: "done" }, { createdAt: new Date("2026-01-01T12:01:00Z") });
    await service().backfill(companyId, actor, window);
    await db.update(activityLog).set({ details: { status: "in_progress" } }).where(eq(activityLog.id, erased.id));
    await service().backfill(companyId, actor, window);
    const exporter = businessEventExportService(db);
    const erasedExport = await exporter.exportPage(companyId,actor,{ ...window,from: "2026-01-01T12:00:00Z",until: "2026-01-01T12:00:00Z",format: "native_jsonl" });
    const retainedExport = await exporter.exportPage(companyId,actor,{ ...window,from: "2026-01-01T12:01:00Z",until: "2026-01-01T12:01:00Z",format: "native_jsonl" });
    const retainedBackfill = await service().backfill(companyId, actor, { ...window, from: "2026-01-01T12:01:00Z", until: "2026-01-01T12:01:00Z" });
    const backupBackfills = await db.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.companyId, companyId));
    const backupDirectory = await mkdtemp(join(tmpdir(), "aw-v8-backfill-archive-"));
    const backup = await runDatabaseBackup({ connectionString: database.connectionString, backupDir: backupDirectory,
      backupEngine: "javascript", retention: { dailyDays: 1, weeklyWeeks: 0, monthlyMonths: 0 } });
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`;
    const target = new URL(database.connectionString); target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const restored = createDb(target.toString());
    try {
      // The real archive/restore owner handles historical immutable Source
      // snapshots; ordinary INSERT intentionally rejects a superseded hash.
      await runDatabaseRestore({ connectionString: target.toString(), backupFile: backup.backupFile });
      // The old backup has projections, but no post-backup suppression register.
      const suppressedAt = new Date().toISOString();
      const marker = { company_id: companyId, source_ref: erased.id, suppressed_at: suppressedAt };
      const ledger = { companies: [], memory: [], analyticalSources: [], businessEvents: [marker, marker,
        { ...marker, company_id: otherCompanyId, source_ref: retained.id },
        { ...marker, company_id: randomUUID() }] };
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await instanceSettingsService(restored).getExperimental()).business_events_v8).toBe(false);
      expect(await restored.select().from(businessEvents).where(eq(businessEvents.sourceRef, erased.id))).toHaveLength(0);
      expect(await restored.select().from(businessEventObjects).where(eq(businessEventObjects.eventId, erased.id))).toHaveLength(0);
      expect(await restored.select().from(businessEvents).where(eq(businessEvents.sourceRef, retained.id))).toHaveLength(1);
      expect(await restored.select().from(businessEventSuppressions).where(eq(businessEventSuppressions.companyId, companyId))).toHaveLength(1);
      expect(await restored.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,erasedExport.manifest.lineageManifestId))).toHaveLength(0);
      expect(await restored.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,erasedExport.manifest.lineageManifestId))).toHaveLength(0);
      expect(await restored.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,retainedExport.manifest.lineageManifestId))).toHaveLength(1);
      expect((await restored.select().from(businessEventBackfillRuns).where(eq(businessEventBackfillRuns.companyId, companyId))).map(row => row.id)).toEqual([retainedBackfill.runId]);
      await expect(restored.insert(businessEventBackfillRuns).values(backupBackfills.find(row => row.id !== retainedBackfill.runId)!)).rejects.toThrow();
      await instanceSettingsService(restored, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true });
      expect((await businessEventService(restored).backfill(companyId, actor, window)).projected).toBe(0);
      expect((await businessEventService(restored).list(companyId, actor, timeWindow)).items.map(event => event.source.ref)).toEqual([retained.id]);
    } finally {
      await restored.$client.end({ timeout: 1 });
      await rm(backupDirectory, { recursive: true, force: true });
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
      await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true });
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
    const eventsOne = await service().list(companyId, actor, { ...timeWindow, limit: 1 });
    expect(eventsOne.items[0].occurredAt).toBe("2026-01-01T12:00:00.123456Z");
    expect(eventsOne.nextCursor?.at).toBe("2026-01-01T12:00:00.123456Z");
    const eventsTwo = await service().list(companyId, actor, { ...timeWindow, limit: 1, cursor: eventsOne.nextCursor! });
    expect(eventsTwo.items).toHaveLength(1);
    expect(eventsTwo.items[0].id).not.toBe(eventsOne.items[0].id);
    const exhausted = await service().list(companyId, actor, { ...timeWindow, limit: 1, cursor: eventsTwo.nextCursor! });
    expect(exhausted.items).toHaveLength(0);
    expect(exhausted.nextCursor).toBeNull();
    await db.execute(sql`update activity_log set created_at='2026-01-01T12:00:00.123457Z'::timestamptz where id=${first.id}::uuid`);
    expect((await service().list(companyId, actor, timeWindow)).items.map(item => item.source.ref)).not.toContain(first.id);
  });

  it("hides a retained hidden Task and a Task moved to a foreign current project", async () => {
    await source(); await service().backfill(companyId, actor, window);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, issueId));
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
    const foreignId = randomUUID(); await db.insert(projects).values({ id: foreignId, companyId: otherCompanyId, name: "Foreign current project" });
    await db.update(issues).set({ hiddenAt: null, projectId: foreignId }).where(eq(issues.id, issueId));
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
    expect((await service().backfill(companyId, actor, window)).unchanged).toBe(0);
  });

  it("does not lend a visible unrelated object's authority to altered retained event bindings", async () => {
    await source(); await service().backfill(companyId, actor, window);
    const [event] = await stored(); const visibleId = randomUUID();
    await db.insert(issues).values({ id: visibleId, companyId, projectId, title: "Unrelated visible source" });
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, issueId));
    await db.update(businessEventObjects).set({ objectId: visibleId }).where(eq(businessEventObjects.eventId, event.id));
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
  });

  it("permits explicit payload suppression after feature rollback", async () => {
    const row = await source(); await service().backfill(companyId, actor, window);
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: false });
    try { await service().suppressSource(companyId, actor, row.id); expect(await stored()).toHaveLength(0); }
    finally { await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true }); }
  });

  it("waits for native Memory erasure before taking source rows or returning retained events", async () => {
    await source(); await service().backfill(companyId, actor, window);
    let releaseMemory!: () => void, signalHeld!: () => void;
    const held = new Promise<void>(resolve => { signalHeld = resolve; });
    const release = new Promise<void>(resolve => { releaseMemory = resolve; });
    const erasure = db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); signalHeld(); await release;
      await tx.execute(sql`set local lock_timeout='1s'`);
      await eraseAnalyticalSourcesUnderMemory(tx, companyId, "issue", [issueId]);
      await eraseBusinessEventObjectUnderMemory(tx, companyId, "issue", issueId);
      await tx.update(issues).set({ title: "Erased workflow task", description: null }).where(eq(issues.id, issueId));
    });
    await held; const read = service().list(companyId, actor, timeWindow);
    try {
      let blocked = false; const deadline = performance.now()+5000;
      while (performance.now()<deadline) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())) as waiting`);
        if (row.waiting) { blocked = true; break; } await new Promise(resolve => setTimeout(resolve,20));
      }
      expect(blocked).toBe(true); releaseMemory(); await erasure;
      expect((await read).items).toHaveLength(0);
    } finally { releaseMemory(); await Promise.allSettled([erasure,read]); }
  });

  it("removes deleted source visibility and preserves disabled-feature admission", async () => {
    const row = await source();
    await service().backfill(companyId, actor, window);
    await db.delete(activityLog).where(eq(activityLog.id, row.id));
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: false });
    await expect(service().list(companyId, actor, timeWindow)).rejects.toMatchObject({ status: 404 });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_events_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true });
  });

  it("keeps composite references company-scoped in the database", async () => {
    await source();
    await service().backfill(companyId, actor, window);
    const [event] = await stored();
    await expect(db.insert(businessEventObjects).values({ companyId: otherCompanyId, eventId: event.id, objectType: "issue", objectId: issueId, qualifier: "primary" })).rejects.toThrow();
  });

  it("validates time windows numerically across ISO fractional formats and caps batch size", () => {
    expect(businessEventBackfillSchema.safeParse({ ...window, from: "2026-01-01T00:00:00Z", until: "2026-01-01T00:00:00.100Z", limit: 200 }).success).toBe(true);
    expect(businessEventBackfillSchema.safeParse({ ...window, limit: 201 }).success).toBe(false);
    expect(businessEventBackfillSchema.safeParse({ ...window, from: window.until, until: window.from }).success).toBe(false);
  });
  it("denies late and restored activity projections after Memory erases a retained native Task", async () => {
    await source({ status: "done" }); await service().backfill(companyId, actor, window);
    const [original] = await stored();
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, companyId);
      await eraseAnalyticalSourcesUnderMemory(tx, companyId, "issue", [issueId]);
      await eraseBusinessEventObjectUnderMemory(tx, companyId, "issue", issueId);
      await tx.update(issues).set({ title: "Erased workflow task", description: null }).where(eq(issues.id, issueId));
    });
    expect(await stored()).toHaveLength(0);
    const late = await source({ status: "done" });
    expect((await service().backfill(companyId, actor, window)).projected).toBe(0);
    // The late source identity had no event suppression marker at erasure.
    // Retaining the object guard must still deny its restored payload.
    await db.insert(businessEvents).values({ ...original, id: late.id, sourceRef: late.id });
    await db.insert(businessEventObjects).values({ companyId, eventId: late.id, objectType: "issue", objectId: issueId, qualifier: "primary" });
    expect((await service().list(companyId, actor, timeWindow)).items).toHaveLength(0);
  });
});
