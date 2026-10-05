import { and, eq, inArray } from "drizzle-orm";
import { learningCycles, learningEvidence, learningHypotheses, learningEvaluations, learningDomainCandidates, learningRetainedAssets, policyChangeProposals, workflows, workflowRevisions, workflowRuns, rolePacks, rolePackVersions, rolePackItems,
  foundationChangeProposals, playbookChangeProposals, projectRoadmapProposals, companySkills, companySkillVersions, documentRevisions, documents, foundationSections, foundationDocuments, playbookDocuments, type Db } from "@paperclipai/db";

/** Runs under the caller's company privacy lock, independently of rollout flags. */
export async function invalidateLearningMemory(tx: Db, companyId: string, recordIds: string[], erase = false) {
  if (!recordIds.length) return;
  const evidence = await tx.select({ cycleId: learningEvidence.cycleId }).from(learningEvidence).where(and(eq(learningEvidence.companyId, companyId), inArray(learningEvidence.memoryRecordId, recordIds)));
  const cycleIds = [...new Set(evidence.map((edge) => edge.cycleId))]; if (!cycleIds.length) return;
  const now = new Date();
  const hypotheses = await tx.update(learningHypotheses).set(erase ? { status: "rejected", claim: "", predictedEffect: "", evaluationContract: null, erasedAt: now, updatedAt: now } : { status: "inconclusive", updatedAt: now })
    .where(and(eq(learningHypotheses.companyId, companyId), inArray(learningHypotheses.cycleId, cycleIds))).returning({ id: learningHypotheses.id });
  await tx.update(learningCycles).set(erase ? { status: "cancelled", trigger: "", purpose: "erased", outcomeVersions: {}, erasedAt: now, updatedAt: now } : { status: "failed", updatedAt: now })
    .where(and(eq(learningCycles.companyId, companyId), inArray(learningCycles.id, cycleIds)));
  if (!hypotheses.length) return;
  const hypothesisIds = hypotheses.map((row) => row.id);
  const links = await tx.update(learningDomainCandidates).set({ invalidatedAt: now, ...(erase ? { erasedAt: now } : {}) })
    .where(and(eq(learningDomainCandidates.companyId, companyId), inArray(learningDomainCandidates.hypothesisId, hypothesisIds))).returning();
  if (erase) await tx.update(learningEvaluations).set({ cases: [], outcomeVersions: {}, metrics: {}, limitations: [], reviewedBy: "erased", erasedAt: now }).where(and(eq(learningEvaluations.companyId, companyId), inArray(learningEvaluations.hypothesisId, hypothesisIds)));
  const ids = (domain: string) => links.filter((link) => link.targetDomain === domain).map((link) => link.candidateId);
  if (ids("foundation").length) await tx.update(foundationChangeProposals).set({ status: "superseded", updatedAt: now }).where(and(eq(foundationChangeProposals.companyId, companyId), inArray(foundationChangeProposals.id, ids("foundation")), eq(foundationChangeProposals.status, "pending")));
  if (ids("playbook").length) await tx.update(playbookChangeProposals).set({ status: "stale", updatedAt: now }).where(and(eq(playbookChangeProposals.companyId, companyId), inArray(playbookChangeProposals.id, ids("playbook")), eq(playbookChangeProposals.status, "pending")));
  if (ids("project").length) await tx.update(projectRoadmapProposals).set({ status: "stale", updatedAt: now }).where(and(eq(projectRoadmapProposals.companyId, companyId), inArray(projectRoadmapProposals.id, ids("project")), eq(projectRoadmapProposals.status, "pending")));
  if (erase && ids("foundation").length) await tx.update(foundationChangeProposals).set({ proposedBody: "", reason: null, changeSummary: null }).where(and(eq(foundationChangeProposals.companyId, companyId), inArray(foundationChangeProposals.id, ids("foundation"))));
  if (erase && ids("playbook").length) await tx.update(playbookChangeProposals).set({ title: "Erased learning proposal", markdown: "", reason: "Erased", reviewRationale: null }).where(and(eq(playbookChangeProposals.companyId, companyId), inArray(playbookChangeProposals.id, ids("playbook"))));
  if (ids("policy").length) await tx.update(policyChangeProposals).set(erase ? { proposal: null, reason: "", reviewRationale: null, erasedAt: now, updatedAt: now } : { status: "stale", updatedAt: now }).where(and(eq(policyChangeProposals.companyId, companyId), inArray(policyChangeProposals.id, ids("policy"))));
  if (erase && ids("project").length) {
    const rows = await tx.select().from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), inArray(projectRoadmapProposals.id, ids("project"))));
    for (const row of rows) await tx.update(projectRoadmapProposals).set({ reason: "Erased learning evidence", reviewRationale: null, patch: { ...row.patch, reason: "Erased learning evidence", evidence: [] }, updatedAt: now }).where(eq(projectRoadmapProposals.id, row.id));
  }
  if (!links.length) return;
  const assets = await tx.select().from(learningRetainedAssets).where(and(eq(learningRetainedAssets.companyId, companyId), inArray(learningRetainedAssets.candidateLinkId, links.map((link) => link.id))));
  const workflowRevisionIds = assets.filter(asset => asset.assetType === "workflow_revision").map(asset => asset.assetId);
  if (workflowRevisionIds.length) {
    const revisions = await tx.select().from(workflowRevisions).where(and(eq(workflowRevisions.companyId, companyId), inArray(workflowRevisions.id, workflowRevisionIds)));
    const workflowIds = [...new Set(revisions.map(revision => revision.workflowId))];
    for (const id of workflowIds) {
      const [workflow] = await tx.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, id))).for("update");
      if (workflow) await tx.update(workflows).set({ ...(workflow.status === "archived" ? {} : { status: "paused" }),
        ...(workflow.draftRevisionId && workflowRevisionIds.includes(workflow.draftRevisionId) ? { draftRevisionId: null } : {}),
        ...(workflow.publishedRevisionId && workflowRevisionIds.includes(workflow.publishedRevisionId) ? { publishedRevisionId: null } : {}), updatedAt: now }).where(eq(workflows.id, id));
    }
    for (const revision of revisions) await tx.update(workflowRevisions).set({ state: ["published", "superseded"].includes(revision.state) ? "superseded" : "discarded", ...(erase ? { graph: { version: 1, nodes: [], edges: [], variables: [], settings: {} }, inputSchema: null, outputSchema: null, changeSummary: null } : {}) }).where(eq(workflowRevisions.id, revision.id));
    const runs = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), inArray(workflowRuns.workflowRevisionId, workflowRevisionIds)));
    for (const run of runs) await tx.update(workflowRuns).set({ ...(erase ? { triggerPayload: {}, failureMessage: null } : {}),
      ...(!["succeeded", "failed", "cancelled"].includes(run.status) ? { status: "cancelled", finishedAt: now, executionOwnerId: null, leaseExpiresAt: null, failureCode: "learning_source_changed" } : {}), updatedAt: now }).where(eq(workflowRuns.id, run.id));
  }
  const packVersionIds = assets.filter(asset => asset.assetType === "role_pack_version").map(asset => asset.assetId);
  if (packVersionIds.length) {
    // Assignments remain in place and fail closed until a human supplies a reviewed replacement.
    await tx.update(rolePacks).set({ publishedVersionId: null, updatedAt: now }).where(and(eq(rolePacks.companyId, companyId), inArray(rolePacks.publishedVersionId, packVersionIds)));
    if (erase) {
      await tx.update(rolePackVersions).set({ summary: "" }).where(and(eq(rolePackVersions.companyId, companyId), inArray(rolePackVersions.id, packVersionIds)));
      await tx.delete(rolePackItems).where(and(eq(rolePackItems.companyId, companyId), inArray(rolePackItems.versionId, packVersionIds)));
    }
  }
  const versionIds = [...new Set([...ids("skill"), ...assets.filter((asset) => asset.assetType === "skill_version").map((asset) => asset.assetId)])];
  if (versionIds.length) {
    if (erase) await tx.update(companySkillVersions).set({ fileInventory: [], label: null, validationSummary: { erased: true }, state: "rejected" }).where(and(eq(companySkillVersions.companyId, companyId), inArray(companySkillVersions.id, versionIds)));
    const skills = await tx.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), inArray(companySkills.activeVersionId, versionIds)));
    for (const row of skills) await tx.update(companySkills).set(erase ? { lifecycleState: "degraded", activeVersionId: null, currentVersionId: null, markdown: "", fileInventory: [], description: null, publicShareToken: null, degradedReason: "Learning evidence erased", updatedAt: now }
      : { lifecycleState: "needs_revalidation", degradedReason: "Learning evidence changed", updatedAt: now }).where(eq(companySkills.id, row.id));
  }
  if (erase) await tx.update(learningRetainedAssets).set({ erasedAt: now }).where(and(eq(learningRetainedAssets.companyId, companyId), inArray(learningRetainedAssets.candidateLinkId, links.map((link) => link.id))));
  const revisionIds = assets.filter((asset) => asset.assetType === "document_revision").map((asset) => asset.assetId);
  if (revisionIds.length) {
    if (erase) {
      await tx.update(documentRevisions).set({ body: "", title: "Erased learning evidence", changeSummary: null }).where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.id, revisionIds)));
      await tx.delete(foundationSections).where(and(eq(foundationSections.companyId, companyId), inArray(foundationSections.documentRevisionId, revisionIds)));
      await tx.update(documents).set({ latestBody: "", title: "Erased learning evidence", updatedAt: now }).where(and(eq(documents.companyId, companyId), inArray(documents.latestRevisionId, revisionIds)));
      await tx.update(learningRetainedAssets).set({ erasedAt: now }).where(and(eq(learningRetainedAssets.companyId, companyId), inArray(learningRetainedAssets.candidateLinkId, links.map((link) => link.id))));
    }
    await tx.update(foundationDocuments).set({ status: "in_review", approvedRevisionId: null, updatedAt: now }).where(and(eq(foundationDocuments.companyId, companyId), inArray(foundationDocuments.approvedRevisionId, revisionIds)));
    await tx.update(playbookDocuments).set({ status: "in_review", approvedRevisionId: null, updatedAt: now }).where(and(eq(playbookDocuments.companyId, companyId), inArray(playbookDocuments.approvedRevisionId, revisionIds)));
  }
}
