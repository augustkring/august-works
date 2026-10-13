import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, companyMemberships, createDb, heartbeatRuns, memoryDeletionMarkers, principalPermissionGrants,
  workflowRevisions, workflowRuns } from "@paperclipai/db";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowRunControlSchema } from "@paperclipai/shared";
import { enqueueWorkflowRunInTransaction, workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { workflowRoutes } from "../routes/workflows.js";

describe("V9 retained workflow run controls keep the Original cancellation and Source owners", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>,
    f: Awaited<ReturnType<typeof seedV5Presences>>, run: typeof workflowRuns.$inferSelect;
  const executor = () => workflowExecutorService(db);
  const command = () => ({ requestId: randomUUID(), expectedWorkflowId: run.workflowId, expectedRevisionId: run.workflowRevisionId,
    expectedUpdatedAt: run.updatedAt.toISOString(), acknowledgeCompletedEffectsRemain: true as const });
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-retained-workflow-control-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db); }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true });
    f = await seedV5Presences(db);
    const native = { principal: { type: "user" as const, userId: f.userId } }, service = workflowService(db);
    const draft = await service.create(f.home, { name: "PRIVATE retained control fixture" }, native);
    const saved = await service.updateDraft(f.home, draft.id, { expectedRevisionId: draft.draftRevisionId!,
      graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "PRIVATE internal start", config: {}, position: { x: 0, y: 0 } }],
        edges: [], variables: [], settings: { totalDeadlineSeconds: 60 } } }, native);
    const published = await service.publish(f.home, draft.id, { expectedDraftRevisionId: saved.draftRevisionId!, expectedPublishedRevisionId: null }, native);
    run = (await db.transaction(tx => enqueueWorkflowRunInTransaction(tx as unknown as typeof db, { companyId: f.home, workflowId: draft.id,
      revisionId: published.publishedRevisionId!, nodeId: "start", source: "manual", triggerPayload: { private: "PRIVATE input" },
      responsibleUserId: f.userId, idempotencyKey: randomUUID(), correlationId: randomUUID(), actor: native }))).run;
  });
  it("admits one Original cancellation after rollout withdrawal and recovers only the exact own receipt", async () => {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: false, enableWorkflowBuilderV1: false, progressive_shell_v9: false });
    const service = executor(), input = command();
    const view = await service.retainedRunControl(f.home, run.id, f.actor);
    expect(view).toMatchObject({ runId: run.id, workflowId: run.workflowId, canRequestStop: true, purpose: "live" });
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|triggerPayload|output|graph|instructions/);
    const [a, b] = await Promise.all([service.stopRetainedRun(f.home, run.id, input, f.actor), service.stopRetainedRun(f.home, run.id, input, f.actor)]);
    expect(a).toEqual(b); expect(a.disposition).toBe("cancellation_requested");
    expect(await service.retainedStopReceipt(f.home, run.id, input.requestId, f.actor)).toEqual(a);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, run.id), eq(activityLog.action, "workflow.customer_stop_admitted")))).toHaveLength(1);
    expect(await service.retainedRunControl(f.home, run.id, f.actor)).toMatchObject({ status: "cancelled", canRequestStop: false });
    await expect(service.stopRetainedRun(f.home, run.id, { ...input, expectedUpdatedAt: new Date().toISOString() }, f.actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.retainedStopReceipt(f.home, run.id, randomUUID(), f.actor)).rejects.toMatchObject({ status: 404 });
  });
  it.each(["session", "local_implicit"] as const)("cancels an actual waiting Native timer with rollout closed for %s", async source => {
    const actor = { principal: { type: "user" as const, userId: f.userId } }, service = workflowService(db);
    const current = (await service.getDetail(f.home, run.workflowId, f.actor))!;
    const saved = await service.updateDraft(f.home, current.id, { expectedRevisionId: current.draftRevisionId!, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", config: {}, position: { x: 0, y: 0 } },
        { id: "wait", type: "core.wait", name: "Wait", config: { durationSeconds: 300 }, position: { x: 0, y: 1 } }],
      edges: [{ id: "start-wait", source: "start", target: "wait" }], variables: [], settings: { totalDeadlineSeconds: 600 } } }, actor);
    const published = await service.publish(f.home, current.id, { expectedDraftRevisionId: saved.draftRevisionId!, expectedPublishedRevisionId: current.publishedRevisionId }, actor);
    run = (await db.transaction(tx => enqueueWorkflowRunInTransaction(tx as unknown as typeof db, { companyId: f.home, workflowId: current.id,
      revisionId: published.publishedRevisionId!, nodeId: "start", source: "manual", triggerPayload: {}, responsibleUserId: f.userId,
      idempotencyKey: randomUUID(), correlationId: randomUUID(), actor }))).run;
    const waiting = await executor().executeQueuedRun(f.home, run.id, actor);
    expect(waiting?.run.status).toBe("waiting");
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: false, enableWorkflowBuilderV1: false, progressive_shell_v9: false });
    const controller = source === "session" ? f.actor : { type: "board" as const, source: "local_implicit" as const };
    const control = workflowRunControlSchema.parse(await executor().retainedRunControl(f.home, run.id, controller));
    const input = { ...command(), expectedUpdatedAt: control.updatedAt };
    if (source === "local_implicit") {
      let failure: unknown;
      const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { ...controller, userId: "local-board", isInstanceAdmin: true }; next(); });
      app.use("/api", workflowRoutes(db));
      app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { failure = error; res.status(500).json({ error: "controlled fixture failure" }); });
      const response = await request(app).post(`/api/companies/${f.home}/workflow-runs/${run.id}/experience/retained-stop?expectedUserId=local-board`).send(input);
      if (failure) throw failure;
      expect(response.status).toBe(200); expect(response.body).toMatchObject({ disposition: "cancellation_requested" });
    } else expect(await executor().stopRetainedRun(f.home, run.id, input, controller)).toMatchObject({ disposition: "cancellation_requested" });
    expect(await executor().retainedRunControl(f.home, run.id, controller)).toMatchObject({ status: "cancelled" });
  });
  it("keeps opaque control available after actual Native copied-payload erasure without restoring private payloads", async () => {
    // A declared software lineage fixture, not a claim that a real model wrote
    // this revision. Actual Native markers/purge/current-source readers apply.
    const [source] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "succeeded", startedAt: new Date(), finishedAt: new Date() }).returning();
    // Establish lineage through the Original creator/revision writer before
    // publication. Published snapshot provenance remains immutable.
    const actor = { principal: { type: "user" as const, userId: f.userId }, runId: source!.id }, service = workflowService(db);
    const draft = await service.create(f.home, { name: "PRIVATE source-bound flow" }, actor);
    const saved = await service.updateDraft(f.home, draft.id, { expectedRevisionId: draft.draftRevisionId!, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "PRIVATE source step", config: {}, position: { x: 0, y: 0 } }],
      edges: [], variables: [], settings: { totalDeadlineSeconds: 60 } } }, actor);
    const published = await service.publish(f.home, draft.id, { expectedDraftRevisionId: saved.draftRevisionId!, expectedPublishedRevisionId: null }, actor);
    run = (await db.transaction(tx => enqueueWorkflowRunInTransaction(tx as unknown as typeof db, { companyId: f.home, workflowId: draft.id,
      revisionId: published.publishedRevisionId!, nodeId: "start", source: "manual", triggerPayload: { private: "PRIVATE source copy" },
      responsibleUserId: f.userId, idempotencyKey: randomUUID(), correlationId: randomUUID(), actor }))).run;
    await db.transaction(async raw => {
      const tx = raw as unknown as typeof db; await lockAnalyticalCompany(tx, f.home); await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${source!.id}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [run.workflowRevisionId], artifactVersionIds: [], runIds: [source!.id] });
    });
    const erased = await executor().getRun(f.home, run.id, f.actor);
    expect(erased?.run.triggerPayload).toEqual({});
    expect(JSON.stringify(erased)).not.toContain("PRIVATE source copy");
    const control = workflowRunControlSchema.parse(await executor().retainedRunControl(f.home, run.id, f.actor));
    expect(control).toMatchObject({ canRequestStop: true });
    const receipt = await executor().stopRetainedRun(f.home, run.id, { ...command(), expectedUpdatedAt: control.updatedAt }, f.actor);
    expect(receipt.disposition).toBe("cancellation_requested");
    expect((await executor().getRun(f.home, run.id, f.actor))?.run.triggerPayload).toEqual({});
    expect(JSON.stringify(await executor().retainedRunControl(f.home, run.id, f.actor))).not.toMatch(/PRIVATE|triggerPayload|output|graph/);
  });
  it("refuses stale review, viewer and non-responsible non-manager control without cancellation", async () => {
    await expect(executor().stopRetainedRun(f.home, run.id, { ...command(), expectedUpdatedAt: "2026-01-01T00:00:00Z" }, f.actor)).rejects.toMatchObject({ status: 409 });
    const userId = randomUUID();
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: userId, membershipRole: "member", status: "active" });
    for (const permissionKey of ["workflows:read", "workflows:run"] as const) await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: userId, permissionKey });
    await expect(executor().retainedRunControl(f.home, run.id, { type: "board", source: "session", userId, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(executor().stopRetainedRun(f.home, run.id, command(), f.actor)).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))).toEqual([expect.objectContaining({ status: "queued" })]);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, run.id), eq(activityLog.action, "workflow.customer_stop_admitted")))).toEqual([]);
  });
  it("rolls back cancellation and the Original receipt after late write-role withdrawal", async () => {
    await db.execute(sql`create function aw_v9_test_withdraw_retained_workflow_control() returns trigger language plpgsql as $$
      begin if NEW.action='workflow.customer_stop_admitted' then update company_memberships set membership_role='viewer'
        where company_id=NEW.company_id and principal_type='user' and principal_id=NEW.actor_id; end if; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_retained_workflow_control after insert on activity_log
      for each row execute function aw_v9_test_withdraw_retained_workflow_control()`);
    try {
      await expect(executor().stopRetainedRun(f.home, run.id, command(), f.actor)).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))).toEqual([expect.objectContaining({ status: "queued" })]);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, run.id), eq(activityLog.action, "workflow.customer_stop_admitted")))).toEqual([]);
    } finally { await db.execute(sql`drop trigger aw_v9_test_late_retained_workflow_control on activity_log`);
      await db.execute(sql`drop function aw_v9_test_withdraw_retained_workflow_control()`); }
  });
});
