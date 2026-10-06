import { and, desc, eq } from "drizzle-orm";
import { companyAgentPackageInstallations, agentPackageUpdateProposals, companySkills, foundationDocuments, playbookDocuments, learningRetainedAssets, projectRoadmapProposals, projects, issues, readinessRequirements, policyChangeProposals, workflows, rolePacks, workflowOptimizerEvaluations, type learningDomainCandidates, type Db } from "@paperclipai/db";
import { roadmapPolicySchema } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
type Link = typeof learningDomainCandidates.$inferSelect;
/** Observe the native owner's current acceptance; Learning cannot certify its own promotion. */
export async function learningPromotionReceipt(db: Db, link: Link) {
  const companyId = link.companyId, id = link.targetId;
  if (link.invalidatedAt || link.erasedAt) return null;
  if (link.targetDomain === "foundation" || link.targetDomain === "playbook") {
    const table = link.targetDomain === "foundation" ? foundationDocuments : playbookDocuments;
    const [target] = await db.select({ revision: table.approvedRevisionId, status: table.status }).from(table).where(and(eq(table.companyId, companyId), eq(table.id, id)));
    if (target?.status !== "approved" || !target.revision) return null;
    const [asset] = await db.select().from(learningRetainedAssets).where(and(eq(learningRetainedAssets.companyId, companyId), eq(learningRetainedAssets.candidateLinkId, link.id), eq(learningRetainedAssets.assetType, "document_revision"), eq(learningRetainedAssets.assetId, target.revision)));
    return asset && !asset.erasedAt ? { domain: link.targetDomain, targetId: id, versionId: target.revision } : null;
  }
  if(link.targetDomain==="agent_package"){
    const[p]=await db.select().from(agentPackageUpdateProposals).where(and(eq(agentPackageUpdateProposals.companyId,companyId),eq(agentPackageUpdateProposals.id,link.candidateId)));
    const[i]=await db.select().from(companyAgentPackageInstallations).where(and(eq(companyAgentPackageInstallations.companyId,companyId),eq(companyAgentPackageInstallations.id,id)));
    return p?.status==="accepted"&&!p.erasedAt&&i&&i.version===p.acceptedInstallationVersion&&i.installedVersionId===p.proposal?.versionId?{domain:"agent_package",targetId:id,versionId:i.installedVersionId}:null;
  }
  if (link.targetDomain === "skill") {
    const [target] = await db.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, id)));
    return target?.activeVersionId === link.candidateId && target.lifecycleState === "active" ? { domain: "skill", targetId: id, versionId: link.candidateId } : null;
  }
  if (link.targetDomain === "workflow") {
    const [target] = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, id)));
    return target?.publishedRevisionId === link.candidateId && target.status === "active" ? { domain: "workflow", targetId: id, versionId: link.candidateId } : null;
  }
  if (link.targetDomain === "role_pack") {
    const [target] = await db.select().from(rolePacks).where(and(eq(rolePacks.companyId, companyId), eq(rolePacks.id, id)));
    return target?.publishedVersionId === link.candidateId && target.status === "active" ? { domain: "role_pack", targetId: id, versionId: link.candidateId } : null;
  }
  if (link.targetDomain === "automation_artifact") {
    const [target] = await db.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, link.candidateId)));
    return target?.status === "active" ? { domain: "automation_artifact", targetId: target.artifactId, versionId: target.artifactVersionId } : null;
  }
  if (link.targetDomain === "project") {
    const [proposal] = await db.select().from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.id, link.candidateId)));
    if (proposal?.status !== "accepted") return null;
    for (const change of proposal.patch.changes) {
      const [task] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.projectId, id), eq(issues.id, change.issueId)));
      if (!task) return null;
      for (const [key, value] of Object.entries(change.patch)) { const current = task[key as keyof typeof task]; if ((current instanceof Date ? current.toISOString() : current) !== value) return null; }
    }
    return { domain: "project", targetId: id, versionId: link.candidateId };
  }
  const [proposal] = await db.select().from(policyChangeProposals).where(and(eq(policyChangeProposals.companyId, companyId), eq(policyChangeProposals.id, link.candidateId)));
  if (proposal?.status !== "accepted" || !proposal.proposal) return null;
  if (proposal.proposal.policyType === "project_roadmap") {
    const [target] = await db.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, id)));
    if (!target || nativeSha256(roadmapPolicySchema.parse(target.roadmapPolicy ?? {})) !== nativeSha256(proposal.proposal.policy)) return null;
  } else {
    const requested = proposal.proposal.requirement;
    const [target] = await db.select().from(readinessRequirements).where(and(eq(readinessRequirements.companyId, companyId), eq(readinessRequirements.requirementKey, requested.requirementKey))).orderBy(desc(readinessRequirements.version)).limit(1);
    if (!target || target.version !== requested.expectedVersion + 1 || target.name !== requested.name || target.actionClass !== requested.actionClass || nativeSha256(target.criteria) !== nativeSha256(requested.criteria)) return null;
  }
  return { domain: "policy", targetId: id, versionId: link.candidateId };
}
