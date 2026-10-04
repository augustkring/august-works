import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, costEvents, documentRevisions, issues, issueRelations, projects, projectScheduleBaselines, companySkills, companySkillVersions } from "@paperclipai/db";
import { createPlaybookSchema, playbookDraftSchema, proposePlaybookSchema, roadmapProposalSchema, roadmapPolicySchema, createMilestoneSchema, projectPlaybookSkillSchema } from "@paperclipai/shared";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { assertRoadmapFieldOwnership } from "../services/roadmap-field-ownership.js";
import { companySkillService } from "../services/company-skills.js";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { playbookService } from "../services/playbooks.js";
import { projectControlService, roadmapHealth } from "../services/project-control.js";
import { budgetService } from "../services/budgets.js";

it("health reports unknown when there is no committed schedule", () => { expect(roadmapHealth([], new Date("2026-10-03T00:00:00Z")).status).toBe("unknown"); });
const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 canonical procedures and schedule", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-playbook-roadmap-"); db = createDb(database.connectionString); await enableV5ForTest(db); });
  afterAll(async () => { await database?.cleanup(); });
  it("keeps project utilization unknown when a billed cost is missing and isolates other projects", async () => {
    const f = await seedV5Presences(db), budgets = budgetService(db);
    const [first, second] = await db.insert(projects).values([{ companyId: f.home, name: "Known observations" }, { companyId: f.home, name: "Unknown costs" }]).returning();
    for (const project of [first!, second!]) await budgets.upsertPolicy(f.home, { scopeType: "project", scopeId: project.id, amount: 100, windowKind: "lifetime" }, f.userId);
    await db.insert(costEvents).values({ companyId: f.home, agentId: f.presence.id, projectId: second!.id, provider: "internal-fixture", model: "internal-fixture", costCents: 0, costStatus: "unknown", occurredAt: new Date() });
    expect(await budgets.projectSummary(f.home, second!.id)).toBeNull();
    expect(await budgets.projectSummary(f.home, first!.id)).toMatchObject([{ observedAmount: 0, utilizationPercent: 0 }]);
    expect(await budgets.projectSummary(f.guest, second!.id)).toEqual([]);
  });
  it("makes Project Planning & Execution available locally without an active V5 version", async () => {
    const f = await seedV5Presences(db), svc = companySkillService(db);
    const skills = await svc.list(f.home);
    const planner = skills.find((skill) => skill.slug === "task-planning");
    expect(planner).toBeDefined();
    const [stored] = await db.select().from(companySkills).where(and(eq(companySkills.companyId, f.home), eq(companySkills.id, planner!.id)));
    expect(stored?.markdown).toContain("# Project Planning & Execution");
    expect(stored?.activeVersionId).toBeNull();
  });
  it("requires fresh local metadata ownership and a new canonical review after classification changes", async () => {
    const f = await seedV5Presences(db), svc = playbookService(db), lifecycle = skillLifecycleService(db), skills = companySkillService(db);
    const playbook = await svc.create(f.actor, f.home, createPlaybookSchema.parse({ key: "metadata-safety", title: "Metadata safety", markdown: "Reviewed source" }));
    let row = await svc.get(f.actor, f.home, playbook.id);
    await svc.review(f.actor, f.home, row.id, { expectedRevisionId: row.document.latestRevisionId!, decision: "approve", rationale: "Review the current canonical procedure" });
    row = await svc.get(f.actor, f.home, row.id);
    const skill = await lifecycle.createDraft(f.actor, f.home, { slug: "metadata-derived", name: "Metadata derived", markdown: "Candidate", description: "", triggerTerms: [], excludeTerms: [], sharing: "company_proposed" });
    const candidate = await svc.projectSkill(f.actor, f.home, row.id, projectPlaybookSkillSchema.parse({ approvedRevisionId: row.approvedRevisionId, skillId: skill.skillId, baseActiveVersionId: null, markdown: "Derived source", summary: "Derive the reviewed source for metadata verification" }));
    const input = { expectedUpdatedAt: row.updatedAt.toISOString(), category: "operations", sensitivity: "restricted" as const, ownerUserId: f.userId, ownerAgentId: f.presence.id, reviewFrequencyDays: 30, rationale: "Restrict this procedure after an explicit source classification review" };
    await expect(svc.updateMetadata(f.actor, f.home, row.id, { ...input, ownerAgentId: f.guestPresence.id })).rejects.toMatchObject({ status: 422 });
    expect(await svc.updateMetadata(f.actor, f.home, row.id, input)).toMatchObject({ status: "in_review", approvedRevisionId: null, sensitivity: "restricted", reviewFrequencyDays: 30 });
    await expect(svc.updateMetadata(f.actor, f.home, row.id, input)).rejects.toMatchObject({ status: 409 });
    expect(await skills.getVersion(f.home, skill.skillId, candidate.id, { type: "agent", source: "agent_jwt", companyId: f.home, agentId: f.presence.id, onBehalfOfUserId: f.userId })).toBeNull();
    expect((await svc.getRevision(f.actor, f.home, row.id, row.document.latestRevisionId!)).body).toBe("Reviewed source");
  });
  it("preserves reviewed canonical approval when an automatic candidate cannot compile", async () => {
    const f = await seedV5Presences(db), svc = playbookService(db), lifecycle = skillLifecycleService(db);
    const playbook = await svc.create(f.actor, f.home, createPlaybookSchema.parse({ key: "failed-recompile", title: "Canonical procedure", markdown: "Reviewed source" }));
    const revision = (await svc.get(f.actor, f.home, playbook.id)).document.latestRevisionId!;
    await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: revision, decision: "approve", rationale: "Reviewed the canonical source" });
    const skill = await lifecycle.createDraft(f.actor, f.home, { slug: "failed-recompile", name: "Projected procedure", markdown: "Original candidate", description: "", triggerTerms: [], excludeTerms: [], sharing: "company_proposed" });
    await svc.projectSkill(f.actor, f.home, playbook.id, projectPlaybookSkillSchema.parse({ skillId: skill.skillId, baseActiveVersionId: null, approvedRevisionId: revision, markdown: "Projected candidate", summary: "Subscribe explicitly to reviewed canonical changes", syncPolicy: "auto_generate_candidate" }));
    const before = await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId, skill.skillId));
    const largeProcedure = "Reviewed detailed procedure. ".repeat(4000);
    const draft = await svc.draft(f.actor, f.home, playbook.id, playbookDraftSchema.parse({ expectedRevisionId: revision, title: "Detailed procedure", markdown: largeProcedure, changeSummary: "Add reviewed operational detail" }));
    const reviewed = await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: draft.id, decision: "approve", rationale: "Human procedure remains valid independently of compilation" });
    expect(reviewed).toMatchObject({ status: "approved", approvedRevisionId: draft.id, generatedCandidates: [], synchronizationFailures: [{ skillId: skill.skillId, reason: "candidate_generation_failed" }] });
    expect((await svc.getRevision(f.actor, f.home, playbook.id, draft.id)).body).toBe(largeProcedure);
    expect(await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId, skill.skillId))).toEqual(before);
  });
  it("propagates restricted source classification and revokes public sharing of a derived candidate", async () => {
    const f = await seedV5Presences(db), svc = playbookService(db), lifecycle = skillLifecycleService(db), skills = companySkillService(db);
    const playbook = await svc.create(f.actor, f.home, createPlaybookSchema.parse({ key: "restricted-source", title: "Restricted procedure", sensitivity: "restricted", markdown: "Restricted canonical instructions" }));
    const revision = (await svc.get(f.actor, f.home, playbook.id)).document.latestRevisionId!;
    await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: revision, decision: "approve", rationale: "Authorized classification review" });
    const skill = await lifecycle.createDraft(f.actor, f.home, { slug: "restricted-derived", name: "Derived procedure", markdown: "Original candidate", description: "", triggerTerms: [], excludeTerms: [], sharing: "company_proposed" });
    await db.update(companySkills).set({ sharingScope: "public_link", publicShareToken: "prior-share-token" }).where(eq(companySkills.id, skill.skillId));
    const projected = await svc.projectSkill(f.actor, f.home, playbook.id, projectPlaybookSkillSchema.parse({ skillId: skill.skillId, baseActiveVersionId: null, approvedRevisionId: revision, markdown: "Derived restricted instructions", summary: "Derive without downgrading the canonical classification" }));
    const [stored] = await db.select().from(companySkills).where(eq(companySkills.id, skill.skillId));
    expect(stored).toMatchObject({ metadata: { sensitivity: "restricted" }, publicShareToken: null, activeVersionId: null });
    expect(projected.validationSummary).toMatchObject({ sensitivity: "restricted", sourceCompanyId: f.home });
    const agent = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, onBehalfOfUserId: f.userId };
    expect(await skills.getVersion(f.home, skill.skillId, projected.id, agent)).toBeNull();
    expect((await skills.getVersion(f.home, skill.skillId, projected.id, f.actor))?.fileInventory[0]?.content).toBe("Derived restricted instructions");
    const later = await lifecycle.propose(f.actor, f.home, skill.skillId, { baseActiveVersionId: null, markdown: "Later candidate", sharing: "company_proposed", summary: "", dependencies: [] });
    expect(later.validationSummary).toMatchObject({ sensitivity: "restricted" });
  });
  it("rolls back the candidate and its audit when the projection link cannot be saved", async () => {
    const f = await seedV5Presences(db), svc = playbookService(db);
    const playbook = await svc.create(f.actor, f.home, createPlaybookSchema.parse({ key: "atomic-projection", title: "Atomic projection", markdown: "Reviewed source" }));
    const revision = (await svc.get(f.actor, f.home, playbook.id)).document.latestRevisionId!;
    await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: revision, decision: "approve", rationale: "Review source before projection" });
    const lifecycle = skillLifecycleService(db), skill = await lifecycle.createDraft(f.actor, f.home, { slug: "atomic-projection", name: "Projection target", markdown: "Original candidate", description: "", triggerTerms: [], excludeTerms: [], sharing: "company_proposed" });
    const before = await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId, skill.skillId));
    await db.execute(sql.raw("CREATE FUNCTION aw_test_reject_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.playbook_id::text = TG_ARGV[0] THEN RAISE EXCEPTION 'fixture projection link failure'; END IF; RETURN NEW; END $$"));
    await db.execute(sql.raw(`CREATE TRIGGER aw_test_reject_projection BEFORE INSERT ON playbook_skill_links FOR EACH ROW EXECUTE FUNCTION aw_test_reject_projection('${playbook.id}')`));
    try {
      await expect(svc.projectSkill(f.actor, f.home, playbook.id, projectPlaybookSkillSchema.parse({ skillId: skill.skillId, baseActiveVersionId: null, approvedRevisionId: revision, markdown: "Projected candidate", summary: "Verify that the complete projection commits atomically" }))).rejects.toThrow();
      expect(await db.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, f.home), eq(companySkillVersions.companySkillId, skill.skillId)))).toEqual(before);
      expect((await svc.get(f.actor, f.home, playbook.id)).links).toEqual([]);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER aw_test_reject_projection ON playbook_skill_links; DROP FUNCTION aw_test_reject_projection()"));
    }
  });
  it("recompiles explicitly subscribed canonical changes into candidates without activating them", async () => {
    const f = await seedV5Presences(db), svc = playbookService(db);
    const playbook = await svc.create(f.actor, f.home, createPlaybookSchema.parse({ key: "synchronized-release", title: "Release", markdown: "Original reviewed procedure" }));
    const first = await svc.get(f.actor, f.home, playbook.id), firstRevision = first.document.latestRevisionId!;
    await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: firstRevision, decision: "approve", rationale: "Reviewed original procedure" });
    const skill = await skillLifecycleService(db).createDraft(f.actor, f.home, { slug: "synced-release", name: "Release procedure", description: "", markdown: "Initial candidate", triggerTerms: ["release"], excludeTerms: [], sharing: "company_proposed" });
    await svc.projectSkill(f.actor, f.home, playbook.id, projectPlaybookSkillSchema.parse({ skillId: skill.skillId, baseActiveVersionId: null, approvedRevisionId: firstRevision, markdown: "Original projected procedure", summary: "Project the reviewed canonical procedure into a candidate", syncPolicy: "auto_generate_candidate" }));
    const draft = await svc.draft(f.actor, f.home, playbook.id, playbookDraftSchema.parse({ expectedRevisionId: firstRevision, title: "Release", markdown: "New reviewed instructions", changeSummary: "Revise after evidence" }));
    const reviewed = await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: draft.id, decision: "approve", rationale: "Reviewed new instructions" });
    expect(reviewed.generatedCandidates).toHaveLength(1);
    const [candidate] = await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, reviewed.generatedCandidates[0]!.versionId));
    expect(candidate).toMatchObject({ state: "candidate", sourcePlaybookRevisionId: draft.id, visibility: "company" });
    expect(candidate!.fileInventory.find((file) => file.path === "SKILL.md")!.content).toContain("New reviewed instructions");
    expect((await db.select().from(companySkills).where(eq(companySkills.id, skill.skillId)))[0]!.activeVersionId).toBeNull();
    expect((await svc.review(f.actor, f.home, playbook.id, { expectedRevisionId: draft.id, decision: "approve", rationale: "Reconfirm the same revision" })).generatedCandidates).toEqual([]);
  });
  it("keeps approved bytes immutable while a draft changes and marks a stale proposal", async () => {
    const f = await seedV5Presences(db), svc = playbookService(db);
    const row = await svc.create(f.actor, f.home, createPlaybookSchema.parse({ key: "release", title: "Release", markdown: "Reviewed procedure" }));
    const first = await svc.get(f.actor, f.home, row.id), firstRevision = first.document.latestRevisionId!;
    await svc.review(f.actor, f.home, row.id, { expectedRevisionId: firstRevision, decision: "approve", rationale: "Reviewed by the operator" });
    const proposal = await svc.propose(f.actor, f.home, row.id, proposePlaybookSchema.parse({ baseApprovedRevisionId: firstRevision, title: "Release", markdown: "Proposed canonical change", reason: "Production evidence indicates the procedure needs revision" }));
    const draft = await svc.draft(f.actor, f.home, row.id, playbookDraftSchema.parse({ expectedRevisionId: firstRevision, title: "Release", markdown: "Unreviewed changes", changeSummary: "Update procedure" }));
    expect((await svc.get(f.actor, f.home, row.id)).approvedRevisionId).toBe(firstRevision);
    expect((await svc.getRevision(f.actor, f.home, row.id, firstRevision)).body).toBe("Reviewed procedure");
    await expect(db.update(documentRevisions).set({ body: "Rewrite history" }).where(eq(documentRevisions.id, firstRevision))).rejects.toThrow();
    expect((await svc.reviewProposal(f.actor, f.home, row.id, proposal.id, true, "Recheck changed draft first")).status).toBe("stale");
    await expect(svc.review({ type: "agent", source: "agent_jwt", agentId: f.presence.id, companyId: f.home, onBehalfOfUserId: f.userId }, f.home, row.id, { expectedRevisionId: draft.id, decision: "approve", rationale: "Agent wants to approve itself" })).rejects.toMatchObject({ status: 403 });
    await expect(svc.get(f.actor, f.guest, row.id)).rejects.toMatchObject({ status: 404 });
  });
  it("requires reviewed commitment changes, keeps forecasts separate, and pins an explicit baseline", async () => {
    const f = await seedV5Presences(db), svc = projectControlService(db);
    const [project] = await db.insert(projects).values({ companyId: f.home, name: "Launch" }).returning();
    const actualStart = new Date("2026-10-01T00:00:00Z");
    const [issue] = await db.insert(issues).values({ companyId: f.home, projectId: project!.id, title: "Ship", status: "in_progress", startedAt: actualStart }).returning();
    const view = await svc.get(f.actor, f.home, project!.id);
    const proposal = await svc.propose(f.actor, f.home, project!.id, roadmapProposalSchema.parse({ expectedProjectUpdatedAt: view.projectUpdatedAt, reason: "Commit the agreed launch schedule after human review", changes: [{ issueId: issue!.id, expectedUpdatedAt: issue!.updatedAt.toISOString(), patch: { plannedStartAt: "2026-10-03T00:00:00Z", plannedEndAt: "2026-10-10T00:00:00Z" } }] }));
    expect(proposal.status).toBe("pending"); expect((await db.select().from(issues).where(eq(issues.id, issue!.id)))[0]!.plannedEndAt).toBeNull();
    expect((await svc.review(f.actor, f.home, project!.id, proposal.id, true, "Approved agreed dates")).status).toBe("accepted");
    const baseline = await svc.baseline(f.actor, f.home, project!.id, "Original plan");
    const after = (await db.select().from(issues).where(eq(issues.id, issue!.id)))[0]!;
    await svc.forecast(f.actor, f.home, project!.id, issue!.id, { expectedUpdatedAt: after.updatedAt.toISOString(), forecastStartAt: "2026-10-03T00:00:00Z", forecastEndAt: "2026-10-12T00:00:00Z", forecastConfidence: 0.6, forecastReason: "Dependency testing extends the likely completion date" });
    const stored = (await db.select().from(issues).where(eq(issues.id, issue!.id)))[0]!;
    expect(stored.startedAt).toEqual(actualStart); expect(stored.completedAt).toBeNull(); expect(stored.plannedEndAt?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect((await svc.get(f.actor, f.home, project!.id)).health.status).toBe("at_risk");
    await expect(db.update(projectScheduleBaselines).set({ name: "Change original" }).where(eq(projectScheduleBaselines.id, baseline.id))).rejects.toThrow();
  });
  it("rejects foreign milestones, dependency cycles and dual ownership of planned dates", async () => {
    const f = await seedV5Presences(db), svc = projectControlService(db);
    const [home] = await db.insert(projects).values({ companyId: f.home, name: "Home" }).returning(), [foreign] = await db.insert(projects).values({ companyId: f.guest, name: "Foreign" }).returning();
    const milestone = await svc.createMilestone(f.actor, f.guest, foreign!.id, createMilestoneSchema.parse({ name: "Foreign" }));
    const [a, b] = await db.insert(issues).values([{ companyId: f.home, projectId: home!.id, title: "A" }, { companyId: f.home, projectId: home!.id, title: "B" }]).returning();
    await expect(db.update(issues).set({ milestoneId: milestone.id }).where(eq(issues.id, a!.id))).rejects.toThrow();
    await db.insert(issueRelations).values({ companyId: f.home, issueId: a!.id, relatedIssueId: b!.id, type: "blocks" });
    await expect(db.insert(issueRelations).values({ companyId: f.home, issueId: b!.id, relatedIssueId: a!.id, type: "blocks" })).rejects.toThrow();
    await svc.policy(f.actor, f.home, home!.id, roadmapPolicySchema.parse({ fieldOwnership: { plannedDates: "external_readonly" }, externalSourceRef: "jira:launch" }));
    await instanceSettingsService(db).updateExperimental({ project_roadmap_v5: false });
    try {
      await expect(assertRoadmapFieldOwnership(db, f.home, home!.id, { plannedEndAt: "2026-10-12T00:00:00Z" })).rejects.toMatchObject({ status: 409 });
      await expect(assertRoadmapFieldOwnership(db, f.home, home!.id, { title: "Permitted internal title edit" })).resolves.toBeUndefined();
    } finally { await instanceSettingsService(db).updateExperimental({ project_roadmap_v5: true }); }
    const view = await svc.get(f.actor, f.home, home!.id);
    await expect(svc.propose(f.actor, f.home, home!.id, roadmapProposalSchema.parse({ expectedProjectUpdatedAt: view.projectUpdatedAt, reason: "Try to overwrite the external plan without authority", changes: [{ issueId: a!.id, expectedUpdatedAt: a!.updatedAt.toISOString(), patch: { plannedEndAt: "2026-10-12T00:00:00Z" } }] }))).rejects.toMatchObject({ status: 409 });
  });
});
