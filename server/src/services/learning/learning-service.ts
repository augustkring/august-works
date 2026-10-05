import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { learningCycles, learningEvidence, learningHypotheses, learningEvaluations, learningDomainCandidates, learningRetainedAssets, rolePacks, rolePackItems, workflows, policyChangeProposals, memoryEvidence, issues, projects, companySkills, foundationDocuments, documents, playbookDocuments, readinessRequirements, type Db } from "@paperclipai/db";
import { learningCycleSchema, learningHypothesisSchema, learningEvaluationSchema, proposeLearningChangeSchema, reviewLearningPolicySchema, EVIDENCE_SENSITIVITIES, roadmapPolicySchema, type MemoryScope, type LearningPolicyPayload, type ReadinessAction } from "@paperclipai/shared";
import type { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { assertDerivedManager, derivedRoots } from "../memory/derived-memory.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { workflowService } from "../workflows/workflow-service.js";
import { rolePackService } from "../role-packs.js";
import { foundationService } from "../foundation/foundation-service.js";
import { playbookService } from "../playbooks.js";
import { skillLifecycleService } from "../skill-lifecycle.js";
import { projectControlService } from "../project-control.js";
import { readinessService } from "../readiness/readiness-service.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { evaluateLearningComparison } from "./learning-evaluation.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
type Cycle = typeof learningCycles.$inferSelect;
type Hypothesis = typeof learningHypotheses.$inferSelect;
const scope = (cycle: Cycle): MemoryScope => ({ type: cycle.scopeType as "company" | "project", id: cycle.scopeId });
export async function learningRoots(db: Db, actor: AuthorizationActor, cycle: Cycle) {
  const edges = await db.select().from(learningEvidence).where(and(eq(learningEvidence.companyId, cycle.companyId), eq(learningEvidence.cycleId, cycle.id)));
  const roots = await derivedRoots(db, actor, cycle.companyId, scope(cycle), cycle.purpose, edges.map((edge) => edge.memoryRecordId), new Map(edges.map((edge) => [edge.memoryRecordId, edge.sourceVersion])));
  await outcomes(db, actor, cycle, Object.keys(cycle.outcomeVersions), cycle.outcomeVersions); return roots;
}
async function outcomes(db: Db, actor: AuthorizationActor, cycle: Cycle, ids: string[], expected?: Record<string, string>) {
  if (!ids.length || ids.length > 64) throw conflict("Learning requires bounded canonical outcomes");
  const rows = await db.select().from(issues).where(and(eq(issues.companyId, cycle.companyId), inArray(issues.id, ids))).for("share");
  if (rows.length !== ids.length) throw notFound("Learning requires surviving canonical Task outcomes");
  for (const row of rows) {
    await assertV7Authorization(db, actor, cycle.companyId, "issue:read", { type: "issue", companyId: cycle.companyId, issueId: row.id });
    if (row.status !== "done" || !row.completedAt || (cycle.scopeType === "project" && row.projectId !== cycle.scopeId)
      || expected && expected[row.id] !== row.updatedAt.toISOString()) throw conflict("Learning outcome is incomplete, outside the scope or changed");
  }
  return rows;
}
async function assertBaseline(db: Db, actor: AuthorizationActor, parent: Cycle, input: z.infer<typeof learningHypothesisSchema>) {
  const companyId = parent.companyId, id = input.targetId;
  let baseline: string | null = null;
  if (input.targetDomain === "foundation") {
    await assertV7Authorization(db, actor, companyId, "foundation:read");
    const [row] = await db.select({ revision: documents.latestRevisionId }).from(foundationDocuments).innerJoin(documents, and(eq(documents.companyId, companyId), eq(documents.id, foundationDocuments.documentId))).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, id)));
    if (row?.revision) baseline = `foundation://${id}/${row.revision}`;
  } else if (input.targetDomain === "skill") {
    const [row] = await db.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, id)));
    if (row) baseline = `skill://${id}/${row.activeVersionId ?? "none"}`;
  } else if (input.targetDomain === "playbook") {
    await assertV7Authorization(db, actor, companyId, "foundation:read");
    const [row] = await db.select().from(playbookDocuments).where(and(eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.id, id)));
    if (row) baseline = `playbook://${id}/${row.approvedRevisionId ?? "none"}`;
  } else if (input.targetDomain === "workflow") {
    await assertV7Authorization(db, actor, companyId, "workflows:read");
    const [row] = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, id)));
    if (row?.draftRevisionId && row.status !== "archived") baseline = `workflow://${id}/${row.draftRevisionId}`;
  } else if (input.targetDomain === "role_pack") {
    const [row] = await db.select().from(rolePacks).where(and(eq(rolePacks.companyId, companyId), eq(rolePacks.id, id), eq(rolePacks.status, "active")));
    if (row) baseline = `role_pack://${id}/${row.publishedVersionId ?? "none"}`;
  } else if (input.targetDomain === "project" || id !== companyId) {
    await assertV7Authorization(db, actor, companyId, "project:read", { type: "project", companyId, projectId: id });
    const [row] = await db.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, id)));
    if (row) baseline = `${input.targetDomain === "policy" ? "policy://project" : "project:/"}/${id}/${row.updatedAt.toISOString()}`;
  } else {
    const match = /^policy:\/\/readiness\/([a-f0-9-]{36})\/([a-z0-9._-]+)\/(\d+)$/i.exec(input.evaluationContract.baselineRef);
    if (match && match[1] === companyId) {
      const [row] = await db.select().from(readinessRequirements).where(and(eq(readinessRequirements.companyId, companyId), eq(readinessRequirements.requirementKey, match[2]!))).orderBy(desc(readinessRequirements.version)).limit(1);
      if ((row?.version ?? 0) === Number(match[3])) baseline = input.evaluationContract.baselineRef;
    }
  }
  if (!baseline || baseline !== input.evaluationContract.baselineRef) throw conflict("The champion baseline is not the current canonical target");
}
export function learningService(db: Db) {
  async function admit(actor: AuthorizationActor, companyId: string, tx = db, manage = false) {
    await assertV7Enabled(tx, "learning_engine_v7"); await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    if (manage) await assertDerivedManager(tx, actor, companyId);
  }
  async function cycle(actor: AuthorizationActor, companyId: string, id: string, tx = db, lock = false) {
    await admit(actor, companyId, tx);
    const query = tx.select().from(learningCycles).where(and(eq(learningCycles.companyId, companyId), eq(learningCycles.id, id)));
    const [row] = await (lock ? query.for("update") : query); if (!row || row.erasedAt) throw notFound("Learning cycle not found");
    if (row.scopeType === "project") await assertV7Authorization(tx, actor, companyId, "project:read", { type: "project", companyId, projectId: row.scopeId! });
    return row;
  }
  async function hypothesis(actor: AuthorizationActor, companyId: string, id: string, tx: Db) {
    const [row] = await tx.select().from(learningHypotheses).where(and(eq(learningHypotheses.companyId, companyId), eq(learningHypotheses.id, id)));
    if (!row || row.erasedAt || !row.evaluationContract) throw notFound("Learning hypothesis not found");
    const parent = await cycle(actor, companyId, row.cycleId, tx, true);
    await learningRoots(tx, actor, parent); return { row: row as Hypothesis & { evaluationContract: NonNullable<Hypothesis["evaluationContract"]> }, parent };
  }
  const audit = (tx: Db, actor: AuthorizationActor, companyId: string, id: string, action: string, publications: Parameters<typeof logActivity>[2], details?: Record<string, unknown>) => logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action, entityType: "learning_cycle", entityId: id, details }, publications);
  return {
    policies: async (actor: AuthorizationActor, companyId: string) => {
      await admit(actor, companyId, db, true);
      const rows = await db.select().from(policyChangeProposals).where(and(eq(policyChangeProposals.companyId, companyId), isNull(policyChangeProposals.erasedAt))).orderBy(desc(policyChangeProposals.createdAt)).limit(100);
      const visible: Array<typeof policyChangeProposals.$inferSelect & { baseline?: LearningPolicyPayload | null }> = [];
      for (const row of rows) {
        const [link] = await db.select().from(learningDomainCandidates).where(and(eq(learningDomainCandidates.companyId, companyId), eq(learningDomainCandidates.targetDomain, "policy"), eq(learningDomainCandidates.candidateId, row.id)));
        if (!link || link.erasedAt) continue;
        try {
          await hypothesis(actor, companyId, link.hypothesisId, db);
          if (row.proposal?.policyType === "project_roadmap") {
            await assertV7Authorization(db, actor, companyId, "project:read", { type: "project", companyId, projectId: row.targetId });
            const [target] = await db.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, row.targetId)));
            if (!target) throw notFound("Policy project not found");
            const stale = row.status === "pending" && target.updatedAt.toISOString() !== row.proposal.expectedProjectUpdatedAt;
            visible.push({ ...row, status: stale ? "stale" : row.status, baseline: { policyType: "project_roadmap", expectedProjectUpdatedAt: target.updatedAt.toISOString(), policy: roadmapPolicySchema.parse(target.roadmapPolicy ?? {}) } });
          } else if (row.proposal?.policyType === "readiness_requirement") {
            const [target] = await db.select().from(readinessRequirements).where(and(eq(readinessRequirements.companyId, companyId), eq(readinessRequirements.requirementKey, row.proposal.requirement.requirementKey))).orderBy(desc(readinessRequirements.version)).limit(1);
            const stale = row.status === "pending" && (target?.version ?? 0) !== row.proposal.requirement.expectedVersion;
            visible.push({ ...row, status: stale ? "stale" : row.status, baseline: target ? { policyType: "readiness_requirement", requirement: { requirementKey: target.requirementKey, name: target.name, actionClass: target.actionClass as ReadinessAction, expectedVersion: target.version, criteria: target.criteria } } : null });
          } else visible.push(row);
        }
        catch (error) { if (error && typeof error === "object" && "status" in error && Number(error.status) === 409) visible.push({ ...row, proposal: null, reason: "", status: "stale" }); else if (!(error && typeof error === "object" && "status" in error && [403,404].includes(Number(error.status)))) throw error; }
      }
      return visible;
    },
    list: async (actor: AuthorizationActor, companyId: string) => {
      await admit(actor, companyId); const rows = await db.select().from(learningCycles).where(and(eq(learningCycles.companyId, companyId), isNull(learningCycles.erasedAt))).orderBy(desc(learningCycles.updatedAt)).limit(100);
      const visible: Cycle[] = [];
      for (const row of rows) { try { await learningRoots(db, actor, row); visible.push(row); } catch (error) { if (!(error && typeof error === "object" && "status" in error && [403, 404, 409].includes(Number(error.status)))) throw error; } }
      return visible;
    },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      const row = await cycle(actor, companyId, id); await learningRoots(db, actor, row);
      const hypotheses = await db.select().from(learningHypotheses).where(and(eq(learningHypotheses.companyId, companyId), eq(learningHypotheses.cycleId, id), isNull(learningHypotheses.erasedAt))).orderBy(desc(learningHypotheses.createdAt)).limit(20);
      const evaluations = hypotheses.length ? await db.select().from(learningEvaluations).where(and(eq(learningEvaluations.companyId, companyId), inArray(learningEvaluations.hypothesisId, hypotheses.map((item) => item.id)), isNull(learningEvaluations.erasedAt))).limit(40) : [];
      const candidates = hypotheses.length ? await db.select().from(learningDomainCandidates).where(and(eq(learningDomainCandidates.companyId, companyId), inArray(learningDomainCandidates.hypothesisId, hypotheses.map((item) => item.id)))).limit(20) : [];
      return { ...row, hypotheses, evaluations, candidates };
    },
    create: async (actor: AuthorizationActor, companyId: string, raw: z.input<typeof learningCycleSchema>) => {
      const input = learningCycleSchema.parse(raw); await admit(actor, companyId, db, true); await assertSaasDomainAdmission(db, companyId, "memory.use");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true);
        const roots = await derivedRoots(tx, actor, companyId, input.scope, input.purpose, input.memoryRecordIds);
        const sources = await tx.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.memoryRecordId, input.memoryRecordIds)));
        // Reviewed prose alone is not an external outcome. Resolve actual canonical Tasks now.
        const taskIds = [...new Set(sources.filter((item) => item.sourceClass === "task" && item.trustLevel === "high" && item.supportsOrContradicts === "supports" && ["august_works_tasks", "august_works_issue"].includes(item.sourceProvider))
          .flatMap((item) => { const match = /^issue:\/\/([a-f0-9-]{36})$/i.exec(item.sourceRef); return match ? [match[1]!] : []; }))];
        if (!taskIds.length || roots.some((root) => !["human_verified", "system_verified", "corroborated"].includes(root.verificationState) || !sources.some((item) => item.memoryRecordId === root.id && item.sourceClass === "task" && item.trustLevel === "high" && item.supportsOrContradicts === "supports" && ["august_works_tasks", "august_works_issue"].includes(item.sourceProvider) && taskIds.some((taskId) => item.sourceRef === `issue://${taskId}`)))) throw conflict("Learning roots require verified canonical outcome evidence");
        const tasks = await outcomes(tx, actor, { scopeType: input.scope.type, scopeId: input.scope.id, companyId } as Cycle, taskIds);
        const [row] = await tx.insert(learningCycles).values({ companyId, scopeType: input.scope.type, scopeId: input.scope.id, purpose: input.purpose, trigger: input.trigger, maxHypotheses: input.maxHypotheses, maxEvaluations: input.maxEvaluations, outcomeVersions: Object.fromEntries(tasks.map((task) => [task.id, task.updatedAt.toISOString()])), createdBy: v7HumanActorId(actor) }).returning();
        await tx.insert(learningEvidence).values(roots.map((root) => ({ companyId, cycleId: row!.id, memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString() })));
        await audit(tx, actor, companyId, row!.id, "learning.cycle_created", publications, { roots: roots.length, outcomes: taskIds.length }); return row!;
      });
    },
    addHypothesis: async (actor: AuthorizationActor, companyId: string, cycleId: string, raw: z.infer<typeof learningHypothesisSchema>) => {
      const input = learningHypothesisSchema.parse(raw); await admit(actor, companyId, db, true);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true); const parent = await cycle(actor, companyId, cycleId, tx, true);
        if (parent.version !== input.expectedCycleVersion || ["cancelled", "failed", "completed"].includes(parent.status)) throw conflict("Learning cycle changed or closed");
        await learningRoots(tx, actor, parent);
        await assertBaseline(tx, actor, parent, input);
        const existing = await tx.select({ id: learningHypotheses.id }).from(learningHypotheses).where(and(eq(learningHypotheses.companyId, companyId), eq(learningHypotheses.cycleId, cycleId))).limit(parent.maxHypotheses);
        if (existing.length >= parent.maxHypotheses) throw conflict("Learning hypothesis budget exhausted");
        if (parent.scopeType === "project" && (!["project", "policy"].includes(input.targetDomain) || input.targetId !== parent.scopeId)) throw forbidden("Project learning cannot broaden into company knowledge");
        const [row] = await tx.insert(learningHypotheses).values({ companyId, cycleId, claim: input.claim, predictedEffect: input.predictedEffect, targetDomain: input.targetDomain, targetId: input.targetId, riskClass: input.riskClass, evaluationContract: input.evaluationContract }).returning();
        await tx.update(learningCycles).set({ version: parent.version + 1, status: "evaluating", updatedAt: new Date() }).where(eq(learningCycles.id, cycleId));
        await audit(tx, actor, companyId, cycleId, "learning.hypothesis_created", publications, { hypothesisId: row!.id, riskClass: input.riskClass }); return row!;
      });
    },
    evaluate: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof learningEvaluationSchema>) => {
      const input = learningEvaluationSchema.parse(raw); await admit(actor, companyId, db, true);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true); const { row, parent } = await hypothesis(actor, companyId, id, tx);
        if (row.version !== input.expectedHypothesisVersion || row.status === "proposal_created" || ["cancelled", "failed", "completed"].includes(parent.status)) throw conflict("Hypothesis changed or closed");
        const hypotheses = await tx.select({ id: learningHypotheses.id }).from(learningHypotheses).where(and(eq(learningHypotheses.companyId, companyId), eq(learningHypotheses.cycleId, parent.id)));
        const previous = await tx.select({ id: learningEvaluations.id }).from(learningEvaluations).where(and(eq(learningEvaluations.companyId, companyId), inArray(learningEvaluations.hypothesisId, hypotheses.map((item) => item.id)))).limit(parent.maxEvaluations);
        if (previous.length >= parent.maxEvaluations) throw conflict("Learning evaluation budget exhausted");
        const tasks = await outcomes(tx, actor, parent, input.cases.flatMap((item) => [item.baselineTaskId, item.challengerTaskId]));
        const result = evaluateLearningComparison(row.evaluationContract, input.cases);
        const [evaluation] = await tx.insert(learningEvaluations).values({ companyId, hypothesisId: id, method: input.method, cases: input.cases, outcomeVersions: Object.fromEntries(tasks.map((task) => [task.id, task.updatedAt.toISOString()])), result: result.result, metrics: result.metrics,
          limitations: [...input.limitations, "Manual review establishes an association; no causal effect or randomized comparison is claimed."], reviewedBy: v7HumanActorId(actor) }).returning();
        await tx.update(learningHypotheses).set({ version: row.version + 1, status: result.result === "passed" ? "supported" : result.result === "failed" ? "not_supported" : "inconclusive", updatedAt: new Date() }).where(eq(learningHypotheses.id, id));
        await tx.update(learningCycles).set({ version: parent.version + 1, updatedAt: new Date() }).where(eq(learningCycles.id, parent.id));
        await audit(tx, actor, companyId, parent.id, "learning.evaluation_recorded", publications, { evaluationId: evaluation!.id, result: result.result }); return evaluation!;
      });
    },
    proposeChange: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof proposeLearningChangeSchema>) => {
      const input = proposeLearningChangeSchema.parse(raw); await admit(actor, companyId, db, true);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true); const { row, parent } = await hypothesis(actor, companyId, id, tx);
        if (row.version !== input.expectedHypothesisVersion || row.status !== "supported" || row.targetDomain !== input.change.targetDomain || ["cancelled", "failed", "completed"].includes(parent.status)) throw conflict("A current supported hypothesis is required");
        if (nativeSha256(input.change) !== row.evaluationContract.challengerHash) throw conflict("The challenger differs from the evaluated proposal");
        const [evaluation] = await tx.select().from(learningEvaluations).where(and(eq(learningEvaluations.companyId, companyId), eq(learningEvaluations.hypothesisId, id), eq(learningEvaluations.id, input.evaluationId), isNull(learningEvaluations.erasedAt)));
        if (!evaluation || evaluation.result !== "passed") throw conflict("A retained passing evaluation is required");
        await outcomes(tx, actor, parent, Object.keys(evaluation.outcomeVersions), evaluation.outcomeVersions);
        const roots = await learningRoots(tx, actor, parent), sourceSensitivity = EVIDENCE_SENSITIVITIES[Math.max(...roots.map((root) => EVIDENCE_SENSITIVITIES.indexOf(root.sensitivityLabel)))]!;
        const principal = actor.source === "local_implicit" ? { type: "system" as const, service: "local-board" } : { type: "user" as const, userId: v7HumanActorId(actor) };
        let candidateId: string;
        if (input.change.targetDomain === "foundation") {
          await assertV7Authorization(tx, actor, companyId, "foundation:propose");
          const [target] = await tx.select({ foundation: foundationDocuments, document: documents }).from(foundationDocuments).innerJoin(documents, and(eq(documents.companyId, companyId), eq(documents.id, foundationDocuments.documentId))).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, row.targetId))).for("update");
          if (!target) throw notFound("Foundation target not found");
          if (target.document.latestRevisionId !== input.change.baseRevisionId) throw conflict("Foundation baseline changed");
          if (EVIDENCE_SENSITIVITIES.indexOf(target.foundation.sensitivity as typeof sourceSensitivity) < EVIDENCE_SENSITIVITIES.indexOf(sourceSensitivity)) throw forbidden("Learning cannot lower source sensitivity");
          const created = await foundationService(tx).createProposal(companyId, row.targetId, { sourceType: "learning", sourceId: id, baseRevisionId: input.change.baseRevisionId, proposedBody: input.change.proposedBody, reason: input.change.reason }, { principal }); candidateId = created.id;
        } else if (input.change.targetDomain === "skill") {
          const [target] = await tx.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, row.targetId)));
          if (!target) throw notFound("Skill target not found");
          const created = await skillLifecycleService(tx).propose(actor, companyId, row.targetId, input.change.candidate, { sourceSensitivity }, publications); candidateId = created.id;
        } else if (input.change.targetDomain === "playbook") {
          const [target] = await tx.select().from(playbookDocuments).where(and(eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.id, row.targetId)));
          if (!target) throw notFound("Playbook target not found");
          if (EVIDENCE_SENSITIVITIES.indexOf(target.sensitivity as typeof sourceSensitivity) < EVIDENCE_SENSITIVITIES.indexOf(sourceSensitivity)) throw forbidden("Learning cannot lower source sensitivity");
          candidateId = (await playbookService(tx).propose(actor, companyId, row.targetId, input.change.proposal, publications)).id;
        } else if (input.change.targetDomain === "project") {
          if (parent.scopeType === "project" && parent.scopeId !== row.targetId) throw forbidden("Learning project target is outside the evidence scope");
          candidateId = (await projectControlService(tx).propose(actor, companyId, row.targetId, input.change.proposal, publications)).id;
        } else if (input.change.targetDomain === "workflow") {
          await assertV7Authorization(tx, actor, companyId, "workflows:edit");
          if (EVIDENCE_SENSITIVITIES.indexOf(sourceSensitivity) > EVIDENCE_SENSITIVITIES.indexOf("internal")) throw forbidden("Workflow drafts cannot carry classified Learning roots");
          await assertBaseline(tx, actor, parent, { expectedCycleVersion: parent.version, claim: row.claim, predictedEffect: row.predictedEffect, targetDomain: "workflow", targetId: row.targetId, riskClass: row.riskClass as "low", evaluationContract: row.evaluationContract });
          const detail = await workflowService(tx).updateDraft(companyId, row.targetId, input.change.draft, { principal });
          if (!detail.draftRevision || detail.draftRevision.id === input.change.draft.expectedRevisionId) throw conflict("Learning requires a distinct Workflow challenger");
          candidateId = detail.draftRevision.id;
        } else if (input.change.targetDomain === "role_pack") {
          if (EVIDENCE_SENSITIVITIES.indexOf(sourceSensitivity) > EVIDENCE_SENSITIVITIES.indexOf("internal")) throw forbidden("Role Pack drafts cannot carry classified Learning roots");
          const [target] = await tx.select().from(rolePacks).where(and(eq(rolePacks.companyId, companyId), eq(rolePacks.id, row.targetId))).for("update");
          if (!target || target.publishedVersionId !== input.change.expectedPublishedVersionId) throw conflict("The Role Pack champion changed");
          const required = target.publishedVersionId ? await tx.select().from(rolePackItems).where(and(eq(rolePackItems.companyId, companyId), eq(rolePackItems.versionId, target.publishedVersionId))) : [];
          for (const { item } of required.filter(({ item }) => item.type.startsWith("required_") || item.type === "capability_expectation")) {
            if (!input.change.draft.items.some(next => next.type === item.type && next.ref === item.ref && next.operation === "add" && next.versionId === item.versionId && (item.loadPoint !== "always" || next.loadPoint === "always"))) throw forbidden("Learning cannot remove or weaken required Role Pack items");
          }
          candidateId = (await rolePackService(tx).createVersion(actor, companyId, row.targetId, input.change.draft, publications)).id;
        } else {
          // Security/approval changes are human proposals; the native policy owner applies them separately.
          if (input.change.proposal.policyType === "project_roadmap") await assertV7Authorization(tx, actor, companyId, "tasks:assign", { type: "project", companyId, projectId: row.targetId });
          else await assertV7Authorization(tx, actor, companyId, "company_scope:read");
          const [created] = await tx.insert(policyChangeProposals).values({ companyId, targetId: row.targetId, policyType: input.change.proposal.policyType, proposal: input.change.proposal, reason: input.change.reason }).returning(); candidateId = created!.id;
        }
        const [link] = await tx.insert(learningDomainCandidates).values({ companyId, hypothesisId: id, evaluationId: evaluation.id, targetDomain: row.targetDomain, targetId: row.targetId, candidateId, candidateHash: row.evaluationContract.challengerHash }).returning();
        if (["workflow", "role_pack"].includes(row.targetDomain)) await tx.insert(learningRetainedAssets).values({ companyId, candidateLinkId: link!.id, assetType: row.targetDomain === "workflow" ? "workflow_revision" : "role_pack_version", assetId: candidateId });
        await tx.update(learningHypotheses).set({ status: "proposal_created", version: row.version + 1, updatedAt: new Date() }).where(eq(learningHypotheses.id, id));
        await tx.update(learningCycles).set({ status: "proposing", version: parent.version + 1, updatedAt: new Date() }).where(eq(learningCycles.id, parent.id));
        await audit(tx, actor, companyId, parent.id, "learning.domain_proposal_created", publications, { hypothesisId: id, targetDomain: row.targetDomain, candidateId }); return link!;
      });
    },
    reviewPolicy: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof reviewLearningPolicySchema>) => {
      const input = reviewLearningPolicySchema.parse(raw); await admit(actor, companyId, db, true);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true);
        const [row] = await tx.select().from(policyChangeProposals).where(and(eq(policyChangeProposals.companyId, companyId), eq(policyChangeProposals.id, id))).for("update");
        if (!row || row.erasedAt || !row.proposal) throw notFound("Policy proposal not found");
        if (row.status !== "pending" || row.version !== input.expectedVersion) throw conflict("Policy proposal changed");
        const [link] = await tx.select().from(learningDomainCandidates).where(and(eq(learningDomainCandidates.companyId, companyId), eq(learningDomainCandidates.targetDomain, "policy"), eq(learningDomainCandidates.candidateId, id)));
        if (!link || link.invalidatedAt || link.erasedAt) throw conflict("Policy learning evidence requires revalidation");
        const { parent } = await hypothesis(actor, companyId, link.hypothesisId, tx);
        if (input.decision === "accept") {
          if (!input.acknowledgeApprovalOrSecurityChange) throw forbidden("Explicit human acknowledgement of governance effects is required");
          if (row.proposal.policyType === "project_roadmap") {
            await assertV7Authorization(tx, actor, companyId, "users:manage_permissions");
            await assertV7Authorization(tx, actor, companyId, "tasks:assign", { type: "project", companyId, projectId: row.targetId });
            const [project] = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, row.targetId))).for("update");
            if (!project || project.updatedAt.toISOString() !== row.proposal.expectedProjectUpdatedAt) throw conflict("Project policy baseline changed");
            await tx.update(projects).set({ roadmapPolicy: roadmapPolicySchema.parse(row.proposal.policy), updatedAt: new Date() }).where(eq(projects.id, project.id));
          } else {
            if (row.targetId !== companyId || parent.scopeType !== "company") throw forbidden("Readiness policy requires a company evidence scope");
            await assertV7Enabled(tx, "readiness_engine_v7"); await assertV7Authorization(tx, actor, companyId, "foundation:approve");
            await readinessService(tx).publishRequirement(companyId, row.proposal.requirement, { actor: { type: "board", source: actor.source, userId: actor.userId ?? undefined }, principalId: actor.source === "local_implicit" ? "local-board" : `user:${v7HumanActorId(actor)}`, userId: actor.userId ?? null });
          }
        }
        const [updated] = await tx.update(policyChangeProposals).set({ status: input.decision === "accept" ? "accepted" : "rejected", version: row.version + 1, reviewedBy: v7HumanActorId(actor), reviewRationale: input.rationale, updatedAt: new Date() }).where(eq(policyChangeProposals.id, id)).returning();
        await audit(tx, actor, companyId, parent.id, "learning.policy_reviewed", publications, { proposalId: id, decision: input.decision }); return updated!;
      });
    },
  };
}
