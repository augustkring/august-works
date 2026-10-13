import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, authUsers, companyMemberships, createDb, instanceSettings, principalPermissionGrants,
  workflowRevisions, workflowRuns, workflows, workflowWaits } from "@paperclipai/db";
import { V5_FEATURE_KEYS, V6_FEATURE_KEYS, V7_FEATURE_KEYS, V9_FEATURE_KEYS } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readWorkflowRecovery } from "../services/experience/workflow-recovery.js";
import { experienceService } from "../services/experience/service.js";
import * as recovery from "../services/experience/workflow-recovery.js";
import * as copiedSource from "../services/analytical-context-authority.js";
import { forbidden } from "../errors.js";

describe("V9 current Original workflow recovery projection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof seedV5Companies>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-workflow-recovery-"); db = createDb(database.connectionString);
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
  const read = () => readWorkflowRecovery(db, fixture.actor, fixture.home, new AbortController().signal);
  async function run(status = "failed", companyId = fixture.home, source = "manual") {
    return db.transaction(async tx => {
    const [workflow] = await tx.insert(workflows).values({ companyId, name: "PRIVATE-WORKFLOW-NAME" }).returning();
    const [revision] = await tx.insert(workflowRevisions).values({ companyId, workflowId: workflow!.id, revisionNumber: 1,
      state: "published", graph: { version: 1, nodes: [], edges: [] } }).returning();
    await tx.update(workflows).set({ publishedRevisionId: revision!.id }).where(eq(workflows.id, workflow!.id));
    const [row] = await tx.insert(workflowRuns).values({ companyId, workflowId: workflow!.id, workflowRevisionId: revision!.id,
      status, source, finishedAt: ["failed", "succeeded", "cancelled"].includes(status) ? new Date() : null, triggerPayload: { token: "PRIVATE-TRIGGER" }, failureMessage: "PRIVATE-FAILURE", failureCode: "PRIVATE-CODE" }).returning();
    return row!;
    });
  }
  async function humanWait(row: Awaited<ReturnType<typeof run>>) {
    const [wait] = await db.insert(workflowWaits).values({ companyId: row.companyId, workflowRunId: row.id,
      nodeId: "human", waitKey: "human", kind: "human_interaction", status: "active" }).returning();
    return wait!;
  }
  it("projects current owned failures/recovery/human waits, labels test runs and makes no repair effects", async () => {
    const failed = await run(), recovering = await run("recovering"), waiting = await run("waiting", fixture.home, "test");
    await humanWait(waiting); await run("waiting"); await run("succeeded"); await run("failed", fixture.guest);
    const archived = await run(); await db.update(workflows).set({ status: "archived", archivedAt: new Date() }).where(eq(workflows.id, archived.workflowId));
    const before = await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, fixture.home));
    const logs = await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home));
    const result = await read();
    expect(result.needsYou.map(card => card.source.resourceId).sort()).toEqual([failed.id, recovering.id, waiting.id].sort());
    expect(result.needsYou.find(card => card.source.resourceId === waiting.id)?.evidence).toEqual(["workflow_test_run", "workflow_waiting"]);
    expect(result.needsYou.find(card => card.source.resourceId === failed.id)?.actions[0]?.href).toBe(`/workflows/${failed.workflowId}/runs/${failed.id}`);
    expect(result.needsYou.every(card => card.actions.every(action => action.operation === "open" && action.criticality === "C4"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, fixture.home))).toEqual(before);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home))).toEqual(logs);
  });
  it("requires current native workflows:read even for an instance admin", async () => {
    await run();
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "workflows:read")));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await expect(readWorkflowRecovery(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home, new AbortController().signal))
      .rejects.toMatchObject({ status: 403 });
  });
  it("withdraws unverified accounts, inactive membership and disabled workflow rollout", async () => {
    await run(); await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, fixture.userId));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, fixture.userId));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await db.update(instanceSettings).set({ experimental: { enableWorkflowsV1: false } }).where(eq(instanceSettings.singletonKey, "default"));
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
  it("keeps the original copied-payload source owner in the read path and fails closed on its refusal", async () => {
    await run(); const owner = vi.spyOn(copiedSource, "assertLearnedWorkflowPayloadAccess").mockRejectedValue(forbidden("PRIVATE-SOURCE-REFUSAL"));
    await expect(read()).rejects.toMatchObject({ status: 403 }); expect(owner).toHaveBeenCalledOnce();
    const actor = owner.mock.calls[0]![2]; expect(actor).toMatchObject({ userId: fixture.userId, ignoreInstanceAdmin: true, isInstanceAdmin: false });
  });
  it("bounds findings and binds current run and human wait state to the source version", async () => {
    const row = await run("waiting"), wait = await humanWait(row), first = (await read()).needsYou[0]!.source.version;
    await db.update(workflowWaits).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(workflowWaits.id, wait.id));
    expect((await read()).needsYou[0]!.source.version).not.toBe(first);
    await db.update(workflowWaits).set({ status: "cancelled", resolvedAt: new Date(), resolvedByType: "user", resolvedById: fixture.userId })
      .where(eq(workflowWaits.id, wait.id));
    expect((await read()).needsYou).toHaveLength(0);
    for (let index = 0; index < 6; index++) await run();
    const value = await read(); expect(value.needsYou).toHaveLength(5); expect(value.coverage?.reason).toBe("more_items_available");
  });
  it("withdraws a recovered run after experience fan-out", async () => {
    const row = await run(), real = recovery.readWorkflowRecovery; let calls = 0;
    vi.spyOn(recovery, "readWorkflowRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(workflowRuns).set({ status: "succeeded", updatedAt: new Date() }).where(eq(workflowRuns.id, row.id));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "workflow" && card.kind === "recovery")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "workflow-recovery")).toMatchObject({ state: "partial", reason: "source_stale" });
  });
  it("withdraws findings when native read authority is revoked during fan-out", async () => {
    await run(); const real = recovery.readWorkflowRecovery; let calls = 0;
    vi.spyOn(recovery, "readWorkflowRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
        eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "workflows:read")));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "workflow" && card.kind === "recovery")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "workflow-recovery")).toMatchObject({ state: "partial", reason: "denied" });
  });
});
