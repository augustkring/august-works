import { and, eq, or } from "drizzle-orm";
import { companies, companyRelationships, companySkills, playbookDocuments, portfolioCapabilityPublications, type Db } from "@paperclipai/db";
import { conflict, notFound } from "../errors.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";

export async function portfolioCompaniesRelated(db: Db, companyId: string, sourceCompanyId: string) {
  const [row] = await db.select({ id: companyRelationships.id }).from(companyRelationships).where(and(eq(companyRelationships.status, "active"), or(and(eq(companyRelationships.sourceCompanyId, sourceCompanyId), eq(companyRelationships.targetCompanyId, companyId)), and(eq(companyRelationships.sourceCompanyId, companyId), eq(companyRelationships.targetCompanyId, sourceCompanyId))))).limit(1);
  return Boolean(row);
}

// This grants access only to an explicit frozen publication, never to the
// source company's live documents, runtime, membership, or permissions.
export async function availablePortfolioPublication(db: Db, companyId: string, publicationId: string) {
  const [row] = await db.select().from(portfolioCapabilityPublications).where(and(eq(portfolioCapabilityPublications.id, publicationId), eq(portfolioCapabilityPublications.status, "published"))).limit(1);
  if (!row || row.companyId === companyId || !row.recipientCompanyIds.includes(companyId) || !(await portfolioCompaniesRelated(db, companyId, row.companyId))) throw notFound("Portfolio publication is not available to this company");
  const [source] = await db.select({ status: companies.status }).from(companies).where(eq(companies.id, row.companyId)).limit(1);
  if (source?.status !== "active" || row.hash !== hashContextPolicySnapshot(row.snapshot)) throw conflict("Publication provenance is unavailable");
  if (row.assetType === "skill") {
    const [skill] = await db.select().from(companySkills).where(and(eq(companySkills.companyId, row.companyId), eq(companySkills.id, row.assetId))).limit(1);
    if (!skill || ["revoked", "deprecated", "degraded"].includes(skill.lifecycleState) || skill.nextReviewAt && skill.nextReviewAt <= new Date()) throw conflict("The source procedure requires review or was withdrawn from use");
  } else {
    const [playbook] = await db.select().from(playbookDocuments).where(and(eq(playbookDocuments.companyId, row.companyId), eq(playbookDocuments.id, row.assetId))).limit(1);
    if (!playbook || ["archived", "superseded"].includes(playbook.status) || !["public", "internal"].includes(playbook.sensitivity) || playbook.nextReviewAt && playbook.nextReviewAt <= new Date()) throw conflict("The source Playbook requires review or was withdrawn from use");
  }
  return row;
}
