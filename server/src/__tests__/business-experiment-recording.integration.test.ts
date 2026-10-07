import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { companies, issues, projects, businessExperiments, businessExperimentAssignments, businessExperimentExposures, businessExperimentExecutions, businessExperimentCompletions, businessExperimentVersions, analyticalLineageManifests, analyticalLineageEdges, createDb } from "@paperclipai/db";
import { ISSUE_STATUSES, businessMetricDefinitionSchema } from "@paperclipai/shared";
import { businessExperimentService } from "../services/business-experiments/service.js";
import { businessExperimentRecordingService } from "../services/business-experiments/recording.js";
import { businessExperimentRoutes } from "../routes/business-experiments.js";
import { errorHandler } from "../middleware/index.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { metricDefinition, analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { experimentDefinition } from "./helpers/business-experiment-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport(), suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const }, rationale = "Human source-owner recording of this exact non-personal native protocol";
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, business_experiments_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("Native experiment assignment and human attestation on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-experiment-recording-"); db = createDb(database.connectionString); });
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags); companyId = randomUUID(); otherId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Recording tenant", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign recording tenant", issuePrefix: randomUUID() }]);
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "experiment"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
  });
  const registry = () => businessExperimentService(db), recording = () => businessExperimentRecordingService(db);
  async function reviewed(short = false) {
    const metrics = [];
    for (const status of ["done", "cancelled", "in_progress"] as const) {
      const definition = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: [status], projectId: null }, denominator: { entity: "issue", statuses: [...ISSUE_STATUSES], projectId: null } } });
      const source = await businessMetricService(db).create(companyId, actor, { key: `metric_${randomUUID().replaceAll("-", "")}`, definition });
      await businessMetricService(db).publish(companyId, actor, source.metric.id, { expectedRevision: 1, versionId: source.version.id }); metrics.push(source);
    }
    const definition = experimentDefinition(policyId, metrics.map(item => ({ id: item.metric.id, versionId: item.version.id })));
    // Actual PostgreSQL time is used throughout. Synthetic fixture sources are
    // enrolled after the real preregistered start; no mocked database clock.
    definition.sampleOrDurationPlan.from = new Date(Date.now() + 1500).toISOString();
    definition.sampleOrDurationPlan.until = new Date(Date.parse(definition.sampleOrDurationPlan.from) + (short ? 1000 : 60000)).toISOString();
    const d = await registry().create(companyId, actor, { key: `recording_${randomUUID().replaceAll("-", "")}`, definition });
    await registry().transition(companyId, actor, d.experiment.id, { expectedRevision: 1, versionId: d.version.id, state: "in_review", rationale });
    const experiment = await registry().transition(companyId, actor, d.experiment.id, { expectedRevision: 2, versionId: d.version.id, state: "ready", rationale });
    return { ...d, experiment, definition, metrics };
  }
  async function running(short = false) {
    const d = await reviewed(short), experiment = await recording().start(companyId, actor, d.experiment.id, { expectedRevision: 3, versionId: d.version.id, mode: "recording_only_human_attested_native_process", rationale });
    return { ...d, experiment };
  }
  async function insideWindow(d: Awaited<ReturnType<typeof running>>) {
    const remaining = Date.parse(d.definition.sampleOrDurationPlan.from) - Date.now() + 20;
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }
  async function enrolled(d: Awaited<ReturnType<typeof running>>, status = "todo", projectId: string | null = null) {
    await insideWindow(d);
    const [unit] = await db.insert(issues).values({ companyId, projectId, title: "Synthetic fixture business unit; not a collected operational outcome", status }).returning();
    const assignment = await recording().assign(companyId, actor, d.experiment.id, { expectedRevision: d.experiment.revision, versionId: d.version.id, unitId: unit.id });
    return { unit, assignment };
  }
  function app() {
    const value = express(); value.use(express.json()); value.use((req, _res, next) => { req.actor = { ...actor, userId: "local-board" }; next(); });
    value.use("/api", businessExperimentRoutes(db)); value.use(errorHandler); return value;
  }
  it("records stable secret-derived assignments and actual native pretreatment invariants without changing the source unit", async () => {
    const d = await running(), { unit, assignment } = await enrolled(d, "in_progress");
    const repeat = await recording().assign(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, unitId: unit.id }); expect(repeat).toEqual(assignment);
    expect(assignment.invariantReceipts[0]).toMatchObject({ value: 1, metricId: d.metrics[2].metric.id, metricVersionId: d.metrics[2].version.id });
    expect((await db.select().from(issues).where(eq(issues.id, unit.id)))[0].status).toBe("in_progress");
    expect(await db.select().from(businessExperimentAssignments).where(eq(businessExperimentAssignments.versionId, d.version.id))).toHaveLength(1);
    const receipts = await recording().receipts(companyId, actor, d.experiment.id, d.version.id);
    expect(receipts.assignments).toEqual([assignment]); expect(receipts.exposureProvenance).toBe("human_attestation"); expect(receipts.exposures).toEqual([]);
    expect(JSON.stringify(receipts)).not.toMatch(/assignmentKeyFingerprint|signature|sourceSnapshot|Synthetic fixture business unit/);
  });
  it("requires explicit applied/not-applied human attestation and preserves identical retry while rejecting revision", async () => {
    const d = await running(), { assignment } = await enrolled(d);
    const command = { expectedRevision: 4, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "applied", assertedAppliedAt: new Date().toISOString(), rationale } };
    const exposure = await recording().recordExposure(companyId, actor, d.experiment.id, command);
    expect(exposure).toMatchObject({ provenance: "human_attestation", arm: assignment.arm, status: "applied", recordedBy: "local-board" });
    expect(await recording().recordExposure(companyId, actor, d.experiment.id, command)).toEqual(exposure);
    await expect(recording().recordExposure(companyId, actor, d.experiment.id, { ...command, exposure: { status: "not_applied", rationale } })).rejects.toMatchObject({ status: 409 });
    const other = await enrolled(d);
    const unexposed = await recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, assignmentId: other.assignment.id, exposure: { status: "not_applied", rationale } });
    expect(unexposed.assertedAppliedAt).toBeNull(); expect((await recording().receipts(companyId, actor, d.experiment.id, d.version.id)).assignments).toHaveLength(2);
  });
  it("rejects pre-window, foreign/hidden subjects, false chronology and frozen protocol replacement", async () => {
    const d = await running();
    const [old] = await db.insert(issues).values({ companyId, title: "Outside registered cohort", createdAt: new Date(Date.parse(d.definition.sampleOrDurationPlan.from) - 1) }).returning();
    await expect(recording().assign(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, unitId: old.id })).rejects.toMatchObject({ status: 409 });
    const [foreign] = await db.insert(issues).values({ companyId: otherId, title: "Foreign business unit" }).returning();
    await expect(recording().assign(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, unitId: foreign.id })).rejects.toMatchObject({ status: 404 });
    const { unit, assignment } = await enrolled(d); await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, unit.id));
    await expect(registry().detail(companyId, actor, d.experiment.id)).rejects.toMatchObject({ status: 404 });
    await db.update(issues).set({ hiddenAt: null }).where(eq(issues.id, unit.id));
    for (const assertedAppliedAt of [new Date(Date.parse(assignment.assignedAt) - 1).toISOString(), new Date(Date.now() + 86400000).toISOString()])
      await expect(recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "applied", assertedAppliedAt, rationale } })).rejects.toMatchObject({ status: 409 });
    await expect(registry().amend(companyId, actor, d.experiment.id, { expectedRevision: 4, definition: d.definition, reason: rationale })).rejects.toMatchObject({ status: 409 });
  });
  it("pauses and resumes recording, rejects early efficacy completion and retains explicit emergency stopping", async () => {
    const d = await running(), { unit, assignment } = await enrolled(d);
    const paused = await recording().control(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, state: "paused", rationale, completion: null }); expect(paused.revision).toBe(5);
    await expect(recording().assign(companyId, actor, d.experiment.id, { expectedRevision: 5, versionId: d.version.id, unitId: unit.id })).rejects.toMatchObject({ status: 409 });
    await recording().control(companyId, actor, d.experiment.id, { expectedRevision: 5, versionId: d.version.id, state: "running", rationale, completion: null });
    await expect(recording().control(companyId, actor, d.experiment.id, { expectedRevision: 6, versionId: d.version.id, state: "completed", rationale, completion: { reason: "fixed_horizon", concurrentChangeReview: { assessment: "none_identified", rationale } } })).rejects.toMatchObject({ status: 409 });
    await recording().control(companyId, actor, d.experiment.id, { expectedRevision: 6, versionId: d.version.id, state: "completed", rationale, completion: { reason: "emergency_safety_stop", concurrentChangeReview: { assessment: "material_or_unknown", rationale } } });
    expect((await recording().receipts(companyId, actor, d.experiment.id, d.version.id)).completion).toMatchObject({ reason: "emergency_safety_stop", concurrentChangeReview: { assessment: "material_or_unknown" } });
    await new Promise(resolve => setTimeout(resolve, 5));
    await expect(recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 7, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "applied", assertedAppliedAt: new Date().toISOString(), rationale } })).rejects.toMatchObject({ status: 409 });
  });
  it("admits actual elapsed fixed-horizon completion and keeps every assigned unit including unexposed units", async () => {
    const d = await running(true), { assignment } = await enrolled(d);
    await recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "not_applied", rationale } });
    const remaining = Date.parse(d.definition.sampleOrDurationPlan.until) - Date.now() + 20; if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    const completed = await recording().control(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, state: "completed", rationale, completion: { reason: "fixed_horizon", concurrentChangeReview: { assessment: "none_identified", rationale } } });
    expect(completed.state).toBe("completed");
    const receipts = await recording().receipts(companyId, actor, d.experiment.id, d.version.id); expect(receipts.assignments).toHaveLength(1); expect(receipts.exposures[0].status).toBe("not_applied"); expect(receipts.completion!.reason).toBe("fixed_horizon");
  });
  it("blocks concurrent company recordings from silently claiming no interference", async () => {
    const first = await running(), second = await reviewed();
    await expect(recording().start(companyId, actor, second.experiment.id, { expectedRevision: 3, versionId: second.version.id, mode: "recording_only_human_attested_native_process", rationale })).rejects.toMatchObject({ status: 409 });
    await recording().control(companyId, actor, first.experiment.id, { expectedRevision: 4, versionId: first.version.id, state: "cancelled", rationale, completion: null });
    expect(await recording().start(companyId, actor, second.experiment.id, { expectedRevision: 3, versionId: second.version.id, mode: "recording_only_human_attested_native_process", rationale })).toMatchObject({ state: "running" });
  });
  it("rejects partial receipt deletion/rewrites and signing-owner rotation before returning historical data", async () => {
    const d = await running(), { assignment } = await enrolled(d);
    await recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "not_applied", rationale } });
    await expect(db.update(businessExperimentAssignments).set({ arm: assignment.arm === "control" ? "treatment" : "control" }).where(eq(businessExperimentAssignments.id, assignment.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(businessExperimentAssignments).where(eq(businessExperimentAssignments.id, assignment.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(businessExperimentExposures).where(eq(businessExperimentExposures.assignmentId, assignment.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    vi.stubEnv("PAPERCLIP_DECISION_SIGNING_SECRET", randomBytes(48).toString("hex"));
    try { await expect(recording().receipts(companyId, actor, d.experiment.id, d.version.id)).rejects.toMatchObject({ status: 404 }); }
    finally { vi.unstubAllEnvs(); }
    expect((await recording().receipts(companyId, actor, d.experiment.id, d.version.id)).assignments[0]).toEqual(assignment);
  });
  it("rejects restore that omits the exact native subject FK despite otherwise intact captured receipts", async () => {
    const d = await running(), { assignment } = await enrolled(d);
    const [stored] = await db.select().from(businessExperimentAssignments).where(eq(businessExperimentAssignments.id, assignment.id));
    // PostgreSQL checks the mandatory source FK shape before uniqueness. The
    // copied authentic snapshot/hash/signature cannot admit a NULL FK bypass.
    await expect(db.insert(businessExperimentAssignments).values({ ...stored, issueId: null })).rejects.toMatchObject({ cause: { code: "23514", constraint_name: "business_experiment_assignments_content_check" } });
    expect((await recording().receipts(companyId, actor, d.experiment.id, d.version.id)).assignments).toHaveLength(1);
  });
  it("denies cached registry and receipt data after an enrolled source leaves current authority", async () => {
    const d = await running(), { unit } = await enrolled(d), [foreignProject] = await db.insert(projects).values({ companyId: otherId, name: "Foreign private scope" }).returning();
    await db.update(issues).set({ projectId: foreignProject.id }).where(eq(issues.id, unit.id));
    await expect(recording().receipts(companyId, actor, d.experiment.id, d.version.id)).rejects.toMatchObject({ status: 404 });
    expect((await registry().list(companyId, actor)).items).toEqual([]);
  });
  it("erases the whole source-dependent protocol instead of dropping an enrolled subject with rollout off and company paused", async () => {
    const d = await running(), first = await enrolled(d), second = await enrolled(d);
    await recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, assignmentId: first.assignment.id, exposure: { status: "not_applied", rationale } });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId)); await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_experiments_v8: false });
    await db.transaction(async raw => { const tx = raw as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); await eraseAnalyticalSourcesUnderMemory(tx, companyId, "issue", [first.unit.id]); });
    for (const table of [businessExperiments, businessExperimentVersions, businessExperimentExecutions, businessExperimentAssignments, businessExperimentExposures]) expect(await db.select().from(table).where(eq(table.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.analysisType, "experiment_assignment")))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.id, second.unit.id))).toHaveLength(1);
  });
  it("retains authorized cancellation with rollout off and actual company purge clears recording descendants", async () => {
    const d = await running(), { assignment } = await enrolled(d);
    await recording().recordExposure(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "not_applied", rationale } });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_experiments_v8: false });
    expect(await recording().control(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, state: "cancelled", rationale, completion: null })).toMatchObject({ state: "cancelled" });
    await purgeCompanyContent(db, companyId);
    for (const table of [businessExperimentAssignments, businessExperimentExposures, businessExperimentCompletions]) expect(await db.select().from(table).where(eq(table.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(companies).where(eq(companies.id, otherId))).toHaveLength(1);
  });
  it("requires the source-owned recording APIs and does not accept caller-selected arms or verified exposure claims", async () => {
    const d = await running(), { assignment } = await enrolled(d), base = `/api/companies/${companyId}/experiments/${d.experiment.id}`, server = app();
    const read = await request(server).get(`${base}/versions/${d.version.id}/receipts?expectedUserId=local-board`);
    expect(read.status).toBe(200); expect(read.headers["cache-control"]).toBe("no-store"); expect(read.body.assignments[0].id).toBe(assignment.id);
    expect((await request(server).get(`${base}/versions/${d.version.id}/receipts?expectedUserId=old-account`)).status).toBe(409);
    expect((await request(server).post(`${base}/assignments`).send({ expectedRevision: 4, versionId: d.version.id, unitId: assignment.unitId, arm: "treatment" })).status).toBe(400);
    expect((await request(server).post(`${base}/exposures`).send({ expectedRevision: 4, versionId: d.version.id, assignmentId: assignment.id, exposure: { status: "not_applied", rationale, verified: true } })).status).toBe(400);
  });
  it("independent stop metadata remains minimal and human-authorized when rollout is disabled and enrolled source access is unavailable", async () => {
    const d = await running(), unit = await enrolled(d);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, unit.unit.id));
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({});
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    const controls = await recording().safetyControls(companyId, actor);
    expect(controls.items).toEqual([{ id: d.experiment.id, companyId, versionId: d.version.id, revision: 4, state: "running" }]);
    expect(JSON.stringify(controls)).not.toContain(unit.unit.id); expect(JSON.stringify(controls)).not.toContain("hypothesis"); expect(JSON.stringify(controls)).not.toContain("rationale");
    await expect(recording().safetyControls(companyId, { type: "agent", agentId: randomUUID(), companyId })).rejects.toMatchObject({ status: 403 });
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = actor; next(); }); app.use(businessExperimentRoutes(db)); app.use(errorHandler);
    const url = `/companies/${companyId}/experiments/recording-controls`;
    const result = await request(app).get(url); expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store"); expect(result.body.items).toEqual(controls.items);
    expect((await request(app).get(`${url}?expectedUserId=someone-else`)).status).toBe(409);
    const stopped = await recording().control(companyId, actor, d.experiment.id, { expectedRevision: 4, versionId: d.version.id, state: "cancelled", rationale, completion: null }); expect(stopped.state).toBe("cancelled");
    expect((await recording().safetyControls(companyId, actor)).items).toEqual([]);
  });

});
