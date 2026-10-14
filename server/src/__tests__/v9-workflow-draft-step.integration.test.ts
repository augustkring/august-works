import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authUsers, companies, companyMemberships, createDb, principalPermissionGrants, workflowRevisions } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowCustomerDraftEdit } from "../services/workflows/workflow-customer-draft-edit.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowDraftStepCommandSchema } from "@paperclipai/shared";

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
});
