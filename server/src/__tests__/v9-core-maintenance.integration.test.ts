import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, agents, authUsers, companyMemberships, createDb, instanceSettings, knowledgeQualityFindings,
  principalPermissionGrants, readinessAssessments, companySkills, companySkillVersions, companySkillDependencies, playbookDocuments } from "@paperclipai/db";
import { V5_FEATURE_KEYS, V6_FEATURE_KEYS, V7_FEATURE_KEYS, V9_FEATURE_KEYS } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { evaluateReadiness, mandatoryReadinessPolicy } from "../services/readiness/readiness-policy.js";
import { readCoreMaintenance } from "../services/experience/core-maintenance.js";
import { experienceService } from "../services/experience/service.js";
import * as core from "../services/experience/core-maintenance.js";
import { playbookService } from "../services/playbooks.js";

describe("V9 current own Core Steward finding projection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof seedV5Companies>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-core-maintenance-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks(); fixture = await seedV5Companies(db);
    await db.update(instanceSettings).set({ experimental: { ...Object.fromEntries(
      [...V5_FEATURE_KEYS, ...V6_FEATURE_KEYS, ...V7_FEATURE_KEYS, ...V9_FEATURE_KEYS].map(key => [key, true])),
      enableFoundationV1: true, enableContextEngineV1: true, enableCollectiveMemoryV1: true,
      enableWorkflowsV1: true, enableChatConnectors: true } }).where(eq(instanceSettings.singletonKey, "default"));
  });
  const read = () => readCoreMaintenance(db, fixture.actor, fixture.home, new AbortController().signal);
  async function procedure(owner = fixture.userId) {
    const id = randomUUID();
    await db.insert(companySkills).values({ id, companyId: fixture.home, key: id, slug: id,
      name: "PRIVATE-PROCEDURE", markdown: "PRIVATE-BODY", sourceType: "url", compatibility: "compatible",
      reviewPolicy: { reviewIntervalDays: 90, stewardUserId: owner } });
    // Structural Native active version; this does not qualify its promotion.
    const [version] = await db.insert(companySkillVersions).values({ companyId: fixture.home, companySkillId: id,
      revisionNumber: 1, state: "active", fileInventory: [{ path: "SKILL.md", kind: "skill", content: "PRIVATE-BODY" }] }).returning();
    await db.update(companySkills).set({ activeVersionId: version!.id, currentVersionId: version!.id,
      lifecycleState: "active", nextReviewAt: new Date(Date.now() - 60_000) }).where(eq(companySkills.id, id));
    return { id, version: version! };
  }
  async function playbook() {
    const service = playbookService(db);
    const row = await service.create(fixture.actor, fixture.home, { key: randomUUID(), title: "PRIVATE-PLAYBOOK",
      markdown: "PRIVATE-PLAYBOOK-BODY", ownerUserId: fixture.userId, ownerAgentId: null,
      category: "general", sensitivity: "internal", reviewFrequencyDays: 90 });
    const revision = (await service.get(fixture.actor, fixture.home, row.id)).document.latestRevisionId!;
    await service.review(fixture.actor, fixture.home, row.id, { expectedRevisionId: revision, decision: "approve", rationale: "Fixture reviewed canonical procedure" });
    await db.update(playbookDocuments).set({ nextReviewAt: new Date(Date.now() - 60_000) }).where(eq(playbookDocuments.id, row.id));
    return row;
  }
  async function finding(companyId = fixture.home, principalId = `user:${fixture.userId}`, status = "open") {
    const [agent] = await db.insert(agents).values({ companyId, name: "PRIVATE-ASSESSMENT-AGENT", role: "general" }).returning();
    const now = new Date(), requirements = mandatoryReadinessPolicy("internal_draft");
    const evaluation = evaluateReadiness({ action: "internal_draft", requirements, evidence: [], now });
    const [assessment] = await db.insert(readinessAssessments).values({ companyId, agentId: agent!.id, principalId,
      subjectType: "agent", subjectId: agent!.id, actionClass: evaluation.actionClass, riskClass: evaluation.riskClass,
      status: evaluation.status, requirementSnapshotHash: "a".repeat(64), policySnapshotHash: "b".repeat(64),
      requirementSnapshot: requirements, assessment: evaluation, assessedAt: now, expiresAt: new Date(evaluation.expiresAt) }).returning();
    const [row] = await db.insert(knowledgeQualityFindings).values({ companyId, assessmentId: assessment!.id,
      findingHash: randomUUID().replaceAll("-", "").repeat(2), qualityDimension: "freshness", requirementKey: "PRIVATE-REQUIREMENT",
      severity: "review_required", status, summary: "PRIVATE-FINDING-SUMMARY", evidenceRefs: [{ private: "PRIVATE-EVIDENCE" }],
      ruleVersion: "fixture-only" }).returning();
    return row!;
  }
  it("aggregates only this current principal's open findings without raw sources or assessment/approval effects", async () => {
    await finding(); await finding(fixture.home, `user:${fixture.userId}`, "acknowledged");
    await finding(fixture.home, "user:other-person"); await finding(fixture.guest);
    const before = await db.select().from(knowledgeQualityFindings).where(eq(knowledgeQualityFindings.companyId, fixture.home));
    const assessments = await db.select().from(readinessAssessments).where(eq(readinessAssessments.companyId, fixture.home));
    const log = await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home));
    const result = await read(); expect(result.needsYou).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-"); expect(JSON.stringify(result)).not.toContain("other-person");
    expect(result.needsYou[0]?.actions[0]).toMatchObject({ operation: "open", criticality: "C2", href: "/readiness" });
    expect(await db.select().from(knowledgeQualityFindings).where(eq(knowledgeQualityFindings.companyId, fixture.home))).toEqual(before);
    expect(await db.select().from(readinessAssessments).where(eq(readinessAssessments.companyId, fixture.home))).toEqual(assessments);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home))).toEqual(log);
  });
  it("requires current verified membership and does not use an instance-admin substitute", async () => {
    await finding(); await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, fixture.userId));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, fixture.userId));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await expect(readCoreMaintenance(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves Original company-read admission and requires current predecessor rollout", async () => {
    await finding(); await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "company_scope:read")));
    // Original active-member company read remains admitted; deleting a pasted
    // permission row must not create a new V9 interpretation of this policy.
    expect((await read()).needsYou).toHaveLength(1);
    await db.update(instanceSettings).set({ experimental: { maintenance_autopilot_v9: false } }).where(eq(instanceSettings.singletonKey, "default"));
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
  it("binds actual finding state and bounds metadata reads without reading private bodies", async () => {
    const row = await finding(), first = (await read()).needsYou[0]!.source.version;
    await db.update(knowledgeQualityFindings).set({ status: "acknowledged" }).where(eq(knowledgeQualityFindings.id, row.id));
    expect((await read()).needsYou[0]?.source.version).not.toBe(first);
    for (let index = 0; index < 6; index++) await finding();
    const result = await read(); expect(result.needsYou).toHaveLength(1); expect(result.coverage?.reason).toBe("more_items_available");
  });
  it("withdraws changed current findings after experience fan-out", async () => {
    const row = await finding(), real = core.readCoreMaintenance; let calls = 0;
    vi.spyOn(core, "readCoreMaintenance").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(knowledgeQualityFindings).set({ status: "acknowledged" }).where(eq(knowledgeQualityFindings.id, row.id));
      return result;
    });
    const result = await experienceService(db).home(fixture.actor, fixture.home);
    expect(result.needsYou.filter(card => card.source.domain === "readiness" && card.kind === "maintenance")).toEqual([]);
    expect(result.dependencies.find(entry => entry.domain === "core-maintenance")).toMatchObject({ state: "partial", reason: "source_stale" });
  });
  it("returns no finding card for a principal whose own findings are absent", async () => {
    await finding(fixture.home, "user:someone-else"); expect((await read()).needsYou).toEqual([]);
  });
  it("projects assigned overdue procedures through their Original readers without bodies or effects", async () => {
    const skill = await procedure(), book = await playbook(); await procedure("someone-else");
    const before = await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home));
    const skillBefore = await db.select().from(companySkills).where(eq(companySkills.id, skill.id));
    const bookBefore = await db.select().from(playbookDocuments).where(eq(playbookDocuments.id, book.id));
    const result = await read();
    expect(result.needsYou.map(card => card.source.domain).sort()).toEqual(["company_skill", "playbook"]);
    expect(result.needsYou.map(card => card.actions[0]?.href).sort()).toEqual([`/playbooks/${book.id}`, `/skills/studio/${skill.id}`].sort());
    expect(JSON.stringify(result)).not.toContain("PRIVATE-"); expect(JSON.stringify(result)).not.toContain(fixture.userId);
    expect(result.needsYou.every(card => card.actions.every(action => action.operation === "open"))).toBe(true);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home))).toEqual(before);
    expect(await db.select().from(companySkills).where(eq(companySkills.id, skill.id))).toEqual(skillBefore);
    expect(await db.select().from(playbookDocuments).where(eq(playbookDocuments.id, book.id))).toEqual(bookBefore);
  });
  it("detects actual required dependency drift even when cached status says current", async () => {
    const skill = await procedure(), book = await playbook();
    await db.update(companySkills).set({ nextReviewAt: new Date(Date.now() + 86_400_000) }).where(eq(companySkills.id, skill.id));
    await db.update(playbookDocuments).set({ nextReviewAt: new Date(Date.now() + 86_400_000) }).where(eq(playbookDocuments.id, book.id));
    await db.insert(companySkillDependencies).values({ companyId: fixture.home, skillId: skill.id, skillVersionId: skill.version.id,
      dependencyType: "playbook_revision", dependencyRef: book.id, dependencyVersion: randomUUID(), status: "current", required: true });
    expect((await read()).needsYou.map(card => card.source.resourceId)).toEqual([skill.id]);
    const [approved] = await db.select().from(playbookDocuments).where(eq(playbookDocuments.id, book.id));
    await db.update(companySkillDependencies).set({ dependencyVersion: approved!.approvedRevisionId!, status: "changed" })
      .where(eq(companySkillDependencies.skillVersionId, skill.version.id));
    expect((await read()).needsYou).toEqual([]);
  });
  it("does not turn assigned review or stale admin claims into classified procedure access", async () => {
    const skill = await procedure(), book = await playbook();
    await db.update(companySkills).set({ metadata: { sensitivity: "restricted" } }).where(eq(companySkills.id, skill.id));
    await db.update(playbookDocuments).set({ sensitivity: "restricted" }).where(eq(playbookDocuments.id, book.id));
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "users:manage_permissions")));
    const result = await readCoreMaintenance(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home, new AbortController().signal);
    expect(result.needsYou).toEqual([]); expect(result.coverage?.reason).toBe("source_stale");
  });
  it("bounds assigned procedure reads and withdraws a reassigned procedure after fan-out", async () => {
    const skill = await procedure(), real = core.readCoreMaintenance; let calls = 0;
    vi.spyOn(core, "readCoreMaintenance").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(companySkills).set({ reviewPolicy: { reviewIntervalDays: 90, stewardUserId: null } }).where(eq(companySkills.id, skill.id));
      return result;
    });
    const result = await experienceService(db).home(fixture.actor, fixture.home);
    expect(result.needsYou.filter(card => card.source.domain === "company_skill")).toEqual([]);
    expect(result.dependencies.find(entry => entry.domain === "core-maintenance")).toMatchObject({ state: "partial", reason: "source_stale" });
    vi.restoreAllMocks();
    for (let index = 0; index < 6; index++) await procedure();
    const bounded = await read(); expect(bounded.needsYou).toHaveLength(5);
    expect(bounded.coverage?.reason).toBe("more_items_available");
  });
  it("preserves Native rollout dependency validation and refuses a closed rollout", async () => {
    await procedure(); await playbook();
    await expect(instanceSettingsService(db).updateExperimental({ skill_lifecycle_v5: false, playbooks_v5: false })).rejects.toMatchObject({ status: 400 });
    expect((await read()).needsYou).toHaveLength(2);
    await instanceSettingsService(db).updateExperimental(Object.fromEntries(
      [...V5_FEATURE_KEYS, ...V6_FEATURE_KEYS, ...V7_FEATURE_KEYS, ...V9_FEATURE_KEYS].map(key => [key, false])));
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
});
