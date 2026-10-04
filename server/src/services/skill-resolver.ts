import { skillDependencyStates } from "./skill-dependencies.js";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { agents, companySkills, companySkillVersions, companySkillDependencies, type Db } from "@paperclipai/db";
import type { ExecutionManifestSkill, RolePackItem } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled } from "./v5-authorization.js";
import { companySkillPolicyService, normalizeSkillPolicySourceType } from "./company-skill-policy.js";
import { companySkillService } from "./company-skills.js";

export function skillTermMatches(query: string, term: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
  const text = normalize(query), needle = normalize(term);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A procedure for UI must not match "build", and UX must not match Linux.
  // Unicode boundaries also keep Danish words and mixed scripts predictable.
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(text);
}

export function skillTaskMatches(query: string, triggers: readonly string[], excludes: readonly string[]) {
  return !excludes.some((term) => skillTermMatches(query, term)) && triggers.some((term) => skillTermMatches(query, term));
}

export function skillResolverService(db: Db) {
  async function authorizedVersion(actor: AuthorizationActor, companyId: string, skillId: string, versionId: string, test = false) {
    await assertV5Authorization(db, actor, companyId, "company_scope:read");
    const [row] = await db.select({ skill: companySkills, version: companySkillVersions }).from(companySkills)
      .innerJoin(companySkillVersions, and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, companySkills.id), eq(companySkillVersions.id, versionId)))
      .where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, skillId))).limit(1);
    if (!row || !(await companySkillService(db).canReadSkill(companyId, skillId, actor))) throw notFound("Skill version not found");
    if (!test && (row.skill.lifecycleState !== "active" || row.skill.activeVersionId !== versionId || row.version.state !== "active" || row.version.visibility !== "company")) throw conflict("The pinned Skill is no longer active; revalidation is required");
    if (row.skill.compatibility !== "compatible" || (!test && row.skill.nextReviewAt && row.skill.nextReviewAt <= new Date())) throw conflict("Skill compatibility or review is overdue");
    const policy = companySkillPolicyService(db);
    const principal = actor.type === "agent" ? await policy.resolveAgentPrincipal(companyId, actor.agentId!) : { type: "board" as const, id: actor.userId ?? "local-board", role: null };
    const decision = await policy.evaluate({ companyId, principal, action: "skills.use", resource: { skillId, skillKey: row.skill.key, sourceType: normalizeSkillPolicySourceType(row.skill.sourceType), sourceLocator: row.skill.sourceLocator ?? undefined } });
    if (!decision.allowed) throw forbidden("Current company policy denies this Skill");
    const dependencies = await db.select().from(companySkillDependencies).where(and(eq(companySkillDependencies.companyId, companyId), eq(companySkillDependencies.skillVersionId, versionId)));
    const freshDependencies = await skillDependencyStates(db, companyId, dependencies as Parameters<typeof skillDependencyStates>[2]);
    if (freshDependencies.some((d) => d.required && d.status !== "current")) throw conflict("A required Skill dependency needs revalidation");
    return row;
  }
  return {
    authorizedVersion,
    resolve: async (actor: AuthorizationActor, companyId: string, query: string, requirements: readonly RolePackItem[], testSelection?: { skillId: string; versionId: string }) => {
      await assertV5Enabled(db, "skill_resolver_v5");
      await assertV5Authorization(db, actor, companyId, "company_scope:read");
      // ponytail: deterministic, bounded descriptors; bodies are loaded only
      // for selected pins. This ceiling is explicit rather than silent paging.
      const rows = await db.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.lifecycleState, "active"))).orderBy(asc(companySkills.key)).limit(501);
      if (rows.length > 500) throw conflict("Skill resolver catalog exceeds 500 entries; narrow the company catalog");
      if (testSelection && !rows.some((r) => r.id === testSelection.skillId)) {
        const [row] = await db.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, testSelection.skillId))).limit(1);
        if (row) rows.push(row);
      }
      for (let index = rows.length - 1; index >= 0; index--) if (!(await companySkillService(db).canReadSkill(companyId, rows[index]!.id, actor))) rows.splice(index, 1);
      const skills: ExecutionManifestSkill[] = [], warnings: string[] = [];
      for (const required of requirements.filter((r) => r.type === "required_skill")) {
        if (required.loadPoint !== "always" && required.triggerTerms.length && !skillTaskMatches(query, required.triggerTerms, required.excludeTerms)) continue;
        if (!rows.some((r) => r.key === required.ref || r.slug === required.ref || r.id === required.ref)) throw conflict(`Required Skill unavailable: ${required.ref}`);
      }
      for (const row of rows) {
        const requirement = requirements.find((r) => ["required_skill", "recommended_skill"].includes(r.type) && [row.id, row.key, row.slug].includes(r.ref));
        const metadata = row.metadata ?? {};
        const terms = (key: string) => Array.isArray(metadata[key]) ? (metadata[key] as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 32) : [];
        const triggers = requirement?.triggerTerms.length ? requirement.triggerTerms : terms("triggerTerms");
        const excludes = [...terms("excludeTerms"), ...(requirement?.excludeTerms ?? [])];
        const matched = skillTaskMatches(query, triggers.length ? triggers : [row.slug.replaceAll("-", " ")], excludes);
        const required = requirement?.type === "required_skill";
        // Explicit negative matches veto even a task-required procedure; an
        // always-loaded security procedure must not have negative triggers.
        const excluded = excludes.some((term) => skillTermMatches(query, term));
        if (excluded && requirement?.loadPoint === "always" && required) throw conflict("A mandatory always-loaded Skill has conflicting exclusion rules");
        if (excluded || (!matched && (!required || requirement?.loadPoint !== "always"))) continue;
        const versionId = testSelection?.skillId === row.id ? testSelection.versionId : requirement?.versionId ?? row.activeVersionId;
        if (!versionId) { if (required) throw conflict(`Required Skill has no active version: ${row.slug}`); continue; }
        try { await authorizedVersion(actor, companyId, row.id, versionId, testSelection?.skillId === row.id); }
        catch (error) { if (required) throw error; warnings.push(`Optional Skill unavailable: ${row.slug}`); continue; }
        const tokens = Math.ceil(Buffer.byteLength(JSON.stringify({ key: row.key, name: row.name, description: row.description?.slice(0, 600) ?? "" }), "utf8") / 4);
        skills.push({ skillId: row.id, versionId, key: row.key, name: row.name, selection: required ? "required" : testSelection?.skillId === row.id ? "task_required" : "recommended", loadPoint: requirement?.loadPoint ?? "task_relevant", estimatedDescriptorTokens: tokens });
      }
      skills.sort((a, b) => (a.selection === "recommended" ? 1 : 0) - (b.selection === "recommended" ? 1 : 0) || a.key.localeCompare(b.key));
      const selected: ExecutionManifestSkill[] = []; let estimatedTokens = 0;
      for (const pin of skills) {
        if (selected.length >= 64 || estimatedTokens + pin.estimatedDescriptorTokens > 2000) {
          if (pin.selection !== "recommended") throw conflict("Required Skill descriptors exceed the runtime inventory budget");
          warnings.push(`Optional Skill omitted by inventory budget: ${pin.name}`); continue;
        }
        selected.push(pin); estimatedTokens += pin.estimatedDescriptorTokens;
      }
      return { skills: selected, estimatedTokens, warnings };
    },
  };
}
