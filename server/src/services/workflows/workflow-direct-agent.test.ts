import { promises as fs } from "node:fs";
import path from "node:path";
import { createDurableRunLogStore } from "../run-log-store.js";
import { memoryJobService } from "../memory/memory-jobs.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentWakeupRequests, companies, companyMemberships, createDb, heartbeatRuns, heartbeatRunEvents,
  issues, issueComments, issueDocuments, documents, documentRevisions, workflowWaits, workflowStepRuns,
  completionContracts, nativeRunResults, agentTaskSessions, issueWorkProducts, memoryBindings, memoryRecords, memoryJobs, memoryDeletionMarkers, instanceUserRoles } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { workflowService } from "./workflow-service.js";
import { workflowExecutorService } from "./workflow-executor.js";
import { submitWorkflowDirectResult, workflowDirectAgentPrompt } from "./workflow-direct-agent.js";
import { memoryService } from "../memory/memory-service.js";
import { instanceSettingsService } from "../instance-settings.js";
import { heartbeatMemoryPayloadRetained, reapplyMemoryDeletionMarkers } from "../memory/memory-privacy.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
suite("Bounded Direct Agent Call", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-direct-call-"); db = createDb(temp.connectionString); }, 30_000);
  afterAll(async () => temp?.cleanup());
  async function seed() {
    const [company] = await db.insert(companies).values({ name: "Direct call", issuePrefix: `D${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const companyId = company!.id, userId = `owner-${randomUUID()}`;
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    const [agent] = await db.insert(agents).values({ companyId, name: "Bounded responder", status: "idle", adapterType: "process", role: "research" }).returning();
    const actor = { principal: { type: "user" as const, userId } };
    const service = workflowService(db), workflow = await service.create(companyId, { name: "Request response" }, actor);
    const draft = await service.updateDraft(companyId, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "call", type: "agent.direct_call", name: "Bounded call", position: { x: 100, y: 0 }, config: {
          agentId: agent!.id, objective: "Return the score", inputMapping: { value: "{{input.value}}" }, timeoutSeconds: 5,
          expectedOutputSchema: { type: "object", properties: { score: { type: "number" } }, required: ["score"], additionalProperties: false },
        } },
        { id: "done", type: "core.transform", name: "Result", position: { x: 200, y: 0 }, config: { mapping: { score: "{{input.score}}" } } },
      ], edges: [{ id: "entry", source: "start", target: "call" }, { id: "result", source: "call", target: "done" }], variables: [], settings: {},
    } }, actor);
    await service.publish(companyId, workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, actor);
    let executionId = "";
    const wakeup = vi.fn(async (agentId: string, input: any) => {
      const [existing] = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.idempotencyKey, input.idempotencyKey)));
      if (existing?.runId) return { id: existing.runId, agentId, status: "running" };
      const [wake] = await db.insert(agentWakeupRequests).values({ companyId, agentId, source: input.source, payload: input.payload,
        idempotencyKey: input.idempotencyKey, requestedByActorType: input.requestedByActorType, requestedByActorId: input.requestedByActorId }).returning();
      const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running", wakeupRequestId: wake!.id,
        contextSnapshot: input.contextSnapshot }).returning();
      executionId = run!.id;
      await db.update(agentWakeupRequests).set({ runId: executionId }).where(eq(agentWakeupRequests.id, wake!.id));
      return { id: executionId, agentId, status: "running" };
    });
    const cancelRun = vi.fn(async (id: string) => { await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, id)); });
    const executor = workflowExecutorService(db, { heartbeat: { wakeup, cancelRun } });
    const waiting = await executor.startManualRun(companyId, workflow.id, { input: { value: 7 } }, actor, randomUUID());
    return { companyId, userId, actor, agentId: agent!.id, workflow, waiting, executor, wakeup, cancelRun, executionId,
      result: { companyId, workflowRunId: waiting.run.id, nodeId: "call", agentId: agent!.id, heartbeatRunId: executionId, result: { score: 42 } } };
  }
  it("returns immutable validated output, resumes after recovery and never creates a Task", async () => {
    const seeded = await seed();
    expect(seeded.waiting.run.status).toBe("waiting");
    expect(seeded.executionId).not.toBe("");
    expect(await db.select().from(issues).where(eq(issues.companyId, seeded.companyId))).toHaveLength(0);
    const context = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.executionId)))[0]!.contextSnapshot!;
    expect(await workflowDirectAgentPrompt(db, seeded.companyId, seeded.agentId, seeded.executionId, context)).toContain("/direct-result");
    await expect(submitWorkflowDirectResult(db, { ...seeded.result, agentId: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await expect(submitWorkflowDirectResult(db, { ...seeded.result, result: { score: "wrong" } })).rejects.toMatchObject({ status: 422 });
    const accepted = await submitWorkflowDirectResult(db, seeded.result);
    expect(await submitWorkflowDirectResult(db, seeded.result)).toEqual(accepted);
    await expect(submitWorkflowDirectResult(db, { ...seeded.result, result: { score: 43 } })).rejects.toMatchObject({ status: 409 });
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, seeded.executionId));
    await seeded.executor.recoverExpiredRuns(10);
    const complete = await seeded.executor.getRun(seeded.companyId, seeded.waiting.run.id);
    expect(complete?.run.status).toBe("succeeded");
    expect(complete?.steps.find((step) => step.nodeId === "done")?.outputJson).toEqual({ score: 42 });
    expect(seeded.wakeup).toHaveBeenCalledOnce();
    await seeded.executor.recoverExpiredRuns(10);
    expect(seeded.wakeup).toHaveBeenCalledOnce();
  });
  it("recovers a lost dispatch binding through the same wake receipt without repeating the execution", async () => {
    const seeded = await seed();
    await db.update(workflowStepRuns).set({ heartbeatRunId: null }).where(and(eq(workflowStepRuns.workflowRunId, seeded.waiting.run.id), eq(workflowStepRuns.nodeId, "call")));
    await seeded.executor.recoverExpiredRuns(10);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, seeded.companyId))).toHaveLength(1);
    expect((await seeded.executor.getRun(seeded.companyId, seeded.waiting.run.id))?.steps.find((step) => step.nodeId === "call")?.heartbeatRunId).toBe(seeded.executionId);
    await seeded.executor.cancelRun(seeded.companyId, seeded.waiting.run.id, { reason: "Stop this call" }, seeded.actor);
    expect(seeded.cancelRun).toHaveBeenCalledWith(seeded.executionId, expect.anything(), expect.anything());
  });
  it("blocks prompt hydration and result submission when the initiating member is suspended", async () => {
    const seeded = await seed();
    const [execution] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.executionId));
    // Instance administration must not revive a revoked company delegation.
    await db.insert(instanceUserRoles).values({ userId: seeded.userId, role: "instance_admin" });
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(
      eq(companyMemberships.companyId, seeded.companyId), eq(companyMemberships.principalId, seeded.userId)));
    await expect(workflowDirectAgentPrompt(db, seeded.companyId, seeded.agentId, seeded.executionId,
      execution!.contextSnapshot as Record<string, unknown>)).rejects.toMatchObject({ status: 403 });
    await expect(submitWorkflowDirectResult(db, seeded.result)).rejects.toMatchObject({ status: 403 });
    const step = (await seeded.executor.getRun(seeded.companyId, seeded.waiting.run.id))?.steps.find((item) => item.nodeId === "call");
    expect(step?.taskResultAcceptedAt).toBeNull();
    await seeded.executor.recoverExpiredRuns(10);
    expect((await seeded.executor.getRun(seeded.companyId, seeded.waiting.run.id))?.run.status).toBe("failed");
    expect(seeded.cancelRun).toHaveBeenCalledWith(seeded.executionId, expect.anything(), expect.anything());
  });
  it("fails missing output and cancels the child when the call deadline expires", async () => {
    const missing = await seed();
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, missing.executionId));
    await missing.executor.recoverExpiredRuns(10);
    expect((await missing.executor.getRun(missing.companyId, missing.waiting.run.id))?.run).toMatchObject({ status: "failed", failureCode: "workflow_direct_agent_result_missing" });
    const expired = await seed();
    await expired.executor.recoverExpiredRuns(10, new Date(Date.now() + 10_000));
    expect(expired.cancelRun).toHaveBeenCalled();
    expect((await expired.executor.getRun(expired.companyId, expired.waiting.run.id))?.run.status).toBe("failed");
  });
  it("preserves a failed asynchronous call and follows its published failure branch", async () => {
    const seeded = await seed();
    await seeded.executor.cancelRun(seeded.companyId, seeded.waiting.run.id, { reason: "Configure a separate branch test" }, seeded.actor);
    const service = workflowService(db), detail = await service.getDetail(seeded.companyId, seeded.workflow.id);
    const graph = structuredClone(detail!.publishedRevision!.graph);
    graph.nodes.find((node) => node.id === "call")!.failurePolicy = "follow_failure_branch";
    graph.nodes.push({ id: "recover", type: "core.transform", name: "Recovered failure", position: { x: 200, y: 100 }, config: { mapping: { recovered: "handled" } } });
    graph.edges.find((edge) => edge.source === "call")!.sourceHandle = "success";
    graph.edges.push({ id: "failure", source: "call", target: "recover", sourceHandle: "failure" });
    const draft = await service.updateDraft(seeded.companyId, seeded.workflow.id, { expectedRevisionId: detail!.draftRevisionId!, graph }, seeded.actor);
    await service.publish(seeded.companyId, seeded.workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: detail!.publishedRevisionId, approvalId: null }, seeded.actor);
    const waiting = await seeded.executor.startManualRun(seeded.companyId, seeded.workflow.id, { input: { value: 7 } }, seeded.actor, "async-failure-branch");
    const childId = waiting.steps.find((step) => step.nodeId === "call")!.heartbeatRunId!;
    await db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, childId));
    await seeded.executor.recoverExpiredRuns(10);
    const completed = await seeded.executor.getRun(seeded.companyId, waiting.run.id);
    expect(completed?.run.status).toBe("succeeded");
    expect(completed?.steps.find((step) => step.nodeId === "call")?.status).toBe("failed");
    expect(completed?.steps.find((step) => step.nodeId === "done")?.status).toBe("skipped");
    expect(completed?.steps.find((step) => step.nodeId === "recover")?.outputJson).toEqual({ recovered: "handled" });
    expect(completed?.steps.filter((step) => step.nodeId === "call")).toHaveLength(1);
  });
  it("erases delegated payloads, queues log erasure and blocks late or restored agent writes", async () => {
    const seeded = await seed();
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
    const [binding] = await db.insert(memoryBindings).values({ companyId: seeded.companyId, key: "shared", name: "Shared", providerKey: "local", config: {} }).returning();
    const [record] = await db.insert(memoryRecords).values({ companyId: seeded.companyId, bindingId: binding!.id, providerKey: "local", memoryType: "observation",
      scopeType: "company", title: "Private source", content: "Private source data", summary: "Private source", observedAt: new Date(),
      reviewState: "accepted", verificationState: "human_verified", createdByActorType: "user", createdByActorId: seeded.userId }).returning();
    await db.update(workflowStepRuns).set({ memoryRecordIds: [record!.id] }).where(and(eq(workflowStepRuns.workflowRunId, seeded.waiting.run.id), eq(workflowStepRuns.nodeId, "call")));
    await db.update(heartbeatRuns).set({ logStore: "local_file", logRef: `${seeded.companyId}/${seeded.agentId}/${seeded.executionId}.ndjson`, stdoutExcerpt: "Private source" }).where(eq(heartbeatRuns.id, seeded.executionId));
    await db.insert(heartbeatRunEvents).values({ companyId: seeded.companyId, agentId: seeded.agentId, runId: seeded.executionId, seq: 1, eventType: "log", message: "Private source", payload: { data: "Private source" } });
    const [task] = await db.insert(issues).values({ companyId: seeded.companyId, title: "Private source task", description: "Private source" }).returning();
    await db.insert(workflowWaits).values({ companyId: seeded.companyId, workflowRunId: seeded.waiting.run.id, nodeId: "call", waitKey: "delegated-copy",
      kind: "task_completion", status: "resolved", referenceType: "issue", referenceId: task!.id, resolvedAt: new Date() });
    await db.insert(issueComments).values({ companyId: seeded.companyId, issueId: task!.id, body: "Private source" });
    const [document] = await db.insert(documents).values({ companyId: seeded.companyId, title: "Private source", latestBody: "Private source" }).returning();
    await db.insert(issueDocuments).values({ companyId: seeded.companyId, issueId: task!.id, documentId: document!.id, key: "result" });
    await db.insert(documentRevisions).values({ companyId: seeded.companyId, documentId: document!.id, revisionNumber: 1, title: "Private source", body: "Private source" });
    const [nativeContract] = await db.insert(completionContracts).values({ companyId: seeded.companyId, issueId: task!.id, revision: 1,
      schemaVersion: "fixture", policyVersion: "fixture", risk: "low", completionAuthority: "board", incompleteCriteriaPolicy: "block",
      contractJson: { source: "Private source" }, canonicalSha256: "a".repeat(64), createdByActorType: "user", createdByActorId: seeded.userId }).returning();
    await db.update(heartbeatRuns).set({ nativeIssueId: task!.id, completionContractId: nativeContract!.id }).where(eq(heartbeatRuns.id, seeded.executionId));
    const [nativeResult] = await db.insert(nativeRunResults).values({ companyId: seeded.companyId, issueId: task!.id, runId: seeded.executionId,
      completionContractId: nativeContract!.id, serverFingerprint: "fixture", schemaStatus: "valid", resultJson: { source: "Private source" }, canonicalSha256: "a".repeat(64) }).returning();
    await db.insert(agentTaskSessions).values({ companyId: seeded.companyId, agentId: seeded.agentId, adapterType: "process", taskKey: "fixture",
      lastRunId: seeded.executionId, sessionParamsJson: { source: "Private source" } });
    await db.insert(issueWorkProducts).values({ companyId: seeded.companyId, issueId: task!.id, type: "document", provider: "fixture", title: "Private source", status: "available", summary: "Private source" });
    const logDir = await fs.mkdtemp("/tmp/aw-private-log-");
    const logStore = createDurableRunLogStore({ basePath: logDir });
    const handle = await logStore.begin({ companyId: seeded.companyId, agentId: seeded.agentId, runId: seeded.executionId });
    await logStore.append(handle, { stream: "stdout", chunk: "Private source", ts: "fixture" });
    await memoryService(db).forget(seeded.companyId, record!.id, seeded.actor);
    expect((await db.select().from(nativeRunResults).where(eq(nativeRunResults.id, nativeResult!.id)))[0]?.resultJson).toEqual({ payloadDeleted: true });
    expect((await db.select().from(completionContracts).where(eq(completionContracts.id, nativeContract!.id)))[0]?.contractJson).toEqual({ payloadDeleted: true });
    expect((await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.lastRunId, seeded.executionId)))[0]?.sessionParamsJson).toBeNull();
    expect((await db.select().from(issueWorkProducts).where(eq(issueWorkProducts.issueId, task!.id)))[0]?.summary).toBeNull();
    await db.update(nativeRunResults).set({ resultJson: { source: "late private source" } }).where(eq(nativeRunResults.id, nativeResult!.id));
    expect((await db.select().from(nativeRunResults).where(eq(nativeRunResults.id, nativeResult!.id)))[0]?.resultJson).toEqual({ payloadDeleted: true });
    expect((await db.select().from(issues).where(eq(issues.id, task!.id)))[0]?.description).toBeNull();
    expect((await db.select().from(issueComments).where(eq(issueComments.issueId, task!.id)))[0]?.body).toBe("Source payload erased");
    expect((await db.select().from(documents).where(eq(documents.id, document!.id)))[0]?.latestBody).toBe("");
    expect((await db.select().from(documentRevisions).where(eq(documentRevisions.documentId, document!.id)))[0]?.body).toBe("");
    await db.update(issues).set({ description: "late source" }).where(eq(issues.id, task!.id));
    await db.update(documents).set({ latestBody: "late source" }).where(eq(documents.id, document!.id));
    expect((await db.select().from(issues).where(eq(issues.id, task!.id)))[0]?.description).toBeNull();
    expect((await db.select().from(documents).where(eq(documents.id, document!.id)))[0]?.latestBody).toBe("");
    const jobs = memoryJobService(db, { runLogStore: logStore });
    const claimed = await jobs.claimNext(new Date());
    expect(claimed?.sourceRefJson.kind).toBe("run_log_erasure");
    await jobs.executeClaimed(claimed!);
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, claimed!.id)))[0]?.status).toBe("succeeded");
    await expect(logStore.read(handle)).rejects.toMatchObject({ status: 404 });
    await expect(fs.readFile(path.join(logDir, handle.logRef))).rejects.toMatchObject({ code: "ENOENT" });
    await fs.rm(logDir, { recursive: true, force: true });

    expect(await heartbeatMemoryPayloadRetained(db, seeded.companyId, seeded.executionId)).toBe(false);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.executionId)))[0]).toMatchObject({ contextSnapshot: {}, resultJson: null, stdoutExcerpt: null, logRef: null });
    expect((await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, seeded.executionId)))[0]?.message).toBeNull();
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.companyId, seeded.companyId))).some((job) => job.sourceRefJson.kind === "run_log_erasure")).toBe(true);
    await db.update(heartbeatRuns).set({ stdoutExcerpt: "late private source", contextSnapshot: { private: true }, resultJson: { private: true } }).where(eq(heartbeatRuns.id, seeded.executionId));
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.executionId)))[0]).toMatchObject({ stdoutExcerpt: null, contextSnapshot: {}, resultJson: null });
    await db.update(memoryRecords).set({ deletedAt: null, content: "restored private source" }).where(eq(memoryRecords.id, record!.id));
    expect(await db.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId, seeded.companyId))).not.toHaveLength(0);
    expect(await heartbeatMemoryPayloadRetained(db, seeded.companyId, seeded.executionId)).toBe(false);
    await reapplyMemoryDeletionMarkers(db, seeded.companyId);
    expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id, record!.id)))[0]?.content).toBe("");
  });
});
