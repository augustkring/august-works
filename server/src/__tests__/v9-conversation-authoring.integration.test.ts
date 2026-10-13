import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, authUsers, companyMemberships, createDb, heartbeatRuns, issues, principalPermissionGrants, workflowRevisions } from "@paperclipai/db";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { workflowAuthoringToolsService } from "../services/workflows/workflow-authoring-tools.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { ExperienceOverloadError } from "../services/experience/projection.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Current conversation previews use actual Original authoring revisions", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, conversation: typeof issues.$inferSelect, run: typeof heartbeatRuns.$inferSelect;
  const view = () => conversationAuthoringService(db).get(f.actor, f.home, conversation.id);
  const tools = () => workflowAuthoringToolsService(db);
  const context = () => ({ companyId: f.home, agentId: f.presence.id, runId: run.id });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-conversation-authoring-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
      enableAiWorkflowAuthoring: true, enableAgentChat: true });
    f = await seedV5Presences(db);
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit", "workflows:publish"].flatMap(permissionKey => [
      { companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey },
      { companyId: f.home, principalType: "user", principalId: f.userId, permissionKey },
    ])).onConflictDoNothing();
    conversation = await issueService(db).create(f.home, { title: "PRIVATE conversation intent", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review", createdByUserId: f.userId });
    [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running",
      contextSnapshot: { issueId: conversation.id, conversationSessionGeneration: conversation.conversationSessionGeneration } }).returning();
  });
  async function draft(name = "Weekly review proposal") {
    return (await tools().create(context(), { name, description: "PRIVATE draft description", idempotencyKey: randomUUID() })).workflow;
  }
  it("refuses an already aborted private read without returning proposal data", async () => {
    await draft(); const controller = new AbortController(); controller.abort();
    await expect(conversationAuthoringService(db).get(f.actor, f.home, conversation.id, controller.signal)).rejects.toBeInstanceOf(ExperienceOverloadError);
    expect((await view()).proposals).toHaveLength(1);
  });
  it("bounds a real privacy-lock wait and releases read admission after the failed query settles", async () => {
    await draft(); let release!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async rawTx => { await lockMemoryPrivacy(rawTx as unknown as typeof db, f.home); locked(); await gate; });
    await ready;
    try { await expect(view()).rejects.toBeInstanceOf(ExperienceOverloadError); }
    finally { release(); await holder; }
    expect((await view()).proposals).toHaveLength(1);
  });
  it("shows the exact saved Original workflow version and excludes prompt/configuration bodies", async () => {
    const workflow = await draft(), initial = await view();
    expect(initial).toMatchObject({ conversationId: conversation.id, agentId: f.presence.id, generation: 0, modelCalled: false, hasMore: false,
      proposals: [{ id: workflow.id, name: workflow.name, authoredRevisionId: workflow.draftRevisionId, authoredRevisionNumber: 1,
        state: "draft", stepCount: 0, triggerCount: 0, href: `/workflows/${workflow.id}` }] });
    expect(JSON.stringify(initial)).not.toMatch(/PRIVATE|graph|config|credential|description|prompt|contextSnapshot/);
    const before = await db.select().from(agents).where(eq(agents.id, f.presence.id));
    expect(await view()).toEqual({ ...initial, observedAt: expect.any(String) });
    expect(await db.select().from(agents).where(eq(agents.id, f.presence.id))).toEqual(before);
  });
  it("distinguishes a later user-edited draft from the version actually proposed in the conversation", async () => {
    const workflow = await draft();
    await workflowService(db).updateDraft(f.home, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: {
      version: 1, nodes: [{ id: "manual", type: "core.manual_trigger", name: "Human-reviewed manual trigger", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {},
    } }, { principal: { type: "user", userId: f.userId } });
    expect((await view()).proposals[0]).toMatchObject({ state: "changed", authoredRevisionId: workflow.draftRevisionId, authoredRevisionNumber: 1, triggerCount: 0 });
  });
  it("previews the actual saved flow and compares a later user edit without exposing private expressions", async () => {
    const workflow = await draft();
    const trigger = await tools().addTrigger(context(), { workflowId: workflow.id, expectedRevisionId: workflow.draftRevisionId,
      node: { id: "begin", type: "core.manual_trigger", name: "Begin weekly review", position: { x: 0, y: 0 }, config: {} } });
    const step = await tools().addStep(context(), { workflowId: workflow.id, expectedRevisionId: trigger.workflow.draftRevisionId,
      node: { id: "research", type: "core.transform", name: "Research account", position: { x: 0, y: 1 }, config: { mapping: { privateExpression: "input.PRIVATE_CUSTOMER" } } } });
    const linked = await tools().connectSteps(context(), { workflowId: workflow.id, expectedRevisionId: step.workflow.draftRevisionId,
      edge: { id: "start-research", source: "begin", target: "research" } });
    const authored = linked.workflow.draftRevision!;
    const editedGraph = { ...authored.graph, nodes: authored.graph.nodes.map(node => node.id === "research" ? { ...node,
      config: { mapping: { privateExpression: "input.PRIVATE_CHANGED" } } } : node) };
    await workflowService(db).updateDraft(f.home, workflow.id, { expectedRevisionId: authored.id, graph: editedGraph },
      { principal: { type: "user", userId: f.userId } });
    const proposal = (await view()).proposals[0]!;
    expect(proposal).toMatchObject({ state: "changed", authoredRevisionId: authored.id, preview: {
      id: authored.id, version: authored.revisionNumber, coverage: "complete", steps: [
        { number: 1, name: "Begin weekly review", next: [{ number: 2 }] },
        { number: 2, name: "Research account", effect: "pure", approval: "not_verified" },
      ] }, comparison: { state: "available", steps: [{ number: 2, change: "changed" }], removedSteps: 0 } });
    expect(JSON.stringify(proposal)).not.toMatch(/PRIVATE_|privateExpression|config|inputMapping|graph|credential/);
  });
  it("does not promote arbitrary model text or another chat session into a saved proposal", async () => {
    expect((await view()).proposals).toEqual([]);
    const otherUserId = `other-${randomUUID()}`, at = new Date();
    await db.insert(authUsers).values({ id: otherUserId, name: "Other account", email: `${otherUserId}@test.invalid`, emailVerified: true, createdAt: at, updatedAt: at });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: otherUserId, status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: otherUserId, permissionKey: "workflows:edit" });
    const other = await issueService(db).create(f.home, { title: "Other owned chat", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: otherUserId, conversationState: "waiting", status: "in_review", createdByUserId: otherUserId });
    const [otherRun] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: otherUserId,
      status: "running", contextSnapshot: { issueId: other.id, conversationSessionGeneration: 0 } }).returning();
    await tools().create({ ...context(), runId: otherRun!.id }, { name: "Another chat's draft", idempotencyKey: randomUUID() });
    expect((await view()).proposals).toEqual([]);
  });
  it("excludes pre-reset proposals and refuses a foreign or retired conversation", async () => {
    await draft(); await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, conversation.id));
    expect(await view()).toMatchObject({ generation: 1, proposals: [] });
    await expect(conversationAuthoringService(db).get(f.actor, f.guest, conversation.id)).rejects.toMatchObject({ status: 404 });
    await issueService(db).create(f.home, { title: "Recovered conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review",
      createdByUserId: f.userId, retireConversationId: conversation.id });
    await expect(view()).rejects.toMatchObject({ status: 404 });
  });
  it("suppresses private proposals after current verified-account or workflow-read withdrawal", async () => {
    await draft(); await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
      eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "workflows:read")));
    await expect(view()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(conversationAuthoringService(db).get({ ...f.actor, isInstanceAdmin: true }, f.home, conversation.id)).rejects.toMatchObject({ status: 403 });
  });
  it("refuses a draft write after the actual responsible account loses verification", async () => {
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(draft()).rejects.toMatchObject({ status: 403, details: { code: "workflow_authoring_account_unavailable" } });
    expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toEqual([]);
  });
  it("rolls back a draft if account verification is withdrawn after the revision insert", async () => {
    await db.execute(sql`create function aw_v9_test_unverify_author() returns trigger language plpgsql as $$
      begin
        update "user" set email_verified=false where id=(select responsible_user_id from heartbeat_runs where id=NEW.created_by_run_id);
        return NEW;
      end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_account_withdrawal after insert on workflow_revisions
      for each row execute function aw_v9_test_unverify_author()`);
    try {
      await expect(draft()).rejects.toMatchObject({ status: 403, details: { code: "workflow_authoring_account_unavailable" } });
      expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toEqual([]);
      expect((await db.select().from(authUsers).where(eq(authUsers.id, f.userId)))[0]?.emailVerified).toBe(true);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_late_account_withdrawal on workflow_revisions`);
      await db.execute(sql`drop function aw_v9_test_unverify_author()`);
    }
  });
  it("refuses a draft write from an older conversation generation even while its run remains active", async () => {
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, conversation.id));
    await expect(draft()).rejects.toMatchObject({ status: 403, details: { code: "workflow_authoring_context_changed" } });
    expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toEqual([]);
  });
  it("refuses a draft write after the Original owner retires its conversation", async () => {
    await issueService(db).create(f.home, { title: "New current conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review",
      createdByUserId: f.userId, retireConversationId: conversation.id });
    await expect(draft()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toEqual([]);
  });
  it("rolls back the Original draft if the responsible user's authority disappears at the final write boundary", async () => {
    await db.execute(sql`create function aw_v9_test_withdraw_workflow_edit() returns trigger language plpgsql as $$
      begin
        delete from principal_permission_grants where company_id=NEW.company_id and principal_type='user' and permission_key='workflows:edit';
        return NEW;
      end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_workflow_withdrawal after insert on workflow_revisions
      for each row execute function aw_v9_test_withdraw_workflow_edit()`);
    try {
      await expect(draft()).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toEqual([]);
      // The late withdrawal itself was in the same rolled-back transaction.
      expect(await db.select().from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
        eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "workflows:edit")))).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_late_workflow_withdrawal on workflow_revisions`);
      await db.execute(sql`drop function aw_v9_test_withdraw_workflow_edit()`);
    }
  });
  it.each(["enforce", "shadow"])("enforces the actual responsible user's workflow authority while legacy mode is %s", async mode => {
    vi.stubEnv("PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE", mode);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
      eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "workflows:edit")));
    await expect(draft()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(workflowRevisions).where(eq(workflowRevisions.companyId, f.home))).toEqual([]);
  });
});
