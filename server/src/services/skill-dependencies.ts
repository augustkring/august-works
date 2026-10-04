import { and, eq } from "drizzle-orm";
import { agentProviderBindings, agentPresenceRuntimeBindings, automationArtifacts, companySkills, companySkillPolicies, foundationDocuments, playbookDocuments, toolCatalogEntries, toolConnections, workflows, type Db } from "@paperclipai/db";
import type { skillDependencyInputSchema } from "@paperclipai/shared";
import type { z } from "zod";

/** Current, company-scoped records are the authority; cached "current" flags are not. */
export async function currentSkillDependencyVersion(db: Db, companyId: string, type: string, ref: string): Promise<string | null> {
  if (type === "policy_revision") {
    if (ref !== "company_skill_policy") return null;
    const [row] = await db.select().from(companySkillPolicies).where(eq(companySkillPolicies.companyId, companyId)).limit(1);
    return row ? String(row.revision) : null;
  }
  // References to canonical records are UUIDs. Reject arbitrary strings before
  // they reach PostgreSQL's UUID casts, and do not resolve another company's id.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) return null;
  if (type === "playbook_revision") {
    const [row] = await db.select().from(playbookDocuments).where(and(eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.id, ref))).limit(1);
    return row && ["approved", "in_review"].includes(row.status) && (!row.nextReviewAt || row.nextReviewAt > new Date()) ? row.approvedRevisionId : null;
  }
  if (type === "foundation_revision") {
    const [row] = await db.select().from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, ref))).limit(1);
    return row && ["approved", "in_review"].includes(row.status) && (!row.validUntil || row.validUntil > new Date()) && (!row.validFrom || row.validFrom <= new Date()) ? row.approvedRevisionId : null;
  }
  if (type === "tool_schema") {
    const [row] = await db.select({ tool: toolCatalogEntries, connection: toolConnections }).from(toolCatalogEntries).innerJoin(toolConnections, and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, toolCatalogEntries.connectionId))).where(and(eq(toolCatalogEntries.companyId, companyId), eq(toolCatalogEntries.id, ref))).limit(1);
    return row && row.tool.status === "active" && row.connection.enabled && !["disabled", "archived"].includes(row.connection.status) ? row.tool.schemaHash : null;
  }
  if (type === "provider_capability") {
    const [row] = await db.select({ provider: agentProviderBindings }).from(agentProviderBindings).innerJoin(agentPresenceRuntimeBindings, and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.providerBindingId, agentProviderBindings.id))).where(eq(agentProviderBindings.id, ref)).limit(1);
    return row && row.provider.status === "active" ? row.provider.capabilitySnapshotHash : null;
  }
  if (type === "workflow_revision") {
    const [row] = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, ref))).limit(1);
    return row?.status === "active" ? row.publishedRevisionId : null;
  }
  if (type === "automation_artifact_version") {
    const [row] = await db.select().from(automationArtifacts).where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, ref))).limit(1);
    return row?.status === "active" ? row.latestVersionId : null;
  }
  if (type === "external_source_commit") {
    const [row] = await db.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, ref))).limit(1);
    // The importer records the resolved commit, never a mutable branch/tag.
    return row && ["git", "github"].includes(row.sourceType) && row.sourceRef && /^[0-9a-f]{40}$/i.test(row.sourceRef) ? row.sourceRef : null;
  }
  return null;
}
export async function skillDependencyStates(db: Db, companyId: string, dependencies: readonly z.infer<typeof skillDependencyInputSchema>[]) {
  const states = [];
  for (const dep of dependencies) {
    const current = await currentSkillDependencyVersion(db, companyId, dep.dependencyType, dep.dependencyRef);
    states.push({ ...dep, status: current === null ? "missing" as const : current === dep.dependencyVersion ? "current" as const : "changed" as const });
  }
  return states;
}
