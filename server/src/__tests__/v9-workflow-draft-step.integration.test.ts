import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, agentIdentities, authUsers, companies, companyMemberships, createDb, principalPermissionGrants, workflowRevisions, workflowRuns, heartbeatRuns, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowCustomerDraftEdit } from "../services/workflows/workflow-customer-draft-edit.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowDraftStepCommandSchema } from "@paperclipai/shared";
import { evaluateWorkflowConditionExpression } from "../services/workflows/workflow-condition-expression.js";

describe.sequential("Original guided workflow draft step owner", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-draft-step-"); db = createDb(database.connectionString); }, 120000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  async function fixture() {
    const companyId = randomUUID(), userId = randomUUID(), now = new Date(), actor = { type: "board" as const, source: "session" as const, userId };
    await db.insert(companies).values({ id: companyId, name: "Draft edit", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Editor", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit", "workflows:publish"].map(permissionKey => ({ companyId, principalType: "user", principalId: userId, permissionKey })));
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true });
    const owner = workflowService(db), human = { principal: { type: "user" as const, userId } }, created = await owner.create(companyId, { name: "Existing flow" }, human);
    const draft = await owner.updateDraft(companyId, created.id, { expectedRevisionId: created.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "wait", type: "core.wait", name: "Wait", position: { x: 0, y: 1 }, config: { durationSeconds: 3 } },
        { id: "approval", type: "human.approval", name: "Ask", position: { x: 0, y: 2 }, config: { summary: "PRIVATE summary", consequence: "PRIVATE consequence" } },
      ], edges: [{ id: "one", source: "start", target: "wait" }, { id: "two", source: "wait", target: "approval" }], variables: [], settings: {},
    } }, human);
    const published = await owner.publish(companyId, created.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null }, human);
    return { companyId, userId, actor, published, service: workflowCustomerDraftEdit(db) };
  }
  async function command(f: Awaited<ReturnType<typeof fixture>>, node = "wait") {
    const view = await f.service.review(f.companyId, f.published.id, node, f.actor);
    return workflowDraftStepCommandSchema.parse({ requestId: randomUUID(), expectedWorkflowId: view.workflowId,
      expectedDraftRevisionId: view.draftRevisionId, expectedPublishedRevisionId: view.publishedRevisionId,
      expectedUpdatedAt: view.updatedAt, expectedNodeId: view.nodeId, expectedNodeType: view.nodeType,
      name: "Edited draft wait", configuration: { kind: "wait", durationSeconds: 7 } });
  }
  it("creates one separate Native draft and exact replay receipt while preserving immutable active graph and branches", async () => {
    const f = await fixture(), input = await command(f), before = f.published.publishedRevision!;
    const [first, repeated] = await Promise.all([f.service.save(f.companyId, f.published.id, input, f.actor), f.service.save(f.companyId, f.published.id, input, f.actor)]);
    expect(repeated).toEqual(first); expect(first).toMatchObject({ previousRevisionId: input.expectedDraftRevisionId, changed: true, published: false, executionStarted: false });
    const detail = await workflowService(db).getDetail(f.companyId, f.published.id, f.actor);
    expect(detail!.publishedRevision).toEqual(before); expect(detail!.draftRevision!.graph.edges).toEqual(before.graph.edges);
    expect(detail!.draftRevision!.graph.nodes[1]).toMatchObject({ name: input.name, config: { durationSeconds: 7 } });
    expect(detail!.draftRevision!.graph.nodes[2]).toEqual(before.graph.nodes[2]);
    const rows = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "workflow.customer_draft_step_saved")));
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows[0].details)).not.toMatch(/PRIVATE|Edited draft wait|durationSeconds/);
    await expect(f.service.save(f.companyId, f.published.id, { ...input, name: "Different" }, f.actor)).rejects.toMatchObject({ status: 409 });
    await instanceSettingsService(db).updateExperimental({ enableWorkflowBuilderV1: false, enableWorkflowsV1: false, progressive_shell_v9: false });
    expect(await f.service.receipt(f.companyId, f.published.id, input.requestId, f.actor)).toEqual(first);
    expect(await workflowService(db).requestReceipt(f.companyId, f.published.id, "draft_edit", input.requestId, f.actor)).toEqual({ kind: "draft_edit", receipt: first });
    expect(await f.service.save(f.companyId, f.published.id, input, f.actor)).toEqual(first);
  });
  it("edits only the selected approval consequence and rejects stale/type/foreign/viewer changes", async () => {
    const f = await fixture(), input = await command(f, "approval"), before = f.published.publishedRevision!;
    const approval = { ...input, name: "Review request", configuration: { kind: "approval" as const, summary: "Review facts", consequence: "Allow the next internal step" } };
    await f.service.save(f.companyId, f.published.id, approval, f.actor);
    const detail = await workflowService(db).getDetail(f.companyId, f.published.id, f.actor);
    expect(detail!.draftRevision!.graph.nodes[2].config).toEqual({ summary: "Review facts", consequence: "Allow the next internal step" });
    expect(detail!.publishedRevision).toEqual(before);
    await expect(f.service.save(f.companyId, f.published.id, { ...approval, requestId: randomUUID() }, f.actor)).rejects.toMatchObject({ status: 409 });
    const current = await command(f);
    await expect(f.service.save(f.companyId, f.published.id, { ...current, expectedNodeType: "human.approval" }, f.actor)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.save(randomUUID(), f.published.id, current, f.actor)).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    await expect(f.service.save(f.companyId, f.published.id, current, { ...f.actor, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
  });
  it("rolls back the new revision and receipt if verification changes after its Original journal insert", async () => {
    const f = await fixture(), input = await command(f);
    await db.execute(sql`create function aw_v9_test_draft_editor_unverify() returns trigger language plpgsql as $$ begin
      if NEW.action='workflow.customer_draft_step_saved' then update ${authUsers} set email_verified=false where id=NEW.actor_id; end if; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_draft_editor_unverify after insert on activity_log for each row execute function aw_v9_test_draft_editor_unverify()`);
    try {
      await expect(f.service.save(f.companyId, f.published.id, input, f.actor)).rejects.toMatchObject({ status: 403 });
      expect((await workflowService(db).getDetail(f.companyId, f.published.id, f.actor))!.draftRevisionId).toBe(input.expectedDraftRevisionId);
      expect(await db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId))).toEqual([]);
      expect((await db.select().from(authUsers).where(eq(authUsers.id, f.userId)))[0].emailVerified).toBe(true);
      expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.workflowId, f.published.id))).filter(row => row.state === "draft")).toHaveLength(1);
    } finally { await db.execute(sql`drop trigger aw_v9_test_draft_editor_unverify on activity_log`); await db.execute(sql`drop function aw_v9_test_draft_editor_unverify()`); }
  });
  it("edits an Agent task brief without changing its assignment, inputs, retry, active version or creating work", async () => {
    const f = await fixture(), owner = workflowService(db), human = { principal: { type: "user" as const, userId: f.userId } };
    const [identity] = await db.insert(agentIdentities).values({ homeCompanyId: f.companyId, name: "Selected analyst" }).returning();
    const [agent] = await db.insert(agents).values({ companyId: f.companyId, agentIdentityId: identity.id, name: "Selected analyst" }).returning();
    const graph = f.published.draftRevision!.graph;
    const task = { id: "agent-work", type: "agent.task", name: "Prepare summary", position: { x: 0, y: 3 },
      config: { agentId: agent.id, objective: "PRIVATE original task", waitForCompletion: false, expectedOutputSchema: null },
      inputSchema: { type: "object", properties: { facts: { type: "string" } } }, retryPolicy: { mode: "none" as const, maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 } };
    const draft = await owner.updateDraft(f.companyId, f.published.id, { expectedRevisionId: f.published.draftRevisionId!, graph: {
      ...graph, nodes: [...graph.nodes, task], edges: [...graph.edges, { id: "ask-work", source: "approval", target: task.id }],
    } }, human);
    const published = await owner.publish(f.companyId, f.published.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: f.published.publishedRevisionId }, human);
    const view = await f.service.review(f.companyId, f.published.id, task.id, f.actor);
    expect(view.configuration).toEqual({ kind: "agent_task", objective: task.config.objective, waitForCompletion: false });
    const input = workflowDraftStepCommandSchema.parse({ ...await command(f), expectedNodeId: task.id, expectedNodeType: task.type,
      name: task.name, configuration: { kind: "agent_task", objective: "PRIVATE revised task\nUse approved facts only" } });
    const first = await f.service.save(f.companyId, f.published.id, input, f.actor);
    expect(await f.service.save(f.companyId, f.published.id, input, f.actor)).toEqual(first);
    const current = await owner.getDetail(f.companyId, f.published.id, f.actor);
    const saved = current!.draftRevision!.graph.nodes.find(node => node.id === task.id)!;
    expect(saved).toEqual({ ...published.draftRevision!.graph.nodes.find(node => node.id === task.id), config: { ...task.config, objective: input.configuration.kind === "agent_task" ? input.configuration.objective : "" } });
    expect(current!.publishedRevision).toEqual(published.publishedRevision);
    expect(current!.draftRevision!.graph.edges).toEqual(published.publishedRevision!.graph.edges);
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(issues).where(eq(issues.companyId, f.companyId))).toEqual([]);
    const rows = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "workflow.customer_draft_step_saved")));
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows[0].details)).not.toMatch(/PRIVATE|objective|approved facts/);
    expect(workflowDraftStepCommandSchema.safeParse({ ...input, configuration: { kind: "agent_task", objective: "New", agentId: randomUUID() } }).success).toBe(false);
    await expect(f.service.save(f.companyId, f.published.id, { ...input, requestId: randomUUID() }, f.actor)).rejects.toMatchObject({ status: 409 });
  });
  it("changes a selected condition through the Original language while retaining both active branches and the exact receipt", async () => {
    const f = await fixture(), owner = workflowService(db), human = { principal: { type: "user" as const, userId: f.userId } };
    const nodes = f.published.draftRevision!.graph.nodes;
    const draft = await owner.updateDraft(f.companyId, f.published.id, { expectedRevisionId: f.published.draftRevisionId!, graph: {
      version: 1, nodes: [...nodes, { id: "choose", type: "core.condition", name: "High amount", position: { x: 1, y: 1 }, config: { expression: '{{trigger.amount}} >= 50000' } }],
      edges: [{ id: "start-choice", source: "start", target: "choose" },
        { id: "yes", source: "choose", target: "approval", sourceHandle: "true", label: "true" },
        { id: "no", source: "choose", target: "wait", sourceHandle: "false", label: "false" }], variables: [], settings: {},
    } }, human);
    const published = await owner.publish(f.companyId, f.published.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: f.published.publishedRevisionId }, human);
    const view = await f.service.review(f.companyId, f.published.id, "choose", f.actor);
    expect(view.configuration).toEqual({ kind: "condition", source: "trigger", path: ["amount"], operator: ">=", value: 50000 });
    const unchanged = workflowDraftStepCommandSchema.parse({ ...await command(f), expectedNodeId: view.nodeId, expectedNodeType: view.nodeType,
      name: view.name, configuration: view.configuration });
    expect(await f.service.save(f.companyId, f.published.id, unchanged, f.actor)).toMatchObject({ changed: false, draftRevisionId: view.draftRevisionId });
    const input = workflowDraftStepCommandSchema.parse({ ...await command(f), expectedNodeId: view.nodeId, expectedNodeType: view.nodeType,
      name: "Review large amount", configuration: { ...view.configuration, value: 10000 } });
    const saved = await f.service.save(f.companyId, f.published.id, input, f.actor);
    const current = await owner.getDetail(f.companyId, f.published.id, f.actor), graph = current!.draftRevision!.graph;
    expect(graph.edges).toEqual(published.publishedRevision!.graph.edges); expect(current!.publishedRevision).toEqual(published.publishedRevision);
    expect(graph.nodes.filter(node => node.id !== "choose")).toEqual(published.publishedRevision!.graph.nodes.filter(node => node.id !== "choose"));
    const expression = graph.nodes.find(node => node.id === "choose")!.config.expression as string;
    expect(evaluateWorkflowConditionExpression(expression, { trigger: { amount: 10000 }, variables: {}, steps: {} })).toBe(true);
    expect(evaluateWorkflowConditionExpression(expression, { trigger: { amount: 9999 }, variables: {}, steps: {} })).toBe(false);
    expect(await f.service.save(f.companyId, f.published.id, input, f.actor)).toEqual(saved);
    const receipts = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "workflow.customer_draft_step_saved")));
    expect(receipts).toHaveLength(2); expect(JSON.stringify(receipts.map(row => row.details))).not.toMatch(/amount|10000|Review large amount|expression/);
  });
});
