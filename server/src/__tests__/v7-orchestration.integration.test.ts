import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentExecutionManifests, agents, companyMemberships, completionContracts, documentRevisions, documents, heartbeatRuns, issueDocuments, issueThreadInteractions, memoryBindings, memoryRecords, contextManifestMemoryRoots, issues, orchestrationPlans, orchestrationWorkerAttempts, toolInvocations, createDb } from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES, createOrchestrationPlanSchema, type CreateOrchestrationPlanInput } from "@paperclipai/shared";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { orchestrationRuntimeControl } from "../services/orchestration/orchestration-runtime-control.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { buildNativeExecutionInput } from "../services/native-runtime/native-execution-input.js";
import { nativeRuntimeContextFixture } from "../services/native-runtime/runtime-context.test-fixture.js";
import { prepareNativeHeartbeatRun } from "../services/native-runtime/prepare-native-run.js";
import { ensureNativeCompletionContract, nativeCompletionContractInput } from "../services/native-runtime/completion-contracts.js";
import { purgeMemoryRecords } from "../services/memory/memory-privacy.js";
import { assertAgentRunWriteAllowed } from "../agent-run-cancellation.js";
import { issueService } from "../services/issues.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 bounded canonical orchestration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, task: typeof issues.$inferSelect;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v7-orchestration-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true });
    f = await seedV5Presences(db);
    const providers = agentProviderBindingService(db), binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, isolationMode: "isolated_per_presence", providerEndpointRef: null });
    await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    await providers.recordDiscovery(f.home, f.presence.id, { provider: "paperclip_native", version: "local-orchestration-fixture", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    [task] = await db.insert(issues).values({ companyId: f.home, title: "Prepare a bounded internal evidence draft", status: "todo", assigneeAgentId: f.presence.id }).returning() as [typeof task];
  });
  const contract = () => ({ objective: "Save an internal draft with retained evidence", requiredOutputs: [{ key: "result" }], businessInvariants: ["Every claim cites retained authorized evidence"] });
  const input = (): CreateOrchestrationPlanInput => ({ issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(), riskClass: "C0", workload: "semantic", completionContract: contract(), budgets: {}, workers: [{ key: "worker", issueId: task.id }] });
  async function started(raw = input()) {
    const service = orchestrationService(db), plan = await service.create(f.actor, f.home, raw);
    return service.decide(f.actor, f.home, plan.id, { expectedVersion: plan.version, action: "start", rationale: "Start the explicitly bounded local fixture work" });
  }
  async function run(issueId = task.id) {
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running", contextSnapshot: { issueId } }).returning();
    const input = { companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId, query: "Prepare the authorized internal draft" };
    return { row: run!, input, prepare: () => agentRuntimeFabricService(db).prepare(input) };
  }
  async function parallel() {
    const [doc] = await db.insert(documents).values({ companyId: f.home, title: "Plan", latestBody: "Split the authorized draft into two joined work products" }).returning();
    const [revision] = await db.insert(documentRevisions).values({ companyId: f.home, documentId: doc!.id, revisionNumber: 1, body: doc!.latestBody }).returning();
    await db.update(documents).set({ latestRevisionId: revision!.id }).where(eq(documents.id, doc!.id));
    await db.insert(issueDocuments).values({ companyId: f.home, issueId: task.id, documentId: doc!.id, key: "plan" });
    await db.insert(issueThreadInteractions).values({ companyId: f.home, issueId: task.id, kind: "request_confirmation", status: "accepted", resolvedByUserId: f.userId,
      payload: { version: 1, prompt: "Accept the explicit split?", target: { type: "issue_document", issueId: task.id, key: "plan", revisionId: revision!.id } } });
    const result = await issueService(db).decomposeAcceptedPlan(task.id, { acceptedPlanRevisionId: revision!.id, actorUserId: f.userId, children: ["Research retained sources", "Write the joined draft"].map(title => ({ title, status: "todo", assigneeAgentId: f.presence.id, workMode: "standard", priority: "medium", blockParentUntilDone: true })) });
    [task] = await db.select().from(issues).where(eq(issues.id, task.id)) as [typeof task];
    return { raw: { ...input(), workload: "decomposable" as const, acceptedPlanRevisionId: revision!.id, budgets: { maxWorkerCount: 2, maxParallelWorkers: 1, maxDelegationDepth: 1, maxRetries: 1 }, workers: result.childIssueIds.map((childId, index) => ({ key: `worker${index}`, issueId: childId, dependsOn: index ? ["worker0"] : [], completionContract: contract() })) }, result };
  }
  it("keeps simple work single, retains its server contract across wake and blocks narrative-only completion", async () => {
    const plan = await started(); expect(plan.mode).toBe("single_worker");
    const native = await ensureNativeCompletionContract({ db, companyId: f.home, issue: task, actorId: f.presence.id, immediateRequest: "I claim everything is complete" });
    expect(native.row.id).toBe(plan.completionContractId); expect(native.row.completionAuthority).toBe("server_arbiter");
    expect((await db.select().from(completionContracts).where(eq(completionContracts.issueId, task.id)))).toHaveLength(1);
    const execution = await run(), prepared = await execution.prepare();
    const [attempt] = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, execution.row.id));
    expect(attempt).toMatchObject({ planId: plan.id, attempt: 1, executionManifestId: prepared!.record.id });
    const nativePrepared = await prepareNativeHeartbeatRun({ db, run: { ...execution.row, completionContractId: plan.completionContractId }, issue: task, environmentLeaseId: randomUUID() });
    expect(nativePrepared.completionContract.revision).toBe(String(native.row.revision));
    const wire = buildNativeExecutionInput({ companyId: f.home, runId: execution.row.id, agentId: f.presence.id, issue: { ...task, workMode: "standard" }, taskPrompt: task.title,
      workspace: { id: randomUUID(), cwd: "/workspace", repoUrl: null, repoRef: null, branchName: null }, normalizedSessionId: nativePrepared.normalizedSessionId, provider: "codex",
      completionContract: { id: native.row.id, sha256: native.row.canonicalSha256, schemaVersion: native.row.schemaVersion, contract: nativeCompletionContractInput(native.row.contractJson) }, runtimeContext: nativeRuntimeContextFixture() });
    expect(Object.keys(wire.completionContract.contract).sort()).toEqual(["criteria", "objective", "revision"]);
    await execution.prepare(); expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id))).toHaveLength(1);
    await expect(db.update(issues).set({ status: "done" }).where(eq(issues.id, task.id))).rejects.toThrow();
  });
  it("serializes concurrent admission, charges retries cumulatively and refuses budget resets", async () => {
    const plan = await started({ ...input(), budgets: { maxRetries: 1 } }), executions = await Promise.all([run(), run()]);
    const results = await Promise.allSettled(executions.map(execution => execution.prepare())); expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const winner = executions[results.findIndex(result => result.status === "fulfilled")]!;
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(heartbeatRuns.id, winner.row.id));
    await (await run()).prepare();
    const [second] = await db.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.planId, plan.id), eq(orchestrationWorkerAttempts.attempt, 2)));
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(heartbeatRuns.id, second!.runId!));
    await expect((await run()).prepare()).rejects.toMatchObject({ status: 403 });
    expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0]!.retriesUsed).toBe(1);
    await expect(db.update(orchestrationPlans).set({ retriesUsed: 0 }).where(eq(orchestrationPlans.id, plan.id))).rejects.toThrow();
  });
  it("fences writes and tool dispatch immediately on Pause and still permits control after feature rollback", async () => {
    const plan = await started(), execution = await run(); await execution.prepare();
    await orchestrationService(db).decide(f.actor, f.home, plan.id, { expectedVersion: 2, action: "pause", rationale: "Pause the worker before any new side effect" });
    const actor = { agentId: f.presence.id, runId: execution.row.id };
    await expect(db.transaction(tx => assertAgentRunWriteAllowed(tx as unknown as typeof db, f.home, actor))).rejects.toMatchObject({ status: 403 });
    await expect(execution.prepare()).rejects.toMatchObject({ status: 403 });
    await expect(db.insert(toolInvocations).values({ companyId: f.home, issueId: task.id, agentId: f.presence.id, runId: execution.row.id, toolName: "fixture_read", status: "executing" })).rejects.toThrow();
    await instanceSettingsService(db).updateExperimental({ orchestration_v7: false });
    expect(await orchestrationService(db).decide(f.actor, f.home, plan.id, { expectedVersion: 3, action: "cancel", rationale: "Cancel retained work after disabling the experimental feature" })).toMatchObject({ status: "cancelled" });
  });
  it("charges actual platform tool transitions once and blocks unadmitted or over-budget execution", async () => {
    const plan = await started({ ...input(), budgets: { maxToolActions: 1 } }), execution = await run(); await execution.prepare();
    const [first] = await db.insert(toolInvocations).values({ companyId: f.home, issueId: task.id, runId: execution.row.id, agentId: f.presence.id, toolName: "fixture_read" }).returning();
    await db.update(toolInvocations).set({ status: "executing" }).where(eq(toolInvocations.id, first!.id));
    await db.update(toolInvocations).set({ status: "executing" }).where(eq(toolInvocations.id, first!.id));
    expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0]!.toolActionsUsed).toBe(1);
    await expect(db.insert(toolInvocations).values({ companyId: f.home, issueId: task.id, runId: execution.row.id, agentId: f.presence.id, toolName: "second", status: "executing" })).rejects.toThrow();
    await expect(db.insert(toolInvocations).values({ companyId: f.home, issueId: task.id, agentId: f.presence.id, toolName: "no_manifest", status: "executing" })).rejects.toThrow();
  });
  it("reuses accepted canonical children, denies premature joins and unplanned delegation", async () => {
    const { raw, result } = await parallel(), plan = await started(raw);
    expect(plan.mode).toBe("planned_parallel"); expect((await orchestrationService(db).get(f.actor, f.home, plan.id)).workers.map(worker => worker.issueId).sort()).toEqual(result.childIssueIds.sort());
    await expect((await run(raw.workers[1]!.issueId)).prepare()).rejects.toMatchObject({ status: 403 });
    await (await run(raw.workers[0]!.issueId)).prepare();
    await expect((await run(task.id)).prepare()).rejects.toMatchObject({ status: 403 });
    await expect(db.insert(issues).values({ companyId: f.home, parentId: raw.workers[0]!.issueId, title: "Undeclared extra worker" })).rejects.toThrow();
  });
  it("requires current assignment and human membership, and preserves material assurance floors", async () => {
    const plan = await started(), execution = await run();
    await db.update(issues).set({ assigneeAgentId: null }).where(eq(issues.id, task.id)); await expect(execution.prepare()).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ assigneeAgentId: f.presence.id }).where(eq(issues.id, task.id));
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId))); await expect(execution.prepare()).rejects.toMatchObject({ status: 403 });
    expect(createOrchestrationPlanSchema.safeParse({ ...input(), actionClass: "financial_commitment", riskClass: "C0" }).success).toBe(false);
    await expect(orchestrationService(db).get({ ...f.actor, companyIds: [f.guest] }, f.guest, plan.id)).rejects.toMatchObject({ status: 404 });
  });
  it("routes deterministic Task work through the native Workflow engine and pins its published revision", async () => {
    const service = workflowService(db), actor = { principal: { type: "user" as const, userId: f.userId } }, workflow = await service.create(f.home, { name: "Bounded deterministic fixture" }, actor);
    const draft = await service.updateDraft(f.home, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} } }, actor);
    const published = await service.publish(f.home, workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, actor);
    const plan = await started({ ...input(), workload: "deterministic", workflowId: workflow.id }); expect(plan.mode).toBe("workflow_bound");
    const result = await workflowExecutorService(db).startTaskRun(f.home, task.id, workflow.id, { input: {}, revisionId: published.publishedRevisionId! }, actor, "bounded-workflow-fixture");
    expect(result.run.status).toBe("succeeded");
    expect((await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id)))[0]).toMatchObject({ runId: null, workflowRunId: result.run.id });
    await expect((await run()).prepare()).rejects.toMatchObject({ status: 403 });
  });
  it("uses canonical Stop after feature rollback", async () => {
    const plan = await started(), execution = await run(); await execution.prepare();
    await instanceSettingsService(db).updateExperimental({ orchestration_v7: false });
    await orchestrationService(db).decide(f.actor, f.home, plan.id, { expectedVersion: 2, action: "pause", rationale: "Stop all retained worker attempts after rollout rollback" });
    const stopped = await orchestrationRuntimeControl(db).stop(f.actor, f.home, plan.id, "Explicit human Stop of retained orchestration");
    expect(stopped.attempts).toMatchObject([{ stopRequested: true }]);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, execution.row.id)))[0]!.status).toBe("cancelled");
  });
  it("blocks material work on missing current Readiness instead of accepting the declared risk label", async () => {
    await started({ ...input(), riskClass: "C2", actionClass: "external_communication", completionContract: { ...contract(), requiredPostconditions: [{ kind: "tool_receipt", toolName: "approved_send", argumentsHash: "a".repeat(64), requireApproval: true }] } });
    await expect((await run()).prepare()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.companyId, f.home))).toEqual([]);
  });
  it("rejects cyclic joins and changed accepted decomposition versions", async () => {
    const { raw } = await parallel();
    expect(createOrchestrationPlanSchema.safeParse({ ...raw, workers: raw.workers.map((worker, index) => ({ ...worker, dependsOn: [raw.workers[index === 0 ? 1 : 0]!.key] })) }).success).toBe(false);
    const plan = await started(raw);
    await db.update(documents).set({ latestRevisionId: null }).where(eq(documents.latestRevisionId, raw.acceptedPlanRevisionId!));
    await expect((await run(raw.workers[0]!.issueId)).prepare()).rejects.toMatchObject({ status: 403 });
    expect(plan.mode).toBe("planned_parallel");
  });
  it("preserves the original deadline and rejects new work when it has expired", async () => {
    const plan = await started({ ...input(), budgets: { maxWallClockSeconds: 30 } }), execution = await run();
    const time = vi.spyOn(Date, "now").mockReturnValue(plan.startedAt!.getTime() + 30_001);
    try { await expect(execution.prepare()).rejects.toMatchObject({ status: 403 }); } finally { time.mockRestore(); }
    await expect(db.update(orchestrationPlans).set({ startedAt: new Date(Date.now() + 60000) }).where(eq(orchestrationPlans.id, plan.id))).rejects.toThrow();
  });
  it("erases retained completion prose and closes its plan when an admitted source is deleted", async () => {
    const plan = await started(), execution = await run(), prepared = await execution.prepare();
    const [binding] = await db.insert(memoryBindings).values({ companyId: f.home, key: "orchestration-privacy", name: "Source fixture", providerKey: "local" }).returning();
    const [record] = await db.insert(memoryRecords).values({ companyId: f.home, bindingId: binding!.id, providerKey: "local", memoryType: "fact", scopeType: "company", content: "Retained source facts", observedAt: new Date(), createdByActorType: "system", createdByActorId: "fixture" }).returning();
    await db.insert(contextManifestMemoryRoots).values({ companyId: f.home, manifestId: prepared!.record.contextManifestId, memoryRecordId: record!.id, sourceVersion: record!.updatedAt.toISOString() });
    await db.transaction(tx => purgeMemoryRecords(tx as unknown as typeof db, f.home, [record!.id]));
    expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0]).toMatchObject({ status: "failed", erasedAt: expect.any(Date) });
    expect((await db.select().from(completionContracts).where(eq(completionContracts.id, plan.completionContractId)))[0]!.contractJson).toEqual({ payloadDeleted: true });
    await expect(orchestrationService(db).get(f.actor, f.home, plan.id)).rejects.toMatchObject({ status: 404 });
    expect((await orchestrationService(db).get(f.actor, f.home, plan.id, true)).completionContract).toBeNull();
  });
  it("leaves a requested cost cap closed until a pre-spend broker is qualified", async () => {
    const service = orchestrationService(db), plan = await service.create(f.actor, f.home, { ...input(), budgets: { maxModelCostMinor: 500 } });
    await expect(service.decide(f.actor, f.home, plan.id, { expectedVersion: 1, action: "start", rationale: "Require a genuine pre-spend cap for this run" })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.companyId, f.home))).toEqual([]);
  });
});
