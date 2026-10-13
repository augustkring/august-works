import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, agents, authUsers, companyMemberships, createDb, heartbeatRuns, issues,
  memoryDeletionMarkers, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts } from "@paperclipai/db";
import { readOrchestrationExperience } from "../services/experience/orchestration-experience.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("V9 work coordination reads the Original plan and current sources", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, task: typeof issues.$inferSelect, planId: string;
  const view = () => readOrchestrationExperience(db, f.actor, f.home);
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-orchestration-experience-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, progressive_shell_v9: true,
      enableWorkflowsV1: true, orchestration_v7: true, readiness_engine_v7: true, role_packs_v5: false, skill_resolver_v5: false });
    f = await seedV5Presences(db);
    [task] = await db.insert(issues).values({ companyId: f.home, title: "Prepare bounded work", status: "todo", assigneeAgentId: f.presence.id }).returning() as [typeof task];
    const saved = await orchestrationService(db).create(f.actor, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
      riskClass: "C0", workload: "semantic", completionContract: { objective: "PRIVATE internal objective", requiredOutputs: [{ key: "result" }],
        businessInvariants: ["PRIVATE invariant; preserve Source authorization"] }, budgets: {}, workers: [{ key: "worker", issueId: task.id }] });
    planId = saved.id;
  });
  it("projects current Native status and administrator limits without private contracts, writes or model calls", async () => {
    const before = await db.select().from(activityLog).where(eq(activityLog.companyId, f.home));
    const result = await view();
    expect(result).toMatchObject({ companyId: f.home, coverage: "bounded", modelCalled: false, canInspect: true,
      rows: [{ id: planId, taskId: task.id, taskTitle: task.title, status: "draft", version: 1, owner: { id: f.presence.id, name: "Fox" },
        inspection: { mode: "single_worker", workers: [{ number: 1, taskId: task.id, agent: { id: f.presence.id, name: "Fox" }, status: "waiting", dependsOn: [], attemptsRecorded: 0 }] } }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|completionContract|workerKey|prompt|executionManifest|credentials/);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, f.home))).toEqual(before);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([]);
  });
  it("shows a member recorded ownership/status while withholding administrator topology and limits", async () => {
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, f.home),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, f.userId)));
    expect(await view()).toMatchObject({ canInspect: false, rows: [{ id: planId, inspection: null, owner: { id: f.presence.id } }] });
  });
  it("requires the current verified account and actual membership, ignoring instance-admin elevation", async () => {
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(view()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, f.userId));
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId),
      eq(companyMemberships.principalType, "user")));
    await expect(readOrchestrationExperience(db, { ...f.actor, isInstanceAdmin: true }, f.home)).rejects.toMatchObject({ status: 403 });
  });
  it("withdraws the projection on a feature rollback without mutating the Original plan", async () => {
    await instanceSettingsService(db).updateExperimental({ progressive_shell_v9: false });
    await expect(view()).rejects.toMatchObject({ status: 404 });
    expect(await orchestrationService(db).get(f.actor, f.home, planId)).toMatchObject({ id: planId, status: "draft" });
    expect(() => readOrchestrationExperience(db, { type: "board", source: "local_implicit", userId: "local-board" }, f.home)).toThrow();
  });
  it("excludes a plan whose bound attempt source was erased without inventing physical plan deletion", async () => {
    const [worker] = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.planId, planId));
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", contextSnapshot: { issueId: task.id } }).returning();
    await db.insert(orchestrationWorkerAttempts).values({ companyId: f.home, planId, workerId: worker!.id,
      agentId: f.presence.id, runId: run!.id, attempt: 1 });
    await db.transaction(async raw => {
      const tx = raw as unknown as typeof db; await lockAnalyticalCompany(tx, f.home); await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${run!.id}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [run!.id] });
    });
    expect(await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, planId))).toEqual([expect.objectContaining({ erasedAt: null, status: "draft" })]);
    await expect(orchestrationService(db).get(f.actor, f.home, planId)).rejects.toMatchObject({ status: 403 });
    expect(await view()).toMatchObject({ rows: [], hasMore: false, coverage: "bounded" });
  });
  it("preserves a missing task owner while showing only the Native recorded worker assignment", async () => {
    await db.update(issues).set({ assigneeAgentId: null }).where(eq(issues.id, task.id));
    expect(await view()).toMatchObject({ rows: [{ owner: null, helpers: [{ id: f.presence.id, name: "Fox" }], inspection: { workers: [{ agent: { id: f.presence.id } }] } }] });
    expect(await db.select().from(agents).where(eq(agents.companyId, f.home))).toHaveLength(1);
  });
});
