import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, analyticalSourceSuppressions, businessMetricObservations, businessMetricVersions, businessMetricPublications, businessMetrics, applyPendingMigrations, companies, createDb, governanceObligations, issues, projects } from "@paperclipai/db";
import { businessMetricDefinitionSchema, queryBusinessMetricSchema } from "@paperclipai/shared";
import { currentAnalyticalPurpose } from "../services/analytical-purpose.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { assertDatabaseRestoreAdmission, prepareRestoredQuarantine } from "../services/saas/quarantine.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { issueService } from "../services/issues.js";
import { projectService } from "../services/projects.js";
import { analyticalPurpose, metricDefinition } from "./helpers/business-metric-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("governed native metric owner on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string; let otherCompanyId: string; let policyId: string; let projectId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-metrics-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    companyId = randomUUID(); otherCompanyId = randomUUID(); projectId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Metric test", issuePrefix: randomUUID() }, { id: otherCompanyId, name: "Other metric test", issuePrefix: randomUUID() }]);
    await db.insert(projects).values({ id: projectId, companyId, name: "Source project" });
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, analyticalPurpose())).id;
  });
  const service = () => businessMetricService(db);
  async function source(status: string, overrides: Partial<typeof issues.$inferInsert> = {}) {
    const [row] = await db.insert(issues).values({ companyId, title: "Private title must not enter analytics", description: "Sensitive prose", projectId, status, createdAt: new Date("2026-01-01T12:00:00Z"), ...overrides }).returning(); return row;
  }
  async function published(definition = metricDefinition(policyId)) {
    const created = await service().create(companyId, actor, { key: `metric_${randomUUID().replaceAll("-", "")}`, definition });
    const metric = await service().publish(companyId, actor, created.metric.id, { expectedRevision: 1, versionId: created.version.id });
    return { ...created, metric };
  }
  function query(metricId: string, versionId: string, overrides: Record<string, unknown> = {}) {
    return queryBusinessMetricSchema.parse({ metricId, versionId, from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", ...overrides });
  }
  const observations = () => db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, companyId));

  it("requires an explicitly approved strategy capability without inheriting ordinary metric permission", async () => {
    await expect(currentAnalyticalPurpose(db, companyId, metricDefinition(policyId), "strategy")).rejects.toMatchObject({ status: 409 });
    const profile = analyticalPurpose(); profile.citation = "Independent strategy-link processing policy";
    profile.analyticalPurpose!.capabilities = ["strategy"];
    const policy = await aiGovernanceService(db).obligation(actor, companyId, profile);
    const declared = { ...metricDefinition(policy.id), governanceObligationRefs: [policy.id] };
    expect((await currentAnalyticalPurpose(db, companyId, declared, "strategy")).map(row => row.id)).toEqual([policy.id]);
    await expect(currentAnalyticalPurpose(db, companyId, declared, "metrics")).rejects.toMatchObject({ status: 409 });
    profile.analyticalPurpose!.status = "suspended";
    await aiGovernanceService(db).obligation(actor, companyId, profile);
    await expect(currentAnalyticalPurpose(db, companyId, declared, "strategy")).rejects.toMatchObject({ status: 409 });
  });

  it("uses a complete half-open native population, current status and exact definition/source lineage without copying prose", async () => {
    await source("done"); await source("todo"); await source("todo");
    await source("done", { createdAt: new Date("2026-01-02T00:00:00Z") });
    await source("done", { companyId: otherCompanyId, projectId: null });
    const registered = await published();
    const result = await service().query(companyId, actor, query(registered.metric.id, registered.version.id, { dimensions: ["project"] }));
    expect(result).toMatchObject({ status: "observed", value: 1 / 3, definitionHash: registered.version.contentHash });
    expect(result.groups).toEqual([{ dimensions: { project: projectId }, value: 1 / 3, numerator: 1, denominator: 3 }]);
    const manifests = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId, companyId));
    expect(manifests).toHaveLength(1); expect(manifests[0].sourceCount).toBe(3);
    const edges = await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.companyId, companyId));
    expect(edges).toHaveLength(6); expect(edges.filter(e => e.inputType === "issue")).toHaveLength(3);
    expect(JSON.stringify([result, manifests, edges])).not.toContain("Private title");
    expect(JSON.stringify([result, manifests, edges])).not.toContain("Sensitive prose");
    expect(await observations()).toHaveLength(1);
  });

  it("retains immutable published definitions and rejects concurrent stale edits with native CAS", async () => {
    const registered = await published();
    await expect(db.update(businessMetricVersions).set({ contentHash: "b".repeat(64) }).where(eq(businessMetricVersions.id, registered.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const changed = { ...registered.version.definition, description: "Changed decision interpretation" };
    const outcomes = await Promise.allSettled([service().createVersion(companyId, actor, registered.metric.id, { expectedRevision: 2, definition: changed }), service().createVersion(companyId, actor, registered.metric.id, { expectedRevision: 2, definition: changed })]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(r => r.status === "rejected")).toHaveLength(1);
    const detail = await service().detail(companyId, actor, registered.metric.id);
    expect(detail.metric.publishedVersionId).toBe(registered.version.id);
    expect(detail.versions.find(v => v.id === registered.version.id)?.contentHash).toBe(registered.version.contentHash);
    const draft = detail.versions.find(v => v.id !== registered.version.id)!;
    await expect(service().query(companyId, actor, query(registered.metric.id, draft.id))).rejects.toMatchObject({ status: 409 });
    expect((await service().query(companyId, actor, query(registered.metric.id, registered.version.id))).status).toBe("undefined");
  });

  it("rejects foreign tenant/version references, missing company authority and mixed-tenant database lineage", async () => {
    const registered = await published();
    await expect(service().detail(otherCompanyId, actor, registered.metric.id)).rejects.toMatchObject({ status: 404 });
    await expect(service().query(companyId, actor, query(registered.metric.id, randomUUID()))).rejects.toMatchObject({ status: 409 });
    const outsider = { type: "agent" as const, source: "agent_key" as const, companyId: otherCompanyId, agentId: randomUUID() };
    await expect(service().query(companyId, outsider, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 403 });
    await expect(db.insert(businessMetricVersions).values({ companyId: otherCompanyId, metricId: registered.metric.id, revision: 99, definition: registered.version.definition, contentHash: registered.version.contentHash, createdBy: "test" })).rejects.toMatchObject({ cause: { code: "23503" } });
  });

  it("requires an explicit approved current purpose rather than ordinary legal evidence", async () => {
    const legal = analyticalPurpose(); delete legal.analyticalPurpose; legal.citation = "Ordinary legal evidence";
    const plain = await aiGovernanceService(db).obligation(actor, companyId, legal);
    await expect(service().create(companyId, actor, { key: "legal_only", definition: metricDefinition(plain.id) })).rejects.toMatchObject({ status: 409 });
    const other = await aiGovernanceService(db).obligation(actor, otherCompanyId, analyticalPurpose());
    await expect(service().create(companyId, actor, { key: "foreign_policy", definition: metricDefinition(other.id) })).rejects.toMatchObject({ status: 409 });
    await expect(service().create(companyId, actor, { key: "retention_exceeded", definition: { ...metricDefinition(policyId), retentionDays: 31 } })).rejects.toMatchObject({ status: 409 });
    const registered = await published();
    const suspended = analyticalPurpose(); suspended.analyticalPurpose!.status = "suspended";
    await aiGovernanceService(db).obligation(actor, companyId, suspended);
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 409 });
    expect(await observations()).toHaveLength(0);
  });

  it("rejects partial populations and undeclared breakdowns without retaining an observation", async () => {
    await source("done"); await source("todo"); const registered = await published();
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id, { maxRows: 1 }))).rejects.toMatchObject({ status: 422, details: { code: "metric_population_budget_exceeded" } });
    const noDimensions = await published({ ...metricDefinition(policyId), dimensions: [] });
    await expect(service().query(companyId, actor, query(noDimensions.metric.id, noDimensions.version.id, { dimensions: ["status"] }))).rejects.toMatchObject({ status: 400 });
    expect(await observations()).toHaveLength(0);
    expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId, companyId))).toHaveLength(0);
  });

  it("preserves explicit unknown for an empty denominator", async () => {
    const registered = await published();
    expect(await service().query(companyId, actor, query(registered.metric.id, registered.version.id))).toMatchObject({ status: "undefined", value: null, reason: "empty_denominator", groups: [] });
  });

  it("erases dependent analytical observations through the native issue owner even while feature flags are disabled", async () => {
    const issue = await source("done"); const registered = await published();
    await service().query(companyId, actor, query(registered.metric.id, registered.version.id));
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_metrics_v8: false, analytical_lineage_v8: false });
    await issueService(db).remove(issue.id);
    expect(await observations()).toHaveLength(0);
    expect(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId, companyId))).toHaveLength(0);
  });

  it("tracks a selected project even when its metric population is empty so native erasure invalidates the result", async () => {
    const definition = metricDefinition(policyId);
    if (definition.calculation.kind !== "native_ratio") throw new Error("fixture");
    definition.calculation.numerator = { entity: "issue", statuses: ["done"], projectId };
    definition.calculation.denominator = { entity: "issue", statuses: ["todo", "done"], projectId };
    const registered = await published(definition);
    await service().query(companyId, actor, query(registered.metric.id, registered.version.id));
    await projectService(db).remove(projectId);
    expect(await observations()).toHaveLength(0);
  });

  it("keeps external authoritative metrics unavailable until provider qualification without falling back to native counts", async () => {
    await source("done");
    const external = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), authorityMode: "external_authoritative", grain: "external_entity", timeSemantics: "external_provider_defined",
      calculation: { kind: "external_metric", providerKey: "metricflow", connectionId: randomUUID(), providerMetricRef: "revenue", providerVersion: "test/v1", definitionHash: "a".repeat(64), qualificationHash: "b".repeat(64) } });
    const registered = await published(external);
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 422, details: { code: "external_metric_provider_unqualified" } });
    expect(await observations()).toHaveLength(0);
  });

  it("rechecks purpose expiry and feature admission at query time", async () => {
    const purpose = analyticalPurpose();
    const expires = Date.now() + 86_400_000;
    purpose.nextReviewAt = new Date(expires).toISOString();
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, purpose)).id;
    const registered = await published();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(expires + 86_400_000));
      await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 409 });
    } finally { vi.useRealTimers(); }
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_metrics_v8: false });
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 404 });
  });
  it("keeps revocation available after rollback and prevents re-publication of revoked metrics", async () => {
    const registered = await published();
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_metrics_v8: false });
    const stopped = await service().transition(companyId, actor, registered.metric.id, { expectedRevision: 2, status: "revoked", reason: "Approved purpose withdrawn" });
    expect(stopped.status).toBe("revoked");
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 409 });
    await expect(service().publish(companyId, actor, registered.metric.id, { expectedRevision: 3, versionId: registered.version.id })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects metric owners outside the current company principal directory", async () => {
    await expect(service().create(companyId, actor, { key: "foreign_owner", definition: { ...metricDefinition(policyId), ownerUserId: "unregistered-human" } })).rejects.toMatchObject({ status: 409 });
  });

  it("blocks overdue definition versions independently of a still-current purpose", async () => {
    const registered = await published();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 31 * 86_400_000));
      await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 409, message: "Metric definition review is overdue; publish a current review version" });
    } finally { vi.useRealTimers(); }
  });

  it("rejects the complete population before aggregation when a contributing project belongs to another company", async () => {
    await source("done");
    const [foreign] = await db.insert(projects).values({ companyId: otherCompanyId, name: "Foreign private project" }).returning();
    await source("todo", { projectId: foreign.id });
    const registered = await published();
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 403 });
    expect(await observations()).toHaveLength(0);
  });

  it("retains a content-free source guard and rejects late or restored analytical input after native erasure without an activity source", async () => {
    const issue = await source("done"); const registered = await published();
    const result = await service().query(companyId, actor, query(registered.metric.id, registered.version.id));
    const [manifest] = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, result.lineageManifestId));
    const edges = await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId, manifest.id));
    await issueService(db).remove(issue.id);
    const guards = await db.select().from(analyticalSourceSuppressions).where(eq(analyticalSourceSuppressions.companyId, companyId));
    expect(guards).toHaveLength(1); expect(guards[0]).toMatchObject({ inputType: "issue", inputRef: issue.id });
    expect(Object.keys(guards[0]).sort()).toEqual(["companyId", "inputRef", "inputType", "suppressedAt"]);
    // Simulate pre-deletion source/manifest payload arriving after its retained guard.
    await db.insert(issues).values(issue);
    await db.insert(analyticalLineageManifests).values(manifest);
    await expect(db.insert(analyticalLineageEdges).values(edges.find(edge => edge.inputType === "issue")!)).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(service().query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 409 });
    expect(await observations()).toHaveLength(0);
  });

  it("rejects altered evidence snapshots and an observation associated with an inconsistent lineage manifest", async () => {
    await source("done"); const registered = await published();
    const result = await service().query(companyId, actor, query(registered.metric.id, registered.version.id));
    await expect(db.update(analyticalLineageManifests).set({ sourceCount: 99 }).where(eq(analyticalLineageManifests.id, result.lineageManifestId))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessMetricObservations).set({ inputHash: "c".repeat(64) }).where(eq(businessMetricObservations.id, result.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const [observation] = await observations();
    await expect(db.insert(businessMetricObservations).values({ ...observation, id: randomUUID() })).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("rechecks stored observations against current authority, lineage completeness and native erasure", async () => {
    const issue = await source("done"); const registered = await published();
    const result = await service().query(companyId, actor, query(registered.metric.id, registered.version.id));
    expect(await service().inspectCurrentObservation(companyId, actor, result.id)).toMatchObject({ id: result.id, value: 1 });
    const [foreign] = await db.insert(projects).values({ companyId: otherCompanyId, name: "Now private in another company" }).returning();
    await db.update(issues).set({ projectId: foreign.id }).where(eq(issues.id, issue.id));
    await expect(service().inspectCurrentObservation(companyId, actor, result.id)).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ projectId }).where(eq(issues.id, issue.id));
    await db.delete(analyticalLineageEdges).where(sql`${analyticalLineageEdges.manifestId}=${result.lineageManifestId} and ${analyticalLineageEdges.inputType}='issue'`);
    await expect(service().inspectCurrentObservation(companyId, actor, result.id)).rejects.toMatchObject({ status: 409 });
    await issueService(db).remove(issue.id);
    await expect(service().inspectCurrentObservation(companyId, actor, result.id)).rejects.toMatchObject({ status: 409 });
  });

  it("takes privacy locks before native issue row deletion when Memory owns a concurrent source update", async () => {
    const issue = await source("done");
    let releaseMemory!: () => void; let signalLocked!: () => void;
    const held = new Promise<void>(resolve => { signalLocked = resolve; });
    const release = new Promise<void>(resolve => { releaseMemory = resolve; });
    const memory = db.transaction(async tx => {
      await lockMemoryPrivacy(tx as unknown as typeof db, companyId);
      signalLocked(); await release;
      await tx.execute(sql`set local lock_timeout = '1s'`);
      await tx.update(issues).set({ description: "Privacy-reconciled native source" }).where(eq(issues.id, issue.id));
    });
    await held;
    const deletion = issueService(db).remove(issue.id);
    try {
      const deadline = performance.now() + 5000; let blocked = false;
      while (performance.now() < deadline) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_locks
          where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())) as waiting`);
        if (row.waiting) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      releaseMemory();
      await expect(memory).resolves.toBeUndefined();
      expect(await deletion).toMatchObject({ id: issue.id });
    } finally {
      releaseMemory(); await Promise.allSettled([memory, deletion]);
    }
  });

  it("reapplies post-backup analytical deletion in isolated native quarantine with flags off and preserves unrelated observations", async () => {
    const erased = await source("done"); await source("todo");
    const registered = await published();
    const erasedResult = await service().query(companyId, actor, query(registered.metric.id, registered.version.id));
    const retainedDefinition = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), valueType: "count", unit: "objects", calculation: { kind: "native_count", population: { entity: "issue", statuses: ["todo"], projectId: null } } });
    const retained = await published(retainedDefinition);
    const retainedResult = await service().query(companyId, actor, query(retained.metric.id, retained.version.id));
    const backup = {
      companies: await db.select().from(companies).where(sql`${companies.id} in (${companyId}::uuid, ${otherCompanyId}::uuid)`),
      projects: await db.select().from(projects).where(eq(projects.companyId, companyId)),
      issues: await db.select().from(issues).where(eq(issues.companyId, companyId)),
      policies: await db.select().from(governanceObligations).where(eq(governanceObligations.companyId, companyId)),
      metrics: await db.select().from(businessMetrics).where(eq(businessMetrics.companyId, companyId)),
      versions: await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.companyId, companyId)),
      publications: await db.select().from(businessMetricPublications).where(eq(businessMetricPublications.companyId, companyId)),
      manifests: await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId, companyId)),
      edges: await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.companyId, companyId)),
      observations: await observations(),
    };
    await issueService(db).remove(erased.id);
    const guard = (await db.select().from(analyticalSourceSuppressions).where(eq(analyticalSourceSuppressions.companyId, companyId)))[0];
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`;
    const target = new URL(database.connectionString); target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const restored = createDb(target.toString());
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(backup.companies);
      await restored.insert(projects).values(backup.projects);
      await restored.insert(issues).values(backup.issues);
      await restored.insert(governanceObligations).values(backup.policies);
      // Break only the insert-order cycle; restore the canonical pointers after versions.
      await restored.insert(businessMetrics).values(backup.metrics.map(row => ({ ...row, publishedVersionId: null, status: "draft" as const })));
      await restored.insert(businessMetricVersions).values(backup.versions);
      for (const row of backup.metrics) await restored.update(businessMetrics).set({ status: row.status, publishedVersionId: row.publishedVersionId }).where(eq(businessMetrics.id, row.id));
      await restored.insert(businessMetricPublications).values(backup.publications);
      await restored.insert(analyticalLineageManifests).values(backup.manifests);
      await restored.insert(analyticalLineageEdges).values(backup.edges);
      await restored.insert(businessMetricObservations).values(backup.observations);
      const marker = { company_id: guard.companyId, input_type: guard.inputType, input_ref: guard.inputRef, suppressed_at: guard.suppressedAt.toISOString() };
      await prepareRestoredQuarantine(restored, target.toString(), { companies: [], memory: [], businessEvents: [], analyticalSources: [marker, marker,
        { ...marker, company_id: otherCompanyId }, { ...marker, company_id: randomUUID() }] });
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await instanceSettingsService(restored).getExperimental()).business_metrics_v8).toBe(false);
      const kept = await restored.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, companyId));
      expect(kept.map(row => row.id)).toEqual([retainedResult.id]);
      expect(await restored.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, erasedResult.lineageManifestId))).toHaveLength(0);
      expect(await restored.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId, erasedResult.lineageManifestId))).toHaveLength(0);
      expect(await restored.select().from(analyticalSourceSuppressions).where(eq(analyticalSourceSuppressions.companyId, companyId))).toHaveLength(1);
      // Direct service exercise cannot clear the application's independent quarantine gate.
      await instanceSettingsService(restored, { runtimeEnv: {} }).updateExperimental(flags);
      await expect(businessMetricService(restored).query(companyId, actor, query(registered.metric.id, registered.version.id))).rejects.toMatchObject({ status: 409 });
      expect((await businessMetricService(restored).query(companyId, actor, query(retained.metric.id, retained.version.id))).value).toBe(1);
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
    } finally {
      await restored.$client.end({ timeout: 1 });
      await db.execute(sql`drop database ${sql.identifier(name)}`);
    }
  }, 30000);

});
