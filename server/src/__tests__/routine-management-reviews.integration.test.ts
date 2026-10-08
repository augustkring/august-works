import express from "express";
import request from "supertest";
import { managementReviewRoutes } from "../routes/management-reviews.js";
import { routineRoutes } from "../routes/routines.js";
import { errorHandler } from "../middleware/index.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, routines, authUsers, businessMetricObservations, companies, companyMemberships, principalPermissionGrants, createDb, issues, managementReviewSnapshots, routineRuns, routineTriggers, workflowRuns } from "@paperclipai/db";
import { createRoutineSchema, routineManagementReviewTemplateSchema } from "@paperclipai/shared";
import { issueService } from "../services/issues.js";
import { routineService } from "../services/routines.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { managementReviewService } from "../services/management-reviews/service.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { analyticalPurpose, metricDefinition } from "./helpers/business-metric-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("Native Routine fresh management review cadence", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, userId: string;
  beforeAll(async () => { process.env.PAPERCLIP_DECISION_SIGNING_SECRET = "0123456789abcdef0123456789abcdef"; database = await startEmbeddedPostgresTestDatabase("aw-v8-routine-review-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableWorkflowsV1: true, analytical_lineage_v8: true, business_metrics_v8: true, management_reviews_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true });
    companyId = randomUUID(); userId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Software native review cadence", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Explicit software Human delegation", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "admin", status: "active" });
    await db.insert(principalPermissionGrants).values(["company_scope:read","users:manage_permissions","workflows:read","workflows:edit","workflows:run","workflows:publish","project:read","issue:read"].map(permissionKey=>({companyId,principalType:"user",principalId:userId,permissionKey})));
  });
  const actor = () => ({ type: "board" as const, source: "session" as const, userId, companyIds: [companyId] });
  async function fixture() {
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "reviews"];
    const obligation = await aiGovernanceService(db).obligation(actor(), companyId, policy), metrics = businessMetricService(db);
    const metric = await metrics.create(companyId, actor(), { key: "native_routine_completion", definition: { ...metricDefinition(obligation.id), ownerUserId: userId } });
    await metrics.publish(companyId, actor(), metric.metric.id, { expectedRevision: 1, versionId: metric.version.id });
    const [task] = await db.insert(issues).values({ companyId, title: "Actual native source Task", status: "todo" }).returning();
    const workflows = workflowService(db), workflowActor = { principal: { type: "user" as const, userId } };
    const created = await workflows.create(companyId, { name: "Native deterministic review dispatch" }, workflowActor);
    const updated = await workflows.updateDraft(companyId, created.id, { expectedRevisionId: created.draftRevisionId!, graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }, { id: "continue", type: "core.condition", name: "Continue", position: { x: 180, y: 0 }, config: { expression: "true" } }], edges: [{ id: "edge", source: "start", target: "continue" }], variables: [], settings: {} } }, workflowActor);
    await workflows.publish(companyId, created.id, { expectedDraftRevisionId: updated.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, workflowActor);
    const template = routineManagementReviewTemplateSchema.parse({ name: "Weekly native source review", reviewType: "weekly_leadership", purpose: "management_intelligence", sensitivity: "internal", retentionDays: 1, periodDays: 7, governanceObligationRefs: [obligation.id], sources: [{ key: "completion", selector: { kind: "metric_query", metricId: metric.metric.id } }], agenda: [{ key: "review_completion", category: "INVESTIGATE", ownerUserId: userId, dueAfterDays: 1, sourceKeys: ["completion"], nextAction: "Human reviews the fresh native observation before deciding whether to act", hypothesis: null }] });
    const service = routineService(db), routine = await service.create(companyId, createRoutineSchema.parse({ title: "Weekly review draft", executionTarget: { kind: "workflow", workflowId: created.id }, concurrencyPolicy: "always_enqueue", managementReviewTemplate: template }), { userId });
    return { service, routine, metric, task: task!, template };
  }
  function app() { const api = express(); api.use(express.json()); api.use((req, _res, next) => { req.actor = actor(); next(); }); api.use("/api", routineRoutes(db)); api.use("/api", managementReviewRoutes(db)); api.use(errorHandler); return api; }
  it("binds the public template update to the current account and native revision without invoking or publishing", async () => {
    const f = await fixture(), endpoint = `/api/routines/${f.routine.id}`, patch = { baseRevisionId: f.routine.latestRevisionId, managementReviewTemplate: { ...f.template, periodDays: 30, reviewType: "monthly_business" } };
    await request(app()).patch(`${endpoint}?expectedUserId=another-account`).send(patch).expect(409);
    expect((await f.service.get(f.routine.id))!.managementReviewTemplate).toEqual(f.template);
    await request(app()).patch(`${endpoint}?expectedUserId=${userId}`).send({ ...patch, managementReviewTemplate: { ...patch.managementReviewTemplate, copiedObservation: { value: 0.75 } } }).expect(400);
    const saved = (await request(app()).patch(`${endpoint}?expectedUserId=${userId}`).send(patch).expect(200)).body;
    expect(saved.managementReviewTemplate).toMatchObject({ periodDays: 30, reviewType: "monthly_business" });
    expect(saved.latestRevisionId).not.toBe(f.routine.latestRevisionId);
    await request(app()).patch(`${endpoint}?expectedUserId=${userId}`).send(patch).expect(409);
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(routineRuns).where(eq(routineRuns.companyId, companyId))).toHaveLength(0);
  });
  it("restores the original template through the native revision owner and admits the restoring Human afresh", async () => {
    const f = await fixture();
    const removed = await f.service.update(f.routine.id, { baseRevisionId: f.routine.latestRevisionId, managementReviewTemplate: null }, { userId });
    expect(removed!.managementReviewTemplate).toBeNull();
    const restored = await f.service.restoreRevision(f.routine.id, f.routine.latestRevisionId!, { userId });
    expect(restored.routine.managementReviewTemplate).toEqual(f.template);
    expect(restored.routine.latestRevisionId).not.toBe(f.routine.latestRevisionId);
    const run = await f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: "restored-template" });
    expect(run.routineRevisionId).toBe(restored.routine.latestRevisionId); expect(run.linkedManagementReviewId).toBeTruthy();
  });
  it("resolves a newly published metric version rather than retaining the template's earlier observation", async () => {
    const f = await fixture(), owner = businessMetricService(db);
    const before = await f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: "original-current-version" });
    const current = await owner.detail(companyId, actor(), f.metric.metric.id);
    const changed = await owner.createVersion(companyId, actor(), f.metric.metric.id, { expectedRevision: current.metric.revision, definition: { ...f.metric.version.definition, description: "Human republishes the current native definition for a subsequent review" } });
    await owner.publish(companyId, actor(), f.metric.metric.id, { expectedRevision: changed.revision, versionId: changed.id });
    const after = await f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: "new-current-version" });
    const first = await managementReviewService(db).detail(companyId, actor(), before.linkedManagementReviewId!), second = await managementReviewService(db).detail(companyId, actor(), after.linkedManagementReviewId!);
    expect(first.sources[0]!.source).toMatchObject({ kind: "analytical", reference: { type: "metric_observation", metricVersionId: f.metric.version.id } });
    expect(second.sources[0]!.source).toMatchObject({ kind: "analytical", reference: { type: "metric_observation", metricVersionId: changed.id } });
    expect(second.id).not.toBe(first.id); expect(second.publishedBy).toBeNull();
  });
  async function publishedReview(taskGrant = true) {
    const f = await fixture(), run = await f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: randomUUID() }), owner = managementReviewService(db), view = await owner.detail(companyId, actor(), run.linkedManagementReviewId!);
    await owner.publish(companyId, actor(), view.id, { expectedContentHash: view.packet.contentHash, rationale: "Current Human explicitly reviews the exact source packet and uncertainty", evidenceAndUncertaintyAcknowledged: true });
    if (taskGrant) await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "tasks:assign" });
    const input = { expectedContentHash: view.packet.contentHash, itemKey: f.template.agenda[0]!.key, idempotencyKey: randomUUID(), title: "Explicit independent Human follow-up", description: "Human requests an investigation before proposing a canonical change", priority: "medium" as const, humanReviewAcknowledged: true as const };
    return { ...f, view, owner, input };
  }
  it("creates one actual native Human Task under concurrent idempotent review commands without copying measurements or executing work", async () => {
    const f = await publishedReview(), [first, repeated] = await Promise.all([f.owner.createTask(companyId, actor(), f.view.id, f.input), f.owner.createTask(companyId, actor(), f.view.id, f.input)]);
    expect(first.issueId).toBe(repeated.issueId); expect([first.reused, repeated.reused].sort()).toEqual([false, true]);
    const task = await issueService(db).getById(first.issueId);
    expect(task).toMatchObject({ companyId, title: f.input.title, createdByUserId: userId, responsibleUserId: userId, status: "todo", assigneeAgentId: null, assigneeUserId: null, executionRunId: null });
    expect(task!.description).toContain(f.input.description); expect(task!.description).toContain(`reviewId=${f.view.id}`);
    expect(task!.description).not.toContain("measuredEffect"); expect(task!.description).not.toContain("metric_observation");
    expect((await f.owner.detail(companyId, actor(), f.view.id)).events).toHaveLength(0);
    await expect(f.owner.createTask(companyId, actor(), f.view.id, { ...f.input, description: "Changed Human command under the same existing native idempotency key" })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(2);
  });
  it("requires independent Task permission and the current exact published Source for a public review action", async () => {
    const f = await publishedReview(false), endpoint = `/api/companies/${companyId}/management-reviews/${f.view.id}/tasks`;
    await request(app()).post(`${endpoint}?expectedUserId=another-account`).send(f.input).expect(409);
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    await request(app()).post(`${endpoint}?expectedUserId=${userId}`).send(f.input).expect(403);
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "tasks:assign" });
    await request(app()).post(`${endpoint}?expectedUserId=${userId}`).send({ ...f.input, observedValue: 0.75 }).expect(400);
    await request(app()).post(`${endpoint}?expectedUserId=${userId}`).send({ ...f.input, expectedContentHash: "0".repeat(64) }).expect(409);
    const created = (await request(app()).post(`${endpoint}?expectedUserId=${userId}`).send(f.input).expect(201)).body;
    expect(created).toMatchObject({ reviewId: f.view.id, itemKey: f.input.itemKey, reused: false });
    expect(await db.select().from(issues).where(eq(issues.id, created.issueId))).toHaveLength(1);
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    await request(app()).post(`${endpoint}?expectedUserId=${userId}`).send({ ...f.input, idempotencyKey: randomUUID() }).expect(403);
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(2);
  });
  it("refuses unpublished or Agent review actions and preserves the independent Human Task after native Source erasure", async () => {
    const f = await fixture(), run = await f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: randomUUID() }), owner = managementReviewService(db), view = await owner.detail(companyId, actor(), run.linkedManagementReviewId!);
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "tasks:assign" });
    const input = { expectedContentHash: view.packet.contentHash, itemKey: f.template.agenda[0]!.key, idempotencyKey: randomUUID(), title: "Independent Human Task content", description: "Human investigates before proposing a material canonical change", humanReviewAcknowledged: true };
    await expect(owner.createTask(companyId, actor(), view.id, input)).rejects.toMatchObject({ status: 409 });
    await expect(owner.createTask(companyId, { type: "agent", source: "agent_jwt", companyId, agentId: randomUUID() }, view.id, input)).rejects.toMatchObject({ status: 403 });
    await owner.publish(companyId, actor(), view.id, { expectedContentHash: view.packet.contentHash, rationale: "Human reviews this exact source and the independent Task proposal", evidenceAndUncertaintyAcknowledged: true });
    const created = await owner.createTask(companyId, actor(), view.id, input);
    await instanceSettingsService(db).updateExperimental({ management_reviews_v8: false, business_metrics_v8: false, analytical_lineage_v8: false }); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId)); await issueService(db).remove(f.task.id);
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.id, view.id))).toHaveLength(0);
    expect((await issueService(db).getById(created.issueId))!.description).toContain(input.description);
    await expect(owner.createTask(companyId, actor(), view.id, { ...input, idempotencyKey: randomUUID() })).rejects.toBeDefined();
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(1);
  });
  it("refuses an Agent-configured Human review template under the original server-assigned delegation", async () => {
    const f = await fixture(), [agent] = await db.insert(agents).values({ companyId, name: "Software Routine configuration Agent", status: "idle", adapterType: "paperclip_runner" }).returning();
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: agent!.id, permissionKey: "workflows:run" });
    await expect(f.service.create(companyId, createRoutineSchema.parse({ title: "Unsupported delegated Human review", executionTarget: { kind: "workflow", workflowId: f.routine.executionTargetRef! }, managementReviewTemplate: f.template }), { agentId: agent!.id })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(routines).where(eq(routines.companyId, companyId))).toHaveLength(1);
  });
  it("creates fresh actual native observations, keeps drafts separate from publication and reuses an idempotent run", async () => {
    const f = await fixture(), input = { source: "manual" as const, idempotencyKey: "native-first-review" };
    const first = await f.service.runRoutine(f.routine.id, input, { userId });
    expect(first.linkedManagementReviewId).toBeTruthy();
    const review = await managementReviewService(db).detail(companyId, actor(), first.linkedManagementReviewId!);
    expect(review).toMatchObject({ status: "draft", publishedBy: null, createdBy: userId });
    const repeated = await f.service.runRoutine(f.routine.id, input, { userId }); expect(repeated.id).toBe(first.id);
    expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, companyId))).toHaveLength(1);
    await db.update(issues).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(issues.id, f.task.id));
    const second = await f.service.runRoutine(f.routine.id, { source: "manual", idempotencyKey: "native-second-review" }, { userId });
    expect(second.linkedManagementReviewId).not.toBe(first.linkedManagementReviewId);
    const observations = await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, companyId));
    expect(observations).toHaveLength(2);expect(new Set(observations.map(row => row.id)).size).toBe(2);
    expect(observations.map(row => row.result.value).sort()).toEqual([0, 1]);
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, second.linkedWorkflowRunId!)))[0]!.triggerPayload).toMatchObject({ routine: { managementReviewId: second.linkedManagementReviewId, routineRevisionId: f.routine.latestRevisionId } });
  });
  it("uses the original cron owner and refuses a withdrawn configured Human rather than borrowing responsibility", async () => {
    const f = await fixture(), { trigger } = await f.service.createTrigger(f.routine.id, { kind: "schedule", cronExpression: "0 9 * * 1", timezone: "Europe/Copenhagen" }, { userId });
    await db.update(routineTriggers).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(routineTriggers.id, trigger.id));
    await f.service.tickScheduledTriggers(new Date());
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, companyId))).toHaveLength(1);
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    await expect(f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: "withdrawn-delegation" })).rejects.toMatchObject({ status: 403 });
    await db.update(routineTriggers).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(routineTriggers.id, trigger.id));
    await expect(f.service.tickScheduledTriggers(new Date())).rejects.toMatchObject({status:403});
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, companyId))).toHaveLength(1);
  });
  it("rolls back fresh observation and native run when a later declared selector is unavailable", async () => {
    const f = await fixture();
    await f.service.update(f.routine.id, { baseRevisionId: f.routine.latestRevisionId, managementReviewTemplate: { ...f.template, sources: [...f.template.sources, { key: "unavailable_project", selector: { kind: "canonical", reference: { type: "project", id: randomUUID() } } }] } }, { userId });
    const events: string[] = [], unsubscribe = subscribeCompanyLiveEvents(companyId, event => events.push(JSON.stringify(event)));
    try { await expect(f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: "unavailable-selector" })).rejects.toBeDefined(); } finally { unsubscribe(); }
    expect(events.some(event => event.includes("business_metric.observed") || event.includes("management_review.drafted"))).toBe(false);
    expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(routineRuns).where(eq(routineRuns.companyId, companyId))).toHaveLength(0);
  });
  it("clears the native review reference on Source erasure while keeping original Routine and Workflow run identity", async () => {
    const f = await fixture(), run = await f.service.runRoutine(f.routine.id, { source: "api", idempotencyKey: "erasure-review" });
    expect(run.linkedManagementReviewId).toBeTruthy();
    await instanceSettingsService(db).updateExperimental({ management_reviews_v8: false, business_metrics_v8: false, analytical_lineage_v8: false });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await issueService(db).remove(f.task.id);
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, companyId))).toHaveLength(0);
    const [retained] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(retained).toMatchObject({ id: run.id, routineRevisionId: f.routine.latestRevisionId, linkedManagementReviewId: null, linkedWorkflowRunId: run.linkedWorkflowRunId });
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.linkedWorkflowRunId!))).toHaveLength(1);
  });
});
