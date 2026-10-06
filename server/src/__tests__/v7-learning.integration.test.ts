import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, agents, agentIdentities, heartbeatRuns, contextManifestMemoryRoots, principalPermissionGrants, companyMemberships, issues, projects, automationArtifacts, automationArtifactVersions, workflowOptimizerEvaluations, workflows, workflowRevisions, workflowRuns, workflowStepRuns, rolePacks, rolePackVersions, rolePackItems, companySkills, companySkillVersions, playbookChangeProposals, projectRoadmapProposals, memoryBindings, memoryRecords, memoryEvidence, learningCycles, learningHypotheses, learningEvaluations, learningDomainCandidates, foundationChangeProposals, documentRevisions, foundationSections, createDb } from "@paperclipai/db";
import { learningChangeSchema, createGovernedSkillSchema, createPlaybookSchema, type LearningChange } from "@paperclipai/shared";
import { learningService } from "../services/learning/learning-service.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService } from "../services/memory/memory-service.js";
import { purgeMemoryRecords, reapplyMemoryDeletionMarkers } from "../services/memory/memory-privacy.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { optimizerEvaluationService } from "../services/optimizer/optimizer-evaluation.js";
import { optimizerSuggestionService } from "../services/optimizer/optimizer-suggestions.js";
import { proposeOptimizerCandidate } from "../services/optimizer/optimizer-candidate-proposal.js";
import { reviewWorkflowRun } from "../services/optimizer/optimizer-run-review.js";
import { contextEngineService } from "../services/context/context-engine.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { rolePackService } from "../services/role-packs.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { playbookService } from "../services/playbooks.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 Organizational Learning domain promotion", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, roots: string[], tasks: string[], targetId: string, revisionId: string;
  const owner = { type: "board" as const, source: "local_implicit" as const }, principal = { principal: { type: "system" as const, service: "local-board" } };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-learning-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableWorkflowsV1: true, enableWorkflowOptimizerSuggestions: true, enableWorkflowOptimizerShadow: true, enableAutomationArtifactsV1: true, agent_identities_v5: true, agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true, role_packs_v5: true, enableCollectiveMemoryV1: true, enableContextEngineV1: true, readiness_engine_v7: true, cognitive_memory_v7: true, memory_observations_v7: true, skill_lifecycle_v5: true, playbooks_v5: true, project_roadmap_v5: true, learning_engine_v7: true }); });
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
  it("links a native replayed Optimizer candidate without granting activation and erases its immutable payload", async () => {
    const service = workflowService(db), created = await service.create(companyId, { name: "Reviewed pure transform" }, principal);
    const draft = await service.updateDraft(companyId, created.id, { expectedRevisionId: created.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "copy", type: "core.transform", name: "Copy", position: { x: 100, y: 0 }, config: { mapping: { value: "{{input.value}}" } } },
      ], edges: [{ id: "e", source: "start", target: "copy" }], variables: [], settings: {} } }, principal);
    const published = await service.publish(companyId, created.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, principal);
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "local-reviewer", status: "active", membershipRole: "owner" });
    const executor = workflowExecutorService(db);
    // These are actual local engine runs reviewed against the declared fixture contract, not customer pilot evidence.
    for (let index = 1; index <= 3; index++) {
      const run = await executor.startManualRun(companyId, created.id, { input: { value: index } }, principal, `learning-source-${index}`);
      await reviewWorkflowRun(db, companyId, run.run.id, { humanCorrection: false, correctedOutputs: {}, reason: "Verified the saved engine output against the copy contract" }, { principal: { type: "user", userId: "local-reviewer" } });
    }
    const suggestion = (await optimizerSuggestionService(db).forWorkflow(companyId, created.id))!.suggestions.find(item => item.operationTypes.length === 1 && item.operationTypes[0] === "core.transform")!;
    const request = await proposeOptimizerCandidate(db, companyId, created.id, suggestion.id);
    const optimizer = optimizerEvaluationService(db), replay = await optimizer.compile(companyId, created.id, suggestion.id, request, principal);
    expect(replay.gatesPassed).toBe(true);
    const [evaluation] = await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, replay.evaluationId));
    const link = await domainProposal(created.id, `optimizer://${created.id}/${published.publishedRevisionId}`, { targetDomain: "automation_artifact", optimizerEvaluationId: replay.evaluationId, expectedArtifactVersionId: replay.artifactVersionId, expectedContentHash: evaluation!.contentHash });
    expect(link.candidateId).toBe(replay.evaluationId);
    expect((await db.select().from(automationArtifacts).where(eq(automationArtifacts.id, replay.artifactId)))[0]!.status).toBe("testing");
    await optimizer.startShadow(companyId, replay.evaluationId, principal);
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    const [erased] = await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, replay.artifactVersionId));
    expect(erased).toMatchObject({ sourceCode: "", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, validationReport: null, securityReport: null });
    expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, replay.evaluationId)))[0]).toMatchObject({ status: "retired", compilerResult: null, replayEvaluation: null, shadowEvaluation: null });
    await expect(optimizer.startShadow(companyId, replay.evaluationId, principal)).rejects.toBeDefined();
    await db.update(automationArtifactVersions).set({ sourceCode: "Restored private facts" }).where(eq(automationArtifactVersions.id, replay.artifactVersionId));
    expect((await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, replay.artifactVersionId)))[0]!.sourceCode).toBe("");
  }, 60_000);
  it("keeps Role Pack challengers unpublished, preserves required policies and erases descendants", async () => {
    const packs = rolePackService(db), pack = await packs.create(owner, companyId, { key: "learning-ops", name: "Operations", description: "" });
    const baseline = await packs.createVersion(owner, companyId, pack.id, { summary: "Baseline", items: [{ type: "required_policy", ref: "approval_before_side_effects", operation: "add", versionId: null, loadPoint: "always", triggerTerms: [], excludeTerms: [] }] });
    await packs.publish(owner, companyId, pack.id, baseline.id, null);
    await expect(domainProposal(pack.id, `role_pack://${pack.id}/${baseline.id}`, { targetDomain: "role_pack", expectedPublishedVersionId: baseline.id, draft: { items: [], summary: "Remove the approval checkpoint" } })).rejects.toMatchObject({ status: 403 });
    const link = await domainProposal(pack.id, `role_pack://${pack.id}/${baseline.id}`, { targetDomain: "role_pack", expectedPublishedVersionId: baseline.id, draft: { items: baseline.items, summary: "Reviewed outcome evidence improves the approval procedure" } });
    expect((await packs.get(owner, companyId, pack.id)).publishedVersionId).toBe(baseline.id);
    await packs.publish(owner, companyId, pack.id, link.candidateId, baseline.id);
    const descendant = await packs.createVersion(owner, companyId, pack.id, { items: baseline.items, summary: "Later refinement of learned procedure" });
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    expect((await db.select().from(rolePacks).where(eq(rolePacks.id, pack.id)))[0]!.publishedVersionId).toBeNull();
    expect((await db.select().from(rolePackVersions).where(eq(rolePackVersions.id, link.candidateId)))[0]!.summary).toBe("");
    expect((await db.select().from(rolePackVersions).where(eq(rolePackVersions.id, descendant.id)))[0]!.summary).toBe("");
    expect(await db.select().from(rolePackItems).where(eq(rolePackItems.versionId, link.candidateId))).toHaveLength(0);
    await expect(packs.getVersion(owner, companyId, pack.id, link.candidateId)).rejects.toMatchObject({ status: 409 });
    await expect(packs.publish(owner, companyId, pack.id, descendant.id, null)).rejects.toMatchObject({ status: 409 });
  });
  it("retains Workflow challenger roots through publication, executions and later drafts", async () => {
    const service = workflowService(db), created = await service.create(companyId, { name: "Learning workflow", description: null, projectId: null }, principal);
    const graph = { version: 1 as const, nodes: [{ id: "start", type: "core.manual_trigger", name: "Review evidence first", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} };
    const link = await domainProposal(created.id, `workflow://${created.id}/${created.draftRevisionId}`, { targetDomain: "workflow", draft: { expectedRevisionId: created.draftRevisionId!, graph, changeSummary: "Apply learned early evidence review" } });
    expect((await service.getDetail(companyId, created.id))!.publishedRevisionId).toBeNull();
    const published = await service.publish(companyId, created.id, { expectedDraftRevisionId: link.candidateId, expectedPublishedRevisionId: null, approvalId: null }, principal);
    const [run] = await db.insert(workflowRuns).values({ companyId, workflowId: created.id, workflowRevisionId: link.candidateId, triggerPayload: { copiedLearningDetail: "Outcome evidence" } }).returning();
    expect(run!.memoryRecordIds.sort()).toEqual([...roots].sort());
    const [step] = await db.insert(workflowStepRuns).values({ companyId, workflowRunId: run!.id, nodeId: "start", inputJson: { privateLearning: "Copied source" } }).returning();
    expect(step!.memoryRecordIds.sort()).toEqual([...roots].sort());
    const descendant = await service.updateDraft(companyId, created.id, { expectedRevisionId: published.draftRevisionId!, graph: { ...graph, nodes: [{ ...graph.nodes[0]!, name: "Refined evidence review" }] } }, principal);
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    const after = (await service.getDetail(companyId, created.id))!;
    expect(after).toMatchObject({ status: "paused", draftRevisionId: null, publishedRevisionId: null });
    for (const id of [link.candidateId, descendant.draftRevisionId!]) expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, id)))[0]!.graph.nodes).toEqual([]);
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, run!.id)))[0]).toMatchObject({ status: "cancelled", triggerPayload: {} });
    expect((await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.id, step!.id)))[0]!.inputJson).toBeNull();
    await expect(db.insert(workflowRuns).values({ companyId, workflowId: created.id, workflowRevisionId: link.candidateId })).rejects.toBeDefined();
    await db.update(workflowRevisions).set({ graph }).where(eq(workflowRevisions.id, link.candidateId));
    expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, link.candidateId)))[0]!.graph.nodes).toEqual([]);
  });
  it("requires the actual native approval receipt before completing a cycle and fences closure replays", async () => {
    const { service, cycle, hypothesis, evaluation } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    const current = await service.get(owner, companyId, cycle.id), input = { expectedVersion: current.version, decision: "complete" as const, rationale: "Reviewed the persisted native approval and retained evaluation" };
    expect(current.candidates[0]!.promotionReceipt).toBeNull();
    await expect(service.finish(owner, companyId, cycle.id, input)).rejects.toMatchObject({ status: 409 });
    await foundationService(db).acceptProposal(companyId, targetId, link.candidateId, principal);
    await expect(service.finish(owner, companyId, cycle.id, input)).rejects.toMatchObject({ status: 409 });
    const accepted = (await foundationService(db).get(companyId, targetId))!;
    await foundationService(db).submitForReview(companyId, targetId, accepted.latestRevisionId!, principal);
    await foundationService(db).approve(companyId, targetId, accepted.latestRevisionId!, principal);
    expect((await service.get(owner, companyId, cycle.id)).candidates[0]!.promotionReceipt?.versionId).toBe(accepted.latestRevisionId);
    expect((await service.finish(owner, companyId, cycle.id, input)).status).toBe("completed");
    await expect(service.finish(owner, companyId, cycle.id, input)).rejects.toMatchObject({ status: 409 });
  });
  it("propagates learned Foundation roots into actual Context consumers and erases late runtime writes with Learning off", async () => {
    const { service, hypothesis, evaluation } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    const foundation = foundationService(db);
    await foundation.acceptProposal(companyId, targetId, link.candidateId, principal);
    const accepted = (await foundation.get(companyId, targetId))!;
    await foundation.submitForReview(companyId, targetId, accepted.latestRevisionId!, principal);
    await foundation.approve(companyId, targetId, accepted.latestRevisionId!, principal);
    const [identity] = await db.insert(agentIdentities).values({ name: "Learned Context reader", homeCompanyId: companyId }).returning();
    const [agent] = await db.insert(agents).values({ companyId, agentIdentityId: identity!.id, name: "Learned Context reader" }).returning();
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agent!.id, status: "active" });
    await db.insert(principalPermissionGrants).values([{ companyId, principalType: "agent", principalId: agent!.id, permissionKey: "company_scope:read" }, { companyId, principalType: "agent", principalId: agent!.id, permissionKey: "foundation:read" }]);
    const [task] = await db.insert(issues).values({ companyId, title: "Apply learned evidence review", description: "Retained learned procedure", assigneeAgentId: agent!.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, status: "running", contextSnapshot: { issueId: task!.id, learnedBody: "Evidence review procedure" }, resultJson: { body: "Copied learned evidence" } }).returning();
    const assembled = await contextEngineService(db).assemble({ companyId, agentId: agent!.id, runId: run!.id, issueId: task!.id, query: "evidence review", intent: "native_task_execution" });
    expect(assembled.packet.foundation).toHaveLength(1);
    expect((await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId, assembled.packet.manifest!.id))).map(root => root.memoryRecordId).sort()).toEqual([...roots].sort());
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: false });
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]).toMatchObject({ contextSnapshot: {}, resultJson: null });
    expect((await db.select().from(issues).where(eq(issues.id, task!.id)))[0]!.description).toBeNull();
    await db.update(heartbeatRuns).set({ resultJson: { restored: "Late learned source prose" } }).where(eq(heartbeatRuns.id, run!.id));
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]!.resultJson).toBeNull();
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: true });
  });
  it("lets an owned live worker propose a hypothesis but cannot self-review or write after Stop", async () => {
    const [identity] = await db.insert(agentIdentities).values({ name: "Learning worker", homeCompanyId: companyId }).returning();
    const [agent] = await db.insert(agents).values({ companyId, agentIdentityId: identity!.id, name: "Learning worker" }).returning();
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agent!.id, status: "active" });
    await db.insert(principalPermissionGrants).values([{ companyId, principalType: "agent", principalId: agent!.id, permissionKey: "company_scope:read" }, { companyId, principalType: "agent", principalId: agent!.id, permissionKey: "foundation:read" }]);
    const [task] = await db.insert(issues).values({ companyId, title: "Inspect repeated learning outcomes", status: "in_progress", assigneeAgentId: agent!.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, status: "running", contextSnapshot: { issueId: task!.id } }).returning();
    await db.update(issues).set({ checkoutRunId: run!.id, executionRunId: run!.id }).where(eq(issues.id, task!.id));
    const actor = { type: "agent" as const, source: "agent_key" as const, companyId, agentId: agent!.id, runId: run!.id }, service = learningService(db);
    const cycle = await service.create(actor, companyId, cycleInput()), hypothesis = await service.addHypothesis(actor, companyId, cycle.id, hypothesisInput(1));
    expect(cycle.createdBy).toBe(`agent:${agent!.id}`);
    await expect(service.evaluate(actor, companyId, hypothesis.id, evaluationInput(1))).rejects.toMatchObject({ status: 403 });
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run!.id));
    await expect(service.addHypothesis(actor, companyId, cycle.id, hypothesisInput(2))).rejects.toMatchObject({ status: 403 });
  });
  it("cancels a pre-proposal cycle without permitting further evaluation or hypothesis writes", async () => {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput());
    expect((await service.finish(owner, companyId, cycle.id, { expectedVersion: 1, decision: "cancel", rationale: "Stop the unused hypothesis cycle before any domain proposal" })).status).toBe("cancelled");
    await expect(service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(2))).rejects.toMatchObject({ status: 409 });
  });
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
