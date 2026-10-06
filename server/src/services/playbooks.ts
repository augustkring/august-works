import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { companySkillService } from "./company-skills.js";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { agents, companyMemberships, documents, documentRevisions, playbookDocuments, playbookChangeProposals, playbookSkillLinks, companySkills, companySkillVersions, type Db } from "@paperclipai/db";
import { createPlaybookSchema, playbookDraftSchema, updatePlaybookMetadataSchema, proposePlaybookSchema, reviewPlaybookSchema, linkPlaybookSkillSchema, projectPlaybookSkillSchema, skillCandidateInputSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import { skillLifecycleService } from "./skill-lifecycle.js";

export function playbookService(db: Db) {
  async function authorize(actor: AuthorizationActor, companyId: string, action: "foundation:read" | "foundation:edit" | "foundation:approve" | "foundation:propose" = "foundation:read") {
    await assertV5Enabled(db, "playbooks_v5"); await assertV5Authorization(db, actor, companyId, action);
    if (["foundation:edit", "foundation:approve"].includes(action)) v5HumanActorId(actor);
  }
  async function get(tx: Db, actor: AuthorizationActor, companyId: string, id: string, lock = false) {
    await authorize(actor, companyId);
    const query = tx.select().from(playbookDocuments).where(and(eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.id, id))).limit(1);
    const [row] = await (lock ? query.for("update") : query); if (!row) throw notFound("Playbook not found");
    if (["confidential", "restricted"].includes(row.sensitivity)) await assertV5Authorization(tx, actor, companyId, "users:manage_permissions");
    const [document] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, row.documentId))).limit(1);
    if (!document || !document.latestRevisionId) throw conflict("Playbook revision is unavailable");
    return { ...row, document, overdue: Boolean(row.nextReviewAt && row.nextReviewAt <= new Date()) };
  }
  async function revision(tx: Db, companyId: string, documentId: string, revisionId: string) {
    const [row] = await tx.select().from(documentRevisions).where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.documentId, documentId), eq(documentRevisions.id, revisionId))).limit(1);
    if (!row) throw notFound("Playbook revision not found"); return row;
  }
  async function appendRevision(tx: Db, row: Awaited<ReturnType<typeof get>>, userId: string, title: string, body: string, changeSummary: string) {
    const [next] = await tx.insert(documentRevisions).values({ companyId: row.companyId, documentId: row.documentId, revisionNumber: row.document.latestRevisionNumber + 1, title, body, changeSummary, createdByUserId: userId }).returning();
    await tx.update(documents).set({ title, latestBody: body, latestRevisionId: next!.id, latestRevisionNumber: next!.revisionNumber, updatedByUserId: userId, updatedAt: new Date() }).where(eq(documents.id, row.documentId));
    return next!;
  }
  return {
    list: async (actor: AuthorizationActor, companyId: string) => {
      await authorize(actor, companyId);
      const rows = await db.select({ playbook: playbookDocuments, title: documents.title, latestRevisionId: documents.latestRevisionId }).from(playbookDocuments).innerJoin(documents, eq(documents.id, playbookDocuments.documentId)).where(eq(playbookDocuments.companyId, companyId)).orderBy(asc(playbookDocuments.key)).limit(501);
      if (rows.length > 500) throw conflict("Playbook catalog exceeds 500 documents");
      const visible = [];
      for (const row of rows) { try { await get(db, actor, companyId, row.playbook.id); visible.push({ ...row.playbook, title: row.title, latestRevisionId: row.latestRevisionId, overdue: Boolean(row.playbook.nextReviewAt && row.playbook.nextReviewAt <= new Date()) }); } catch (error) { if (!(error instanceof Error && "status" in error && error.status === 403)) throw error; } }
      return visible;
    },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      const row = await get(db, actor, companyId, id);
      const revisions = await db.select({ id: documentRevisions.id, revisionNumber: documentRevisions.revisionNumber, changeSummary: documentRevisions.changeSummary, createdAt: documentRevisions.createdAt }).from(documentRevisions).where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.documentId, row.documentId))).orderBy(desc(documentRevisions.revisionNumber)).limit(100);
      const proposals = await db.select().from(playbookChangeProposals).where(and(eq(playbookChangeProposals.companyId, companyId), eq(playbookChangeProposals.playbookId, id))).orderBy(desc(playbookChangeProposals.createdAt)).limit(100);
      const allLinks = await db.select().from(playbookSkillLinks).where(and(eq(playbookSkillLinks.companyId, companyId), eq(playbookSkillLinks.playbookId, id))).limit(100), links = [];
      for (const link of allLinks) if (await companySkillService(db).canReadSkill(companyId, link.skillId, actor) && await companySkillService(db).getVersion(companyId, link.skillId, link.skillVersionId, actor)) links.push(link);
      return { ...row, revisions, proposals, links: links.map((link) => ({ ...link, drifted: link.playbookRevisionId !== row.approvedRevisionId })) };
    },
    getRevision: async (actor: AuthorizationActor, companyId: string, id: string, revisionId: string) => { const row = await get(db, actor, companyId, id); return revision(db, companyId, row.documentId, revisionId); },
    create: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof createPlaybookSchema>, parentPublications?: ActivityPublication[]) => {
      await authorize(actor, companyId, "foundation:edit"); const input = createPlaybookSchema.parse(raw), userId = v5HumanActorId(actor);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        if (input.ownerAgentId && !(await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.ownerAgentId), ne(agents.status, "terminated"))).limit(1))[0]) throw unprocessable("Playbook owner must be an active local presence");
        if (input.ownerUserId && !(await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.ownerUserId), eq(companyMemberships.status, "active"))).limit(1))[0]) throw unprocessable("Playbook owner must be an active company member");
        const [document] = await tx.insert(documents).values({ companyId, title: input.title, latestBody: input.markdown, createdByUserId: userId, updatedByUserId: userId }).returning();
        const [first] = await tx.insert(documentRevisions).values({ companyId, documentId: document!.id, revisionNumber: 1, title: input.title, body: input.markdown, changeSummary: "Initial draft", createdByUserId: userId }).returning();
        await tx.update(documents).set({ latestRevisionId: first!.id }).where(eq(documents.id, document!.id));
        const { title: _title, markdown: _markdown, ...metadata } = input;
        const [playbook] = await tx.insert(playbookDocuments).values({ ...metadata, companyId, documentId: document!.id, ownerUserId: input.ownerUserId ?? userId }).onConflictDoNothing().returning();
        if (!playbook) throw conflict("Playbook key already exists");
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "playbook.draft_created", entityType: "playbook", entityId: playbook.id }, publications); return playbook;
      }, parentPublications);
    },
    updateMetadata: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof updatePlaybookMetadataSchema>) => {
      await authorize(actor, companyId, "foundation:edit"); const input = updatePlaybookMetadataSchema.parse(raw), userId = v5HumanActorId(actor);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await get(tx, actor, companyId, id, true);
        if (row.status === "archived" || row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw conflict("Playbook metadata changed or is archived; refresh before saving");
        if (input.ownerAgentId && !(await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.ownerAgentId), ne(agents.status, "terminated"))).limit(1))[0]) throw unprocessable("Playbook owner must be an active local presence");
        if (input.ownerUserId && !(await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.ownerUserId), eq(companyMemberships.status, "active"))).limit(1))[0]) throw unprocessable("Playbook owner must be an active company member");
        const classificationChanged = input.sensitivity !== row.sensitivity;
        if (classificationChanged) await assertV5Authorization(tx, actor, companyId, "users:manage_permissions");
        const { expectedUpdatedAt: _expected, rationale, ...metadata } = input;
        const [updated] = await tx.update(playbookDocuments).set({ ...metadata, ...(classificationChanged ? { status: "in_review", approvedRevisionId: null, lastReviewedAt: null, nextReviewAt: null } : row.lastReviewedAt ? { nextReviewAt: new Date(row.lastReviewedAt.getTime() + input.reviewFrequencyDays * 86_400_000) } : {}), updatedAt: new Date() }).where(eq(playbookDocuments.id, id)).returning();
        if (classificationChanged) {
          await skillLifecycleService(tx).invalidateDependency(companyId, "playbook_revision", id, null, publications);
          const linked = await tx.select({ skillId: playbookSkillLinks.skillId }).from(playbookSkillLinks).where(and(eq(playbookSkillLinks.companyId, companyId), eq(playbookSkillLinks.playbookId, id))).orderBy(asc(playbookSkillLinks.skillId)).limit(501);
          if (linked.length > 500) throw conflict("Review the excessive Playbook link set before changing classification");
          const levels = ["public", "internal", "confidential", "restricted"];
          for (const skillId of new Set(linked.map((item) => item.skillId))) {
            const [skill] = await tx.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, skillId))).limit(1).for("update");
            if (!skill) continue;
            const current = skill.metadata?.sensitivity ?? "internal", rank = levels.indexOf(String(current));
            const sensitivity = levels[Math.max(rank < 0 ? 3 : rank, levels.indexOf(input.sensitivity))]!;
            await tx.update(companySkills).set({ metadata: { ...skill.metadata, sensitivity }, ...(["confidential", "restricted"].includes(sensitivity) ? { publicShareToken: null } : {}), updatedAt: new Date() }).where(eq(companySkills.id, skillId));
          }
        }
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "playbook.metadata_updated", entityType: "playbook", entityId: id, details: { previousSensitivity: row.sensitivity, sensitivity: input.sensitivity, classificationChanged, canonicalReviewRequired: classificationChanged, rationale } }, publications);
        return updated!;
      });
    },
    draft: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof playbookDraftSchema>, parentPublications?: ActivityPublication[]) => {
      await authorize(actor, companyId, "foundation:edit"); const input = playbookDraftSchema.parse(raw), userId = v5HumanActorId(actor);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await get(tx, actor, companyId, id, true);
        if (row.status === "archived" || row.document.latestRevisionId !== input.expectedRevisionId) throw conflict("Playbook draft changed or is archived; refresh before saving");
        const next = await appendRevision(tx, row, userId, input.title, input.markdown, input.changeSummary);
        // The approved pointer remains on the reviewed revision while a draft
        // evolves. Runtime resolution never consumes the unreviewed latest body.
        await tx.update(playbookDocuments).set({ status: "in_review", updatedAt: new Date() }).where(eq(playbookDocuments.id, id));
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "playbook.draft_updated", entityType: "playbook", entityId: id, details: { revisionId: next.id } }, publications); return next;
      }, parentPublications);
    },
    review: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof reviewPlaybookSchema>) => {
      await authorize(actor, companyId, "foundation:approve"); const input = reviewPlaybookSchema.parse(raw), userId = v5HumanActorId(actor);
      const result = await withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await get(tx, actor, companyId, id, true);
        if (row.document.latestRevisionId !== input.expectedRevisionId || row.status === "archived") throw conflict("The Playbook changed; repeat review");
        await revision(tx, companyId, row.documentId, input.expectedRevisionId);
        const status = input.decision === "approve" ? "approved" : input.decision === "archive" ? "archived" : "in_review";
        const [updated] = await tx.update(playbookDocuments).set({ status, ...(input.decision === "approve" ? { approvedRevisionId: input.expectedRevisionId, lastReviewedAt: new Date(), nextReviewAt: new Date(Date.now() + row.reviewFrequencyDays * 86_400_000) } : {}), updatedAt: new Date() }).where(eq(playbookDocuments.id, id)).returning();
        const generatedCandidates: Array<{ skillId: string; versionId: string }> = [], synchronizationFailures: Array<{ skillId: string | null; reason: string }> = [];
        if (input.decision === "approve" && row.approvedRevisionId !== input.expectedRevisionId) {
          const links = await tx.select().from(playbookSkillLinks).where(and(eq(playbookSkillLinks.companyId, companyId), eq(playbookSkillLinks.playbookId, id), eq(playbookSkillLinks.syncPolicy, "auto_generate_candidate"))).orderBy(desc(playbookSkillLinks.createdAt)).limit(101);
          if (links.length > 100) synchronizationFailures.push({ skillId: null, reason: "projection_link_limit" });
          else {
            const canonical = await revision(tx, companyId, row.documentId, input.expectedRevisionId), seen = new Set<string>();
            for (const link of links) {
              if (seen.has(link.skillId)) continue; seen.add(link.skillId);
              const candidatePublications: ActivityPublication[] = [];
              try {
                // Keep the reviewed human procedure valid if compilation fails.
                // A savepoint owns the entire candidate/link/audit, and live
                // publications are copied only after the savepoint commits.
                const candidate = await tx.transaction(async (savepoint) => {
                  const inner = savepoint as unknown as Db;
                  await assertV5Enabled(inner, "playbook_skill_projection_v5");
                  const [skill] = await inner.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, link.skillId))).limit(1);
                  if (!skill) throw notFound("Projected local Skill is unavailable");
                  const proposed = await skillLifecycleService(inner).propose(actor, companyId, skill.id, skillCandidateInputSchema.parse({ baseActiveVersionId: skill.activeVersionId, markdown: `# ${canonical.title ?? row.key}\n\n${canonical.body}`, summary: "Recompile the newly reviewed canonical procedure; evaluation and promotion remain required", sharing: "company_proposed", dependencies: [{ dependencyType: "playbook_revision", dependencyRef: id, dependencyVersion: input.expectedRevisionId, required: true }] }), { sourcePlaybookRevisionId: input.expectedRevisionId, sourceSensitivity: row.sensitivity as z.infer<typeof createPlaybookSchema>["sensitivity"] }, candidatePublications);
                  await inner.insert(playbookSkillLinks).values({ companyId, playbookId: id, playbookRevisionId: input.expectedRevisionId, skillId: skill.id, skillVersionId: proposed.id, relationType: "derived_from", syncPolicy: "auto_generate_candidate" });
                  return proposed;
                });
                publications.push(...candidatePublications);
                generatedCandidates.push({ skillId: link.skillId, versionId: candidate.id });
              } catch {
                synchronizationFailures.push({ skillId: link.skillId, reason: "candidate_generation_failed" });
              }
            }
          }
        }
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: `playbook.${status}`, entityType: "playbook", entityId: id, details: { revisionId: input.expectedRevisionId, rationale: input.rationale, generatedCandidates, synchronizationFailures } }, publications); return { ...updated!, generatedCandidates, synchronizationFailures };
      });
      if (input.decision !== "request_changes") await skillLifecycleService(db).invalidateDependency(companyId, "playbook_revision", id, input.decision === "approve" ? input.expectedRevisionId : null);
      return result;
    },
    propose: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof proposePlaybookSchema>, parentPublications?: ActivityPublication[]) => {
      await authorize(actor, companyId, "foundation:propose"); const input = proposePlaybookSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await get(tx, actor, companyId, id, true);
        if (row.approvedRevisionId !== input.baseApprovedRevisionId || row.status === "archived") throw conflict("The canonical Playbook changed; refresh the proposal");
        if (input.sourceSkillId && !(await companySkillService(tx).canReadSkill(companyId, input.sourceSkillId, actor))) throw notFound("Feedback Skill not found");
        if (input.sourceSkillId && !(await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, input.sourceSkillId), eq(companySkillVersions.id, input.sourceSkillVersionId!))).limit(1))[0]) throw notFound("Local feedback Skill version not found");
        const [proposal] = await tx.insert(playbookChangeProposals).values({ ...input, companyId, playbookId: id, baseDraftRevisionId: row.document.latestRevisionId!, createdByAgentId: actor.type === "agent" ? actor.agentId : null, createdByUserId: actor.type === "board" ? v5HumanActorId(actor) : null }).returning();
        await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.agentId ?? v5HumanActorId(actor), action: "playbook.change_proposed", entityType: "playbook", entityId: id, details: { proposalId: proposal!.id } }, publications); return proposal!;
      }, parentPublications);
    },
    reviewProposal: async (actor: AuthorizationActor, companyId: string, id: string, proposalId: string, accept: boolean, rationale: string) => {
      await authorize(actor, companyId, "foundation:approve"); const userId = v5HumanActorId(actor);
      if (rationale.trim().length < 10 || rationale.length > 4000) throw unprocessable("Review rationale must contain 10–4000 characters");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await get(tx, actor, companyId, id, true), [proposal] = await tx.select().from(playbookChangeProposals).where(and(eq(playbookChangeProposals.companyId, companyId), eq(playbookChangeProposals.playbookId, id), eq(playbookChangeProposals.id, proposalId))).limit(1).for("update");
        if (!proposal || proposal.status !== "pending") throw conflict("A pending Playbook proposal is required");
        const stale = proposal.baseApprovedRevisionId !== row.approvedRevisionId || row.document.latestRevisionId !== proposal.baseDraftRevisionId;
        const status = stale ? "stale" : accept ? "accepted" : "rejected";
        if (status === "accepted") { await appendRevision(tx, row, userId, proposal.title, proposal.markdown, proposal.reason); await tx.update(playbookDocuments).set({ status: "in_review", updatedAt: new Date() }).where(eq(playbookDocuments.id, id)); }
        const [reviewed] = await tx.update(playbookChangeProposals).set({ status, reviewedByUserId: userId, reviewRationale: rationale, updatedAt: new Date() }).where(eq(playbookChangeProposals.id, proposalId)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: `playbook.proposal_${status}`, entityType: "playbook", entityId: id, details: { proposalId } }, publications); return reviewed!;
      });
    },
    linkSkill: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof linkPlaybookSkillSchema>) => {
      await authorize(actor, companyId, "foundation:edit"); const input = linkPlaybookSkillSchema.parse(raw), row = await get(db, actor, companyId, id);
      await revision(db, companyId, row.documentId, input.playbookRevisionId);
      if (!(await companySkillService(db).canReadSkill(companyId, input.skillId, actor))) throw notFound("Linked Skill not found");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const [link] = await tx.insert(playbookSkillLinks).values({ ...input, companyId, playbookId: id }).onConflictDoNothing().returning();
        if (!link) throw conflict("This immutable Playbook/Skill link already exists");
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "playbook.skill_linked", entityType: "playbook", entityId: id, details: { linkId: link.id, skillVersionId: input.skillVersionId } }, publications); return link;
      });
    },
    projectSkill: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof projectPlaybookSkillSchema>) => {
      await assertV5Enabled(db, "playbook_skill_projection_v5"); await authorize(actor, companyId); const input = projectPlaybookSkillSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await get(tx, actor, companyId, id, true);
        if (row.status !== "approved" || row.overdue || row.approvedRevisionId !== input.approvedRevisionId) throw conflict("Projection requires the current reviewed, non-overdue Playbook revision");
        await revision(tx, companyId, row.documentId, input.approvedRevisionId);
        const candidate = await skillLifecycleService(tx).propose(actor, companyId, input.skillId, skillCandidateInputSchema.parse({ baseActiveVersionId: input.baseActiveVersionId, markdown: input.markdown, summary: input.summary, sharing: "company_proposed", dependencies: [{ dependencyType: "playbook_revision", dependencyRef: id, dependencyVersion: input.approvedRevisionId, required: true }] }), { sourcePlaybookRevisionId: input.approvedRevisionId, sourceSensitivity: row.sensitivity as z.infer<typeof createPlaybookSchema>["sensitivity"] }, publications);
        await tx.insert(playbookSkillLinks).values({ companyId, playbookId: id, playbookRevisionId: input.approvedRevisionId, skillId: input.skillId, skillVersionId: candidate.id, relationType: "derived_from", syncPolicy: input.syncPolicy });
        await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.agentId ?? v5HumanActorId(actor), action: "playbook.skill_candidate_projected", entityType: "playbook", entityId: id, details: { candidateVersionId: candidate.id } }, publications);
        return candidate;
      });
    },
  };
}
