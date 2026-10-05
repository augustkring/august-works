import { assertSaasDomainAdmission } from "./saas/domain-admission.js";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { companySkills, companySkillVersions, companySkillDependencies, playbookDocuments, foundationDocuments, portfolioCapabilityPublications, portfolioCapabilitySubscriptions, type Db } from "@paperclipai/db";
import { createGovernedSkillSchema, createPlaybookSchema, installPortfolioCapabilitySchema, publishPortfolioCapabilitySchema, skillCandidateInputSchema, type PortfolioCapabilitySnapshot } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { skillLifecycleService } from "./skill-lifecycle.js";
import { skillResolverService } from "./skill-resolver.js";
import { playbookService } from "./playbooks.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { logActivity } from "./activity-log.js";
import { availablePortfolioPublication, portfolioCompaniesRelated } from "./portfolio-source.js";

export function portfolioCapabilityService(db: Db) {
  async function authorize(actor: AuthorizationActor, companyId: string, mutate = false) {
    await assertV5Enabled(db, "portfolio_skill_sharing_v5"); await assertV5Authorization(db, actor, companyId, "company_scope:read");
    if (mutate) { v5HumanActorId(actor); await assertV5Authorization(db, actor, companyId, "users:manage_permissions"); await assertSaasDomainAdmission(db,companyId,"portfolio.use"); }
  }
  async function publication(actor: AuthorizationActor, companyId: string, publicationId: string) {
    await authorize(actor, companyId);
    const row = await availablePortfolioPublication(db, companyId, publicationId);
    return row;
  }
  return {
    publish: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof publishPortfolioCapabilitySchema>) => {
      await authorize(actor, companyId, true); const input = publishPortfolioCapabilitySchema.parse(raw);
      for (const recipient of input.recipientCompanyIds) if (recipient === companyId || !(await portfolioCompaniesRelated(db, recipient, companyId))) throw forbidden("Every recipient must have an accepted relationship; the publication grants access only to its frozen snapshot");
      let snapshot: PortfolioCapabilitySnapshot;
      if (input.assetType === "skill") {
        const { skill, version } = await skillResolverService(db).authorizedVersion(actor, companyId, input.assetId, input.versionId);
        if (skill.sharingScope !== "company" || ["confidential", "restricted"].includes(String(skill.metadata?.sensitivity ?? ""))) throw forbidden("Only a company-shared, non-sensitive active Skill may be published");
        if (input.classification === "public" && skill.metadata?.sensitivity !== "public") throw forbidden("An internal procedure cannot be reclassified as public by publishing it");
        const dependencies = await db.select().from(companySkillDependencies).where(and(eq(companySkillDependencies.companyId, companyId), eq(companySkillDependencies.skillVersionId, version.id)));
        for (const dependency of dependencies) {
          if (dependency.dependencyType !== "playbook_revision" && dependency.dependencyType !== "foundation_revision") continue;
          const [document] = dependency.dependencyType === "playbook_revision"
            ? await db.select({ sensitivity: playbookDocuments.sensitivity }).from(playbookDocuments).where(and(eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.id, dependency.dependencyRef))).limit(1)
            : await db.select({ sensitivity: foundationDocuments.sensitivity }).from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, dependency.dependencyRef))).limit(1);
          if (!document || !["public", "internal"].includes(document.sensitivity)) throw forbidden("A procedure with sensitive or unavailable canonical dependencies cannot be published");
        }
        const markdown = version.fileInventory.find((f) => f.path === "SKILL.md")?.content; if (!markdown) throw conflict("Active Skill body is unavailable");
        if (version.fileInventory.length > 500 || version.fileInventory.some((f) => !f.path || f.path.startsWith("/") || f.path.includes("\\") || f.path.split("/").some((part) => part === "." || part === "..")) || Buffer.byteLength(JSON.stringify(version.fileInventory), "utf8") > 2_000_000) throw unprocessable("Skill files exceed publication limits or contain invalid paths");
        const terms = (key: string) => Array.isArray(skill.metadata?.[key]) ? (skill.metadata![key] as unknown[]).filter((value): value is string => typeof value === "string" && value.length <= 100).slice(0, 32) : [];
        snapshot = { title: skill.name, key: skill.slug, markdown, sourceCompanyId: companyId, sourceAssetId: skill.id, sourceVersionId: version.id, files: version.fileInventory, triggerTerms: terms("triggerTerms"), excludeTerms: terms("excludeTerms") };
      } else {
        const playbook = await playbookService(db).get(actor, companyId, input.assetId);
        if (playbook.status !== "approved" || playbook.overdue || playbook.approvedRevisionId !== input.versionId || !["public", "internal"].includes(playbook.sensitivity)) throw forbidden("Only the current non-sensitive reviewed Playbook revision may be published");
        if (input.classification === "public" && playbook.sensitivity !== "public") throw forbidden("An internal Playbook cannot be reclassified as public by publishing it");
        const revision = await playbookService(db).getRevision(actor, companyId, input.assetId, input.versionId);
        snapshot = { title: revision.title ?? playbook.key, key: playbook.key, markdown: revision.body, sourceCompanyId: companyId, sourceAssetId: playbook.id, sourceVersionId: revision.id, files: [] };
      }
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const [row] = await tx.insert(portfolioCapabilityPublications).values({ ...input, companyId, snapshot, hash: hashContextPolicySnapshot(snapshot), publishedByUserId: v5HumanActorId(actor) }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "portfolio.capability_published", entityType: "portfolio_publication", entityId: row!.id, details: { assetType: input.assetType, sourceVersionId: input.versionId, recipientCompanyIds: input.recipientCompanyIds } }, publications); return row!;
      });
    },
    withdraw: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await authorize(actor, companyId, true);
      return withV5ActivityTransaction(db, async (tx, publications) => { const [row] = await tx.update(portfolioCapabilityPublications).set({ status: "withdrawn" }).where(and(eq(portfolioCapabilityPublications.companyId, companyId), eq(portfolioCapabilityPublications.id, id))).returning(); if (!row) throw notFound("Publication not found"); await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "portfolio.publication_withdrawn", entityType: "portfolio_publication", entityId: id }, publications); return row; });
    },
    discover: async (actor: AuthorizationActor, companyId: string) => {
      await authorize(actor, companyId);
      const rows = await db.select().from(portfolioCapabilityPublications).where(and(eq(portfolioCapabilityPublications.status, "published"), sql`${companyId}::uuid = any(${portfolioCapabilityPublications.recipientCompanyIds})`)).orderBy(desc(portfolioCapabilityPublications.createdAt)).limit(501);
      if (rows.length > 500) throw conflict("Portfolio catalog exceeds 500 releases");
      const visible = [];
      for (const row of rows) { try { await publication(actor, companyId, row.id); visible.push({ id: row.id, companyId: row.companyId, assetType: row.assetType, assetId: row.assetId, versionId: row.versionId, title: row.snapshot.title, key: row.snapshot.key, classification: row.classification, hash: row.hash, releaseNotes: row.releaseNotes, createdAt: row.createdAt }); } catch (error) { if (!(error instanceof Error && "status" in error && [404, 409].includes(Number(error.status)))) throw error; } }
      return visible;
    },
    ownPublications: async (actor: AuthorizationActor, companyId: string) => { await authorize(actor, companyId, true); return db.select().from(portfolioCapabilityPublications).where(eq(portfolioCapabilityPublications.companyId, companyId)).orderBy(desc(portfolioCapabilityPublications.createdAt)).limit(500); },
    get: publication,
    install: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof installPortfolioCapabilitySchema>) => {
      await authorize(actor, companyId, true); const input = installPortfolioCapabilitySchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
      await tx.select({ id: portfolioCapabilityPublications.id }).from(portfolioCapabilityPublications).where(eq(portfolioCapabilityPublications.id, input.publicationId)).limit(1).for("update");
      const source = await portfolioCapabilityService(tx).get(actor, companyId, input.publicationId);
      let localSkillId: string | null = null, localPlaybookId: string | null = null;
      if (source.assetType === "skill") {
        const local = await skillLifecycleService(tx).createDraft(actor, companyId, createGovernedSkillSchema.parse({ slug: input.localKey, name: source.snapshot.title, description: `Adopted from ${source.companyId}; source version ${source.versionId}`, markdown: source.snapshot.markdown, triggerTerms: source.snapshot.triggerTerms ?? [], excludeTerms: source.snapshot.excludeTerms ?? [], sharing: "company_proposed" }), { files: source.snapshot.files, publication: { id: source.id, companyId: source.companyId, versionId: source.versionId, hash: source.hash } }, publications); localSkillId = local.skillId;
      } else {
        const local = await playbookService(tx).create(actor, companyId, createPlaybookSchema.parse({ key: input.localKey, title: source.snapshot.title, markdown: source.snapshot.markdown, category: "portfolio_adoption", sensitivity: source.classification }), publications); localPlaybookId = local.id;
      }
        const [subscription] = await tx.insert(portfolioCapabilitySubscriptions).values({ companyId, publicationId: source.id, sourceCompanyId: source.companyId, sourceAssetId: source.assetId, pinnedSourceVersionId: source.versionId, assetType: source.assetType, localSkillId, localPlaybookId, mode: input.mode, createdByUserId: v5HumanActorId(actor) }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "portfolio.capability_adopted_as_candidate", entityType: "portfolio_subscription", entityId: subscription!.id, details: { sourceCompanyId: source.companyId, publicationId: source.id, sourceVersionId: source.versionId, localSkillId, localPlaybookId, mode: input.mode } }, publications); return subscription!;
      });
    },
    subscriptions: async (actor: AuthorizationActor, companyId: string) => {
      await authorize(actor, companyId);
      const rows = await db.select().from(portfolioCapabilitySubscriptions).where(eq(portfolioCapabilitySubscriptions.companyId, companyId)).orderBy(desc(portfolioCapabilitySubscriptions.createdAt)).limit(500);
      const releases = await db.select().from(portfolioCapabilityPublications).where(and(eq(portfolioCapabilityPublications.status, "published"), sql`${companyId}::uuid = any(${portfolioCapabilityPublications.recipientCompanyIds})`)).orderBy(desc(portfolioCapabilityPublications.createdAt)).limit(500);
      const result = [];
      for (const row of rows) {
        let available = null;
        const next = releases.find((r) => r.companyId === row.sourceCompanyId && r.assetType === row.assetType && r.assetId === row.sourceAssetId);
        try { available = await publication(actor, companyId, next?.id ?? row.publicationId); } catch (error) { if (!(error instanceof Error && "status" in error && [404, 409].includes(Number(error.status)))) throw error; }
        result.push({ ...row, sourceAvailable: Boolean(available), updateAvailable: row.mode === "subscribe" && Boolean(available && available.versionId !== row.pinnedSourceVersionId), availablePublicationId: row.mode === "subscribe" && available?.versionId !== row.pinnedSourceVersionId ? available?.id ?? null : null });
      }
      return result;
    },
    prepareUpgrade: async (actor: AuthorizationActor, companyId: string, subscriptionId: string, publicationId: string, expectedActiveVersionId: string | null, expectedRevisionId?: string) => {
      await authorize(actor, companyId, true);
      const [local] = await db.select().from(portfolioCapabilitySubscriptions).where(and(eq(portfolioCapabilitySubscriptions.companyId, companyId), eq(portfolioCapabilitySubscriptions.id, subscriptionId))).limit(1);
      if (!local || local.mode !== "subscribe") throw conflict("Only a subscription may prepare an upgrade; forks remain independent");
      const next = await publication(actor, companyId, publicationId);
      if (next.companyId !== local.sourceCompanyId || next.assetId !== local.sourceAssetId || next.assetType !== local.assetType) throw forbidden("Upgrade must belong to the subscribed source asset");
      if (local.assetType === "playbook") {
        if (!local.localPlaybookId || !expectedRevisionId) throw conflict("Playbook upgrade requires the current local draft revision");
        return withV5ActivityTransaction(db, async (tx, publications) => {
          const draft = await playbookService(tx).draft(actor, companyId, local.localPlaybookId!, { expectedRevisionId, title: next.snapshot.title, markdown: next.snapshot.markdown, changeSummary: `Portfolio release ${next.id}: ${next.releaseNotes}` }, publications);
          await tx.update(portfolioCapabilitySubscriptions).set({ publicationId: next.id, pinnedSourceVersionId: next.versionId }).where(eq(portfolioCapabilitySubscriptions.id, local.id));
          await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "portfolio.playbook_upgrade_drafted", entityType: "portfolio_subscription", entityId: local.id, details: { revisionId: draft.id, sourceVersionId: next.versionId } }, publications);
          return draft;
        });
      }
      if (!local.localSkillId) throw conflict("Subscribed Skill is unavailable");
      return skillLifecycleService(db).propose(actor, companyId, local.localSkillId, skillCandidateInputSchema.parse({ baseActiveVersionId: expectedActiveVersionId, markdown: next.snapshot.markdown, summary: next.releaseNotes, sharing: "company_proposed" }), { files: next.snapshot.files, publication: { id: next.id, companyId: next.companyId, versionId: next.versionId, hash: next.hash } });
    },
  };
}
