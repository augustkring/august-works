import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, authUsers, companyMemberships, createDb, heartbeatRuns, issues, memoryDeletionMarkers,
  principalPermissionGrants, workflowRevisions, workflowRuns, workflowStepRuns, workflows, workflowWaits } from "@paperclipai/db";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { workflowAuthoringToolsService } from "../services/workflows/workflow-authoring-tools.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";

describe.sequential("Original workflow private authoring copy owner", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, source: typeof issues.$inferSelect, origin: typeof heartbeatRuns.$inferSelect;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-workflow-source-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 120_000);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  beforeEach(async () => {
    f = await seedV5Presences(db);
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true, enableAiWorkflowAuthoring: true, enableAgentChat: true });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit", "workflows:publish", "workflows:run"].flatMap(permissionKey => [
      { companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey },
      { companyId: f.home, principalType: "user", principalId: f.userId, permissionKey },
    ])).onConflictDoNothing();
    source = await issueService(db).create(f.home, { title: "PRIVATE source", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review", createdByUserId: f.userId });
    [origin] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", contextSnapshot: { issueId: source.id, conversationSessionGeneration: 0 } }).returning();
  });
  const human = () => ({ principal: { type: "user" as const, userId: f.userId } });
  async function authored() {
    return (await workflowAuthoringToolsService(db).create({ companyId: f.home, agentId: f.presence.id, runId: origin.id },
      { name: "PRIVATE workflow", description: "PRIVATE described intent", idempotencyKey: randomUUID() })).workflow;
  }
  async function changedAndPublished(waitForCompletion = false) {
    const created = await authored(), owner = workflowService(db);
    const changed = await owner.updateDraft(f.home, created.id, { expectedRevisionId: created.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "task", type: "work.create_task", name: "PRIVATE task step", position: { x: 0, y: 1 }, config: {
          title: "PRIVATE copied task", description: "PRIVATE copied description", projectId: null,
          assigneeAgentId: null, assigneeUserId: f.userId, waitForCompletion } },
      ], edges: [{ id: "to-task", source: "start", target: "task" }], variables: [], settings: { totalDeadlineSeconds: 60 },
    } }, human());
    const published = await owner.publish(f.home, changed.id, { expectedDraftRevisionId: changed.draftRevisionId!, expectedPublishedRevisionId: null }, human());
    return { created, changed, published };
  }
  async function eraseSource() {
    await db.transaction(async raw => {
      const tx = raw as unknown as typeof db;
      await lockAnalyticalCompany(tx, f.home); await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${origin.id}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [origin.id] });
    });
  }
  it("retains exact source identities through Human changes and publication without exposing them in public details", async () => {
    const { created, changed, published } = await changedAndPublished();
    const [stored] = await db.select().from(workflows).where(eq(workflows.id, created.id));
    expect(stored!.authoringSourceRunIds).toEqual([origin.id]);
    expect(changed.draftRevisionId).not.toBe(created.draftRevisionId);
    expect(published.publishedRevisionId).toBe(changed.draftRevisionId);
    expect(published.draftRevision?.createdByRunId).toBeNull();
    const current = await workflowService(db).getDetail(f.home, created.id, f.actor);
    expect(current!.publishedRevision?.graph.nodes[1].name).toBe("PRIVATE task step");
    expect(current).not.toHaveProperty("authoringSourceRunIds");
    expect((await workflowService(db).list(f.home, f.actor)).map(item => item.id)).toContain(created.id);
    expect(await workflowService(db).list(f.home)).toEqual([]);
    await expect(workflowService(db).getDetail(f.home, created.id)).rejects.toMatchObject({ status: 403 });
  });
  it("requires the current owned source and verified account even for an instance-admin request snapshot", async () => {
    const created = await authored();
    await expect(workflowService(db).getDetail(f.home, created.id, { ...f.actor, userId: "different-human", isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(workflowService(db).getDetail(f.home, created.id, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("requires current Native workflow reading authority after a retained private revision was created", async () => {
    const created = await authored();
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
      eq(principalPermissionGrants.principalType, "user"), eq(principalPermissionGrants.principalId, f.userId),
      eq(principalPermissionGrants.permissionKey, "workflows:read")));
    await expect(workflowService(db).getDetail(f.home, created.id, f.actor)).rejects.toMatchObject({ status: 403 });
    expect(await workflowService(db).list(f.home, f.actor)).toEqual([]);
  });
  it("does not let an API key borrow a current Human from a real private authoring run", async () => {
    const created = await authored();
    await expect(workflowService(db).getDetail(f.home, created.id, { type: "agent", source: "agent_key", companyId: f.home,
      agentId: f.presence.id, runId: origin.id, onBehalfOfUserId: f.userId })).rejects.toMatchObject({ status: 403 });
  });
  it("erases published and later Human drafts and their actual Native task copies, retaining unavailable identities", async () => {
    const { published } = await changedAndPublished(), engine = workflowExecutorService(db);
    const admitted = await engine.startManualRun(f.home, published.id, { input: { privateInput: "PRIVATE input" } }, human(), randomUUID());
    const copies = await db.select().from(issues).where(and(eq(issues.companyId, f.home), eq(issues.originKind, "workflow_task")));
    expect(copies).toHaveLength(1); expect(copies[0].title).toBe("PRIVATE copied task");
    await eraseSource();
    const [root] = await db.select().from(workflows).where(eq(workflows.id, published.id));
    expect(root).toMatchObject({ name: "Source-erased workflow", description: null, status: "paused", publishedRevisionId: null, draftRevisionId: null,
      authoringSourceRunIds: [origin.id] });
    const revisions = await db.select().from(workflowRevisions).where(eq(workflowRevisions.workflowId, published.id));
    expect(revisions.length).toBeGreaterThan(2);
    for (const row of revisions) expect(row).toMatchObject({ graph: { version: 1, nodes: [], edges: [], variables: [], settings: {} }, inputSchema: null, outputSchema: null, changeSummary: null });
    const [task] = await db.select().from(issues).where(eq(issues.id, copies[0].id));
    expect(task).toMatchObject({ title: "Erased workflow task", description: null });
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id));
    expect(run!.triggerPayload).toEqual({});
    expect(JSON.stringify(await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, run!.id)))).not.toContain("PRIVATE");
    await expect(workflowService(db).getDetail(f.home, published.id, f.actor)).rejects.toMatchObject({ status: 403 });
    await expect(engine.getRun(f.home, run!.id, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("refuses dropping provenance and scrubs late/restored private workflow payloads after erasure", async () => {
    const { published } = await changedAndPublished();
    await expect(db.update(workflows).set({ authoringSourceRunIds: [] }).where(eq(workflows.id, published.id))).rejects.toBeTruthy();
    await eraseSource();
    await db.update(workflows).set({ name: "PRIVATE restored", description: "PRIVATE restored" }).where(eq(workflows.id, published.id));
    const [root] = await db.select().from(workflows).where(eq(workflows.id, published.id));
    expect(root!.name).toBe("Source-erased workflow"); expect(root!.description).toBeNull();
    const [original] = await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, published.publishedRevisionId!));
    await db.update(workflowRevisions).set({ graph: published.publishedRevision!.graph, changeSummary: "PRIVATE restore" }).where(eq(workflowRevisions.id, original!.id));
    expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, original!.id)))[0].graph.nodes).toEqual([]);
    await db.insert(activityLog).values({ companyId: f.home, actorType: "user", actorId: f.userId,
      action: "workflow.late_fixture", entityType: "workflow", entityId: root!.id, details: { body: "PRIVATE restore" } });
    expect((await db.select().from(activityLog).where(eq(activityLog.entityId, root!.id))).every(row => !JSON.stringify(row.details).includes("PRIVATE"))).toBe(true);
  });
  it("retains Original child cancellation through erasure and completes its software cleanup with rollout closed", async () => {
    const { published } = await changedAndPublished(true), engine = workflowExecutorService(db);
    const admitted = await engine.startManualRun(f.home, published.id, { input: {} }, human(), randomUUID());
    expect(admitted.run.status).toBe("waiting");
    const childId = admitted.waits.find(wait => wait.referenceType === "issue")!.referenceId!;
    await instanceSettingsService(db).updateExperimental({ enableAiWorkflowAuthoring: false, enableWorkflowBuilderV1: false,
      enableWorkflowsV1: false, progressive_shell_v9: false, experience_projection_v9: false });
    await eraseSource();
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id)))[0].status).toBe("cancelling");
    const [wait] = await db.select().from(workflowWaits).where(eq(workflowWaits.workflowRunId, admitted.run.id));
    expect(wait).toMatchObject({ status: "cancelled", resolutionJson: { parentCancellation: true, errorCode: "workflow_parent_cancelled" } });
    const result = await engine.recoverExpiredRuns(100, new Date(), { cancellationOnly: true });
    expect(result.failedRunIds).toEqual([]); expect(result.recovered).toBeGreaterThan(0);
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id)))[0].status).toBe("cancelled");
    expect((await db.select().from(issues).where(eq(issues.id, childId)))[0]).toMatchObject({ status: "cancelled", description: null });
    await db.update(workflowWaits).set({ resolutionJson: { privateValue: "PRIVATE restored" } }).where(eq(workflowWaits.id, wait.id));
    expect((await db.select().from(workflowWaits).where(eq(workflowWaits.id, wait.id)))[0].resolutionJson).toEqual({ parentCancellation: true, errorCode: "workflow_parent_cancelled" });
  });
  it("cancels the actual queued Native child without promoting a replacement heartbeat after source erasure", async () => {
    const { published } = await changedAndPublished(true), engine = workflowExecutorService(db);
    const admitted = await engine.startManualRun(f.home, published.id, { input: {} }, human(), randomUUID());
    const childId = admitted.waits.find(wait => wait.referenceType === "issue")!.referenceId!;
    // The fixture controls queue admission; cancellation/recovery below uses
    // the actual Native heartbeat service, not a mocked cancelRun implementation.
    const [child] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
      responsibleUserId: f.userId, invocationSource: "on_demand", status: "queued", contextSnapshot: { issueId: childId } }).returning();
    await db.update(issues).set({ assigneeAgentId: f.presence.id, assigneeUserId: null, executionRunId: child.id,
      executionAgentId: f.presence.id }).where(eq(issues.id, childId));
    await db.update(workflowStepRuns).set({ heartbeatRunId: child.id }).where(and(eq(workflowStepRuns.workflowRunId, admitted.run.id), eq(workflowStepRuns.nodeId, "task")));
    await eraseSource();
    const result = await engine.recoverExpiredRuns(100, new Date(), { cancellationOnly: true });
    expect(result.failedRunIds).toEqual([]);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, child.id)))[0].status).toBe("cancelled");
    expect((await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).map(row => row.id).sort())
      .toEqual([origin.id, child.id].sort());
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id)))[0].status).toBe("cancelled");
  });
  it("keeps a permanent deletion marker when the private Native workflow itself is removed", async () => {
    const created = await authored();
    await db.delete(workflows).where(eq(workflows.id, created.id));
    await db.insert(workflows).values({ id: created.id, companyId: f.home, name: "PRIVATE restore", description: "PRIVATE restore", authoringSourceRunIds: [] });
    const [restored] = await db.select().from(workflows).where(eq(workflows.id, created.id));
    expect(restored).toMatchObject({ name: "Source-erased workflow", description: null, status: "paused" });
    const [receipt] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_authoring_source_erased(${f.home}::uuid,${created.id}::uuid) as erased`);
    expect(receipt.erased).toBe(true);
  });
});
