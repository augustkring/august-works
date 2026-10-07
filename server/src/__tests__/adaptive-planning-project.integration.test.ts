import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyticalLineageEdges, analyticalLineageManifests, companies, createDb, issues, issueRelations, projects, projectRoadmapProposals } from "@paperclipai/db";
import { roadmapPolicySchema, projectPlanningProfileSchema, type ProjectPlanningProfile } from "@paperclipai/shared";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { projectPlanningService } from "../services/adaptive-planning/project-owner.js";
import { projectControlService } from "../services/project-control.js";
import { projectControlRoutes } from "../routes/project-control.js";
import { errorHandler } from "../middleware/index.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { disableV8Rollout } from "./helpers/v8-rollout.js";
import { analyticalPurpose, metricDefinition } from "./helpers/business-metric-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const actor = { type: "board" as const, source: "local_implicit" as const };
const rationale = "Explicit synthetic planning constraint review; no business-impact or human productivity claim";
describe.skipIf(!support.supported)("Native project planning source and canonical Roadmap review on PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, policyId: string;
  beforeAll(async () => { process.env.PAPERCLIP_DECISION_SIGNING_SECRET = "0123456789abcdef0123456789abcdef"; database = await startEmbeddedPostgresTestDatabase("aw-v8-planning-project-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ analytical_lineage_v8: true, business_metrics_v8: true, strategy_execution_v8: true, adaptive_planning_v8: true, planning_optimizer_v8: true, enableFoundationV1: true, project_roadmap_v5: true, ai_use_cases_v7: true, governance_evidence_v7: true });
    companyId = randomUUID(); otherId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Synthetic native planning", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign planning", issuePrefix: randomUUID() }]);
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "planning"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
  });
  async function fixture() {
    const [project] = await db.insert(projects).values({ companyId, name: "Canonical source project" }).returning();
    const tasks = await db.insert(issues).values([{ companyId, projectId: project.id, title: "First native task", status: "todo", responsibleUserId: "local-board" }, { companyId, projectId: project.id, title: "Dependent native task", status: "todo", responsibleUserId: "local-board" }]).returning();
    await db.insert(issueRelations).values({ companyId, issueId: tasks[0].id, relatedIssueId: tasks[1].id, type: "blocks" });
    const profile = projectPlanningProfileSchema.parse({ purpose: "management_intelligence", sensitivity: "internal", retentionDays: 1, governanceObligationRefs: [policyId], horizon: { start: new Date(Date.now() + 86400000).toISOString().slice(0, 10), days: 5 }, pools: [{ key: "declared_capacity", days: Array.from({ length: 5 }, () => ({ availableMinutes: 480, committedMinutes: 0 })) }], policy: { mandatoryCommitmentsFirst: true, orderBy: [{ key: "learning_value", direction: "maximize" }], paretoDimensions: [] }, tasks: tasks.map((task, index) => ({ key: task.id, expectedUpdatedAt: task.updatedAt.toISOString(), durationDays: 1, demands: [{ poolKey: "declared_capacity", minutesPerDay: 240 }], mandatoryCommitment: false, dimensions: { learning_value: index }, rationale })), evidence: [] });
    return { project, tasks, profile };
  }
  async function proposal() {
    const f = await fixture(), preview = await projectPlanningService(db).preview(companyId, f.project.id, actor, f.profile), created = await projectPlanningService(db).propose(companyId, f.project.id, actor, { profile: f.profile, expectedSnapshotHash: preview.snapshotHash, reason: rationale });
    return { ...f, preview, created };
  }
  function app() { const api = express(); api.use(express.json()); api.use((req, _res, next) => { req.actor = { ...actor, userId: "local-board" }; next(); }); api.use("/api", projectControlRoutes(db)); api.use(errorHandler); return api; }
  it("qualifies strict account-bound public commands and minimal rollout-independent control metadata", async () => {
    const f = await fixture(), endpoint = `/api/companies/${companyId}/projects/${f.project.id}/roadmap/planning`;
    const source = await request(app()).get(`${endpoint}/source?expectedUserId=local-board`).expect(200); expect(source.body.projectId).toBe(f.project.id); expect(source.headers["cache-control"]).toBe("no-store");
    await request(app()).get(`${endpoint}/source?expectedUserId=foreign-account`).expect(409);
    const preview = await request(app()).post(`${endpoint}/preview?expectedUserId=local-board`).send(f.profile).expect(200); expect(preview.headers["cache-control"]).toBe("no-store");
    await request(app()).post(`${endpoint}/preview?expectedUserId=foreign-account`).send(f.profile).expect(409);
    await request(app()).post(`${endpoint}/preview?arbitrarySql=select`).send(f.profile).expect(400);
    await request(app()).post(`${endpoint}/preview`).send({ ...f.profile, estimates: [{ value: 100 }] }).expect(400);
    const created = await request(app()).post(`${endpoint}/proposals`).send({ profile: f.profile, expectedSnapshotHash: preview.body.snapshotHash, reason: rationale }).expect(201);
    await request(app()).get(`${endpoint}/proposals/${created.body.id}`).expect(200);
    await disableV8Rollout(db); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    const controls = await request(app()).get(`${endpoint}/controls?expectedUserId=local-board`).expect(200);
    expect(controls.body).toEqual({ proposals: [{ id: created.body.id, status: "pending" }], hasMore: false, nextCursor: null }); expect(JSON.stringify(controls.body)).not.toContain(rationale);
    await request(app()).get(`${endpoint}/proposals/${created.body.id}`).expect(404);
    await db.update(companies).set({ status: "active" }).where(eq(companies.id, companyId));
    await request(app()).post(`${endpoint}/proposals/${created.body.id}/review?expectedUserId=foreign-account`).send({ accept: false, rationale }).expect(409);
    const rejected = await request(app()).post(`${endpoint}/proposals/${created.body.id}/review?expectedUserId=local-board`).send({ accept: false, rationale }).expect(200);
    expect(Object.keys(rejected.body).sort()).toEqual(["companyId", "id", "projectId", "status", "updatedAt"]); expect(rejected.body.status).toBe("rejected"); expect(JSON.stringify(rejected.body)).not.toContain(rationale);
  });
  it("rejects agent and foreign-session authority before inspecting project source", async () => {
    const f = await fixture(), owner = projectPlanningService(db);
    await expect(owner.preview(companyId, f.project.id, { type: "agent", source: "agent_jwt", companyId, agentId: randomUUID() }, f.profile)).rejects.toMatchObject({ status: 403 });
    await expect(owner.preview(companyId, f.project.id, { type: "board", source: "session", userId: randomUUID(), companyIds: [otherId] }, f.profile)).rejects.toMatchObject({ status: 403 });
  });
  it("honors canonical external field ownership before claiming an applicable native plan", async () => {
    const f = await fixture(), policy = roadmapPolicySchema.parse({ fieldOwnership: { plannedDates: "external_authoritative" }, externalSourceRef: "https://example.test/native-plan-source" });
    await db.update(projects).set({ roadmapPolicy: policy }).where(eq(projects.id, f.project.id));
    await expect(projectPlanningService(db).preview(companyId, f.project.id, actor, f.profile)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.projectId, f.project.id))).toEqual([]);
  });
  it("requires original human source identity rather than copied database proof material", async () => {
    const f = await proposal(), [original] = await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, f.created.id)), [manifest] = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, original.planningManifestId!));
    const edges = await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId, manifest.id)), id = randomUUID(), manifestId = randomUUID(), createdAt = new Date();
    await db.transaction(async (raw) => {
      const tx = raw as unknown as typeof db;
      await tx.execute(sql`set local time zone 'Pacific/Auckland'`);
      await tx.insert(projectRoadmapProposals).values({ ...original, id, createdAt, planningContext: null, planningContextHash: null, planningManifestId: null });
      await tx.insert(analyticalLineageManifests).values({ ...manifest, id: manifestId, analysisRef: id, createdAt });
      await tx.insert(analyticalLineageEdges).values(edges.map((edge) => ({ ...edge, manifestId })));
      await tx.update(projectRoadmapProposals).set({ planningContext: original.planningContext, planningContextHash: original.planningContextHash, planningManifestId: manifestId }).where(eq(projectRoadmapProposals.id, id));
    });
    await expect(projectPlanningService(db).detail(companyId, f.project.id, actor, id)).rejects.toMatchObject({ status: 404 });
    await expect(projectControlService(db).review(actor, companyId, f.project.id, id, true, rationale)).rejects.toMatchObject({ status: 404 });
    expect((await db.select().from(issues).where(eq(issues.id, f.tasks[0].id)))[0].plannedStartAt).toBeNull();
  });
  it("captures complete native dependencies and creates a pending proposal without changing tasks", async () => {
    const f = await proposal();
    expect(f.preview).toMatchObject({ authority: "human_roadmap_review_required", result: { status: "feasible_best_known", optimality: "not_proven" } });
    expect(f.created.status).toBe("pending"); expect(f.created.context.sourceSnapshot.dependencies).toEqual([{ before: f.tasks[0].id, after: f.tasks[1].id }]);
    expect(await db.select().from(issues).where(eq(issues.projectId, f.project.id))).toMatchObject([{ plannedStartAt: null }, { plannedStartAt: null }]);
    expect((await projectPlanningService(db).detail(companyId, f.project.id, actor, f.created.id)).currentQualification).toBe("current");
    // V5 cannot expose inherited analytical source prose without its source owner.
    expect((await projectControlService(db).get(actor, companyId, f.project.id)).proposals).toEqual([]);
  });
  it("applies exactly once through separate canonical human review", async () => {
    const f = await proposal(), review = await projectControlService(db).review(actor, companyId, f.project.id, f.created.id, true, rationale);
    expect(review.status).toBe("accepted");
    const stored = await db.select().from(issues).where(eq(issues.projectId, f.project.id));
    for (const item of f.created.context.result.schedule) { const task = stored.find((row) => row.id === item.taskKey)!; expect(task.plannedStartAt!.getTime()).toBe(Date.parse(`${f.profile.horizon.start}T00:00:00Z`) + item.startDay * 86400000); expect(task.plannedEndAt!.getTime()).toBe(Date.parse(`${f.profile.horizon.start}T00:00:00Z`) + item.endDay * 86400000); }
    await expect(projectControlService(db).review(actor, companyId, f.project.id, f.created.id, true, rationale)).rejects.toMatchObject({ status: 409 });
  });
  it("serializes competing human acceptance so the same native plan applies only once", async () => {
    const f = await proposal(), owner = projectControlService(db);
    const outcomes = await Promise.allSettled([owner.review(actor, companyId, f.project.id, f.created.id, true, rationale), owner.review(actor, companyId, f.project.id, f.created.id, true, rationale)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, f.created.id)))[0].status).toBe("accepted");
  });
  it("uses native company purge for complete planning material while preserving a foreign company", async () => {
    const f = await proposal(), [foreign] = await db.insert(projects).values({ companyId: otherId, name: "Foreign project survives native purge" }).returning();
    await disableV8Rollout(db); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await purgeCompanyContent(db, companyId);
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId))).toEqual([]);
    expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId, companyId))).toEqual([]);
    expect(await db.select().from(projects).where(eq(projects.id, foreign.id))).toHaveLength(1);
  });
  it("rejects modified or incomplete task/source snapshots before any proposal exists", async () => {
    const f = await fixture(), owner = projectPlanningService(db), preview = await owner.preview(companyId, f.project.id, actor, f.profile);
    await expect(owner.preview(companyId, f.project.id, actor, { ...f.profile, tasks: f.profile.tasks.slice(1) })).rejects.toMatchObject({ status: 409 });
    await expect(owner.propose(companyId, f.project.id, actor, { profile: f.profile, expectedSnapshotHash: "0".repeat(64), reason: rationale })).rejects.toMatchObject({ status: 409 });
    await db.update(issues).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(issues.id, f.tasks[0].id));
    await expect(owner.propose(companyId, f.project.id, actor, { profile: f.profile, expectedSnapshotHash: preview.snapshotHash, reason: rationale })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.projectId, f.project.id))).toEqual([]);
  });
  it("preserves signed historical material while blocking changed tasks at canonical acceptance", async () => {
    const f = await proposal(); await db.update(issues).set({ updatedAt: new Date(Date.now() + 1000), estimatedEffortMinutes: 100 }).where(eq(issues.id, f.tasks[0].id));
    const retained = await projectPlanningService(db).detail(companyId, f.project.id, actor, f.created.id); expect(retained.contextHash).toBe(f.created.contextHash); expect(retained.context).toEqual(f.created.context); expect(retained.currentQualification).toBe("needs_revalidation");
    await expect(projectControlService(db).review(actor, companyId, f.project.id, f.created.id, true, rationale)).rejects.toMatchObject({ status: 409 });
    expect((await db.select().from(issues).where(eq(issues.id, f.tasks[0].id)))[0].plannedStartAt).toBeNull();
  });
  it("detects changed dependency constraints even when the project and task timestamps did not change", async () => {
    const f = await proposal(); await db.delete(issueRelations).where(and(eq(issueRelations.companyId, companyId), eq(issueRelations.issueId, f.tasks[0].id)));
    await expect(projectControlService(db).review(actor, companyId, f.project.id, f.created.id, true, rationale)).rejects.toMatchObject({ status: 409 });
    expect((await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, f.created.id)))[0].status).toBe("pending");
  });
  it("withholds unresolved external blockers and captures authorized completed predecessors", async () => {
    const f = await fixture(), [outsideProject] = await db.insert(projects).values({ companyId, name: "External source ancestry" }).returning(), [outside] = await db.insert(issues).values({ companyId, projectId: outsideProject.id, title: "Native external predecessor", status: "todo", responsibleUserId: "local-board" }).returning();
    await db.insert(issueRelations).values({ companyId, issueId: outside.id, relatedIssueId: f.tasks[0].id, type: "blocks" });
    await expect(projectPlanningService(db).preview(companyId, f.project.id, actor, f.profile)).rejects.toMatchObject({ status: 409 });
    await db.update(issues).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(issues.id, outside.id));
    const preview = await projectPlanningService(db).preview(companyId, f.project.id, actor, f.profile), created = await projectPlanningService(db).propose(companyId, f.project.id, actor, { profile: f.profile, expectedSnapshotHash: preview.snapshotHash, reason: rationale });
    expect(created.context.sourceSnapshot.satisfiedDependencies).toMatchObject([{ id: outside.id, projectId: outsideProject.id, status: "done" }]);
    await projectControlService(db).review(actor, companyId, f.project.id, created.id, true, rationale);
    await disableV8Rollout(db); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await db.transaction(async (raw) => { const tx = raw as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); await eraseAnalyticalSourcesUnderMemory(tx, companyId, "project", [outsideProject.id]); });
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, created.id))).toEqual([]);
    expect((await db.select().from(issues).where(eq(issues.id, f.tasks[0].id)))[0].plannedStartAt).not.toBeNull();
  });
  it("prevents persisted abstention and unknown/overcommitted capacity from producing canonical plan changes", async () => {
    const f = await fixture();
    for (const alter of [(p: ProjectPlanningProfile) => { p.tasks[0].durationDays = null; }, (p: ProjectPlanningProfile) => { p.pools[0].days[0].availableMinutes = null; }, (p: ProjectPlanningProfile) => { p.pools[0].days[0].committedMinutes = 481; }]) {
      const p = structuredClone(f.profile); alter(p); const preview = await projectPlanningService(db).preview(companyId, f.project.id, actor, p); expect(preview.result.status).not.toBe("feasible_best_known");
      await expect(projectPlanningService(db).propose(companyId, f.project.id, actor, { profile: p, expectedSnapshotHash: preview.snapshotHash, reason: rationale })).rejects.toMatchObject({ status: 409 });
    }
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.projectId, f.project.id))).toEqual([]);
  });
  it("denies cross-company sources and rollout-off new reliance while retaining independent human rejection", async () => {
    const f = await proposal(); await expect(projectPlanningService(db).preview(otherId, f.project.id, actor, f.profile)).rejects.toMatchObject({ status: 409 });
    await disableV8Rollout(db); await expect(projectControlService(db).review(actor, companyId, f.project.id, f.created.id, true, rationale)).rejects.toMatchObject({ status: 404 });
    const rejected = await projectControlService(db).review(actor, companyId, f.project.id, f.created.id, false, rationale);
    expect(rejected.status).toBe("rejected"); expect(Object.keys(rejected).sort()).toEqual(["companyId", "id", "projectId", "status", "updatedAt"]);
  });
  it("guards immutable source material and forbids accepted metadata before canonical task application", async () => {
    const f = await proposal();
    await expect(db.update(projectRoadmapProposals).set({ reason: "Rewritten source prose" }).where(eq(projectRoadmapProposals.id, f.created.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(projectRoadmapProposals).set({ planningManifestId: null, planningContext: null, planningContextHash: null }).where(eq(projectRoadmapProposals.id, f.created.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(projectRoadmapProposals).set({ status: "accepted", reviewedByUserId: "local-board", reviewRationale: rationale }).where(eq(projectRoadmapProposals.id, f.created.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("inherits native analytical evidence and erases complete dependent planning prose through source retention", async () => {
    const f = await fixture(), metrics = businessMetricService(db), definition = metricDefinition(policyId);
    if (definition.calculation.kind === "native_ratio") { definition.calculation.denominator.projectId = f.project.id; definition.calculation.numerator.projectId = f.project.id; }
    const metric = await metrics.create(companyId, actor, { key: `planning_${randomUUID().replaceAll("-", "")}`, definition }); await metrics.publish(companyId, actor, metric.metric.id, { expectedRevision: 1, versionId: metric.version.id });
    const observed = await metrics.query(companyId, actor, { metricId: metric.metric.id, versionId: metric.version.id, from: new Date(Date.now() - 86400000).toISOString(), until: new Date(Date.now() + 1000).toISOString(), dimensions: [], maxRows: 100 });
    f.profile.evidence = [{ key: "observed", source: { type: "metric_observation", id: observed.id, metricId: metric.metric.id, metricVersionId: metric.version.id }, rationale }];
    const preview = await projectPlanningService(db).preview(companyId, f.project.id, actor, f.profile), created = await projectPlanningService(db).propose(companyId, f.project.id, actor, { profile: f.profile, expectedSnapshotHash: preview.snapshotHash, reason: rationale });
    expect(created.context.evidence[0].sourceHash).toMatch(/^[a-f0-9]{64}$/); expect(created.context.evidence[0].facts.status).toBe("observed");
    const [stored] = await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, created.id));
    await disableV8Rollout(db); await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, stored.planningManifestId!));
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, created.id))).toEqual([]);
    expect((await db.select().from(issues).where(eq(issues.id, f.tasks[0].id)))[0].plannedStartAt).toBeNull();
  });
});
