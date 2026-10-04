import { availablePortfolioPublication } from "./portfolio-source.js";
import { skillDependencyStates } from "./skill-dependencies.js";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { agents, companyMemberships, companySkillEvalCases, companySkills, companySkillVersions, companySkillDependencies, companySkillEvalSuites, companySkillEvalRuns, companySkillEvalScores, companySkillTestRuns, portfolioCapabilitySubscriptions, type Db } from "@paperclipai/db";
import { createGovernedSkillSchema, skillCandidateInputSchema, skillLifecycleTransitionSchema, skillPromotionInputSchema, skillPromotionPolicySchema, skillReviewPolicySchema, updateSkillGovernanceSchema, type SkillPolicyAction } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { companySkillPolicyService, normalizeSkillPolicySourceType } from "./company-skill-policy.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { companySkillService } from "./company-skills.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";

type SkillProvenance = { sourcePlaybookRevisionId?: string; sourceSensitivity?: "public" | "internal" | "confidential" | "restricted"; files?: typeof companySkillVersions.$inferSelect.fileInventory; publication?: { id: string; companyId: string; versionId: string; hash: string } };
const sensitivities = ["public", "internal", "confidential", "restricted"] as const;
function sensitivityRank(value: unknown) {
  if (value === undefined) return 1;
  const rank = sensitivities.indexOf(value as typeof sensitivities[number]);
  return rank < 0 ? 3 : rank;
}

export function skillLifecycleService(db: Db) {
  async function skill(tx: Db, companyId: string, id: string, lock = false) {
    const query = tx.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, id))).limit(1);
    const [row] = await (lock ? query.for("update") : query); if (!row) throw notFound("Skill not found"); return row;
  }
  async function version(tx: Db, companyId: string, skillId: string, id: string) {
    const [row] = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, skillId), eq(companySkillVersions.id, id))).limit(1);
    if (!row) throw notFound("Skill version not found"); return row;
  }
  async function authorize(actor: AuthorizationActor, companyId: string, action: SkillPolicyAction, row?: typeof companySkills.$inferSelect, tx: Db = db) {
    await assertV5Enabled(tx, "skill_lifecycle_v5");
    await assertV5Authorization(tx, actor, companyId, "company_scope:read");
    if (row && !(await companySkillService(tx).canReadSkill(companyId, row.id, actor))) throw notFound("Skill not found");
    if (actor.type === "agent") {
      await assertV5Enabled(tx, "skill_autonomous_proposals_v5");
      if (action === "skills.promote") {
        await assertV5Enabled(tx, "skill_autonomous_promotion_v5");
        if (row) {
          const policy = skillPromotionPolicySchema.parse(row.promotionPolicy);
          if (!policy.allowAutonomousPromotion || policy.requireHumanReview || row.ownerAgentId !== actor.agentId) throw forbidden("Autonomous promotion requires the local owner's explicit policy and no mandatory human review");
        }
      } else if (action !== "skills.propose") throw forbidden("Human review is required for this lifecycle operation");
      await assertV5Authorization(tx, actor, companyId, "skills:suggest-changes");
    } else {
      v5HumanActorId(actor); await assertV5Authorization(tx, actor, companyId, "users:manage_permissions");
    }
    const policies = companySkillPolicyService(tx), effective = await policies.get(companyId);
    if (actor.type === "agent" && !effective.materialized) throw forbidden("Autonomous proposals require a materialized company Skill policy");
    let role: string | null = null;
    if (actor.type === "agent") role = (await tx.select({ role: agents.role }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, actor.agentId!))).limit(1))[0]?.role ?? null;
    const decision = await policies.evaluate({ companyId, principal: { type: actor.type === "agent" ? "agent" : "board", id: actor.type === "agent" ? actor.agentId! : v5HumanActorId(actor), role }, action,
      resource: row ? { skillId: row.id, skillKey: row.key, sourceType: normalizeSkillPolicySourceType(row.sourceType), sourceLocator: row.sourceLocator ?? undefined } : { sourceType: "generated" } });
    if (!decision.allowed || actor.type === "agent" && action === "skills.promote" && decision.reason !== "explicit_rule") throw forbidden("Company Skill policy denies this lifecycle operation", { code: "skill_policy_denied", reason: decision.reason });
  }
  async function audit(tx: Db, actor: AuthorizationActor, companyId: string, id: string, action: string, publications: ActivityPublication[], details?: Record<string, unknown>) {
    await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.type === "agent" ? actor.agentId! : v5HumanActorId(actor), agentId: actor.type === "agent" ? actor.agentId : null, action, entityType: "company_skill", entityId: id, details }, publications);
  }
  async function overlap(tx: Db, row: typeof companySkills.$inferSelect, markdown: string, actor: AuthorizationActor) {
    // ponytail: deterministic lexical screening of at most 500 active Skills;
    // add a calibrated retrieval index if real libraries exceed this ceiling.
    const peers = await tx.select({ id: companySkills.id, name: companySkills.name, description: companySkills.description, categories: companySkills.categories }).from(companySkills).where(and(eq(companySkills.companyId, row.companyId), eq(companySkills.lifecycleState, "active"), ne(companySkills.id, row.id))).orderBy(asc(companySkills.id)).limit(501);
    if (peers.length > 500) throw conflict("Overlap screening exceeds its current 500-Skill limit");
    const tokens = (value: string) => new Set((value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 128));
    const subject = tokens(`${row.name} ${row.description ?? ""} ${markdown.slice(0, 2000)}`);
    const visible = [];
    for (const peer of peers) if (await companySkillService(tx).canReadSkill(row.companyId, peer.id, actor)) visible.push(peer);
    return visible.map((peer) => { const other = tokens(`${peer.name} ${peer.description ?? ""} ${peer.categories.join(" ")}`); const matches = [...other].filter((word) => subject.has(word)).length; return { skillId: peer.id, name: peer.name, score: other.size ? matches / other.size : 0 }; }).filter((match) => match.score >= 0.6).sort((a, b) => b.score - a.score || a.skillId.localeCompare(b.skillId)).slice(0, 20);
  }
  return {
    authorizeAction: authorize,
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await assertV5Enabled(db, "skill_lifecycle_v5"); await assertV5Authorization(db, actor, companyId, "company_scope:read");
      const row = await skill(db, companyId, id);
      if (!(await companySkillService(db).canReadSkill(companyId, id, actor))) throw notFound("Skill not found");
      const visible = await companySkillService(db).listVersions(companyId, id, actor);
      const storedVersions = visible.length ? await db.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, id), inArray(companySkillVersions.id, visible.map((version) => version.id)))) : [];
      const versions = [];
      for (const version of visible) {
        const overlapReview = storedVersions.find((stored) => stored.id === version.id)?.validationSummary?.overlapReview as { state?: string; candidates?: Array<{ skillId: string; [key: string]: unknown }> } | undefined;
        const candidates = [];
        for (const candidate of overlapReview?.candidates ?? []) if (await companySkillService(db).canReadSkill(companyId, candidate.skillId, actor)) candidates.push(candidate);
        const dependencies = await db.select().from(companySkillDependencies).where(and(eq(companySkillDependencies.companyId, companyId), eq(companySkillDependencies.skillVersionId, version.id)));
        versions.push({ id: version.id, state: version.state, visibility: version.visibility, revisionNumber: version.revisionNumber, createdAt: version.createdAt, overlapReview: overlapReview ? { state: overlapReview.state, candidates } : null, dependencies: await skillDependencyStates(db, companyId, dependencies as Parameters<typeof skillDependencyStates>[2]) });
      }
      return { id: row.id, lifecycleState: row.lifecycleState, activeVersionId: row.activeVersionId, headVersionId: versions.some((version) => version.id === row.headVersionId) ? row.headVersionId : null, ownerAgentId: row.ownerAgentId, degradedReason: row.degradedReason, reviewPolicy: row.reviewPolicy, promotionPolicy: row.promotionPolicy, lastValidatedAt: row.lastValidatedAt, nextReviewAt: row.nextReviewAt, versions };
    },
    governance: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof updateSkillGovernanceSchema>) => {
      const input = updateSkillGovernanceSchema.parse(raw); await authorize(actor, companyId, "skills.approve");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await skill(tx, companyId, id, true); await authorize(actor, companyId, "skills.approve", row, tx);
        if (input.ownerAgentId) { const [owner] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.ownerAgentId), ne(agents.status, "terminated"))).limit(1); if (!owner) throw unprocessable("Skill owner must be a local presence"); }
        if (input.reviewPolicy?.stewardUserId && !(await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.reviewPolicy.stewardUserId), eq(companyMemberships.status, "active"))).limit(1))[0]) throw unprocessable("Skill steward must be an active company member");
        const [updated] = await tx.update(companySkills).set({ ...input, updatedAt: new Date() }).where(eq(companySkills.id, id)).returning();
        await audit(tx, actor, companyId, id, "skill.governance_updated", publications); return updated!;
      });
    },
    createDraft: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof createGovernedSkillSchema>, provenance?: SkillProvenance, parentPublications?: ActivityPublication[]) => {
      const input = createGovernedSkillSchema.parse(raw); await authorize(actor, companyId, "skills.propose");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        if (actor.type === "agent") {
          const [owner] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, actor.agentId!))).limit(1).for("update");
          if (!owner || !["idle", "running", "error"].includes(owner.status) || owner.budgetMonthlyCents > 0 && owner.spentMonthlyCents >= owner.budgetMonthlyCents) throw forbidden("The local agent is paused, unavailable or over budget");
          const [count] = await tx.select({ count: sql<number>`count(*)` }).from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.ownerAgentId, owner.id), inArray(companySkills.lifecycleState, ["draft", "proposed", "testing"])));
          if (Number(count!.count) >= 10) throw conflict("This local agent already owns ten unpromoted Skills; review them before creating more");
        }
        const [row] = await tx.insert(companySkills).values({ companyId, key: `company/${companyId}/${input.slug}`, slug: input.slug, name: input.name, description: input.description, markdown: input.markdown, sourceType: "generated", sharingScope: input.sharing === "private_draft" ? "private" : "company", compatibility: "compatible", ownerAgentId: actor.type === "agent" ? actor.agentId : null, metadata: { sourceKind: "governed_generated", triggerTerms: input.triggerTerms, excludeTerms: input.excludeTerms } }).onConflictDoNothing().returning();
        if (!row) throw conflict("This local Skill key already exists; propose a challenger instead");
        await audit(tx, actor, companyId, row.id, "skill.governed_draft_created", publications);
        const candidate = await skillLifecycleService(tx).propose(actor, companyId, row.id, skillCandidateInputSchema.parse({ baseActiveVersionId: null, markdown: input.markdown, sharing: input.sharing, summary: "Initial governed procedure" }), provenance, publications);
        return { skillId: row.id, candidate };
      }, parentPublications);
    },
    propose: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof skillCandidateInputSchema>, provenance?: SkillProvenance, parentPublications?: ActivityPublication[]) => {
      const input = skillCandidateInputSchema.parse(raw); await authorize(actor, companyId, "skills.propose");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await skill(tx, companyId, id, true); await authorize(actor, companyId, "skills.propose", row, tx);
        if (["revoked", "deprecated"].includes(row.lifecycleState)) throw conflict("Revoked/deprecated Skills cannot receive candidates");
        if (row.activeVersionId !== input.baseActiveVersionId) throw conflict("The active Skill changed; refresh before proposing");
        if (actor.type === "agent") {
          const [owner] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, actor.agentId!))).limit(1).for("update");
          if (!owner || !["idle", "running", "error"].includes(owner.status) || owner.budgetMonthlyCents > 0 && owner.spentMonthlyCents >= owner.budgetMonthlyCents) throw forbidden("The local owner cannot propose while paused or over budget");
          const [recent] = await tx.select({ count: sql<number>`count(*)` }).from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.authorAgentId, actor.agentId!), sql`${companySkillVersions.createdAt} > now() - interval '24 hours'`));
          if (Number(recent!.count) >= 5) throw conflict("Autonomous proposal limit reached: five candidates per local agent per day");
        }
        const base = row.activeVersionId ? await version(tx, companyId, id, row.activeVersionId) : null;
        const sensitivity = sensitivities[Math.max(sensitivityRank(row.metadata?.sensitivity), sensitivityRank(base?.validationSummary?.sensitivity ?? "public"), sensitivityRank(provenance?.sourceSensitivity ?? "public"))]!;
        const inheritedDependencies = base ? await tx.select().from(companySkillDependencies).where(and(eq(companySkillDependencies.companyId, companyId), eq(companySkillDependencies.skillVersionId, base.id))) : [];
        const dependencies = new Map(inheritedDependencies.map((dep) => [`${dep.dependencyType}:${dep.dependencyRef}`, { dependencyType: dep.dependencyType, dependencyRef: dep.dependencyRef, dependencyVersion: dep.dependencyVersion, required: dep.required }]));
        for (const dep of input.dependencies) { const key = `${dep.dependencyType}:${dep.dependencyRef}`, inherited = dependencies.get(key); if (inherited?.required && !dep.required) throw conflict("A challenger cannot silently remove a required dependency"); dependencies.set(key, dep); }
        if (dependencies.size > 64) throw conflict("Skill dependency inventory exceeds 64 references");
        const files = [...(provenance?.files ?? base?.fileInventory ?? [])].filter((file) => file.path !== "SKILL.md"); files.push({ path: "SKILL.md", kind: "skill", content: input.markdown });
        const overlaps = await overlap(tx, row, input.markdown, actor);
        const [next] = await tx.select({ revision: sql<number>`coalesce(max(${companySkillVersions.revisionNumber}), 0) + 1` }).from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, id)));
        const [candidate] = await tx.insert(companySkillVersions).values({ companyId, companySkillId: id, revisionNumber: Number(next!.revision), label: input.summary || null, fileInventory: files,
          sourcePlaybookRevisionId: provenance?.sourcePlaybookRevisionId ?? base?.sourcePlaybookRevisionId ?? null, visibility: input.sharing === "private_draft" ? "private" : "company", authorAgentId: actor.type === "agent" ? actor.agentId : null, authorUserId: actor.type === "board" ? v5HumanActorId(actor) : null,
          validationSummary: { sensitivity, sourceCompanyId: companyId, baseActiveVersionId: row.activeVersionId, overlapReview: { state: overlaps.length ? "pending" : "clear", candidates: overlaps }, source: "governed_candidate", ...(provenance?.publication ? { portfolioSource: provenance.publication } : base?.validationSummary?.portfolioSource ? { portfolioSource: base.validationSummary.portfolioSource, publicationInherited: true } : {}) } }).returning();
        if (dependencies.size) await tx.insert(companySkillDependencies).values((await skillDependencyStates(tx, companyId, [...dependencies.values()] as Parameters<typeof skillDependencyStates>[2])).map((dep) => ({ ...dep, companyId, skillId: id, skillVersionId: candidate!.id })));
        // Derived procedures retain the strongest source classification,
        // including after later challengers omit explicit source metadata.
        await tx.update(companySkills).set({ metadata: { ...row.metadata, sensitivity }, ...(["confidential", "restricted"].includes(sensitivity) ? { publicShareToken: null } : {}) }).where(eq(companySkills.id, id));
        if (!row.activeVersionId) await tx.update(companySkills).set({ lifecycleState: input.sharing === "private_draft" ? "draft" : "proposed", sharingScope: input.sharing === "private_draft" ? "private" : "company", updatedAt: new Date() }).where(eq(companySkills.id, id));
        await audit(tx, actor, companyId, id, "skill.candidate_proposed", publications, { versionId: candidate!.id, sharing: input.sharing, overlapCount: overlaps.length, sensitivity });
        return candidate!;
      }, parentPublications);
    },
    submitCandidate: async (actor: AuthorizationActor, companyId: string, id: string, versionId: string) => {
      await authorize(actor, companyId, "skills.propose");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await skill(tx, companyId, id, true), candidate = await version(tx, companyId, id, versionId); await authorize(actor, companyId, "skills.propose", row, tx);
        if (candidate.state !== "candidate") throw conflict("Only candidates can be submitted");
        if (actor.type === "agent" && candidate.authorAgentId !== actor.agentId) throw forbidden("Only the author can submit a private candidate");
        await tx.update(companySkillVersions).set({ visibility: "company" }).where(eq(companySkillVersions.id, versionId));
        if (!row.activeVersionId) await tx.update(companySkills).set({ lifecycleState: "proposed", sharingScope: "company", updatedAt: new Date() }).where(eq(companySkills.id, id));
        await audit(tx, actor, companyId, id, "skill.candidate_submitted", publications, { versionId }); return { versionId, visibility: "company" as const };
      });
    },
    reviewOverlap: async (actor: AuthorizationActor, companyId: string, id: string, versionId: string, rationale: string) => {
      await authorize(actor, companyId, "skills.approve"); if (rationale.trim().length < 20 || rationale.length > 4000) throw unprocessable("Overlap review requires a rationale of 20–4000 characters");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await skill(tx, companyId, id, true), candidate = await version(tx, companyId, id, versionId); await authorize(actor, companyId, "skills.approve", row, tx);
        if (candidate.state !== "candidate") throw conflict("Only candidate overlap can be reviewed");
        await tx.update(companySkillVersions).set({ validationSummary: { ...candidate.validationSummary, overlapReview: { state: "accepted_separate", rationale, reviewedByUserId: v5HumanActorId(actor), reviewedAt: new Date().toISOString() } } }).where(eq(companySkillVersions.id, versionId));
        await audit(tx, actor, companyId, id, "skill.overlap_reviewed", publications, { versionId }); return { versionId, state: "accepted_separate" };
      });
    },
    transition: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof skillLifecycleTransitionSchema>) => {
      const input = skillLifecycleTransitionSchema.parse(raw); await authorize(actor, companyId, "skills.deprecate");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await skill(tx, companyId, id, true); await authorize(actor, companyId, "skills.deprecate", row, tx);
        if (row.lifecycleState === "revoked") throw conflict("Revoked Skills cannot be reactivated by a lifecycle transition");
        if (row.activeVersionId && ["proposed", "testing"].includes(input.state)) throw conflict("Active versions stay active while challengers are tested");
        const [updated] = await tx.update(companySkills).set({ lifecycleState: input.state, degradedReason: input.reason, updatedAt: new Date() }).where(eq(companySkills.id, id)).returning();
        await audit(tx, actor, companyId, id, `skill.${input.state}`, publications); return updated!;
      });
    },
    promote: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof skillPromotionInputSchema>) => {
      const input = skillPromotionInputSchema.parse(raw); await authorize(actor, companyId, "skills.promote");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await skill(tx, companyId, id, true); await authorize(actor, companyId, "skills.promote", row, tx);
        if (row.activeVersionId !== input.expectedActiveVersionId) throw conflict("The champion changed; repeat comparison against the current active version");
        if (["revoked", "deprecated"].includes(row.lifecycleState)) throw conflict("A revoked/deprecated Skill cannot be promoted");
        const candidate = await version(tx, companyId, id, input.versionId), policy = skillPromotionPolicySchema.parse(row.promotionPolicy);
        if (candidate.visibility !== "company" || candidate.state !== "validated") throw conflict("Promotion requires a shared, validated immutable candidate");
        const [evaluation] = await tx.select().from(companySkillEvalRuns).where(and(eq(companySkillEvalRuns.companyId, companyId), eq(companySkillEvalRuns.skillId, id), eq(companySkillEvalRuns.id, input.evaluationRunId))).limit(1);
        if (!evaluation || evaluation.status !== "passed" || evaluation.candidateVersionId !== candidate.id || evaluation.championVersionId !== row.activeVersionId || evaluation.trials < policy.minimumPairedTrials) throw conflict("A passing paired evaluation against the current champion is required");
        const summary = evaluation.aggregate;
        if (!summary || summary.safetyPassed !== true || summary.processPassed !== true || typeof summary.candidateOutcomeScore !== "number" || summary.candidateOutcomeScore < policy.minimumOutcomeScore || (typeof summary.costRegressionRatio !== "number" || summary.costRegressionRatio > policy.maximumCostRegressionRatio)) throw conflict("Evaluation guard floors do not meet current promotion policy");
        const required = await tx.select().from(companySkillEvalSuites).where(and(eq(companySkillEvalSuites.companyId, companyId), eq(companySkillEvalSuites.skillId, id), eq(companySkillEvalSuites.requiredForPromotion, true)));
        if (!required.length) throw conflict("Promotion requires a configured evaluation suite");
        for (const suite of required) {
          const [passed] = await tx.select().from(companySkillEvalRuns).where(and(eq(companySkillEvalRuns.companyId, companyId), eq(companySkillEvalRuns.skillId, id), eq(companySkillEvalRuns.suiteId, suite.id), eq(companySkillEvalRuns.candidateVersionId, candidate.id), row.activeVersionId ? eq(companySkillEvalRuns.championVersionId, row.activeVersionId) : sql`${companySkillEvalRuns.championVersionId} is null`, eq(companySkillEvalRuns.status, "passed"), eq(companySkillEvalRuns.caseSetHash, suite.caseSetHash))).limit(1);
          const score = passed?.aggregate;
          if (!passed || passed.trials < policy.minimumPairedTrials || score?.safetyPassed !== true || score.processPassed !== true || typeof score.candidateOutcomeScore !== "number" || score.candidateOutcomeScore < policy.minimumOutcomeScore || typeof score.costRegressionRatio !== "number" || score.costRegressionRatio > policy.maximumCostRegressionRatio) throw conflict("Every required suite must pass the pinned case set under the current promotion floors");
          const retained = await tx.select({ deletedAt: companySkillTestRuns.deletedAt, status: companySkillTestRuns.status }).from(companySkillEvalScores).innerJoin(companySkillTestRuns, eq(companySkillEvalScores.testRunId, companySkillTestRuns.id)).where(and(eq(companySkillEvalScores.companyId, companyId), eq(companySkillEvalScores.evalRunId, passed.id), eq(companySkillTestRuns.companyId, companyId)));
          if (!retained.length || retained.some((trace) => trace.deletedAt || trace.status !== "succeeded")) throw conflict("A required suite lost its retained execution evidence");
        }
        if (actor.type === "agent") {
          const highRisk = await tx.select({ id: companySkillEvalCases.id }).from(companySkillEvalCases).innerJoin(companySkillEvalSuites, eq(companySkillEvalSuites.id, companySkillEvalCases.suiteId)).where(and(eq(companySkillEvalCases.companyId, companyId), eq(companySkillEvalSuites.skillId, id), inArray(companySkillEvalCases.risk, ["high", "critical"]))).limit(1);
          if (highRisk.length) throw forbidden("High-risk and critical procedures require human promotion review");
        }
        const deps = await tx.select().from(companySkillDependencies).where(and(eq(companySkillDependencies.companyId, companyId), eq(companySkillDependencies.skillVersionId, candidate.id), eq(companySkillDependencies.required, true)));
        if ((await skillDependencyStates(tx, companyId, deps as Parameters<typeof skillDependencyStates>[2])).some((dep) => dep.status !== "current")) throw conflict("Required dependencies need revalidation before promotion");
        const observed = await tx.select({ deletedAt: companySkillTestRuns.deletedAt, status: companySkillTestRuns.status }).from(companySkillEvalScores).innerJoin(companySkillTestRuns, eq(companySkillEvalScores.testRunId, companySkillTestRuns.id)).where(and(eq(companySkillEvalScores.companyId, companyId), eq(companySkillEvalScores.evalRunId, evaluation.id), eq(companySkillTestRuns.companyId, companyId)));
        if (!observed.length || observed.some((trace) => trace.deletedAt || trace.status !== "succeeded")) throw conflict("Evaluation source traces are unavailable; repeat evaluation before promotion");
        const overlapReview = candidate.validationSummary?.overlapReview as { state?: string } | undefined;
        if (!overlapReview || !["clear", "accepted_separate"].includes(overlapReview.state ?? "")) throw conflict("Resolve overlap before promotion");
        const source = candidate.validationSummary?.portfolioSource as { id?: string; companyId?: string; versionId?: string; hash?: string } | undefined;
        if (source && candidate.validationSummary?.publicationInherited !== true) {
          if (!source.id) throw conflict("Portfolio provenance is incomplete");
          const release = await availablePortfolioPublication(tx, companyId, source.id);
          if (release.companyId !== source.companyId || release.versionId !== source.versionId || release.hash !== source.hash || release.assetType !== "skill") throw conflict("Portfolio provenance changed");
          await tx.update(portfolioCapabilitySubscriptions).set({ publicationId: release.id, pinnedSourceVersionId: release.versionId }).where(and(eq(portfolioCapabilitySubscriptions.companyId, companyId), eq(portfolioCapabilitySubscriptions.localSkillId, id), eq(portfolioCapabilitySubscriptions.sourceCompanyId, release.companyId), eq(portfolioCapabilitySubscriptions.sourceAssetId, release.assetId), eq(portfolioCapabilitySubscriptions.mode, "subscribe")));
        }
        if (row.activeVersionId) await tx.update(companySkillVersions).set({ state: "superseded" }).where(eq(companySkillVersions.id, row.activeVersionId));
        await tx.update(companySkillVersions).set({ state: "active", activatedAt: new Date() }).where(eq(companySkillVersions.id, candidate.id));
        const review = skillReviewPolicySchema.parse(row.reviewPolicy), body = candidate.fileInventory.find((file) => file.path === "SKILL.md")?.content;
        if (!body) throw conflict("The validated Skill body is unavailable");
        const [updated] = await tx.update(companySkills).set({ activeVersionId: candidate.id, currentVersionId: candidate.id, markdown: body, sharingScope: "company", lifecycleState: "active", degradedReason: null, lastValidatedAt: new Date(), nextReviewAt: new Date(Date.now() + review.reviewIntervalDays * 86_400_000), updatedAt: new Date() }).where(eq(companySkills.id, id)).returning();
        await audit(tx, actor, companyId, id, "skill.promoted", publications, { previousVersionId: row.activeVersionId, versionId: candidate.id, evaluationRunId: evaluation.id }); return updated!;
      });
    },
    invalidateDependency: async (companyId: string, dependencyType: string, dependencyRef: string, currentVersion: string | null, parentPublications?: ActivityPublication[]) => withV5ActivityTransaction(db, async (tx, publications) => {
      const affected = await tx.update(companySkillDependencies).set({ status: currentVersion === null ? "missing" : "changed", invalidatedAt: new Date() }).where(and(eq(companySkillDependencies.companyId, companyId), eq(companySkillDependencies.dependencyType, dependencyType), eq(companySkillDependencies.dependencyRef, dependencyRef), currentVersion ? ne(companySkillDependencies.dependencyVersion, currentVersion) : undefined)).returning();
      for (const dep of affected.filter((item) => item.required)) {
        const [updated] = await tx.update(companySkills).set({ lifecycleState: currentVersion === null ? "degraded" : "needs_revalidation", degradedReason: `Required ${dependencyType} changed`, updatedAt: new Date() }).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, dep.skillId), eq(companySkills.activeVersionId, dep.skillVersionId), inArray(companySkills.lifecycleState, ["active", "needs_revalidation", "degraded"]))).returning({ id: companySkills.id });
        if (updated) await logActivity(tx, { companyId, actorType: "system", actorId: "skill-dependency-validation", action: "skill.dependency_invalidated", entityType: "company_skill", entityId: updated.id, details: { dependencyType, dependencyRef, required: true } }, publications);
      }
      return { affectedVersions: [...new Set(affected.map((dep) => dep.skillVersionId))] };
    }, parentPublications),
  };
}
