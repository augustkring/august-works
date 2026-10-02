import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyMemberships, createDb, workflowRuns } from "@paperclipai/db";
import type { WorkflowGraphV1, WorkflowNodeV1 } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { workflowService } from "./workflow-service.js";
import { workflowExecutorService } from "./workflow-executor.js";
import { approvalService } from "../approvals.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
suite("Published workflow failure policies", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-failure-policy-"); db = createDb(temp.connectionString); }, 30_000);
  afterAll(async () => temp?.cleanup());
  async function seed(policy: WorkflowNodeV1["failurePolicy"], nullable = true) {
    const [company] = await db.insert(companies).values({ name: "Failure policy", issuePrefix: `F${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const companyId = company!.id, userId = `owner-${randomUUID()}`;
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const actor = { principal: { type: "user" as const, userId } };
    const svc = workflowService(db);
    const workflow = await svc.create(companyId, { name: "Recover missing input" }, actor);
    const branched = policy === "follow_failure_branch" || policy === "wait_for_human";
    const graph: WorkflowGraphV1 = { version: 1, nodes: [
      { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "broken", type: "core.transform", name: "Missing required input", position: { x: 100, y: 0 }, config: { mapping: { value: "{{input.missing}}" } }, failurePolicy: policy },
      { id: "recover", type: "core.transform", name: "Recovery", position: { x: 200, y: 100 }, config: { mapping: { recovered: "true" } },
        ...(policy === "continue_with_null" ? { inputSchema: { type: nullable ? ["object", "null"] : "object" } } : {}) },
      ...(branched ? [{ id: "success", type: "core.transform", name: "Success", position: { x: 200, y: 0 }, config: { mapping: { success: "true" } } }] : []),
    ], edges: [{ id: "entry", source: "start", target: "broken" },
      { id: "recover", source: "broken", target: "recover", ...(branched ? { sourceHandle: "failure" } : {}) },
      ...(branched ? [{ id: "success", source: "broken", target: "success", sourceHandle: "success" }] : [])], variables: [], settings: {} };
    const draft = await svc.updateDraft(companyId, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph }, actor);
    await svc.publish(companyId, workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, actor);
    return { companyId, userId, actor, workflow };
  }
  it("preserves a failed checkpoint and runs only the declared failure path", async () => {
    const seeded = await seed("follow_failure_branch");
    const executor = workflowExecutorService(db);
    const result = await executor.startManualRun(seeded.companyId, seeded.workflow.id, { input: {} }, seeded.actor, "failure-branch");
    expect(result.run.status).toBe("succeeded");
    expect(result.steps.find((step) => step.nodeId === "broken")).toMatchObject({ status: "failed" });
    expect(result.steps.find((step) => step.nodeId === "recover")).toMatchObject({ status: "succeeded", outputJson: { recovered: "true" } });
    expect(result.steps.find((step) => step.nodeId === "success")?.status).toBe("skipped");
    // Simulate losing the worker immediately after a durable recovery checkpoint.
    await db.update(workflowRuns).set({ status: "running", finishedAt: null, executionOwnerId: "expired-worker", leaseExpiresAt: new Date(0) })
      .where(and(eq(workflowRuns.companyId, seeded.companyId), eq(workflowRuns.id, result.run.id)));
    await executor.recoverExpiredRuns(10, new Date());
    const recovered = await executor.getRun(seeded.companyId, result.run.id);
    expect(recovered?.run.status).toBe("succeeded");
    expect(recovered?.steps.filter((step) => step.nodeId === "broken")).toHaveLength(1);
    expect(recovered?.steps.filter((step) => step.nodeId === "recover")).toHaveLength(1);
  });
  it("continues with null only under an explicit nullable downstream contract", async () => {
    await expect(seed("continue_with_null", false)).rejects.toMatchObject({ status: 422 });
    const seeded = await seed("continue_with_null");
    const result = await workflowExecutorService(db).startManualRun(seeded.companyId, seeded.workflow.id, { input: {} }, seeded.actor, "nullable");
    expect(result.run.status).toBe("succeeded");
    expect(result.steps.find((step) => step.nodeId === "broken")).toMatchObject({ status: "failed", outputJson: null });
    expect(result.steps.find((step) => step.nodeId === "recover")?.outputJson).toEqual({ recovered: "true" });
  });
  it("parks the failed action for a bound human decision and does not repeat it", async () => {
    const seeded = await seed("wait_for_human");
    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(seeded.companyId, seeded.workflow.id, { input: {} }, seeded.actor, "human-recovery");
    expect(waiting.run.status).toBe("waiting");
    const wait = waiting.waits.find((item) => item.status === "active")!;
    expect(wait).toMatchObject({ nodeId: "broken", referenceType: "approval" });
    await approvalService(db).approve(wait.referenceId!, seeded.userId, "Continue through the explicit failure path");
    await executor.recoverExpiredRuns(10, new Date());
    const recovered = await executor.getRun(seeded.companyId, waiting.run.id);
    expect(recovered?.run.status).toBe("succeeded");
    expect(recovered?.steps.find((step) => step.nodeId === "broken")?.status).toBe("failed");
    expect(recovered?.steps.filter((step) => step.nodeId === "broken")).toHaveLength(1);
    expect(recovered?.steps.find((step) => step.nodeId === "recover")?.status).toBe("succeeded");
  });
  it("fails the workflow when human recovery is rejected", async () => {
    const seeded = await seed("wait_for_human");
    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(seeded.companyId, seeded.workflow.id, { input: {} }, seeded.actor, "rejected-recovery");
    await approvalService(db).reject(waiting.waits[0]!.referenceId!, seeded.userId, "Do not continue");
    await executor.recoverExpiredRuns(10, new Date());
    expect((await executor.getRun(seeded.companyId, waiting.run.id))?.run.status).toBe("failed");
  });
});
