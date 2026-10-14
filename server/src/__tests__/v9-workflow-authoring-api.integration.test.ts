import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, authUsers, companyMemberships, createDb, heartbeatRuns, issues, principalPermissionGrants,
  workflows, workflowRevisions, workflowRuns } from "@paperclipai/db";
import { workflowAuthoringApiCommandSchema } from "@paperclipai/shared";
import { workflowRoutes } from "../routes/workflows.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { executeRunnerApi, validateRunnerApiCall } from "../services/native-runtime/runner-api-client.js";
import { searchRunnerApi } from "../services/native-runtime/runner-api-catalog.js";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe.sequential("Native workflow authoring API keeps the Original typed SDK boundary", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, conversation: typeof issues.$inferSelect, run: typeof heartbeatRuns.$inferSelect;
  let actor: Express.Request["actor"], server: Server | undefined;
  const operationId = "POST /api/companies/{companyId}/workflow-authoring";
  const path = () => `/api/companies/${f.home}/workflow-authoring`;
  const app = () => {
    const instance = express(); instance.use(express.json());
    // Authenticated-actor fixture. Real JWT signature/provider qualification is
    // separate; all authoring, relationship and V5 checks below are Native.
    instance.use((req, _res, next) => { req.actor = actor; next(); });
    instance.use("/api", workflowRoutes(db)); instance.use(errorHandler); return instance;
  };
  const create = (key = randomUUID()) => ({ operation: "create_workflow", input: { name: "Weekly follow-up", idempotencyKey: key } });
  const call = (body: unknown) => request(app()).post(path()).send(body);
  const owned = () => db.select().from(workflows).where(eq(workflows.companyId, f.home));
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-workflow-api-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 120_000);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } });
  beforeEach(async () => {
    f = await seedV5Presences(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
      enableAiWorkflowAuthoring: true, enableAgentChat: true });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit", "workflows:publish"].flatMap(permissionKey => [
      { companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey },
      { companyId: f.home, principalType: "user", principalId: f.userId, permissionKey },
    ])).onConflictDoNothing();
    conversation = await issueService(db).create(f.home, { title: "PRIVATE described intent", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review", createdByUserId: f.userId });
    [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", runtimeMode: "native", nativeIssueId: conversation.id,
      contextSnapshot: { issueId: conversation.id, conversationSessionGeneration: conversation.conversationSessionGeneration } }).returning();
    await db.update(issues).set({ executionRunId: run.id }).where(eq(issues.id, conversation.id));
    actor = { type: "agent", source: "agent_jwt", companyId: f.home, agentId: f.presence.id, runId: run.id, onBehalfOfUserId: f.userId };
  });
  it("discovers and transports typed draft authoring through Native call_api and previews the actual saved revision", async () => {
    const discovered = searchRunnerApi({ query: operationId });
    expect(discovered.results).toHaveLength(1);
    expect(discovered.results[0]).toMatchObject({ operationId, callPolicy: "rest", authorization: { actor: "agent", heartbeatBound: true } });
    expect(discovered.results[0]!.requestBody).toBeDefined();
    server = app().listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Local HTTP fixture unavailable");
    const io = { apiUrl: `http://127.0.0.1:${address.port}`, token: "authenticated-actor-fixture",
      readFile: async () => { throw new Error("No file channel"); }, saveResponse: async () => { throw new Error("Expected bounded inline result"); } };
    const context = { companyId: f.home, issueId: conversation.id, runId: run.id, workMode: "standard" };
    const created = await executeRunnerApi({ operationId, body: create() }, context, io);
    expect(created).toMatchObject({ ok: true, status: 200, data: { status: "created", workflow: { publishedRevisionId: null } } });
    let workflow = (created.data as { workflow: { id: string; draftRevisionId: string } }).workflow;
    const mutate = async (operation: string, input: Record<string, unknown>) => {
      const response = await call({ operation, input }); expect(response.status, JSON.stringify(response.body)).toBe(200);
      if (response.body.workflow) workflow = response.body.workflow;
      return response.body;
    };
    const ref = () => ({ workflowId: workflow.id, expectedRevisionId: workflow.draftRevisionId });
    const add = { ...ref(), node: { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} } };
    await mutate("add_trigger", add);
    expect((await mutate("add_trigger", add)).status).toBe("replayed");
    await mutate("add_step", { ...ref(), node: { id: "wait", type: "core.wait", name: "Wait briefly", position: { x: 0, y: 1 }, config: { durationSeconds: 1 } } });
    await mutate("connect_steps", { ...ref(), edge: { id: "next", source: "start", target: "wait" } });
    await mutate("update_step", { ...ref(), nodeId: "wait", updates: { config: { durationSeconds: 2 } } });
    expect(await mutate("test_step", { workflowId: workflow.id, nodeId: "wait" })).toMatchObject({ executionPerformed: false, validationPassed: true });
    expect(await mutate("prepare_publish", { workflowId: workflow.id, expectedDraftRevisionId: workflow.draftRevisionId, expectedPublishedRevisionId: null }))
      .toMatchObject({ requiresHumanPublish: true, publishReady: true, publishedRevisionId: null });
    const preview = await conversationAuthoringService(db).get(f.actor, f.home, conversation.id);
    expect(preview.proposals).toEqual([expect.objectContaining({ id: workflow.id, authoredRevisionId: workflow.draftRevisionId, stepCount: 1, triggerCount: 1, state: "draft" })]);
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, f.home))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toHaveLength(1);
    expect((await owned())[0]!.publishedRevisionId).toBeNull();
    const journal = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.entityType, "workflow")));
    expect(journal).toHaveLength(5); expect(journal.every(row => row.runId === run.id && row.actorId === f.presence.id)).toBe(true);
    expect(JSON.stringify(journal.map(row => row.details))).not.toMatch(/PRIVATE|durationSeconds|graph/);
    await mutate("remove_step", { ...ref(), nodeId: "wait" });
    expect((await workflowService(db).getDetail(f.home, workflow.id, f.actor))!.draftRevision!.graph.edges).toEqual([]);
  });
  it("serializes retrying creates without extra revisions or duplicate Activity", async () => {
    const body = create(); const responses = await Promise.all([call(body), call(body)]);
    expect(responses.map(item => item.status)).toEqual([200, 200]);
    expect(responses.map(item => item.body.status).sort()).toEqual(["created", "replayed"]);
    expect(await owned()).toHaveLength(1);
    expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.entityType, "workflow")))).toHaveLength(1);
  });
  it("refuses a board identity, long-lived key, scoped key, wrong Agent and another company", async () => {
    const native = actor;
    for (const invalid of [f.actor, { ...native, source: "agent_key", runId: undefined }, { ...native, keyId: randomUUID() },
      { ...native, agentId: f.guestPresence.id }, { ...native, companyId: f.guest }]) {
      actor = invalid as Express.Request["actor"]; expect((await call(create())).status).toBe(403);
    }
    expect(await owned()).toHaveLength(0);
  });
  it("refuses an inactive run and a changed conversation generation", async () => {
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run.id));
    expect((await call(create())).status).toBe(403);
    await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, run.id));
    await db.update(issues).set({ conversationSessionGeneration: conversation.conversationSessionGeneration + 1 }).where(eq(issues.id, conversation.id));
    expect((await call(create())).status).toBe(403); expect(await owned()).toHaveLength(0);
  });
  it("retains feature gates, current Agent authority and responsible-account verification", async () => {
    await instanceSettingsService(db).updateExperimental({ enableAiWorkflowAuthoring: false });
    expect((await call(create())).status).toBe(404);
    await instanceSettingsService(db).updateExperimental({ enableAiWorkflowAuthoring: true });
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "workflows:edit")));
    expect((await call(create())).status).toBe(403);
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey: "workflows:edit" });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    expect((await call(create())).status).toBe(403); expect(await owned()).toHaveLength(0);
  });
  it("rejects untyped graph/actor injection and leaves Ask/Plan non-mutating", async () => {
    for (const body of [{ ...create(), actor: f.actor }, { operation: "publish_workflow", input: {} },
      { operation: "replace_graph", input: {} }, { operation: "create_workflow", input: { ...create().input, runId: randomUUID() } }]) {
      expect(workflowAuthoringApiCommandSchema.safeParse(body).success).toBe(false);
      expect((await call(body)).status).toBe(400);
    }
    for (const workMode of ["ask", "planning"]) expect(() => validateRunnerApiCall({ operationId, body: create() },
      { companyId: f.home, issueId: conversation.id, runId: run.id, workMode })).toThrow(/only reads/);
    expect(await owned()).toHaveLength(0);
  });
  it("rejects stale or invalid typed nodes without advancing the canonical revision", async () => {
    const created = await call(create()); expect(created.status).toBe(200);
    const workflow = created.body.workflow;
    const input = { workflowId: workflow.id, expectedRevisionId: workflow.draftRevisionId,
      node: { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} } };
    expect((await call({ operation: "add_trigger", input })).status).toBe(200);
    expect((await call({ operation: "add_step", input: { ...input, node: { ...input.node, id: "unknown", type: "invented.execute" } } })).status).toBe(422);
    const stale = await call({ operation: "add_step", input: { ...input, node: { ...input.node, id: "wait", type: "core.wait", config: { durationSeconds: 1 } } } });
    expect(stale.status).toBe(409);
    expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toHaveLength(2);
  });
  it("cannot bypass canonical Ask mode, a replacement execution owner or a pending Stop through direct HTTP", async () => {
    await db.update(issues).set({ workMode: "ask" }).where(eq(issues.id, conversation.id));
    expect((await call(create())).status).toBe(403);
    await db.update(issues).set({ workMode: "standard", executionRunId: null }).where(eq(issues.id, conversation.id));
    expect((await call(create())).status).toBe(403);
    await db.update(issues).set({ executionRunId: run.id }).where(eq(issues.id, conversation.id));
    await db.update(heartbeatRuns).set({ resultJson: { executionCancellation: { state: "requested" } } }).where(eq(heartbeatRuns.id, run.id));
    expect((await call(create())).status).toBe(403); expect(await owned()).toHaveLength(0);
  });
});
