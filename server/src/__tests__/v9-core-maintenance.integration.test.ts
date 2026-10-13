import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, agents, authUsers, companyMemberships, createDb, instanceSettings, knowledgeQualityFindings,
  principalPermissionGrants, readinessAssessments } from "@paperclipai/db";
import { V5_FEATURE_KEYS, V6_FEATURE_KEYS, V7_FEATURE_KEYS, V9_FEATURE_KEYS } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { evaluateReadiness, mandatoryReadinessPolicy } from "../services/readiness/readiness-policy.js";
import { readCoreMaintenance } from "../services/experience/core-maintenance.js";
import { experienceService } from "../services/experience/service.js";
import * as core from "../services/experience/core-maintenance.js";

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
});
