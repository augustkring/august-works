import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { analyticalSourceSuppressions, businessMetricTargets, businessMetricTargetVersions, businessMetricTargetApprovals, companies, goals, projects, issues, createDb } from "@paperclipai/db";
import { businessMetricTargetDefinitionSchema } from "@paperclipai/shared";
import { businessMetricService } from "../services/business-metrics/service.js";
import { businessMetricTargetService } from "../services/business-metrics/targets.js";
import { goalService } from "../services/goals.js";
import { projectService } from "../services/projects.js";
import { suppressAnalyticalSource } from "../services/analytical-privacy.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { analyticalPurpose, metricDefinition } from "./helpers/business-metric-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("human metric commitments on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>; let companyId: string; let otherCompanyId: string; let goalId: string; let projectId: string;
  let pinned: Awaited<ReturnType<ReturnType<typeof businessMetricService>["create"]>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-targets-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    companyId = randomUUID(); otherCompanyId = randomUUID(); goalId = randomUUID(); projectId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Target company", issuePrefix: randomUUID() }, { id: otherCompanyId, name: "Foreign", issuePrefix: randomUUID() }]);
    await db.insert(goals).values({ id: goalId, companyId, title: "Native goal" });
    await db.insert(projects).values({ id: projectId, companyId, name: "Native project" });
    const policy = await aiGovernanceService(db).obligation(actor, companyId, analyticalPurpose());
    pinned = await businessMetricService(db).create(companyId, actor, { key: "completion", definition: metricDefinition(policy.id) });
    await businessMetricService(db).publish(companyId, actor, pinned.metric.id, { expectedRevision: 1, versionId: pinned.version.id });
  });
  const service = () => businessMetricTargetService(db);
  const definition = () => businessMetricTargetDefinitionSchema.parse({ metricId: pinned.metric.id, metricVersionId: pinned.version.id, scope: { type: "goal", goalId }, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-02T00:00:00Z", criterion: { kind: "at_least", value: 0.8 }, rationale: "A consciously approved review commitment", assumptions: ["Current task state measures completion rather than business outcomes"], ownerUserId: "local-board" });
  async function approved() {
    const created = await service().create(companyId, actor, { key: "completion_target", definition: definition() });
    const target = await service().approve(companyId, actor, created.target.id, { expectedRevision: 1, versionId: created.version.id, approvalRationale: "Human review accepts this explicit commitment" });
    return { ...created, target };
  }
  it("keeps a commitment distinct from observations and revisions until human approval", async () => {
    const created = await service().create(companyId, actor, { key: "completion_target", definition: definition() });
    await expect(service().compare(companyId, actor, created.target.id)).rejects.toMatchObject({ status: 409 });
    await service().approve(companyId, actor, created.target.id, { expectedRevision: 1, versionId: created.version.id, approvalRationale: "Reviewed human commitment with explicit assumptions" });
    const revised = await service().revise(companyId, actor, created.target.id, { expectedRevision: 2, definition: { ...definition(), criterion: { kind: "at_least", value: 0.9 } } });
    expect(revised.id).not.toBe(created.version.id);
    expect((await service().detail(companyId, actor, created.target.id)).target).toMatchObject({ revision: 3, approvedVersionId: created.version.id, status: "approved" });
    await expect(db.update(businessMetricTargetVersions).set({ contentHash: "a".repeat(64) }).where(eq(businessMetricTargetVersions.id, revised.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessMetricTargetApprovals).set({ rationale: "Silently replaced approval" }).where(eq(businessMetricTargetApprovals.targetId, created.target.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("rejects foreign scopes, invalid units, moved commitments and agent approval", async () => {
    const [foreign] = await db.insert(goals).values({ companyId: otherCompanyId, title: "Foreign goal" }).returning();
    await expect(service().create(companyId, actor, { key: "foreign", definition: { ...definition(), scope: { type: "goal", goalId: foreign.id } } })).rejects.toMatchObject({ status: 404 });
    await expect(service().create(companyId, actor, { key: "bad_ratio", definition: { ...definition(), criterion: { kind: "at_least", value: 80 } } })).rejects.toMatchObject({ status: 422 });
    await expect(service().create(companyId, actor, { key: "foreign_owner", definition: { ...definition(), ownerUserId: "absent-user" } })).rejects.toMatchObject({ status: 409 });
    const created = await approved();
    await expect(service().revise(companyId, actor, created.target.id, { expectedRevision: 2, definition: { ...definition(), scope: { type: "company" } } })).rejects.toMatchObject({ status: 409 });
    const agent = { type: "agent" as const, source: "agent_key" as const, companyId, agentId: randomUUID() };
    await expect(service().approve(companyId, agent, created.target.id, { expectedRevision: 2, versionId: created.version.id, approvalRationale: "A proposed agent approval is not human authority" })).rejects.toMatchObject({ status: 403 });
    await expect(db.insert(businessMetricTargets).values({ companyId, key: "forged_scope", metricId: pinned.metric.id, scopeType: "goal", goalId: foreign.id, createdBy: "test" })).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.update(businessMetricTargets).set({ scopeType: "company", goalId: null }).where(eq(businessMetricTargets.id, created.target.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("serializes concurrent revisions with native CAS and keeps retirement available after rollback", async () => {
    const created = await approved();
    const outcomes = await Promise.allSettled([service().revise(companyId, actor, created.target.id, { expectedRevision: 2, definition: definition() }), service().revise(companyId, actor, created.target.id, { expectedRevision: 2, definition: definition() })]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_metrics_v8: false });
    expect(await service().retire(companyId, actor, created.target.id, { expectedRevision: 3, reason: "Purpose withdrawn during rollout rollback" })).toMatchObject({ status: "retired", revision: 4 });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    await expect(service().approve(companyId, actor, created.target.id, { expectedRevision: 4, versionId: created.version.id, approvalRationale: "Attempt to reopen a retired commitment" })).rejects.toMatchObject({ status: 409 });
  });
  it("requires review after a published metric changes without rewriting the commitment", async () => {
    const created = await approved();
    const revised = await businessMetricService(db).createVersion(companyId, actor, pinned.metric.id, { expectedRevision: 2, definition: { ...pinned.version.definition, description: "A changed definition requires commitment review" } });
    await businessMetricService(db).publish(companyId, actor, pinned.metric.id, { expectedRevision: 3, versionId: revised.id });
    expect((await service().detail(companyId, actor, created.target.id)).target).toMatchObject({ status: "needs_review", approvedVersionId: created.version.id });
    await expect(service().compare(companyId, actor, created.target.id)).rejects.toMatchObject({ status: 409 });
    expect((await db.select().from(businessMetricTargetVersions).where(eq(businessMetricTargetVersions.targetId, created.target.id)))[0].definition.metricVersionId).toBe(pinned.version.id);
  });
  it("preserves unknown for an empty denominator and uses the metric population rather than goal ownership", async () => {
    const created = await approved();
    expect((await service().compare(companyId, actor, created.target.id)).comparison).toMatchObject({ status: "unknown", value: null, reason: "empty_denominator" });
    await db.insert(issues).values({ companyId, title: "No goal association", projectId: null, status: "done", createdAt: new Date("2026-01-01T12:00:00Z") });
    expect((await service().compare(companyId, actor, created.target.id)).comparison).toMatchObject({ status: "met", value: 1 });
    expect((await service().detail(companyId, actor, created.target.id)).versions[0].definition.criterion).toEqual({ kind: "at_least", value: 0.8 });
  });
  it("erases target history through native goals and blocks old target payloads after source restoration", async () => {
    const created = await approved(); const originalGoal = (await db.select().from(goals).where(eq(goals.id, goalId)))[0];
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_metrics_v8: false });
    await goalService(db).remove(goalId);
    expect(await db.select().from(businessMetricTargets).where(eq(businessMetricTargets.id, created.target.id))).toHaveLength(0);
    expect(await db.select().from(businessMetricTargetVersions).where(eq(businessMetricTargetVersions.targetId, created.target.id))).toHaveLength(0);
    expect(await db.select().from(businessMetricTargetApprovals).where(eq(businessMetricTargetApprovals.targetId, created.target.id))).toHaveLength(0);
    expect(await db.select().from(analyticalSourceSuppressions).where(eq(analyticalSourceSuppressions.inputRef, goalId))).toHaveLength(1);
    await db.insert(goals).values(originalGoal);
    await expect(db.insert(businessMetricTargets).values({ ...created.target, status: "draft", approvedVersionId: null })).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("rolls back analytical erasure when a canonical goal cannot be deleted", async () => {
    const created = await approved();
    await db.insert(goals).values({ companyId, title: "Child prevents canonical deletion", parentId: goalId });
    await expect(goalService(db).remove(goalId)).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await db.select().from(analyticalSourceSuppressions).where(eq(analyticalSourceSuppressions.inputRef, goalId))).toHaveLength(0);
    expect((await service().detail(companyId, actor, created.target.id)).target.status).toBe("approved");
  });
  it("erases project-scoped target history and replays target erasure with flags disabled", async () => {
    const created = await service().create(companyId, actor, { key: "project_target", definition: { ...definition(), scope: { type: "project", projectId } } });
    await projectService(db).remove(projectId);
    expect(await db.select().from(businessMetricTargets).where(eq(businessMetricTargets.id, created.target.id))).toHaveLength(0);
    const goalTarget = await approved();
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ business_metrics_v8: false });
    await db.transaction(tx => suppressAnalyticalSource(tx, companyId, "goal", goalId));
    expect(await db.select().from(businessMetricTargets).where(eq(businessMetricTargets.id, goalTarget.target.id))).toHaveLength(0);
    expect(await db.select().from(goals).where(eq(goals.id, goalId))).toHaveLength(1);
  });
});
