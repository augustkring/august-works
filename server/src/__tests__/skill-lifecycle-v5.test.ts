import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companySkills, companySkillVersions, companySkillDependencies, createDb } from "@paperclipai/db";
import { skillCandidateInputSchema, skillPromotionPolicySchema } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { companySkillService } from "../services/company-skills.js";
import { aggregateSkillEvaluation, skillEvaluationService } from "../services/skill-evaluations.js";
import { instanceSettingsService } from "../services/instance-settings.js";

it("paired evaluation never passes unknown evidence, safety/process failures or a cheap outcome regression", () => {
  const policy = skillPromotionPolicySchema.parse({});
  const score = { triggerPassed: true, processPassed: true, safetyPassed: true, efficiencyPassed: true, outcomeScore: 1, costCents: 100 };
  const arms = [{ arm: "champion", scores: score }, { arm: "candidate", scores: { ...score, costCents: 50 } }];
  expect(aggregateSkillEvaluation(arms, 4, policy, true).status).toBe("running");
  expect(aggregateSkillEvaluation(arms, 2, policy, true).status).toBe("passed");
  expect(aggregateSkillEvaluation([arms[0]!, { arm: "candidate", scores: { ...score, triggerPassed: null } }], 2, policy, true).status).toBe("inconclusive");
  for (const regression of [{ safetyPassed: false }, { processPassed: false }, { outcomeScore: 0.8, costCents: 1 }]) {
    expect(aggregateSkillEvaluation([arms[0]!, { arm: "candidate", scores: { ...score, ...regression } }], 2, policy, true).status).toBe("failed");
  }
});

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 immutable Skill candidates", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-skill-lifecycle-"); db = createDb(database.connectionString); await enableV5ForTest(db); });
  afterAll(async () => { await database?.cleanup(); });
  async function fixture(existing?: Awaited<ReturnType<typeof seedV5Presences>>) {
    const f = existing ?? await seedV5Presences(db), id = randomUUID();
    await db.insert(companySkills).values({ id, companyId: f.home, key: `company/${f.home}/${id}`, slug: id, name: "Required procedure", markdown: "Active procedure", sourceType: "url", compatibility: "compatible" });
    const [version] = await db.insert(companySkillVersions).values({ companyId: f.home, companySkillId: id, revisionNumber: 1, state: "active", fileInventory: [{ path: "SKILL.md", kind: "skill", content: "Active procedure" }] }).returning();
    await db.update(companySkills).set({ activeVersionId: version!.id, currentVersionId: version!.id, lifecycleState: "active" }).where(eq(companySkills.id, id));
    return { ...f, skillId: id, version: version! };
  }
  it("replaces a required evaluation case set atomically while retaining immutable historical cases", async () => {
    const f = await fixture(), svc = skillEvaluationService(db);
    const cases = [{ name: "Positive", input: "Evaluate this matching task", shouldTrigger: true, risk: "low" as const, rubric: { requiredText: [], forbiddenText: [], requiredTools: [], prohibitedTools: [], maximumCostCents: null, maximumRuntimeMs: null, requiresHumanJudgement: true } }, { name: "Negative", input: "An unrelated task", shouldTrigger: false, risk: "low" as const, rubric: { requiredText: [], forbiddenText: [], requiredTools: [], prohibitedTools: [], maximumCostCents: null, maximumRuntimeMs: null, requiresHumanJudgement: true } }];
    const original = await svc.createSuite(f.actor, f.home, f.skillId, { name: "Initial cases", requiredForPromotion: true, cases });
    const input = { reason: "Replace obsolete domain examples with reviewed current cases", replacement: { name: "Updated cases", requiredForPromotion: true, cases: cases.map((item) => ({ ...item, input: item.input + " for the updated domain" })) } };
    await expect(svc.replaceSuite({ type: "agent", source: "agent_jwt", agentId: f.presence.id, companyId: f.home, onBehalfOfUserId: f.userId }, f.home, f.skillId, original.id, input)).rejects.toMatchObject({ status: 403 });
    const next = await svc.replaceSuite(f.actor, f.home, f.skillId, original.id, input);
    expect(next.caseSetHash).not.toBe(original.caseSetHash);
    expect((await svc.getSuite(f.actor, f.home, f.skillId, original.id)).cases).toEqual(original.cases);
    expect((await svc.list(f.actor, f.home, f.skillId)).suites.filter((item) => item.requiredForPromotion).map((item) => item.id)).toEqual([next.id]);
    await expect(svc.replaceSuite(f.actor, f.home, f.skillId, original.id, input)).rejects.toMatchObject({ status: 409 });
    await expect(svc.replaceSuite(f.actor, f.guest, f.skillId, next.id, input)).rejects.toMatchObject({ status: 404 });
  });
  it("retains private-draft boundaries when lifecycle rollout is disabled and protects classified versions", async () => {
    const f = await seedV5Presences(db), lifecycle = skillLifecycleService(db), skills = companySkillService(db);
    const draft = await lifecycle.createDraft(f.actor, f.home, { slug: "private-rollback", name: "Private rollback draft", description: "", markdown: "Private retained procedure", triggerTerms: ["private"], excludeTerms: [], sharing: "private_draft" });
    const other = { type: "agent" as const, source: "agent_jwt" as const, agentId: f.presence.id, companyId: f.home, onBehalfOfUserId: f.userId };
    await instanceSettingsService(db).updateExperimental({ skill_lifecycle_v5: false });
    try {
      expect(await skills.canReadSkill(f.home, draft.skillId, other)).toBe(false);
      expect(await skills.getVersion(f.home, draft.skillId, draft.candidate.id, other)).toBeNull();
      await expect(skills.listVersions(f.home, draft.skillId, other)).rejects.toMatchObject({ status: 404 });
    } finally { await instanceSettingsService(db).updateExperimental({ skill_lifecycle_v5: true }); }
    const active = await fixture(f);
    await db.update(companySkills).set({ metadata: { sensitivity: "restricted" } }).where(eq(companySkills.id, active.skillId));
    expect(await skills.getVersion(f.home, active.skillId, active.version.id, other)).toBeNull();
    expect(await skills.getVersion(f.home, active.skillId, active.version.id, f.actor)).toBeTruthy();
  });
  it("proposes without editing active bytes or allowing private candidate body reads through V4 version APIs", async () => {
    const f = await fixture(), svc = skillLifecycleService(db);
    const candidate = await svc.propose(f.actor, f.home, f.skillId, skillCandidateInputSchema.parse({ baseActiveVersionId: f.version.id, markdown: "Private challenger body" }));
    const [stored] = await db.select().from(companySkills).where(eq(companySkills.id, f.skillId));
    expect(stored).toMatchObject({ markdown: "Active procedure", activeVersionId: f.version.id, currentVersionId: f.version.id, headVersionId: candidate.id, lifecycleState: "active" });
    const other = { type: "agent" as const, source: "agent_jwt" as const, agentId: f.presence.id, companyId: f.home, onBehalfOfUserId: f.userId };
    expect(await companySkillService(db).getVersion(f.home, f.skillId, candidate.id, other)).toBeNull();
    expect((await companySkillService(db).listVersions(f.home, f.skillId, other)).map((version) => version.id)).toEqual([f.version.id]);
    expect((await companySkillService(db).getVersion(f.home, f.skillId, candidate.id, f.actor))?.fileInventory[0]?.content).toBe("Private challenger body");
    await expect(db.update(companySkillVersions).set({ fileInventory: [{ path: "SKILL.md", kind: "skill", content: "Overwritten" }] }).where(eq(companySkillVersions.id, f.version.id))).rejects.toThrow();
    await expect(svc.promote(f.actor, f.home, f.skillId, { versionId: candidate.id, expectedActiveVersionId: f.version.id, evaluationRunId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it("fails closed on autonomous proposal authority and stale champion references", async () => {
    const f = await fixture(), svc = skillLifecycleService(db), input = skillCandidateInputSchema.parse({ baseActiveVersionId: f.version.id, markdown: "Challenger" });
    await expect(svc.propose({ type: "agent", source: "agent_jwt", agentId: f.presence.id, companyId: f.home, onBehalfOfUserId: f.userId }, f.home, f.skillId, input)).rejects.toMatchObject({ status: 403 });
    await expect(svc.propose(f.actor, f.home, f.skillId, { ...input, baseActiveVersionId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it("inherits required champion dependencies and rejects silently downgrading them", async () => {
    const f = await fixture(), svc = skillLifecycleService(db), dependencyRef = randomUUID();
    await db.insert(companySkillDependencies).values({ companyId: f.home, skillId: f.skillId, skillVersionId: f.version.id, dependencyType: "provider_capability", dependencyRef, dependencyVersion: "old-snapshot", required: true });
    const candidate = await svc.propose(f.actor, f.home, f.skillId, skillCandidateInputSchema.parse({ baseActiveVersionId: f.version.id, markdown: "Revised procedure", dependencies: [] }));
    expect((await db.select().from(companySkillDependencies).where(eq(companySkillDependencies.skillVersionId, candidate.id))).map((dep) => ({ type: dep.dependencyType, ref: dep.dependencyRef, required: dep.required }))).toEqual([{ type: "provider_capability", ref: dependencyRef, required: true }]);
    await expect(svc.propose(f.actor, f.home, f.skillId, skillCandidateInputSchema.parse({ baseActiveVersionId: f.version.id, markdown: "Try to bypass dependency validation", dependencies: [{ dependencyType: "provider_capability", dependencyRef, dependencyVersion: "new-snapshot", required: false }] }))).rejects.toMatchObject({ status: 409 });
  });
  it("invalidates affected active versions while leaving unrelated Skills untouched", async () => {
    const a = await fixture(), b = await fixture(a);
    await db.insert(companySkillDependencies).values({ companyId: a.home, skillId: a.skillId, skillVersionId: a.version.id, dependencyType: "provider_capability", dependencyRef: "provider-a", dependencyVersion: "version-1", required: true });
    await skillLifecycleService(db).invalidateDependency(a.home, "provider_capability", "provider-a", "version-2");
    expect((await db.select().from(companySkills).where(eq(companySkills.id, a.skillId)))[0]!.lifecycleState).toBe("needs_revalidation");
    expect((await db.select().from(companySkills).where(eq(companySkills.id, b.skillId)))[0]!.lifecycleState).toBe("active");
  });
});
