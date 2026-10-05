import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, issues, projects, companySkills, companySkillVersions, playbookChangeProposals, projectRoadmapProposals, memoryBindings, memoryRecords, memoryEvidence, learningCycles, learningHypotheses, learningEvaluations, learningDomainCandidates, foundationChangeProposals, documentRevisions, foundationSections, createDb } from "@paperclipai/db";
import { learningChangeSchema, createGovernedSkillSchema, createPlaybookSchema, type LearningChange } from "@paperclipai/shared";
import { learningService } from "../services/learning/learning-service.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService } from "../services/memory/memory-service.js";
import { purgeMemoryRecords, reapplyMemoryDeletionMarkers } from "../services/memory/memory-privacy.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { playbookService } from "../services/playbooks.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 Organizational Learning domain promotion", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, roots: string[], tasks: string[], targetId: string, revisionId: string;
  const owner = { type: "board" as const, source: "local_implicit" as const }, principal = { principal: { type: "system" as const, service: "local-board" } };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-learning-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableCollectiveMemoryV1: true, enableContextEngineV1: true, readiness_engine_v7: true, cognitive_memory_v7: true, memory_observations_v7: true, skill_lifecycle_v5: true, playbooks_v5: true, project_roadmap_v5: true, learning_engine_v7: true }); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); roots = [randomUUID(), randomUUID()]; tasks = Array.from({ length: 4 }, () => randomUUID());
    await db.insert(companies).values({ id: companyId, name: "Learning fixture", issuePrefix: `L${companyId.slice(0, 7)}` });
    for (const id of tasks) await db.insert(issues).values({ id, companyId, title: `Reviewed outcome ${id}`, status: "done", completedAt: new Date() });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "learning", name: "Verified outcomes", providerKey: "local" }).returning();
    for (const [index, id] of roots.entries()) {
      await db.insert(memoryRecords).values({ id, companyId, bindingId: binding!.id, providerKey: "local", memoryType: "outcome", scopeType: "company", content: `Actual customer outcome ${index}`, reviewState: "accepted", verificationState: "human_verified", observedAt: new Date(), createdByActorType: "system", createdByActorId: "fixture" });
      await db.insert(memoryEvidence).values({ companyId, memoryRecordId: id, sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${tasks[index]}`, sourceVersion: "1", observedAt: new Date(), excerptHash: String(index).repeat(64), citationJson: { label: "Reviewed Task" }, trustLevel: "high", supportsOrContradicts: "supports" });
    }
    const document = await foundationService(db).createDraft(companyId, { foundationKey: "company_profile", title: "Company profile", body: "Original governed baseline", category: "company", documentType: "profile", sensitivity: "internal" }, principal);
    targetId = document.id; revisionId = document.latestRevisionId!;
  });
  const cycleInput = () => ({ scope: { type: "company" as const, id: null }, purpose: "native_task_execution", trigger: "Repeated late review increases rework", memoryRecordIds: roots });
  const change = () => ({ targetDomain: "foundation" as const, baseRevisionId: revisionId, proposedBody: "Add an evidence review before drafting the final response.", reason: "Repeated verified work outcomes suggest reviewing evidence earlier." });
  const contract = () => ({ expectedImprovement: "Earlier evidence review reduces rework", protectedInvariants: ["Human approval remains mandatory"], baselineRef: `foundation://${targetId}/${revisionId}`, challengerHash: nativeSha256(change()), minimumCases: 2, minimumQuality: 0.8, minimumImprovement: 0.05, rollbackPath: "Reject the candidate and retain the previously reviewed baseline" });
  const hypothesisInput = (version: number) => ({ expectedCycleVersion: version, claim: "Earlier evidence review should reduce repeated late corrections", predictedEffect: "Fewer late corrections without removing any approval gate", targetDomain: "foundation" as const, targetId, riskClass: "material" as const, evaluationContract: contract() });
  const judgment = (quality: number) => ({ correctness: true, safety: true, policy: true, businessOutcome: quality, reliability: 1, latencyMs: 100, costCents: 10 });
  const evaluationInput = (version: number) => ({ expectedHypothesisVersion: version, method: "manual_review" as const, cases: [0, 1].map((index) => ({ baselineTaskId: tasks[index * 2]!, challengerTaskId: tasks[index * 2 + 1]!, baseline: judgment(0.7), challenger: judgment(0.9), invariantResults: [true], rationale: "Reviewed saved work products and current canonical outcomes" })), limitations: ["Small manually selected case set; no randomized causal comparison"] });
  async function supported() {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput());
    const hypothesis = await service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(cycle.version));
    const evaluation = await service.evaluate(owner, companyId, hypothesis.id, evaluationInput(hypothesis.version));
    return { service, cycle, hypothesis, evaluation };
  }
  async function domainProposal(target: string, baseline: string, rawChange: LearningChange) {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput()), normalized = learningChangeSchema.parse(rawChange);
    const hypothesis = await service.addHypothesis(owner, companyId, cycle.id, { ...hypothesisInput(1), targetDomain: normalized.targetDomain, targetId: target,
      evaluationContract: { ...contract(), baselineRef: baseline, challengerHash: nativeSha256(normalized) } });
    const evaluation = await service.evaluate(owner, companyId, hypothesis.id, evaluationInput(1));
    return service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: normalized });
  }
  it("uses the native Skill challenger lifecycle and still requires native Skill evaluation for promotion", async () => {
    const skills = skillLifecycleService(db), created = await skills.createDraft(owner, companyId, createGovernedSkillSchema.parse({ slug: "learning-procedure", name: "Procedure", markdown: "Keep human approval before changing systems" }));
    const link = await domainProposal(created.skillId, `skill://${created.skillId}/none`, { targetDomain: "skill", candidate: { baseActiveVersionId: null, markdown: "Review evidence before drafting; keep human approval", summary: "Evidence review before drafting", dependencies: [], sharing: "company_proposed" } });
    expect((await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, link.candidateId)))[0]!.state).toBe("candidate");
    expect((await db.select().from(companySkills).where(eq(companySkills.id, created.skillId)))[0]!.activeVersionId).toBeNull();
    await expect(skills.promote(owner, companyId, created.skillId, { versionId: link.candidateId, expectedActiveVersionId: null, evaluationRunId: randomUUID() })).rejects.toBeDefined();
  });
  it("uses the native Playbook proposal without replacing its approved procedure", async () => {
    const playbooks = playbookService(db), created = await playbooks.create(owner, companyId, createPlaybookSchema.parse({ key: "learning-procedure", title: "Procedure", markdown: "Original reviewed procedure" }));
    const link = await domainProposal(created.id, `playbook://${created.id}/none`, { targetDomain: "playbook", proposal: { baseApprovedRevisionId: null, title: "Procedure", markdown: "Review evidence before drafting", reason: "Real outcomes show repeated late evidence review" } });
    expect((await db.select().from(playbookChangeProposals).where(eq(playbookChangeProposals.id, link.candidateId)))[0]!.status).toBe("pending");
    expect((await playbooks.get(owner, companyId, created.id)).approvedRevisionId).toBeNull();
  });
  it("keeps roadmap dates unchanged and policy proposals behind explicit human acknowledgement", async () => {
    const [project] = await db.insert(projects).values({ companyId, name: "Evidence project" }).returning();
    const [task] = await db.insert(issues).values({ companyId, projectId: project!.id, title: "Plan evidence checkpoint" }).returning();
    const link = await domainProposal(project!.id, `project://${project!.id}/${project!.updatedAt.toISOString()}`, { targetDomain: "project", proposal: { expectedProjectUpdatedAt: project!.updatedAt.toISOString(), changes: [{ issueId: task!.id, expectedUpdatedAt: task!.updatedAt.toISOString(), patch: { estimatedEffortMinutes: 60 } }], reason: "Allow enough time for early evidence review", evidence: [] } });
    expect((await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, link.candidateId)))[0]!.status).toBe("pending");
    expect((await db.select().from(issues).where(eq(issues.id, task!.id)))[0]!.estimatedEffortMinutes).toBeNull();
    const policy = await domainProposal(project!.id, `policy://project/${project!.id}/${project!.updatedAt.toISOString()}`, learningChangeSchema.parse({ targetDomain: "policy", reason: "Use human review for all forecast-driven schedule changes", proposal: { policyType: "project_roadmap", expectedProjectUpdatedAt: project!.updatedAt.toISOString(), policy: {} } }));
    await expect(learningService(db).reviewPolicy(owner, companyId, policy.candidateId, { expectedVersion: 1, decision: "accept", rationale: "Reviewed the effects on approvals and scheduling rules", acknowledgeApprovalOrSecurityChange: false })).rejects.toMatchObject({ status: 403 });
    await learningService(db).reviewPolicy(owner, companyId, policy.candidateId, { expectedVersion: 1, decision: "accept", rationale: "Reviewed the effects on approvals and scheduling rules", acknowledgeApprovalOrSecurityChange: true });
    expect((await db.select().from(projects).where(eq(projects.id, project!.id)))[0]!.roadmapPolicy?.allowLowRiskAgentScheduleUpdates).toBe(false);
  });
  it("keeps failed comparisons out of production even when the challenger is cheaper", async () => {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput()), hypothesis = await service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(1));
    const input = evaluationInput(1); input.cases[0]!.challenger.safety = false; input.cases[0]!.challenger.costCents = 0;
    const evaluation = await service.evaluate(owner, companyId, hypothesis.id, input); expect(evaluation.result).toBe("failed");
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.companyId, companyId))).toHaveLength(0);
    expect((await foundationService(db).get(companyId, targetId))!.latestRevisionId).toBe(revisionId);
  });
  it("creates a domain proposal after reviewed comparison without publishing canonical truth", async () => {
    const { service, hypothesis, evaluation } = await supported(); expect(evaluation.result).toBe("passed"); expect(evaluation.metrics.causalEffectEstablished).toBe(false);
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    const [proposal] = await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id, link.candidateId)); expect(proposal!.status).toBe("pending");
    expect((await foundationService(db).get(companyId, targetId))!.latestRevisionId).toBe(revisionId);
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects reflected-only evidence, copied cases, forged baselines and unevaluated edits", async () => {
    await db.update(memoryEvidence).set({ sourceRef: `issue://${randomUUID()}` }).where(eq(memoryEvidence.memoryRecordId, roots[0]!));
    await expect(learningService(db).create(owner, companyId, cycleInput())).rejects.toMatchObject({ status: 404 });
    await db.update(memoryEvidence).set({ sourceRef: `issue://${tasks[0]}` }).where(eq(memoryEvidence.memoryRecordId, roots[0]!));
    const { service, hypothesis, evaluation, cycle } = await supported();
    const copied = evaluationInput(2); copied.cases[1] = copied.cases[0]!; await expect(service.evaluate(owner, companyId, hypothesis.id, copied)).rejects.toBeDefined();
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: { ...change(), proposedBody: "An unevaluated security exception" } })).rejects.toMatchObject({ status: 409 });
    const current = await service.get(owner, companyId, cycle.id);
    await expect(service.addHypothesis(owner, companyId, cycle.id, { ...hypothesisInput(current.version), evaluationContract: { ...contract(), baselineRef: `foundation://${targetId}/${randomUUID()}` } })).rejects.toMatchObject({ status: 409 });
  });
  it("serializes hypothesis budgets and rejects agent self-certification and foreign evidence", async () => {
    const service = learningService(db), cycle = await service.create(owner, companyId, { ...cycleInput(), maxHypotheses: 1 });
    const results = await Promise.allSettled([service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(1)), service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(1))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(service.create({ type: "agent", source: "agent_key", companyId, agentId: randomUUID() }, companyId, cycleInput())).rejects.toMatchObject({ status: 403 });
    await expect(service.create(owner, companyId, { ...cycleInput(), memoryRecordIds: [randomUUID()] })).rejects.toMatchObject({ status: 404 });
  });
  it("rechecks current outcomes before creating a proposal", async () => {
    const { service, hypothesis, evaluation } = await supported();
    await db.update(issues).set({ updatedAt: new Date(Date.now() + 1000), status: "in_progress" }).where(eq(issues.id, tasks[3]!));
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() })).rejects.toMatchObject({ status: 409 });
  });
  it("blocks domain acceptance when source evidence changes with V7 disabled", async () => {
    const { service, hypothesis, evaluation } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: false });
    await memoryService(db).revoke(companyId, roots[0]!, { reason: "Wrong outcome" }, principal);
    expect((await db.select().from(learningDomainCandidates).where(eq(learningDomainCandidates.id, link.id)))[0]!.invalidatedAt).not.toBeNull();
    await expect(foundationService(db).acceptProposal(companyId, targetId, link.candidateId, principal)).rejects.toBeDefined();
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: true });
  });
  it("erases accepted derived revisions and prevents restored proposal content from surviving", async () => {
    const { service, hypothesis, evaluation, cycle } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    await foundationService(db).acceptProposal(companyId, targetId, link.candidateId, principal);
    const accepted = (await foundationService(db).get(companyId, targetId))!;
    const descendant = await foundationService(db).updateDraft(companyId, targetId, { baseRevisionId: accepted.latestRevisionId!, body: "Later draft retains the learned procedure", changeSummary: "Refine the learned procedure without changing its provenance" }, principal);
    await db.transaction(async (tx) => { await purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]); });
    expect((await db.select().from(documentRevisions).where(eq(documentRevisions.id, accepted.latestRevisionId!)))[0]!.body).toBe("");
    expect((await db.select().from(documentRevisions).where(eq(documentRevisions.id, descendant.latestRevisionId!)))[0]!.body).toBe("");
    expect((await db.select().from(learningCycles).where(eq(learningCycles.id, cycle.id)))[0]!.trigger).toBe("");
    expect((await db.select().from(learningHypotheses).where(eq(learningHypotheses.id, hypothesis.id)))[0]!.evaluationContract).toBeNull();
    expect((await db.select().from(learningEvaluations).where(eq(learningEvaluations.id, evaluation.id)))[0]!.cases).toEqual([]);
    await db.update(foundationChangeProposals).set({ proposedBody: "Late restored customer details" }).where(eq(foundationChangeProposals.id, link.candidateId));
    expect((await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id, link.candidateId)))[0]!.proposedBody).toBe("");
    await db.update(learningHypotheses).set({ claim: "Late restored customer claim", erasedAt: null }).where(eq(learningHypotheses.id, hypothesis.id));
    expect((await db.select().from(learningHypotheses).where(eq(learningHypotheses.id, hypothesis.id)))[0]!.claim).toBe("");
    await db.insert(foundationSections).values({ companyId, foundationDocumentId: targetId, documentRevisionId: accepted.latestRevisionId!, ordinal: 0, headingPath: ["Restored customer"], body: "Late copied customer facts", contentHash: "a".repeat(64), tokenCount: 10 });
    expect((await db.select().from(foundationSections).where(eq(foundationSections.documentRevisionId, accepted.latestRevisionId!)))[0]!.body).toBe("");
    await db.update(memoryRecords).set({ content: "Restored source", deletedAt: null }).where(eq(memoryRecords.id, roots[0]!));
    await reapplyMemoryDeletionMarkers(db, companyId); await expect(service.get(owner, companyId, cycle.id)).rejects.toMatchObject({ status: 404 });
  });
});
