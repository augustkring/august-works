import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { adaptivePlanningProposals, agents, analyticalLineageManifests, analyticalSourceSuppressions, authUsers, budgetPolicies, companyMemberships, companies, costEvents, createDb, goals, issues, issueRelations, principalPermissionGrants, projectGoals, projects, projectRoadmapProposals } from "@paperclipai/db";
import { crossProjectPlanningProfileSchema, portfolioPlanningProfileSchema } from "@paperclipai/shared";
import { crossProjectPlanningService } from "../services/adaptive-planning/cross-project.js";
import { projectPlanningService } from "../services/adaptive-planning/project-owner.js";
import { portfolioPlanningService } from "../services/adaptive-planning/portfolio.js";
import { crossProjectPlanningRoutes } from "../routes/cross-project-planning.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { issueService } from "../services/issues.js";
import { errorHandler } from "../middleware/index.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { disableV8Rollout } from "./helpers/v8-rollout.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport(), rationale = "Explicit software joint planning qualification; no staffing, budget or business-impact claim";
describe.skipIf(!support.supported)("Native same-company cross-project planning proposals", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, userId: string, policyId: string;
  const actor = () => ({ type: "board" as const, source: "session" as const, userId, companyIds: [companyId] });
  const owner = () => crossProjectPlanningService(db);
  beforeAll(async () => { process.env.PAPERCLIP_DECISION_SIGNING_SECRET = "0123456789abcdef0123456789abcdef"; database = await startEmbeddedPostgresTestDatabase("aw-v8-cross-project-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ analytical_lineage_v8: true, business_metrics_v8: true, strategy_execution_v8: true, adaptive_planning_v8: true, planning_optimizer_v8: true, enableFoundationV1: true, project_roadmap_v5: true, ai_use_cases_v7: true, governance_evidence_v7: true });
    companyId = randomUUID(); userId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Joint planning software fixture", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Current software Human", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "admin" });
    await db.insert(principalPermissionGrants).values(["company_scope:read", "users:manage_permissions", "project:read", "issue:read", "issue:mutate", "tasks:assign"].map(permissionKey => ({ companyId, principalType: "user", principalId: userId, permissionKey })));
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["planning"]; policyId = (await aiGovernanceService(db).obligation(actor(), companyId, policy)).id;
  });
  async function fixture() {
    const projectRows = await db.insert(projects).values(["First", "Second"].map(name => ({ companyId, name }))).returning();
    const taskRows = await db.insert(issues).values(projectRows.map((project, index) => ({ companyId, projectId: project.id, title: `Native cross-project Task ${index}`, status: "todo", responsibleUserId: userId }))).returning();
    await db.insert(issueRelations).values({ companyId, issueId: taskRows[0].id, relatedIssueId: taskRows[1].id, type: "blocks" });
    const profile = crossProjectPlanningProfileSchema.parse({ purpose: "management_intelligence", sensitivity: "internal", retentionDays: 1, governanceObligationRefs: [policyId], projects: projectRows.map(project => ({ id: project.id, expectedUpdatedAt: project.updatedAt.toISOString() })), horizon: { start: new Date(Date.now() + 86400000).toISOString().slice(0, 10), days: 5 }, pools: [{ key: "declared_pool", days: Array.from({ length: 5 }, () => ({ availableMinutes: 480, committedMinutes: 0 })) }], policy: { mandatoryCommitmentsFirst: true, orderBy: [], paretoDimensions: [] }, tasks: taskRows.map(task => ({ key: task.id, expectedUpdatedAt: task.updatedAt.toISOString(), durationDays: 1, demands: [{ poolKey: "declared_pool", minutesPerDay: 480 }], mandatoryCommitment: false, dimensions: {}, rationale })), evidence: [] });
    return { projects: projectRows, tasks: taskRows, profile };
  }
  async function proposed() { const f = await fixture(), preview = await owner().preview(companyId, actor(), f.profile), proposal = await owner().propose(companyId, actor(), { profile: f.profile, expectedSnapshotHash: preview.snapshotHash, reason: rationale }); return { ...f, preview, proposal }; }
  async function portfolioFixture() {
    const f = await fixture(), [goal] = await db.insert(goals).values({ companyId, title: "Declared software strategic Goal", status: "active" }).returning();
    await db.insert(projectGoals).values(f.projects.map(project => ({ companyId, projectId: project.id, goalId: goal.id })));
    const profile = portfolioPlanningProfileSchema.parse({ ...f.profile,
      initiatives: f.projects.map((project, index) => ({ projectId: project.id, mandatoryCommitment: false, protectedCommitment: false, preference: "eligible", dimensions: { alignment: 10 - index }, estimatedBilledCostCents: 40, rationale })),
      initiativePolicy: { mandatoryCommitmentsFirst: true, orderBy: [{ key: "alignment", direction: "maximize" }], minimumDimensions: [{ key: "alignment", minimum: 5 }], requireActiveGoal: true, maxSelectedActiveProjects: 2 },
    });
    return { ...f, goal, profile };
  }
  const review = (id: string, revision: number, action: "begin_review" | "accept" | "reject" | "cancel") => owner().review(companyId, actor(), id, { expectedRevision: revision, action, rationale });
  function app() { const api = express(); api.use(express.json()); api.use((req, _res, next) => { req.actor = actor(); next(); }); api.use("/api", crossProjectPlanningRoutes(db)); api.use(errorHandler); return api; }
  it("admits actual current Goal associations and cumulative native billed-cost bounds without writing projects, Tasks or proposals", async () => {
    const f = await portfolioFixture(), service = portfolioPlanningService(db);
    const [budget] = await db.insert(budgetPolicies).values({ companyId, scopeType: "company", scopeId: companyId, windowKind: "lifetime", amount: 60 }).returning();
    const preview = await service.preview(companyId, actor(), f.profile);
    expect(preview.currentSources.projects.every(project => project.activeGoalIds.includes(f.goal.id))).toBe(true);
    expect(preview.currentSources.budgets).toMatchObject([{ policyId: budget.id, projectId: null, remainingCents: 60 }]);
    expect(preview.result.selectedProjectIds).toEqual([f.projects[0].id]);
    expect(preview.result.candidates.find(candidate => candidate.projectId === f.projects[1].id)).toMatchObject({ disposition: "investigate", reasons: ["native_hard_budget_bound"] });
    expect(await db.select().from(adaptivePlanningProposals).where(eq(adaptivePlanningProposals.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId))).toHaveLength(0);
    expect((await db.select().from(issues).where(eq(issues.companyId, companyId))).every(task => task.plannedStartAt === null)).toBe(true);
    expect((await db.select().from(projects).where(eq(projects.companyId, companyId))).every(project => project.status === "backlog")).toBe(true);
    await db.update(budgetPolicies).set({ amount: 0, updatedAt: new Date() }).where(eq(budgetPolicies.id, budget.id));
    const unlimited = await service.preview(companyId, actor(), f.profile);
    expect(unlimited.currentSources.budgets).toEqual([]); expect(unlimited.result.selectedProjectIds).toHaveLength(2); expect(unlimited.snapshotHash).not.toBe(preview.snapshotHash);
    await db.update(goals).set({ status: "cancelled", updatedAt: new Date() }).where(eq(goals.id, f.goal.id));
    const withdrawn = await service.preview(companyId, actor(), f.profile); expect(withdrawn.result.selectedProjectIds).toEqual([]); expect(withdrawn.currentSources.projects.every(project => project.activeGoalIds.length === 0)).toBe(true);
  });
  it("keeps unknown actual cost events and future budget periods explicit and refuses erased Goal sources", async () => {
    const f = await portfolioFixture(), service = portfolioPlanningService(db);
    const [agent] = await db.insert(agents).values({ companyId, name: "Accounting software fixture", adapterType: "process" }).returning();
    const [budget] = await db.insert(budgetPolicies).values({ companyId, scopeType: "company", scopeId: companyId, windowKind: "calendar_month_utc", amount: 100 }).returning();
    await db.insert(costEvents).values({ companyId, agentId: agent.id, projectId: f.projects[0].id, provider: "software_fixture", model: "software_fixture", costCents: 0, costStatus: "unknown", occurredAt: new Date() });
    const unknown = await service.preview(companyId, actor(), f.profile); expect(unknown.currentSources.budgets[0].remainingCents).toBeNull(); expect(unknown.result.selectedProjectIds).toEqual([]);
    expect(unknown.result.candidates.every(candidate => candidate.disposition === "investigate")).toBe(true);
    await db.update(costEvents).set({ costStatus: "reported", costCents: 10 }).where(eq(costEvents.companyId, companyId));
    const period = await service.preview(companyId, actor(), { ...f.profile, horizon: { ...f.profile.horizon, start: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 10) } });
    expect(period.currentSources.budgets[0].remainingCents).toBe(90); expect(period.result.selectedProjectIds).toEqual([]);
    await db.update(budgetPolicies).set({ hardStopEnabled: false }).where(eq(budgetPolicies.id, budget.id));
    expect((await service.preview(companyId, actor(), f.profile)).currentSources.budgets).toEqual([]);
    await db.insert(analyticalSourceSuppressions).values({ companyId, inputType: "goal", inputRef: f.goal.id });
    await expect(service.preview(companyId, actor(), f.profile)).rejects.toMatchObject({ status: 404 });
  });
  it("binds the initiative preview API to current Human, company, flags and exact complete native versions", async () => {
    const f = await portfolioFixture(), endpoint = `/api/companies/${companyId}/adaptive-planning/initiatives/preview`;
    await request(app()).post(`${endpoint}?expectedUserId=another-human`).send(f.profile).expect(409);
    await request(app()).post(endpoint).send({ ...f.profile, execute: true }).expect(400);
    const response = await request(app()).post(`${endpoint}?expectedUserId=${userId}`).send(f.profile).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store"); expect(response.body.authority).toBe("human_initiative_review_required");
    await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, f.tasks[0].id));
    await expect(portfolioPlanningService(db).preview(companyId, actor(), f.profile)).rejects.toMatchObject({ status: 409 });
    await expect(portfolioPlanningService(db).preview(companyId, { type: "agent", source: "agent_jwt", companyId, agentId: randomUUID() }, f.profile)).rejects.toMatchObject({ status: 403 });
    await disableV8Rollout(db); await expect(portfolioPlanningService(db).preview(companyId, actor(), f.profile)).rejects.toMatchObject({ status: 404 });
  });
  it("pins current native Goal, association and budget version timestamps as JSON wire values", async () => {
    const f = await portfolioFixture(), service = portfolioPlanningService(db);
    const [budget] = await db.insert(budgetPolicies).values({ companyId, scopeType: "company", scopeId: companyId, windowKind: "lifetime", amount: 100 }).returning();
    const original = await service.preview(companyId, actor(), f.profile);
    await db.update(goals).set({ description: "Human changed only Goal wording", updatedAt: new Date(f.goal.updatedAt.getTime() + 1000) }).where(eq(goals.id, f.goal.id));
    const goalChanged = await service.preview(companyId, actor(), f.profile);
    expect(goalChanged.snapshotHash).not.toBe(original.snapshotHash); expect(goalChanged.result).toEqual(original.result);
    await db.update(projectGoals).set({ updatedAt: new Date(Date.now() + 2000) }).where(and(eq(projectGoals.companyId, companyId), eq(projectGoals.projectId, f.projects[0].id)));
    const associationChanged = await service.preview(companyId, actor(), f.profile);
    expect(associationChanged.snapshotHash).not.toBe(goalChanged.snapshotHash); expect(associationChanged.result).toEqual(original.result);
    await db.update(budgetPolicies).set({ updatedAt: new Date(budget.updatedAt.getTime() + 1000) }).where(eq(budgetPolicies.id, budget.id));
    const budgetChanged = await service.preview(companyId, actor(), f.profile);
    expect(budgetChanged.snapshotHash).not.toBe(associationChanged.snapshotHash); expect(budgetChanged.result).toEqual(original.result);
  });
  it("jointly solves complete cross-project dependencies and applies only through separate native Human Roadmap review", async () => {
    const f = await proposed(), schedule = new Map(f.preview.result.schedule.map(item => [item.taskKey, item]));
    expect(f.preview.result.status).toBe("feasible_best_known"); expect(schedule.get(f.tasks[0].id)!.endDay).toBeLessThanOrEqual(schedule.get(f.tasks[1].id)!.startDay);
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId))).toHaveLength(0);
    expect((await db.select().from(issues).where(eq(issues.companyId, companyId))).every(task => task.plannedStartAt === null)).toBe(true);
    await expect(review(f.proposal.id, 1, "accept")).rejects.toMatchObject({ status: 409 });
    expect(await review(f.proposal.id, 1, "begin_review")).toMatchObject({ status: "under_review", revision: 2 });
    const accepted = await review(f.proposal.id, 2, "accept"); expect(accepted).toMatchObject({ status: "accepted", revision: 3 }); expect(accepted.appliedRoadmapRefs).toHaveLength(2);
    const native = await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId));
    expect(native).toHaveLength(2); expect(native.every(proposal => proposal.status === "accepted" && proposal.reviewedByUserId === userId && proposal.createdByUserId === userId)).toBe(true);
    for (const task of await db.select().from(issues).where(eq(issues.companyId, companyId))) { const item = schedule.get(task.id)!; expect(task.plannedStartAt!.getTime()).toBe(Date.parse(`${f.profile.horizon.start}T00:00:00Z`) + item.startDay * 86400000); expect(task.plannedEndAt!.getTime()).toBe(Date.parse(`${f.profile.horizon.start}T00:00:00Z`) + item.endDay * 86400000); }
    await expect(review(f.proposal.id, 2, "accept")).rejects.toMatchObject({ status: 409 });
    expect((await owner().detail(companyId, actor(), f.proposal.id)).context).toEqual(f.proposal.context);
  });
  it("refuses a favorable subset, foreign Tasks and unresolved omitted predecessors", async () => {
    const f = await fixture();
    const { projects: _projects, ...singleProfile } = f.profile;
    await expect(projectPlanningService(db).preview(companyId, f.projects[1].id, actor(), { ...singleProfile, tasks: [f.profile.tasks[1]] })).rejects.toMatchObject({ status: 409 });
    const [extra] = await db.insert(issues).values({ companyId, projectId: f.projects[0].id, title: "Omitted active native Task", status: "todo" }).returning();
    await expect(owner().preview(companyId, actor(), f.profile)).rejects.toMatchObject({ status: 409 });
    await issueService(db).remove(extra.id);
    const otherId = randomUUID(); await db.insert(companies).values({ id: otherId, name: "Foreign", issuePrefix: randomUUID() }); const [foreign] = await db.insert(issues).values({ companyId: otherId, title: "Foreign hidden Task" }).returning();
    await expect(owner().preview(companyId, actor(), { ...f.profile, tasks: [{ ...f.profile.tasks[0], key: foreign.id }, f.profile.tasks[1]] })).rejects.toMatchObject({ status: 409 });
    const [external] = await db.insert(issues).values({ companyId, title: "Unresolved unselected predecessor", status: "todo" }).returning(); await db.insert(issueRelations).values({ companyId, issueId: external.id, relatedIssueId: f.tasks[0].id, type: "blocks" });
    await expect(owner().preview(companyId, actor(), f.profile)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(adaptivePlanningProposals).where(eq(adaptivePlanningProposals.companyId, companyId))).toHaveLength(0);
  });
  it("exposes actual infeasibility and unknown capacity without creating a proposal", async () => {
    const f = await fixture();
    await expect(db.insert(issueRelations).values({ companyId, issueId: f.tasks[1].id, relatedIssueId: f.tasks[0].id, type: "blocks" })).rejects.toMatchObject({ cause: { code: "23514" } });
    const short = { ...f.profile, horizon: { ...f.profile.horizon, days: 1 }, pools: f.profile.pools.map(pool => ({ ...pool, days: pool.days.slice(0, 1) })) };
    const infeasible = await owner().preview(companyId, actor(), short); expect(infeasible.result.status).toBe("infeasible"); await expect(owner().propose(companyId, actor(), { profile: short, expectedSnapshotHash: infeasible.snapshotHash, reason: rationale })).rejects.toMatchObject({ status: 409 });
    const unknown = await owner().preview(companyId, actor(), { ...f.profile, pools: [{ ...f.profile.pools[0], days: f.profile.pools[0].days.map(day => ({ ...day, availableMinutes: null })) }] }); expect(unknown.result.status).toBe("inconclusive"); expect(unknown.result.diagnostics.some(item => item.code === "unknown_capacity")).toBe(true);
  });
  it("fences changed Source versions and preserves rollout-independent cancellation metadata", async () => {
    const f = await proposed(); await review(f.proposal.id, 1, "begin_review");
    await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, f.tasks[0].id));
    await expect(review(f.proposal.id, 2, "accept")).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId))).toHaveLength(0);
    await disableV8Rollout(db); const controls = await owner().controls(companyId, actor()); expect(controls.items).toEqual([{ id: f.proposal.id, status: "under_review", revision: 2 }]); expect(JSON.stringify(controls)).not.toContain(rationale);
    expect(await review(f.proposal.id, 2, "cancel")).toMatchObject({ status: "cancelled", revision: 3 });
  });
  it("rolls back native application and private live events when the original Task mutation policy refuses it", async () => {
    const f = await proposed(); await review(f.proposal.id, 1, "begin_review");
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId), eq(principalPermissionGrants.permissionKey, "issue:mutate")));
    const events: unknown[] = [], unsubscribe = subscribeCompanyLiveEvents(companyId, event => events.push(event));
    try { await expect(review(f.proposal.id, 2, "accept")).rejects.toMatchObject({ status: 403 }); expect(events).toEqual([]); } finally { unsubscribe(); }
    expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId))).toHaveLength(0);
    expect((await db.select().from(issues).where(eq(issues.companyId, companyId))).every(task => task.plannedStartAt === null)).toBe(true);
    expect((await db.select().from(adaptivePlanningProposals).where(eq(adaptivePlanningProposals.id, f.proposal.id)))[0].status).toBe("under_review");
  });
  it("rolls back the first original Roadmap application when a later native write fails", async () => {
    const f = await proposed(); await review(f.proposal.id, 1, "begin_review");
    const lastTask = f.proposal.context.sourceSnapshots[1].tasks[0].id;
    // Explicit isolated software fault after an actual earlier native owner applied.
    await db.execute(sql.raw(`CREATE FUNCTION aw_test_cross_project_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${lastTask}'::uuid AND NEW.planned_start_at IS NOT NULL THEN RAISE EXCEPTION 'software_late_native_write_failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`));
    await db.execute(sql.raw("CREATE TRIGGER aw_test_cross_project_late_failure BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION aw_test_cross_project_late_failure()"));
    const events: unknown[] = [], unsubscribe = subscribeCompanyLiveEvents(companyId, event => events.push(event));
    try {
      await expect(review(f.proposal.id, 2, "accept")).rejects.toMatchObject({ cause: { code: "23514" } });
      expect(events).toEqual([]);
      expect(await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.companyId, companyId))).toHaveLength(0);
      expect((await db.select().from(issues).where(eq(issues.companyId, companyId))).every(task => task.plannedStartAt === null && task.plannedEndAt === null)).toBe(true);
      expect((await db.select().from(adaptivePlanningProposals).where(eq(adaptivePlanningProposals.id, f.proposal.id)))[0].status).toBe("under_review");
    } finally { unsubscribe(); await db.execute(sql.raw("DROP TRIGGER aw_test_cross_project_late_failure ON issues")); await db.execute(sql.raw("DROP FUNCTION aw_test_cross_project_late_failure()")); }
  });
  it("enforces native immutable signed material, public account binding and Human withdrawal", async () => {
    const f = await proposed(), endpoint = `/api/companies/${companyId}/adaptive-planning/proposals/${f.proposal.id}`;
    const choices = `/api/companies/${companyId}/adaptive-planning/source-options`;
    await request(app()).get(`${choices}?expectedUserId=another-human`).expect(409);
    const menu = (await request(app()).get(`${choices}?expectedUserId=${userId}&q=First`).expect(200)).body;
    expect(menu.items).toHaveLength(1); expect(menu.items[0]).toMatchObject({ title: "First", source: { kind: "canonical", reference: { type: "project", id: f.projects[0].id } } });
    await request(app()).get(`${choices}?q=${"x".repeat(121)}`).expect(400);
    await request(app()).get(`${endpoint}?expectedUserId=another-human`).expect(409);
    expect((await request(app()).get(`${endpoint}?expectedUserId=${userId}`).expect(200)).headers["cache-control"]).toBe("no-store");
    await request(app()).post(`${endpoint}/review?expectedUserId=${userId}`).send({ expectedRevision: 1, action: "begin_review", rationale, copiedAuthority: true }).expect(400);
    await expect(db.update(adaptivePlanningProposals).set({ reason: "Tampered material" }).where(eq(adaptivePlanningProposals.id, f.proposal.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(adaptivePlanningProposals).set({ status: "accepted", revision: 2, reviewedByUserId: userId, reviewRationale: rationale }).where(eq(adaptivePlanningProposals.id, f.proposal.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(owner().preview(companyId, { type: "agent", source: "agent_jwt", companyId, agentId: randomUUID() }, f.profile)).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    await expect(owner().detail(companyId, actor(), f.proposal.id)).rejects.toMatchObject({ status: 403 });
  });
  it("erases the original analytical proposal on native Task deletion with flags off and company paused", async () => {
    const f = await proposed(); await disableV8Rollout(db); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await issueService(db).remove(f.tasks[0].id);
    expect(await db.select().from(adaptivePlanningProposals).where(eq(adaptivePlanningProposals.id, f.proposal.id))).toHaveLength(0);
    expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, f.proposal.manifestId))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.companyId, companyId))).toHaveLength(2);
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(1);
  });
});
