import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, agents, authUsers, companyMemberships, createDb, heartbeatRuns, issues,
  memoryDeletionMarkers, supervisionInterventions, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts } from "@paperclipai/db";
import { readOrchestrationExperience } from "../services/experience/orchestration-experience.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { orchestrationControlExperienceService } from "../services/experience/orchestration-control.js";
import { supervisionService } from "../services/supervision/supervision-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("V9 work coordination reads the Original plan and current sources", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, task: typeof issues.$inferSelect, planId: string;
  const view = () => readOrchestrationExperience(db, f.actor, f.home);
  const controls = () => orchestrationControlExperienceService(db);
  const command = (action: "pause" | "cancel" = "cancel", expectedVersion = 1) => ({ requestId: randomUUID(), action,
    expectedVersion, rationale: "Explicitly stop this bounded software fixture", acknowledgeCompletedEffectsRemain: true });
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
    // Control authority survives payload withdrawal, without restoring the
    // erased attempt or making private execution evidence readable again.
    expect(await controls().get(f.actor, f.home, planId)).toMatchObject({ status: "draft", canStop: true });
    expect(await controls().request(f.actor, f.home, planId, command())).toMatchObject({ resultingVersion: 2, action: "cancel" });
    await expect(orchestrationService(db).get(f.actor, f.home, planId)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves a missing task owner while showing only the Native recorded worker assignment", async () => {
    await db.update(issues).set({ assigneeAgentId: null }).where(eq(issues.id, task.id));
    expect(await view()).toMatchObject({ rows: [{ owner: null, helpers: [{ id: f.presence.id, name: "Fox" }], inspection: { workers: [{ agent: { id: f.presence.id } }] } }] });
    expect(await db.select().from(agents).where(eq(agents.companyId, f.home))).toHaveLength(1);
  });
  it("requests one Native Stop under concurrency and replays only its body-free receipt", async () => {
    const input = command(), service = controls();
    const [a, b] = await Promise.all([service.request(f.actor, f.home, planId, input), service.request(f.actor, f.home, planId, input)]);
    expect(a).toEqual(b); expect(a).toMatchObject({ requestId: input.requestId, resultingVersion: 2, action: "cancel",
      disposition: "control_requested", propagation: "pending_verification" });
    expect(await service.get(f.actor, f.home, planId)).toMatchObject({ status: "cancelled", version: 2, canStop: false });
    expect(await db.select().from(supervisionInterventions).where(eq(supervisionInterventions.planId, planId))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, planId), eq(activityLog.action, "orchestration.experience_control_requested")))).toHaveLength(1);
    expect(await service.receipt(f.actor, f.home, planId, input.requestId)).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/PRIVATE|rationale|budget|worker|manifest/);
    await expect(service.request(f.actor, f.home, planId, { ...input, rationale: "A different request with the same identity" })).rejects.toMatchObject({ status: 409 });
  });
  it("keeps minimal control and Original receipts available through complete experience/orchestration rollback", async () => {
    const input = command("pause"), service = controls(), receipt = await service.request(f.actor, f.home, planId, input);
    await instanceSettingsService(db).updateExperimental({ progressive_shell_v9: false, orchestration_v7: false });
    expect(await service.get(f.actor, f.home, planId)).toMatchObject({ version: 2, status: "paused", canPause: false, canStop: true });
    expect(await service.receipt(f.actor, f.home, planId, input.requestId)).toEqual(receipt);
    expect(await service.request(f.actor, f.home, planId, command("cancel", 2))).toMatchObject({ resultingVersion: 3 });
    expect(await service.receipt(f.actor, f.home, planId, input.requestId)).toEqual(receipt);
  });
  it("delivers the Original Stop outbox to a queued Native run after rollout withdrawal without replaying control", async () => {
    const [worker] = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.planId, planId));
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
      invocationSource: "on_demand", status: "queued", contextSnapshot: { issueId: worker!.issueId } }).returning();
    await db.insert(orchestrationWorkerAttempts).values({ companyId: f.home, planId, workerId: worker!.id,
      agentId: f.presence.id, runId: run!.id, attempt: 1, status: "running" });
    const input = command(), receipt = await controls().request(f.actor, f.home, planId, input);
    await instanceSettingsService(db).updateExperimental({ progressive_shell_v9: false, orchestration_v7: false, supervision_v7: false });
    const delivery = supervisionService(db);
    expect(await delivery.deliverStops(20, f.home)).toMatchObject({ applied: 1, failed: 0 });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id))).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([{ id: run!.id }]);
    expect(await delivery.deliverStops(20, f.home)).toMatchObject({ applied: 0, failed: 0 });
    expect(await controls().request(f.actor, f.home, planId, input)).toEqual(receipt);
    expect(await db.select().from(supervisionInterventions).where(eq(supervisionInterventions.planId, planId))).toEqual([expect.objectContaining({ status: "applied", attempts: 1 })]);
    // Actual Native queue cancellation is software evidence, not a live adapter
    // process/channel or reversible-completed-effect qualification.
    expect(receipt.propagation).toBe("pending_verification");
  });
  it("refuses member controls, stale reviews and missing receipt inference without changing Native state", async () => {
    const service = controls();
    await expect(service.request(f.actor, f.home, planId, command("cancel", 99))).rejects.toMatchObject({ status: 409 });
    await expect(service.receipt(f.actor, f.home, planId, randomUUID())).rejects.toMatchObject({ status: 404 });
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, f.home),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, f.userId)));
    await expect(service.get(f.actor, f.home, planId)).rejects.toMatchObject({ status: 403 });
    await expect(service.request(f.actor, f.home, planId, command())).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, planId))).toEqual([expect.objectContaining({ status: "draft", version: 1 })]);
    expect(await db.select().from(supervisionInterventions).where(eq(supervisionInterventions.planId, planId))).toEqual([]);
  });
  it("rolls back plan, Native outbox and both journals after late administrative withdrawal", async () => {
    await db.execute(sql`create function aw_v9_test_withdraw_plan_controller() returns trigger language plpgsql as $$
      begin if NEW.action='orchestration.experience_control_requested' then
        update company_memberships set membership_role='member' where company_id=NEW.company_id
          and principal_type='user' and principal_id=NEW.actor_id; end if; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_plan_controller after insert on activity_log
      for each row execute function aw_v9_test_withdraw_plan_controller()`);
    try {
      await expect(controls().request(f.actor, f.home, planId, command())).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, planId))).toEqual([expect.objectContaining({ status: "draft", version: 1 })]);
      expect(await db.select().from(supervisionInterventions).where(eq(supervisionInterventions.planId, planId))).toEqual([]);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, planId), sql`${activityLog.action} in ('orchestration.cancel_requested','orchestration.experience_control_requested')`))).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_late_plan_controller on activity_log`);
      await db.execute(sql`drop function aw_v9_test_withdraw_plan_controller()`);
    }
  });
});
