import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { companies, projects, businessExperiments, businessExperimentVersions, businessExperimentTransitions, businessExperimentMetricPins, businessMetricVersions, analyticalLineageManifests, analyticalLineageEdges, createDb } from "@paperclipai/db";
import { ISSUE_STATUSES, businessMetricDefinitionSchema } from "@paperclipai/shared";
import { businessExperimentService } from "../services/business-experiments/service.js";
import { businessExperimentRoutes } from "../routes/business-experiments.js";
import { errorHandler } from "../middleware/index.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { eraseExpiredAnalyticalLineage } from "../services/analytical-retention.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { metricDefinition, analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { experimentDefinition } from "./helpers/business-experiment-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport(), suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, business_experiments_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
const rationale = "Explicit human review of the exact native protocol and source authority";
suite("Native governed experiment preregistration on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-experiment-"); db = createDb(database.connectionString); });
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    companyId = randomUUID(); otherId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Experiment tenant", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign tenant", issuePrefix: randomUUID() }]);
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "experiment"]; policy.analyticalPurpose!.permittedSensitivity = ["internal", "confidential"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
  });
  const service = () => businessExperimentService(db);
  function app() {
    const value = express(); value.use(express.json());
    value.use((req, _res, next) => { req.actor = { ...actor, userId: "local-board" }; next(); });
    value.use("/api", businessExperimentRoutes(db)); value.use(errorHandler); return value;
  }
  async function draft(options: { filtered?: boolean; confidential?: boolean; projectId?: string } = {}) {
    const sources = [];
    for (const status of ["done", "cancelled", "in_progress"] as const) {
      const definition = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), sensitivity: options.confidential ? "confidential" : "internal",
        calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: [status], projectId: options.projectId ?? null }, denominator: { entity: "issue", statuses: options.filtered ? ["todo", "done", "cancelled", "in_progress"] : [...ISSUE_STATUSES], projectId: options.projectId ?? null } } });
      const metric = await businessMetricService(db).create(companyId, actor, { key: `metric_${randomUUID().replaceAll("-", "")}`, definition });
      await businessMetricService(db).publish(companyId, actor, metric.metric.id, { expectedRevision: 1, versionId: metric.version.id }); sources.push(metric);
    }
    const definition = experimentDefinition(policyId, sources.map(item => ({ id: item.metric.id, versionId: item.version.id })));
    if (options.confidential) definition.sensitivity = "confidential";
    if (options.projectId) definition.scope = { type: "project", id: options.projectId };
    const created = await service().create(companyId, actor, { key: `experiment_${randomUUID().replaceAll("-", "")}`, definition });
    return { ...created, definition, sources };
  }
  async function ready() {
    const d = await draft();
    await service().transition(companyId, actor, d.experiment.id, { expectedRevision: 1, versionId: d.version.id, state: "in_review", rationale });
    const experiment = await service().transition(companyId, actor, d.experiment.id, { expectedRevision: 2, versionId: d.version.id, state: "ready", rationale });
    return { ...d, experiment };
  }
  it("captures exact native definitions and retains separate human review/readiness receipts", async () => {
    const d = await ready(); expect(d.experiment).toMatchObject({ state: "ready", revision: 3, currentVersionId: d.version.id });
    expect(d.version.metricPins.map(item => item.role)).toEqual(["primary", "guardrail", "invariant"]);
    expect(d.version.metricPins[2].metricVersionId).toBe(d.sources[2].version.id);
    const detail = await service().detail(companyId, actor, d.experiment.id);
    expect(detail.transitions.map(item => item.toState)).toEqual(["ready", "in_review"]);
    expect(detail.versions[0]).toMatchObject({ contentHash: d.version.contentHash, currentQualification: "current" });
    expect((await service().list(companyId, actor)).items.map(item => item.experiment.id)).toEqual([d.experiment.id]);
    await expect(service().transition(companyId, actor, d.experiment.id, { expectedRevision: 3, versionId: d.version.id, state: "running", rationale })).rejects.toMatchObject({ status: 409 });
    expect((await service().detail(companyId, actor, d.experiment.id)).experiment.state).toBe("ready");
  });
  it("rejects status-filtered denominators rather than dropping intent-to-treat subjects", async () => {
    await expect(draft({ filtered: true })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(businessExperiments).where(eq(businessExperiments.companyId, companyId))).toHaveLength(0);
  });
  it("serves source-authorized no-store APIs and rejects stale accounts, unknown queries and pasted authority", async () => {
    const d = await draft(), base = `/api/companies/${companyId}/experiments`, server = app();
    const detail = await request(server).get(`${base}/${d.experiment.id}?expectedUserId=local-board`);
    expect(detail.status).toBe(200); expect(detail.headers["cache-control"]).toBe("no-store"); expect(detail.body.versions[0].contentHash).toBe(d.version.contentHash);
    const oldAccount = await request(server).get(`${base}/${d.experiment.id}?expectedUserId=old-account`);
    expect(oldAccount.status).toBe(409); expect(JSON.stringify(oldAccount.body)).not.toContain(d.definition.hypothesis);
    expect((await request(server).get(`${base}?trusted=true`)).status).toBe(400);
    expect((await request(server).get(`${base}?cursor=not-a-uuid`)).status).toBe(400);
    const denied = await request(server).post(`${base}/${d.experiment.id}/transition`).send({ expectedRevision: 1, versionId: d.version.id, state: "in_review", rationale, approved: true });
    expect(denied.status).toBe(400); expect((await service().detail(companyId, actor, d.experiment.id)).experiment.revision).toBe(1);
    const created = await request(server).post(base).send({ key: `api_${randomUUID().replaceAll("-", "")}`, definition: d.definition }); expect(created.status).toBe(201);
  });
  it("reasoned amendments reset review and preserve the original protocol rather than rewriting it", async () => {
    const d = await ready(), definition = { ...d.definition, hypothesis: "Explicit new hypothesis requiring a separate human review before any execution" };
    const revised = await service().amend(companyId, actor, d.experiment.id, { expectedRevision: 3, definition, reason: "Clarify the hypothesis before assignment and exposure are authorized" });
    expect(revised.experiment).toMatchObject({ revision: 4, state: "draft", currentVersionId: revised.version.id });
    expect(revised.version.contentHash).not.toBe(d.version.contentHash);
    const detail = await service().detail(companyId, actor, d.experiment.id); expect(detail.versions).toHaveLength(2); expect(detail.versions[1].contentHash).toBe(d.version.contentHash);
    await expect(service().transition(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, state: "in_review", rationale })).rejects.toMatchObject({ status: 409 });
  });
  it("enforces CAS under concurrent review and amendment without losing either history", async () => {
    const d = await draft();
    const results = await Promise.allSettled([
      service().transition(companyId, actor, d.experiment.id, { expectedRevision: 1, versionId: d.version.id, state: "in_review", rationale }),
      service().amend(companyId, actor, d.experiment.id, { expectedRevision: 1, definition: d.definition, reason: rationale }),
    ]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1); expect(results.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((await service().detail(companyId, actor, d.experiment.id)).experiment.revision).toBe(2);
  });
  it("keeps historical invariant pins fixed when publication changes and blocks renewed readiness", async () => {
    const d = await ready(), source = d.sources[2];
    const next = await businessMetricService(db).createVersion(companyId, actor, source.metric.id, { expectedRevision: 2, definition: source.version.definition });
    await businessMetricService(db).publish(companyId, actor, source.metric.id, { expectedRevision: 3, versionId: next.id });
    const historical = await service().detail(companyId, actor, d.experiment.id);
    expect(historical.versions[0]).toMatchObject({ contentHash: d.version.contentHash, currentQualification: "needs_revalidation" });
    expect(historical.versions[0].metricPins[2].metricVersionId).toBe(source.version.id);
    await expect(service().transition(companyId, actor, d.experiment.id, { expectedRevision: 3, versionId: d.version.id, state: "in_review", rationale })).rejects.toMatchObject({ status: 409 });
    const amended = await service().amend(companyId, actor, d.experiment.id, { expectedRevision: 3, definition: d.definition, reason: "Review the changed native invariant definition before execution" });
    expect(amended.version.metricPins[2].metricVersionId).toBe(next.id);
  });
  it("requires independent purpose, current human ownership and admitted personal-impact boundaries", async () => {
    const d = await draft(), policy = analyticalPurpose();
    const onlyMetrics = (await aiGovernanceService(db).obligation(actor, companyId, { ...policy, citation: "Metrics only, no experiment authority" })).id;
    const attempts = [ { ...d.definition, governanceObligationRefs: [onlyMetrics] }, { ...d.definition, ownerUserId: "outside-company" },
      { ...d.definition, ethics: { ...d.definition.ethics, personImpact: "customers" } }, { ...d.definition, ethics: { ...d.definition.ethics, requiresConsent: true, consentGovernanceObligationRef: policyId } },
      { ...d.definition, ethics: { ...d.definition.ethics, changesMaterialAiDecisions: true, aiUseCaseId: randomUUID() } } ];
    for (const definition of attempts) await expect(service().create(companyId, actor, { key: `deny_${randomUUID().replaceAll("-", "")}`, definition })).rejects.toMatchObject({ status: 409 });
    await expect(service().detail(otherId, actor, d.experiment.id)).rejects.toMatchObject({ status: 404 });
    await expect(service().create(otherId, actor, { key: "foreign_purpose", definition: d.definition })).rejects.toMatchObject({ status: 409 });
    const secret = await draft({ confidential: true });
    await expect(service().create(companyId, actor, { key: "secret_downgrade", definition: { ...secret.definition, sensitivity: "internal" } })).rejects.toMatchObject({ status: 403 });
  });
  it("does not admit retrospective review or a horizon beyond current source review expiry", async () => {
    const d = await draft(), past = { ...d.definition, sampleOrDurationPlan: { ...d.definition.sampleOrDurationPlan, from: new Date(Date.now() - 86400000).toISOString(), until: new Date(Date.now() + 86400000).toISOString() } };
    const amended = await service().amend(companyId, actor, d.experiment.id, { expectedRevision: 1, definition: past, reason: rationale });
    await expect(service().transition(companyId, actor, d.experiment.id, { expectedRevision: 2, versionId: amended.version.id, state: "in_review", rationale })).rejects.toMatchObject({ status: 409 });
    const long = await service().amend(companyId, actor, d.experiment.id, { expectedRevision: 2, definition: { ...d.definition, sampleOrDurationPlan: { ...d.definition.sampleOrDurationPlan, until: new Date(Date.now() + 40 * 86400000).toISOString() } }, reason: rationale });
    await service().transition(companyId, actor, d.experiment.id, { expectedRevision: 3, versionId: long.version.id, state: "in_review", rationale });
    await expect(service().transition(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: long.version.id, state: "ready", rationale })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects immutable protocol/receipt edits, partial pin removal and bare owner changes", async () => {
    const d = await ready();
    await expect(db.update(businessExperimentVersions).set({ amendmentReason: "Unauthorized edit of preregistration" }).where(eq(businessExperimentVersions.id, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(businessExperimentMetricPins).where(eq(businessExperimentMetricPins.versionId, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(businessExperimentTransitions).where(eq(businessExperimentTransitions.experimentId, d.experiment.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessExperiments).set({ state: "running", revision: 4, updatedAt: new Date() }).where(eq(businessExperiments.id, d.experiment.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("rejects committing a restored protocol with omitted source-owner FK pins", async () => {
    const d = await draft(), rootId = randomUUID(), versionId = randomUUID(), manifestId = randomUUID(), now = new Date();
    const [original] = await db.select().from(businessExperimentVersions).where(eq(businessExperimentVersions.id, d.version.id));
    const [manifest] = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, original.lineageManifestId));
    const edges = await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId, manifest.id));
    await expect(db.transaction(async raw => {
      const tx = raw as unknown as typeof db; await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
      await tx.insert(businessExperiments).values({ id: rootId, companyId, key: "incomplete_source_replay", createdBy: "local-board", createdAt: now, updatedAt: now });
      await tx.insert(analyticalLineageManifests).values({ ...manifest, id: manifestId, analysisRef: versionId, createdAt: now, sourceWatermark: now.toISOString() });
      await tx.insert(analyticalLineageEdges).values(edges.map(edge => ({ ...edge, manifestId })));
      await tx.insert(businessExperimentVersions).values({ ...original, id: versionId, experimentId: rootId, lineageManifestId: manifestId, createdAt: now });
      await tx.update(businessExperiments).set({ currentVersionId: versionId }).where(eq(businessExperiments.id, rootId));
    })).rejects.toMatchObject({ code: "23514", message: "experiment_complete_source_pins_required" });
    expect(await db.select().from(businessExperiments).where(eq(businessExperiments.id, rootId))).toHaveLength(0);
  });
  it("rejects a plausible lifecycle receipt that never advances the canonical experiment owner", async () => {
    const d = await draft();
    await expect(db.transaction(async raw => {
      const tx = raw as unknown as typeof db;
      await tx.insert(businessExperimentTransitions).values({ companyId, experimentId: d.experiment.id, versionId: d.version.id, revision: 2, fromState: "draft", toState: "in_review", rationale, createdBy: "local-board", createdAt: new Date() });
    })).rejects.toMatchObject({ code: "23514", message: "experiment_transition_must_advance_owner" });
    expect((await service().detail(companyId, actor, d.experiment.id)).transitions).toEqual([]);
  });
  it("allows explicit cancellation with rollout off while preventing renewed authority or amendments", async () => {
    const d = await ready(); await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_experiments_v8: false });
    await expect(service().detail(companyId, actor, d.experiment.id)).rejects.toMatchObject({ status: 404 });
    expect(await service().transition(companyId, actor, d.experiment.id, { expectedRevision: 3, versionId: d.version.id, state: "cancelled", rationale })).toMatchObject({ state: "cancelled", revision: 4 });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    await expect(service().amend(companyId, actor, d.experiment.id, { expectedRevision: 4, definition: d.definition, reason: rationale })).rejects.toMatchObject({ status: 409 });
  });
  it("erases full protocol prose/history on native source erasure with flags off and company paused", async () => {
    const [project] = await db.insert(projects).values({ companyId, name: "Admitted experimental source scope" }).returning();
    const d = await draft({ projectId: project.id }); await service().transition(companyId, actor, d.experiment.id, { expectedRevision: 1, versionId: d.version.id, state: "in_review", rationale });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId)); await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_experiments_v8: false });
    await db.transaction(async raw => { const tx = raw as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); await eraseAnalyticalSourcesUnderMemory(tx, companyId, "project", [project.id]); });
    expect(await db.select().from(businessExperiments).where(eq(businessExperiments.id, d.experiment.id))).toHaveLength(0);
    expect(await db.select().from(businessExperimentVersions).where(eq(businessExperimentVersions.experimentId, d.experiment.id))).toHaveLength(0);
    expect(await db.select().from(businessExperimentTransitions).where(eq(businessExperimentTransitions.experimentId, d.experiment.id))).toHaveLength(0);
  });
  it("retention and actual native company purge erase owned experiment descendants and preserve another tenant", async () => {
    const d = await ready(); const [stored] = await db.select().from(businessExperimentVersions).where(eq(businessExperimentVersions.id, d.version.id));
    await eraseExpiredAnalyticalLineage(db, new Date(stored.expiresAt.getTime() + 1));
    expect(await db.select().from(businessExperiments).where(eq(businessExperiments.id, d.experiment.id))).toHaveLength(0);
    const next = await draft(); await purgeCompanyContent(db, companyId);
    expect(await db.select().from(businessExperimentMetricPins).where(and(eq(businessExperimentMetricPins.companyId, companyId), eq(businessExperimentMetricPins.versionId, next.version.id)))).toHaveLength(0);
    expect(await db.select().from(companies).where(eq(companies.id, otherId))).toHaveLength(1);
  });
});
