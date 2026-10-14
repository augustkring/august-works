import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authUsers, companies, companyMemberships, createDb, principalPermissionGrants, workflowRevisions, workflowRuns, workflowStepRuns } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowCustomerDraftFlow } from "../services/workflows/workflow-customer-draft-flow.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowDraftFlowCommandSchema, type WorkflowDraftFlowOperation } from "@paperclipai/shared";
import { admitCustomerWorkflowTest } from "../services/workflows/workflow-customer-test.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";

describe.sequential("Original guided draft flow composition", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-draft-flow-"); db = createDb(database.connectionString); }, 120000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  async function fixture() {
    const companyId = randomUUID(), userId = randomUUID(), now = new Date(), actor = { type: "board" as const, source: "session" as const, userId };
    await db.insert(companies).values({ id: companyId, name: "Draft flow", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Editor", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit", "workflows:publish", "workflows:run"].map(permissionKey => ({ companyId, principalType: "user", principalId: userId, permissionKey })));
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true });
    const human = { principal: { type: "user" as const, userId } }, workflow = await workflowService(db).create(companyId, { name: "Empty described draft" }, human);
    return { companyId, userId, actor, human, workflow, service: workflowCustomerDraftFlow(db) };
  }
  async function command(f: Awaited<ReturnType<typeof fixture>>, operation: WorkflowDraftFlowOperation) {
    const view = await f.service.review(f.companyId, f.workflow.id, f.actor);
    return workflowDraftFlowCommandSchema.parse({ requestId: randomUUID(), expectedWorkflowId: view.workflowId,
      expectedDraftRevisionId: view.draftRevisionId, expectedPublishedRevisionId: view.publishedRevisionId, expectedUpdatedAt: view.updatedAt,
      expectedLastNodeId: view.steps.at(-1)?.nodeId ?? null, operation });
  }
  it("records one concurrent manual start, no execution/publication, body-free replay and rollout-closed recovery", async () => {
    const f = await fixture(); expect(await f.service.review(f.companyId, f.workflow.id, f.actor)).toMatchObject({ availability: "empty", steps: [] });
    const input = await command(f, { kind: "start_manual", deadlineSeconds: 30, name: "PRIVATE manual start" });
    const [first, repeated] = await Promise.all([f.service.save(f.companyId, f.workflow.id, input, f.actor), f.service.save(f.companyId, f.workflow.id, input, f.actor)]);
    expect(repeated).toEqual(first); expect(first).toMatchObject({ changed: true, published: false, executionStarted: false });
    const detail = await workflowService(db).getDetail(f.companyId, f.workflow.id, f.actor);
    expect(detail!.publishedRevisionId).toBeNull(); expect(detail!.draftRevision!.graph.nodes).toHaveLength(1);
    expect(detail!.draftRevision!.graph.nodes[0]).toMatchObject({ type: "core.manual_trigger", name: input.operation.kind === "start_manual" && input.operation.name });
    expect(detail!.draftRevision!.graph.edges).toEqual([]);
    const rows = await db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId)); expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].details)).not.toMatch(/PRIVATE|manual_trigger|graph/);
    await expect(f.service.save(f.companyId, f.workflow.id, { ...input, operation: { kind: "start_manual", deadlineSeconds: 30, name: "Different" } }, f.actor)).rejects.toMatchObject({ status: 409 });
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: false, enableWorkflowBuilderV1: false, progressive_shell_v9: false });
    expect(await workflowService(db).requestReceipt(f.companyId, f.workflow.id, "draft_build", input.requestId, f.actor)).toEqual({ kind: "draft_build", receipt: first });
    expect(await f.service.save(f.companyId, f.workflow.id, input, f.actor)).toEqual(first);
  });
  it("appends waits and approval checkpoints and removes only the exact last draft node, preserving immutable active data", async () => {
    const f = await fixture(), owner = workflowService(db);
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "start_manual", deadlineSeconds: 30, name: "Start" }), f.actor);
    const first = await owner.getDetail(f.companyId, f.workflow.id, f.actor);
    const published = await owner.publish(f.companyId, f.workflow.id, { expectedDraftRevisionId: first!.draftRevisionId!, expectedPublishedRevisionId: null }, f.human);
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "append_wait", name: "Wait", durationSeconds: 3 }), f.actor);
    const wait = await owner.getDetail(f.companyId, f.workflow.id, f.actor);
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "append_approval", name: "Ask", summary: "PRIVATE facts", consequence: "PRIVATE next step" }), f.actor);
    const approval = await owner.getDetail(f.companyId, f.workflow.id, f.actor);
    expect(approval!.draftRevision!.graph.nodes[2]).toMatchObject({ type: "human.approval", config: { summary: "PRIVATE facts", consequence: "PRIVATE next step" } });
    const removal = await command(f, { kind: "remove_last" });
    await expect(f.service.save(f.companyId, f.workflow.id, { ...removal, expectedLastNodeId: wait!.draftRevision!.graph.nodes[1].id }, f.actor)).rejects.toMatchObject({ status: 409 });
    await f.service.save(f.companyId, f.workflow.id, removal, f.actor);
    const after = await owner.getDetail(f.companyId, f.workflow.id, f.actor);
    expect(after!.draftRevision!.graph).toEqual(wait!.draftRevision!.graph); expect(after!.publishedRevision).toEqual(published.publishedRevision);
    await expect(f.service.save(f.companyId, f.workflow.id, { ...removal, requestId: randomUUID() }, f.actor)).rejects.toMatchObject({ status: 409 });
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "remove_last" }), f.actor);
    await expect(f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "remove_last" }), f.actor)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps actual branches Advanced and refuses flattened edits, false tail identity and viewer authority", async () => {
    const f = await fixture(), owner = workflowService(db);
    await owner.updateDraft(f.companyId, f.workflow.id, { expectedRevisionId: f.workflow.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "branch", type: "core.condition", name: "Choose", position: { x: 0, y: 1 }, config: { expression: "true" } },
        ...["yes", "no"].map(id => ({ id, type: "core.wait", name: id, position: { x: 0, y: 2 }, config: { durationSeconds: 3 } })),
      ], edges: [{ id: "next", source: "start", target: "branch" },
        { id: "yes", source: "branch", target: "yes", sourceHandle: "true", label: "true" },
        { id: "no", source: "branch", target: "no", sourceHandle: "false", label: "false" }], variables: [], settings: {},
    } }, f.human);
    const view = await f.service.review(f.companyId, f.workflow.id, f.actor); expect(view).toMatchObject({ availability: "advanced", steps: [] });
    const input = await command(f, { kind: "append_wait", name: "Unexpected", durationSeconds: 3 });
    await expect(f.service.save(f.companyId, f.workflow.id, input, f.actor)).rejects.toMatchObject({ status: 409 });
    const current = await owner.getDetail(f.companyId, f.workflow.id, f.actor), graph = current!.draftRevision!.graph;
    await owner.updateDraft(f.companyId, f.workflow.id, { expectedRevisionId: current!.draftRevisionId!,
      graph: { ...graph, nodes: graph.nodes.filter(node => ["start", "branch"].includes(node.id)), edges: graph.edges.filter(edge => edge.id === "next") } }, f.human);
    expect(await f.service.review(f.companyId, f.workflow.id, f.actor)).toMatchObject({ availability: "advanced", steps: [] });
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    await expect(f.service.review(f.companyId, f.workflow.id, { ...f.actor, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
    await expect(f.service.save(randomUUID(), f.workflow.id, input, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("rolls back the original revision and receipt on late account withdrawal", async () => {
    const f = await fixture(), input = await command(f, { kind: "start_manual", deadlineSeconds: 30, name: "Start" });
    await db.execute(sql`create function aw_v9_test_flow_unverify() returns trigger language plpgsql as $$ begin
      if NEW.action='workflow.customer_draft_flow_saved' then update ${authUsers} set email_verified=false where id=NEW.actor_id; end if; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_flow_unverify after insert on activity_log for each row execute function aw_v9_test_flow_unverify()`);
    try {
      await expect(f.service.save(f.companyId, f.workflow.id, input, f.actor)).rejects.toMatchObject({ status: 403 });
      expect((await workflowService(db).getDetail(f.companyId, f.workflow.id, f.actor))!.draftRevisionId).toBe(input.expectedDraftRevisionId);
      expect(await db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId))).toEqual([]);
      expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.workflowId, f.workflow.id))).filter(row => row.state === "draft")).toHaveLength(1);
    } finally { await db.execute(sql`drop trigger aw_v9_test_flow_unverify on activity_log`); await db.execute(sql`drop function aw_v9_test_flow_unverify()`); }
  });
  it("tests the actual guided manual/wait draft through the Original timer owner without publishing or external work", async () => {
    const f = await fixture(), owner = workflowService(db), executor = workflowExecutorService(db);
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "start_manual", name: "Start", deadlineSeconds: 30 }), f.actor);
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "append_wait", name: "Wait", durationSeconds: 1 }), f.actor);
    const before = await owner.getDetail(f.companyId, f.workflow.id, f.actor);
    const receipt = await admitCustomerWorkflowTest(db, f.companyId, f.workflow.id, { requestId: randomUUID(), expectedWorkflowId: f.workflow.id,
      expectedUpdatedAt: before!.updatedAt.toISOString(), expectedDraftRevisionId: before!.draftRevisionId!, expectedRunStatus: "succeeded", acknowledgeInternalTest: true }, f.actor);
    const waiting = await executor.executeQueuedRun(f.companyId, receipt.runId, f.human); expect(waiting!.run.status).toBe("waiting");
    await expect.poll(async () => {
      await executor.recoverExpiredRuns();
      const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, receipt.runId)); return run.status;
    }, { timeout: 10000, interval: 100 }).toBe("succeeded");
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, receipt.runId)); expect(run).toMatchObject({ source: "test", workflowRevisionId: before!.draftRevisionId, responsibleUserId: f.userId });
    const steps = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, receipt.runId));
    const waitNode = before!.draftRevision!.graph.nodes.find(node => node.type === "core.wait")!;
    expect(steps).toHaveLength(2); expect(steps.find(step => step.nodeId === waitNode.id)).toMatchObject({ status: "succeeded", outputJson: { reason: "delay_elapsed" } });
    expect(await owner.getDetail(f.companyId, f.workflow.id, f.actor)).toEqual(before);
  });
  it("composes explicit Native conditional branches once, preserves active data and tests both actual timer outcomes", async () => {
    const f = await fixture(), owner = workflowService(db), executor = workflowExecutorService(db);
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "start_manual", name: "Start", deadlineSeconds: 30 }), f.actor);
    const started = (await owner.getDetail(f.companyId, f.workflow.id, f.actor))!;
    const published = await owner.publish(f.companyId, f.workflow.id, { expectedDraftRevisionId: started.draftRevisionId!, expectedPublishedRevisionId: null }, f.human);
    const input = await command(f, { kind: "append_condition", name: "Compare amount",
      condition: { kind: "condition", source: "trigger", path: ["amount"], operator: ">=", value: 10000 },
      whenTrue: { name: "PRIVATE large amount", durationSeconds: 1 }, whenFalse: { name: "PRIVATE small amount", durationSeconds: 1 } });
    const [receipt, repeated] = await Promise.all([f.service.save(f.companyId, f.workflow.id, input, f.actor), f.service.save(f.companyId, f.workflow.id, input, f.actor)]);
    expect(repeated).toEqual(receipt);
    const before = (await owner.getDetail(f.companyId, f.workflow.id, f.actor))!;
    expect(before.publishedRevision).toEqual(published.publishedRevision);
    expect(before.draftRevision!.graph.nodes).toHaveLength(4); expect(before.draftRevision!.graph.edges).toHaveLength(3);
    expect(before.draftRevision!.graph.nodes.find(node => node.type === "core.condition")!.config).toEqual({ expression: '{{trigger["amount"]}} >= 10000' });
    const branches = before.draftRevision!.graph.edges.filter(edge => edge.sourceHandle);
    expect(branches.map(edge => edge.sourceHandle)).toEqual(["true", "false"]);
    expect((await f.service.review(f.companyId, f.workflow.id, f.actor)).availability).toBe("advanced");
    await expect(f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "append_wait", name: "No flattening", durationSeconds: 1 }), f.actor)).rejects.toMatchObject({ status: 409 });
    for (const amount of [10000, 9999]) {
      const testReceipt = await admitCustomerWorkflowTest(db, f.companyId, f.workflow.id, { requestId: randomUUID(), expectedWorkflowId: f.workflow.id,
        expectedUpdatedAt: before.updatedAt.toISOString(), expectedDraftRevisionId: before.draftRevisionId!, expectedRunStatus: "succeeded", acknowledgeInternalTest: true,
        syntheticInput: [{ path: ["amount"], value: amount }] }, f.actor);
      expect((await executor.executeQueuedRun(f.companyId, testReceipt.runId, f.human))!.run.status).toBe("waiting");
      await expect.poll(async () => { await executor.recoverExpiredRuns();
        const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, testReceipt.runId)); return run.status;
      }, { timeout: 10000, interval: 100 }).toBe("succeeded");
      const steps = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, testReceipt.runId));
      const selected = branches.find(edge => edge.sourceHandle === (amount >= 10000 ? "true" : "false"))!;
      expect(steps.find(step => step.nodeId === selected.target)).toMatchObject({ status: "succeeded", outputJson: { reason: "delay_elapsed" } });
      expect(steps.find(step => step.nodeId === branches.find(edge => edge !== selected)!.target)?.status).not.toBe("succeeded");
    }
    expect(await owner.getDetail(f.companyId, f.workflow.id, f.actor)).toEqual(before);
    const activities = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "workflow.customer_draft_flow_saved")));
    expect(JSON.stringify(activities.map(row => row.details))).not.toMatch(/PRIVATE|condition|amount|durationSeconds/);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: false, enableWorkflowBuilderV1: false, progressive_shell_v9: false });
    expect(await f.service.save(f.companyId, f.workflow.id, input, f.actor)).toEqual(receipt);
  });
  it("refuses references outside the exact current earlier path before adding a branch", async () => {
    const f = await fixture();
    await f.service.save(f.companyId, f.workflow.id, await command(f, { kind: "start_manual", name: "Start", deadlineSeconds: 30 }), f.actor);
    const before = await workflowService(db).getDetail(f.companyId, f.workflow.id, f.actor);
    const input = await command(f, { kind: "append_condition", name: "Compare", condition: { kind: "condition", source: "steps", path: ["another-step", "value"], operator: "===", value: true },
      whenTrue: { name: "True", durationSeconds: 1 }, whenFalse: { name: "False", durationSeconds: 1 } });
    await expect(f.service.save(f.companyId, f.workflow.id, input, f.actor)).rejects.toMatchObject({ status: 409 });
    expect(await workflowService(db).getDetail(f.companyId, f.workflow.id, f.actor)).toEqual(before);
  });
  it("tests both Native condition branches with exact synthetic data, body-free journals and changed-input replay refusal", async () => {
    const f = await fixture(), owner = workflowService(db), executor = workflowExecutorService(db);
    const draft = await owner.updateDraft(f.companyId, f.workflow.id, { expectedRevisionId: f.workflow.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "choose", type: "core.condition", name: "Amount", position: { x: 0, y: 1 }, config: { expression: '{{trigger.amount}} >= 10000' } },
        ...["yes", "no"].map(id => ({ id, type: "core.merge", name: id, position: { x: 0, y: 2 }, config: { mode: "all" } })),
      ], edges: [{ id: "next", source: "start", target: "choose" },
        { id: "yes", source: "choose", target: "yes", sourceHandle: "true", label: "true" },
        { id: "no", source: "choose", target: "no", sourceHandle: "false", label: "false" }], variables: [], settings: { totalDeadlineSeconds: 30 },
    } }, f.human);
    for (const [amount, selected] of [[10000, "yes"], [9999, "no"]] as const) {
      const input = { requestId: randomUUID(), expectedWorkflowId: f.workflow.id, expectedUpdatedAt: draft.updatedAt.toISOString(),
        expectedDraftRevisionId: draft.draftRevisionId!, expectedRunStatus: "succeeded" as const, acknowledgeInternalTest: true as const,
        syntheticInput: [{ path: ["amount"], value: amount }, { path: ["customer", "note"], value: "PRIVATE synthetic note" }] };
      const receipt = await admitCustomerWorkflowTest(db, f.companyId, f.workflow.id, input, f.actor);
      expect((await executor.executeQueuedRun(f.companyId, receipt.runId, f.human))!.run.status).toBe("succeeded");
      const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, receipt.runId));
      expect(run.triggerPayload).toEqual({ amount, customer: { note: "PRIVATE synthetic note" } });
      const steps = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, receipt.runId));
      expect(steps.find(step => step.nodeId === selected)?.status).toBe("succeeded");
      expect(steps.find(step => step.nodeId === (selected === "yes" ? "no" : "yes"))?.status).not.toBe("succeeded");
      expect(await admitCustomerWorkflowTest(db, f.companyId, f.workflow.id, input, f.actor)).toEqual(receipt);
      await expect(admitCustomerWorkflowTest(db, f.companyId, f.workflow.id, { ...input, syntheticInput: [{ path: ["amount"], value: 1 }] }, f.actor)).rejects.toMatchObject({ status: 409 });
    }
    const receipts = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "workflow.customer_test_admitted")));
    expect(receipts).toHaveLength(2); expect(JSON.stringify(receipts.map(row => row.details))).not.toMatch(/PRIVATE|syntheticInput|customer/);
    expect((await owner.getDetail(f.companyId, f.workflow.id, f.actor))!.publishedRevisionId).toBeNull();
  });
});
