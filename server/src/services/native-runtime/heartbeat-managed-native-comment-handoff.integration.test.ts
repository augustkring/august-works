import { randomUUID } from "node:crypto";
import { nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { agentWakeupRequests, agents, createDb, environmentLeases, heartbeatRuns, issueComments, issueDocuments, issues, nativeRunFinalizations, nativeRunResults, orchestrationModelReservations, orchestrationWorkerAttempts, runtimeSandboxBindings } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { withManagedNativeHeartbeatFixture } from "../../__tests__/helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { issueService } from "../issues.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { instanceSettingsService } from "../instance-settings.js";
import { readRunLeaseCleanup, verifyNativeCleanupRuntimeState } from "../execution-sandbox/run-lease-cleanup.js";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home = "";
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "managed-native-comment-handoff-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", `managed-native-comment-handoff-${randomUUID()}`);
  vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-native-comment-handoff-${randomUUID()}-${randomUUID()}`);
  database = await startEmbeddedPostgresTestDatabase("managed-native-comment-handoff-");
  db = createDb(database.connectionString, { maxConnections: 3 });
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
    readiness_engine_v7: true, orchestration_v7: true, role_packs_v5: false, skill_resolver_v5: false });
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
}, 30_000);

async function bounded<T>(promise: Promise<T>, label: string, ms = 120_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`managed_native_comment_handoff_timeout_${label}`)), ms);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function waitFor<T>(read: () => Promise<T | null | undefined>, label: string, ms = 45_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value != null) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`managed_native_comment_handoff_timeout_${label}`);
}
function tool(body: Record<string, unknown>, name: string): string {
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  const found = tools.find(row => row.name === name || ["paperclip__", "paperclip_", "paperclip."]
    .some(prefix => row.name === `${prefix}${name}`));
  if (typeof found?.name !== "string") throw new Error(`managed_native_comment_handoff_tool_missing_${name}`);
  return found.name;
}
function toolUse(body: Record<string, unknown>, name: string, id: string, input: Record<string, unknown>) {
  return { stop_reason: "tool_use" as const,
    content: [{ type: "tool_use", id, name: tool(body, name), input }] };
}
function finish(body: Record<string, unknown>, execution: Pick<NativeExecutionInput, "completionContract">, id: string) {
  const contract = execution.completionContract.contract;
  return toolUse(body, "paperclip_finish", id, { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
    summary: "Completed the admitted Task before handing off the saved Human comments.", completionClaim: {
      contractRevision: contract.revision, objectiveSatisfied: true,
      criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })),
      remainingWork: [],
    }, evidence: [], verification: [], attentionRequests: [], artifacts: [] });
}

it("retains late Human comments across Native cleanup failure and promotes after real reconciliation", async () => {
  const commentBodies = ["Please carry this input forward.", "Also preserve this second note."] as const;
  let dispatchResolve!: (facts: { runId: string; companyId: string; issueId: string }) => void;
  const dispatched = new Promise<{ runId: string; companyId: string; issueId: string }>(resolve => { dispatchResolve = resolve; });
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>(resolve => { releaseFirstResponse = resolve; });
  let actualStopReached!: () => void;
  const actualStopGate = new Promise<void>(resolve => { actualStopReached = resolve; });
  let injectedCleanupFailure = false;
  let predecessorRunId = "", firstTaskId = "", firstResponseHeld = false, sawSuccessorComment = false;
  let providerCalls = 0;

  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial",
    afterManagedSandboxStopReceipt: async ({ scope }) => {
      if (scope.runId !== predecessorRunId || injectedCleanupFailure) return;
      injectedCleanupFailure = true;
      actualStopReached();
      // The real signed Host Stop already completed. Fail before the normal
      // environment-runtime receipt/release publication to exercise pending cleanup.
      throw new Error("fixture_native_cleanup_receipt_publication_failed");
    },
    providerReply: ({ body, callIndex, execution, runId, issueId }) => {
      providerCalls++;
      if (!predecessorRunId && issueId === firstTaskId) predecessorRunId = runId;
      if (runId === predecessorRunId) {
        if (callIndex === 1) return toolUse(body, "write_document", "handoff-predecessor-output", {
          idempotencyKey: randomUUID(), key: "result", title: "Accepted predecessor result",
          body: "The genuine Native predecessor completed its declared output.", baseRevisionId: null });
        if (callIndex === 2) return finish(body, execution, "handoff-predecessor-finish");
        if (callIndex === 3) return { stop_reason: "end_turn", content: [{ type: "text", text: "Finished." }] };
      }
      if (callIndex === 1) return finish(body, execution, "handoff-successor-finish");
      if (callIndex === 2) return { stop_reason: "end_turn", content: [{ type: "text", text: "Finished." }] };
      throw new Error(`managed_native_comment_handoff_unexpected_provider_call_${callIndex}`);
    },
    beforeProviderResponse: async ({ run, issueId, companyId }) => {
      if (run.nativeIssueId !== firstTaskId || firstResponseHeld) return;
      predecessorRunId = run.id;
      firstResponseHeld = true;
      expect(run).toMatchObject({ runtimeMode: "native", status: "running", nativeIssueId: issueId });
      dispatchResolve({ runId: run.id, companyId, issueId });
      await bounded(firstResponseGate, "first_real_provider_response");
    },
    beforeManagedModelRequest: async ({ runId, body }) => {
      if (!predecessorRunId || runId === predecessorRunId) return;
      const serialized = JSON.stringify(body);
      sawSuccessorComment ||= commentBodies.every(text => serialized.includes(text));
    },
    driveScheduler: async ({ actor, companyId, agentId, heartbeat, humanApi, factsForRun, closeManagedAgentHostForRun }) => {
      if (!actor.userId) throw new Error("managed_native_comment_handoff_current_human_missing");
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
      const task = await issueService(db).create(companyId, { title: "Native comment handoff",
        description: "Promote actual accepted Human comments after a managed Native executor settles.", status: "todo",
        responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId }, db, undefined,
        { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      firstTaskId = task.id;
      const planService = orchestrationService(db);
      const plan = await planService.create(actor, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Finish the Task and deliver the saved Human comments to a successor",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["No accepted Human input is lost"] },
        budgets: { maxModelCostMinor: 20, maxToolActions: 8, maxRetries: 1 }, workers: [{ key: "writer", issueId: task.id }] });
      await planService.decide(actor, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Current Human authorizes bounded Native handoff" });
      const firstWake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId,
        payload: { issueId: task.id }, contextSnapshot: { issueId: task.id } });
      if (!firstWake) throw new Error("managed_native_comment_handoff_predecessor_wake_missing");
      await bounded(dispatched, "predecessor_provider_dispatch");
      expect(predecessorRunId).toBe(firstWake.id);
      let settled = false;
      try {
      const [predecessorLease] = await db.select().from(environmentLeases).where(and(
        eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, firstWake.id)));
      expect(predecessorLease).toBeTruthy();
      const cleanupOwner = await readRunLeaseCleanup(db, { companyId, runId: firstWake.id, leaseId: predecessorLease!.id });
      releaseFirstResponse();
      const executionDrain = heartbeat.drainActiveRunExecutions();
      await bounded(actualStopGate, "actual_signed_stop_before_cleanup_failure");
      await bounded(executionDrain, "executor_finally_after_cleanup_failure", 180_000);
      await waitFor(async () => db.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, cleanupOwner.session.bindingId),
        eq(runtimeSandboxBindings.runtimeCellId, cleanupOwner.session.cellId),
        eq(runtimeSandboxBindings.cellGeneration, cleanupOwner.session.cellGeneration),
      )).then(rows => rows[0]?.status === "stopped" ? rows[0] : null), "actual_signed_sandbox_stop");
      const failedLease = await waitFor(async () => db.select().from(environmentLeases).where(eq(environmentLeases.id, predecessorLease!.id))
        .then(rows => rows[0]?.status === "pending_cleanup" && rows[0]?.cleanupStatus === "failed" ? rows[0] : null), "actual_cleanup_failure_persisted");
      const [predecessorDuringFailure] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, firstWake.id));
      expect(predecessorDuringFailure).toMatchObject({ runtimeMode: "native", status: "succeeded", nativePhase: "committed" });
      const [ownerDuringFailure] = await db.select({ executionRunId: issues.executionRunId }).from(issues).where(eq(issues.id, task.id));
      expect(ownerDuringFailure?.executionRunId).toBe(firstWake.id);

      // These Human comments arrive only after the executor's cleanup has failed.
      const acceptedIds: string[] = [];
      for (const body of commentBodies) {
        const response = await request(humanApi.app).post(`/api/issues/${task.id}/comments`)
          .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost")
          .send({ body, clientRequestId: randomUUID() });
        expect(response.status).toBe(201);
        acceptedIds.push(response.body.id as string);
      }
      expect(acceptedIds.every(Boolean)).toBe(true);
      const [taskAfterHumanComment] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, task.id));
      // This Task remains active under its original current-Human plan. A
      // comment is continuation input; it does not imply the separate Todo
      // transition that the board route requires an explicit move-to-Todo for.
      expect(taskAfterHumanComment?.status).toBe("in_progress");
      const deferred = await waitFor(async () => db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.status, "deferred_issue_execution"),
      )).then(rows => rows.find(row => row.payload?.issueId === task.id)), "late_comment_deferred_while_predecessor_owns_issue");
      expect((deferred.payload?._paperclipWakeContext as Record<string, unknown> | undefined)?.wakeCommentIds).toEqual(acceptedIds);
      expect(deferred.runId).toBeNull();
      await heartbeat.resumeQueuedRuns();
      const [stillDeferred] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferred.id));
      expect(stillDeferred).toMatchObject({ status: "deferred_issue_execution", runId: null });
      const [stillOwned] = await db.select({ executionRunId: issues.executionRunId }).from(issues).where(eq(issues.id, task.id));
      expect(stillOwned?.executionRunId).toBe(firstWake.id);
      const duringCleanup = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, task.id)));
      expect(duringCleanup.map(row => row.id)).toEqual([firstWake.id]);

      const reconciled = await heartbeat.sweepPendingCleanupLeases({ backoffMs: 0 });
      expect(reconciled.destroyed).toBe(1);
      const finalLeases = await db.select().from(environmentLeases).where(eq(environmentLeases.id, failedLease.id));
      expect(finalLeases[0]).toMatchObject({ cleanupStatus: "success", releasedAt: expect.any(Date) });
      expect(await verifyNativeCleanupRuntimeState(db, { companyId, runId: firstWake.id, leaseId: predecessorLease!.id },
        finalLeases[0]!.metadata?.remoteExecutionTermination)).toMatchObject({ state: "stopped", runId: firstWake.id, leaseId: predecessorLease!.id });
      await heartbeat.resumeQueuedRuns();
      const [predecessor] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, firstWake.id));
      expect(predecessor).toMatchObject({ runtimeMode: "native", status: "succeeded", nativePhase: "committed" });
      const [predecessorFinalization] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, firstWake.id));
      expect(predecessorFinalization).toMatchObject({ phase: "committed", leaseOwner: null });
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, firstWake.id))).toHaveLength(1);
      const [taskAfter] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
      expect(taskAfter?.executionRunId).not.toBe(firstWake.id);

      const [promoted] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferred.id));
      expect(promoted?.status).toBe("coalesced");
      expect(promoted?.runId).toBeTruthy();
      expect(promoted?.runId).not.toBe(firstWake.id);
      const [successor] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, promoted!.runId!));
      expect(successor).toMatchObject({ runtimeMode: "native", nativeIssueId: task.id, agentId });
      expect(successor?.contextSnapshot?.wakeCommentIds).toEqual(acceptedIds);
      const taskRuns = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, task.id)));
      expect(taskRuns.map(row => row.id).sort()).toEqual([firstWake.id, successor!.id].sort());
      expect(sawSuccessorComment).toBe(true);
      expect(providerCalls).toBeGreaterThanOrEqual(4);
      await closeManagedAgentHostForRun(successor!.id);
      await closeManagedAgentHostForRun(firstWake.id);
      settled = true;
      } finally {
        releaseFirstResponse();
        if (!settled) await bounded(heartbeat.drainActiveRunExecutions(), "failure_cleanup_drain", 180_000).catch(() => undefined);
      }
    },
  });
}, 300_000);

it("holds a same-Task wake during real Native cleanup while admitting an unrelated Task", async () => {
  let predecessorRunId = "", predecessorIssueId = "", unrelatedIssueId = "";
  let releaseFirstResponse!: () => void, firstResponseStarted!: () => void;
  const firstResponseGate = new Promise<void>(resolve => { releaseFirstResponse = resolve; });
  const firstResponseStartedGate = new Promise<void>(resolve => { firstResponseStarted = resolve; });
  let releaseFinalizer!: () => void, actualStopReached!: () => void;
  const finalizerGate = new Promise<void>(resolve => { releaseFinalizer = resolve; });
  const actualStopGate = new Promise<void>(resolve => { actualStopReached = resolve; });
  let unrelatedProviderStarted!: () => void;
  const unrelatedProviderGate = new Promise<void>(resolve => { unrelatedProviderStarted = resolve; });
  let heldFirstResponse = false, heldFinalizer = false, successorCommentSeen = false;
  let sameTaskCommentId = "", sameTaskCommentBody = "", successorRunId = "";
  let successorProviderFinished!: () => void;
  const successorProviderFinishedGate = new Promise<void>(resolve => { successorProviderFinished = resolve; });

  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "concurrent",
    afterManagedSandboxStopReceipt: async ({ scope, receipt }) => {
      if (scope.runId !== predecessorRunId || heldFinalizer) return;
      heldFinalizer = true;
      const [runAtStop] = await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, scope.companyId), eq(heartbeatRuns.id, scope.runId)));
      expect(runAtStop).toMatchObject({ runtimeMode: "native", status: "succeeded", nativePhase: "committed" });
      const [leaseAtStop] = await db.select().from(environmentLeases).where(and(
        eq(environmentLeases.companyId, scope.companyId), eq(environmentLeases.id, scope.leaseId),
        eq(environmentLeases.heartbeatRunId, scope.runId)));
      expect(leaseAtStop).toBeTruthy();
      expect(leaseAtStop?.releasedAt).toBeNull();
      expect(await verifyNativeCleanupRuntimeState(db, scope, receipt)).toMatchObject({
        state: "stopped", runId: scope.runId, leaseId: scope.leaseId,
      });
      actualStopReached();
      // Keep the real executor inside finalization after the signed Host Stop;
      // no persisted run or cleanup receipt is manufactured by the fixture.
      await bounded(finalizerGate, "predecessor_finalizer_hold", 180_000);
    },
    providerReply: ({ body, callIndex, execution, issueId, runId }) => {
      if (issueId === unrelatedIssueId && callIndex === 1) unrelatedProviderStarted();
      const sameTaskSuccessor = issueId === predecessorIssueId && runId !== predecessorRunId && heldFinalizer;
      const id = sameTaskSuccessor ? "same-task-successor" : issueId === predecessorIssueId ? "predecessor" : "unrelated";
      if (sameTaskSuccessor && callIndex === 1) {
        successorRunId = runId;
        expect(JSON.stringify(body)).toContain(sameTaskCommentBody);
        successorCommentSeen = true;
        return finish(body, execution, "cleanup-successor-finish");
      }
      if (sameTaskSuccessor && callIndex === 2) {
        successorProviderFinished();
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Finished." }] };
      }
      if (callIndex === 1) return toolUse(body, "write_document", `${id}-output`, {
        idempotencyKey: randomUUID(), key: "result", title: `${id} actual Native result`,
        body: `Actual managed Native result for ${id} Task.`, baseRevisionId: null });
      if (callIndex === 2) return finish(body, execution, `${id}-finish`);
      if (callIndex === 3) return { stop_reason: "end_turn", content: [{ type: "text", text: "Finished." }] };
      throw new Error(`managed_native_cleanup_admission_unexpected_call_${id}_${callIndex}`);
    },
    beforeProviderResponse: async ({ run, issueId }) => {
      if (issueId !== predecessorIssueId || heldFirstResponse) return;
      predecessorRunId = run.id;
      heldFirstResponse = true;
      firstResponseStarted();
      await bounded(firstResponseGate, "predecessor_provider_response", 180_000);
    },
    driveScheduler: async ({ actor, companyId, agentId, heartbeat, humanApi, closeManagedAgentHostForRun }) => {
      if (!actor.userId) throw new Error("managed_native_cleanup_admission_current_human_missing");
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 2 } } }).where(eq(agents.id, agentId));
      const orchestration = orchestrationService(db);
      const createPlannedTask = async (title: string) => {
        const task = await issueService(db).create(companyId, { title,
          description: "Verify issue-scoped Native cleanup admission with a real bounded Task.", status: "todo",
          responsibleUserId: actor.userId!, createdByUserId: actor.userId!, assigneeAgentId: agentId }, db, undefined,
          { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
        const plan = await orchestration.create(actor, companyId, { issueId: task.id,
          expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
          completionContract: { objective: `Complete ${title} with a bounded saved result`,
            requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["No cross-Task ownership"] },
          budgets: { maxModelCostMinor: 20, maxToolActions: 8, maxRetries: 1 }, workers: [{ key: "writer", issueId: task.id }] });
        await orchestration.decide(actor, companyId, plan.id, { expectedVersion: plan.version,
          action: "start", rationale: "Current Human authorizes this independent bounded Task" });
        return { task, plan };
      };
      let settled = false;
      try {
      const predecessorSetup = await createPlannedTask("Native cleanup predecessor");
      const predecessor = predecessorSetup.task;
      predecessorIssueId = predecessor.id;
      const predecessorWake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId,
        payload: { issueId: predecessor.id }, contextSnapshot: { issueId: predecessor.id } });
      if (!predecessorWake) throw new Error("managed_native_cleanup_admission_predecessor_wake_missing");
      await bounded(firstResponseStartedGate, "predecessor_dispatch");
      releaseFirstResponse();
      await bounded(actualStopGate, "predecessor_actual_signed_stop", 180_000);
      const [predecessorLease] = await db.select().from(environmentLeases).where(and(
        eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, predecessorWake.id)));
      expect(predecessorLease).toBeTruthy();
      const cleanupOwner = await readRunLeaseCleanup(db, { companyId, runId: predecessorWake.id, leaseId: predecessorLease!.id });
      expect(await verifyNativeCleanupRuntimeState(db,
        { companyId, runId: predecessorWake.id, leaseId: predecessorLease!.id },
        predecessorLease!.metadata?.remoteExecutionTermination)).toMatchObject({
          state: "stopped", runId: predecessorWake.id, leaseId: predecessorLease!.id,
        });
      expect(cleanupOwner).toMatchObject({ runId: predecessorWake.id, leaseId: predecessorLease!.id });
      const [committedPredecessor] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, predecessorWake.id));
      expect(committedPredecessor).toMatchObject({ runtimeMode: "native", status: "succeeded", nativePhase: "committed" });
      const [predecessorResult] = await db.select({ id: issueDocuments.id }).from(issueDocuments).where(and(
        eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, predecessor.id), eq(issueDocuments.key, "result")));
      expect(predecessorResult).toBeTruthy();
      const [stillOwned] = await db.select({ executionRunId: issues.executionRunId }).from(issues).where(eq(issues.id, predecessor.id));
      expect(stillOwned?.executionRunId).toBe(predecessorWake.id);
      sameTaskCommentBody = "Keep this accepted input for the same Task after cleanup.";
      const humanComment = await request(humanApi.app).post(`/api/issues/${predecessor.id}/comments`)
        .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost")
        .send({ body: sameTaskCommentBody, clientRequestId: randomUUID() });
      expect(humanComment.status).toBe(201);
      sameTaskCommentId = humanComment.body.id as string;
      const [issueAfterComment] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, predecessor.id));
      expect(issueAfterComment?.status).toBe("in_review");
      const deferred = await waitFor(async () => db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.status, "deferred_issue_execution"),
      )).then(rows => rows.find(wake => wake.payload?.issueId === predecessor.id) ?? null), "same_task_wake_deferred_during_cleanup");
      expect((deferred.payload?._paperclipWakeContext as Record<string, unknown> | undefined)?.wakeCommentIds)
        .toContain(sameTaskCommentId);
      await heartbeat.resumeQueuedRuns();
      const [stillDeferred] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferred.id));
      expect(stillDeferred).toMatchObject({ status: "deferred_issue_execution", runId: null });
      const predecessorRunsDuringCleanup = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, predecessor.id)));
      expect(predecessorRunsDuringCleanup.map(run => run.id)).toEqual([predecessorWake.id]);

      const unrelatedSetup = await createPlannedTask("Native cleanup unrelated Task");
      const unrelated = unrelatedSetup.task;
      unrelatedIssueId = unrelated.id;
      const unrelatedWake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId,
        payload: { issueId: unrelated.id }, contextSnapshot: { issueId: unrelated.id } });
      if (!unrelatedWake) throw new Error("managed_native_cleanup_admission_unrelated_wake_missing");
      await bounded(unrelatedProviderGate, "unrelated_actual_provider_dispatch", 180_000);
      const [unrelatedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, unrelatedWake.id));
      expect(unrelatedRun).toMatchObject({ runtimeMode: "native", nativeIssueId: unrelated.id, agentId });
      const [unrelatedLease] = await db.select({ id: environmentLeases.id, heartbeatRunId: environmentLeases.heartbeatRunId })
        .from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
          eq(environmentLeases.heartbeatRunId, unrelatedWake.id)));
      expect(unrelatedLease).toMatchObject({ heartbeatRunId: unrelatedWake.id });
      expect(unrelatedLease?.id).not.toBe(predecessorLease!.id);
      const [predecessorStillOwned] = await db.select({ executionRunId: issues.executionRunId }).from(issues).where(eq(issues.id, predecessor.id));
      expect(predecessorStillOwned?.executionRunId).toBe(predecessorWake.id);
      expect(unrelatedRun?.id).not.toBe(predecessorWake.id);

      releaseFinalizer();
      const [predecessorAfter] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, predecessorWake.id));
      expect(predecessorAfter).toMatchObject({ status: "succeeded", nativePhase: "committed" });
      const predecessorLeaseAfter = await waitFor(async () => db.select().from(environmentLeases)
        .where(eq(environmentLeases.id, predecessorLease!.id)).then(rows => rows[0]?.releasedAt ? rows[0] : null),
        "predecessor_exact_lease_released");
      expect(predecessorLeaseAfter).toMatchObject({ status: "released", cleanupStatus: "success", releasedAt: expect.any(Date) });
      expect(await verifyNativeCleanupRuntimeState(db,
        { companyId, runId: predecessorWake.id, leaseId: predecessorLease!.id },
        predecessorLeaseAfter.metadata?.remoteExecutionTermination)).toMatchObject({
          state: "stopped", runId: predecessorWake.id, leaseId: predecessorLease!.id,
        });
      const [predecessorFinalizationAfter] = await db.select().from(nativeRunFinalizations)
        .where(eq(nativeRunFinalizations.runId, predecessorWake.id));
      expect(predecessorFinalizationAfter).toMatchObject({ phase: "committed", leaseOwner: null });
      const promotedWake = await waitFor(async () => db.select().from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, deferred.id)).then(rows => rows[0]?.runId ? rows[0] : null),
        "same_task_comment_promoted_by_native_release");
      expect(promotedWake.status).not.toBe("deferred_issue_execution");
      expect(promotedWake.runId).not.toBe(predecessorWake.id);
      expect((promotedWake.payload?._paperclipWakeContext as Record<string, unknown> | undefined)?.wakeCommentIds)
        .toContain(sameTaskCommentId);
      const successorRunIdFromWake = promotedWake.runId!;
      const [ownerAtSuccessorAdmission] = await db.select({ executionRunId: issues.executionRunId })
        .from(issues).where(eq(issues.id, predecessor.id));
      expect(ownerAtSuccessorAdmission?.executionRunId).toBe(successorRunIdFromWake);
      const successorRun = await waitFor(async () => {
        const run = await heartbeat.getRun(successorRunIdFromWake);
        if (run?.status === "failed") throw new Error(`cleanup_successor_preselection_failed:${run.errorCode ?? "unknown"}`);
        return run?.runtimeMode === "native" && ["queued", "running", "succeeded"].includes(run.status) ? run : null;
      }, "same_task_comment_successor_run");
      expect(successorRun).toMatchObject({ runtimeMode: "native", nativeIssueId: predecessor.id });
      await bounded(successorProviderFinishedGate, "same_task_successor_provider_consumed_comment", 90_000);
      expect(successorRunId).toBe(successorRunIdFromWake);
      expect(successorCommentSeen).toBe(true);
      await bounded(heartbeat.drainActiveRunExecutions(), "predecessor_unrelated_and_same_task_successor_settled", 180_000);
      const [successorAfter] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, successorRunIdFromWake));
      const [unrelatedAfter] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, unrelatedWake.id));
      expect(successorAfter).toMatchObject({ runtimeMode: "native", status: "succeeded", nativePhase: "committed" });
      expect(unrelatedAfter).toMatchObject({ status: "succeeded", nativePhase: "committed" });
      const successorProfile = successorAfter!.runnerProfileJson as Record<string, unknown>;
      const successorReceipt = nativeRunInputSourceReceiptSchema.parse(successorProfile.nativeInputSourceReceipt);
      const successorCommentSource = successorReceipt.bootstrap.inputs.find((source): source is Extract<NativePayloadSourceInput,
        { kind: "comment" }> => source.kind === "comment" && source.commentId === sameTaskCommentId);
      expect(successorCommentSource).toMatchObject({ kind: "comment", issueId: predecessor.id, commentId: sameTaskCommentId });
      const [issueAfterSuccessor] = await db.select({ status: issues.status, executionRunId: issues.executionRunId })
        .from(issues).where(eq(issues.id, predecessor.id));
      expect(issueAfterSuccessor).toMatchObject({ status: "in_review", executionRunId: null });
      const persistedPlan = await orchestration.get(actor, companyId, predecessorSetup.plan.id);
      expect(persistedPlan).toMatchObject({ status: "running", retriesUsed: 1 });
      const samePlanAttempts = persistedPlan.attempts.filter(attempt => attempt.workerId === persistedPlan.workers[0]?.id);
      expect(samePlanAttempts.map(attempt => attempt.runId).sort()).toEqual([predecessorWake.id, successorRunIdFromWake].sort());
      expect(samePlanAttempts).toHaveLength(2);
      const [predecessorAttempt] = samePlanAttempts.filter(attempt => attempt.runId === predecessorWake.id);
      const [successorAttempt] = samePlanAttempts.filter(attempt => attempt.runId === successorRunIdFromWake);
      expect(predecessorAttempt?.status).toBe("succeeded");
      expect(successorAttempt?.status).toBe("running");
      const [unrelatedFinalIssueOwner] = await db.select({ executionRunId: issues.executionRunId })
        .from(issues).where(eq(issues.id, unrelated.id));
      expect(unrelatedFinalIssueOwner?.executionRunId).not.toBe(unrelatedWake.id);
      await closeManagedAgentHostForRun(predecessorWake.id);
      await closeManagedAgentHostForRun(unrelatedWake.id);
      await closeManagedAgentHostForRun(successorRunIdFromWake);
      settled = true;
      } finally {
        releaseFirstResponse();
        releaseFinalizer();
        if (!settled)
          await bounded(heartbeat.drainActiveRunExecutions(), "cleanup_admission_failure_drain", 180_000).catch(() => undefined);
      }
    },
  });
}, 300_000);

it("delivers an accepted comment after explicit live Native operator interruption with exact source binding", async () => {
  const commentBody = "Please carry this live-turn input forward.";
  let dispatchResolve!: (facts: { runId: string; companyId: string; issueId: string }) => void;
  const dispatched = new Promise<{ runId: string; companyId: string; issueId: string }>(resolve => { dispatchResolve = resolve; });
  let releasePreDispatch!: () => void;
  const preDispatchGate = new Promise<void>(resolve => { releasePreDispatch = resolve; });
  let actualStopReached!: () => void;
  const actualStopGate = new Promise<void>(resolve => { actualStopReached = resolve; });
  let predecessorRunId = "", firstTaskId = "", fixtureCompanyId = "", preDispatchHeld = false, sawSuccessorComment = false, providerCalls = 0;

  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial",
    afterManagedSandboxStopReceipt: async ({ scope }) => {
      if (scope.runId === predecessorRunId) actualStopReached();
    },
    providerReply: ({ body, callIndex, execution, runId }) => {
      providerCalls++;
      if (runId === predecessorRunId) {
        return { stop_reason: "end_turn", content: [{ type: "text", text: `predecessor response ${callIndex}` }] };
      }
      if (callIndex === 1) return toolUse(body, "write_document", "operator-interrupt-successor-output", {
        idempotencyKey: randomUUID(), key: "result", title: "Interrupted CLI input result",
        body: "The successor used the exact accepted Human comment source.", baseRevisionId: null });
      if (callIndex === 2) return finish(body, execution, "operator-interrupt-successor-finish");
      if (callIndex === 3) return { stop_reason: "end_turn", content: [{ type: "text", text: "Finished." }] };
      throw new Error(`managed_native_operator_interrupt_unexpected_call_${callIndex}`);
    },
    beforeManagedModelRequest: async ({ runId, issueId, body }) => {
      if (issueId === firstTaskId && !preDispatchHeld) {
        preDispatchHeld = true;
        predecessorRunId = runId;
        dispatchResolve({ runId, companyId: fixtureCompanyId, issueId });
        // The SDK reached the authenticated Host boundary, but the gateway has
        // not quoted, reserved or sent this request to the configured provider.
        await bounded(preDispatchGate, "authenticated_native_request_before_gateway_dispatch");
        return;
      }
      if (runId !== predecessorRunId) sawSuccessorComment ||= JSON.stringify(body).includes(commentBody);
    },
    driveScheduler: async ({ actor, companyId, agentId, heartbeat, humanApi, factsForRun, closeManagedAgentHostForRun }) => {
      if (!actor.userId) throw new Error("managed_native_operator_interrupt_current_human_missing");
      fixtureCompanyId = companyId;
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
      const task = await issueService(db).create(companyId, { title: "Native interrupted CLI input",
        description: "Deliver the exact Human issue comment submitted with an explicit interrupt during a live Native request.", status: "todo",
        responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId }, db, undefined,
        { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      firstTaskId = task.id;
      const planService = orchestrationService(db);
      const plan = await planService.create(actor, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Complete the Task after carrying forward the interrupted Human input",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["The accepted interrupt comment remains bound to its source"] },
        budgets: { maxModelCostMinor: 20, maxToolActions: 8 }, workers: [{ key: "writer", issueId: task.id }] });
      await planService.decide(actor, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Current Human authorizes bounded execution and explicit comment interruption" });
      const firstWake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId,
        payload: { issueId: task.id }, contextSnapshot: { issueId: task.id } });
      if (!firstWake) throw new Error("managed_native_operator_interrupt_predecessor_wake_missing");
      await bounded(dispatched, "authenticated_live_native_predecessor_before_paid_dispatch");
      expect(predecessorRunId).toBe(firstWake.id);
      expect(factsForRun(firstWake.id).providerCallCount).toBe(0);
      const [predecessorAttempt] = await db.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts).where(and(
        eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.runId, firstWake.id)));
      expect(predecessorAttempt).toBeTruthy();
      const predecessorReservations = await db.select({ id: orchestrationModelReservations.id }).from(orchestrationModelReservations)
        .where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.workerAttemptId, predecessorAttempt!.id)));
      expect(predecessorReservations).toHaveLength(0);
      let settled = false;
      try {
        const interruptRequest = request(humanApi.app).patch(`/api/issues/${task.id}`)
          .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost")
          .send({ comment: commentBody, commentClientRequestId: randomUUID(), interrupt: true })
          .then(response => response);
        await waitFor(async () => heartbeat.getRun(firstWake.id).then(run => {
          const cancellation = run?.resultJson?.startupCancellation;
          return cancellation && typeof cancellation === "object" && "requestedAt" in cancellation &&
            typeof cancellation.requestedAt === "string" ? run : null;
        }), "durable_operator_interrupt_stop_intent");
        const nativeStopAcknowledgement = await waitFor(async () => heartbeat.getRun(firstWake.id).then(run => {
          const cancellation = run?.resultJson?.nativeCancellation;
          return cancellation && typeof cancellation === "object" &&
            (cancellation as Record<string, unknown>).scope === "run" &&
            (cancellation as Record<string, unknown>).dispatchState === "acknowledged" &&
            (cancellation as Record<string, unknown>).dispatched === true ? run : null;
        }), "actual_native_session_interrupt_acknowledged", 90_000);
        expect(nativeStopAcknowledgement.resultJson?.nativeCancellation).toMatchObject({
          scope: "run", dispatchState: "acknowledged", dispatched: true,
        });
        releasePreDispatch();
        const response = await bounded(interruptRequest, "actual_issue_comment_interrupt_route", 180_000);
        expect(response.status).toBe(200);
        await bounded(actualStopGate, "actual_signed_native_host_stop", 180_000);
        await bounded(heartbeat.drainActiveRunExecutions(), "interrupted_executor_finally", 180_000);
        const [interrupted] = await db.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, firstWake.id)));
        expect(interrupted).toMatchObject({ runtimeMode: "native", status: "cancelled", errorCode: "operator_interrupted",
          resultJson: { operatorInterrupted: true, interruptionSource: "issue_comment_interrupt", interruptedIssueId: task.id } });
        expect(factsForRun(firstWake.id).providerCallCount).toBe(0);
        const predecessorReservationsAfter = await db.select({ id: orchestrationModelReservations.id }).from(orchestrationModelReservations)
          .where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.workerAttemptId, predecessorAttempt!.id)));
        expect(predecessorReservationsAfter).toHaveLength(0);
        const [issueAfterInterrupt] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, task.id));
        expect(issueAfterInterrupt?.status).toBe("in_progress");
        const [sourceComment] = await db.select().from(issueComments).where(and(
          eq(issueComments.companyId, companyId), eq(issueComments.issueId, task.id), eq(issueComments.authorUserId, actor.userId),
          eq(issueComments.body, commentBody), isNull(issueComments.createdByRunId)));
        expect(sourceComment).toBeTruthy();
        const wake = await waitFor(async () => db.select().from(agentWakeupRequests).where(and(
          eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
          eq(agentWakeupRequests.reason, "issue_commented"),
        )).then(rows => rows.find(row => row.payload?.commentId === sourceComment!.id) ?? null), "operator_interrupt_comment_wake");
        expect(wake.requestedByActorType).toBe("user");
        expect(wake.requestedByActorId).toBe(actor.userId);
        expect(wake.payload?.interruptedRunId).toBe(firstWake.id);
        expect(wake.payload?.commentId).toBe(sourceComment!.id);
        const wakeId = wake.id;

        const [predecessorLease] = await db.select().from(environmentLeases).where(and(
          eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, firstWake.id)));
        expect(predecessorLease).toBeTruthy();
        const released = await waitFor(async () => db.select().from(environmentLeases).where(eq(environmentLeases.id, predecessorLease!.id))
          .then(rows => rows[0]?.status === "released" && rows[0]?.cleanupStatus === "success" ? rows[0] : null), "real_operator_interrupt_release", 180_000);
        expect(released.releasedAt).toBeInstanceOf(Date);
        expect(await verifyNativeCleanupRuntimeState(db, { companyId, runId: firstWake.id, leaseId: predecessorLease!.id },
          released.metadata?.remoteExecutionTermination)).toMatchObject({ state: "stopped", runId: firstWake.id, leaseId: predecessorLease!.id });
        await heartbeat.resumeQueuedRuns();
        const successor = await waitFor(async () => db.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), or(eq(heartbeatRuns.nativeIssueId, task.id),
            sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${task.id}`),
        )).then(rows => {
          const candidate = rows.find(row => row.id !== firstWake.id && row.status === "failed");
          if (candidate) throw new Error(`native_operator_interrupt_successor_preselection_failed:${candidate.errorCode ?? "unknown"}`);
          return rows.find(row => row.id !== firstWake.id && row.nativeIssueId === task.id && row.runtimeMode === "native" &&
            ["queued", "running", "succeeded"].includes(row.status)) ?? null;
        }), "native_operator_interrupt_successor", 180_000);
        const [promotedWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wakeId));
        expect(promotedWake?.runId).toBe(successor.id);
        expect(successor.contextSnapshot?.wakeCommentId).toBe(sourceComment!.id);
        await waitFor(async () => sawSuccessorComment ? true : null, "successor_provider_bound_comment", 120_000);
        const [successorRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, successor.id));
        const profile = successorRun.runnerProfileJson as Record<string, unknown>;
        const receipt = profile.nativeInputSourceReceipt as { bootstrap?: { inputs?: Array<Record<string, unknown>> } } | undefined;
        const bound = receipt?.bootstrap?.inputs?.filter(source => source.kind === "comment" && source.issueId === task.id) ?? [];
        expect(bound).toHaveLength(1);
        expect(bound[0]).toMatchObject({ commentId: sourceComment!.id, sourceVersion: expect.any(String), contentHash: expect.any(String) });
        expect(sawSuccessorComment).toBe(true);
        expect(factsForRun(successor.id).providerCallCount).toBeGreaterThan(0);
        const [successorAttempt] = await db.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts).where(and(
          eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.runId, successor.id)));
        expect(successorAttempt).toBeTruthy();
        const successorReservations = await db.select({ id: orchestrationModelReservations.id }).from(orchestrationModelReservations)
          .where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.workerAttemptId, successorAttempt!.id)));
        expect(successorReservations.length).toBeGreaterThan(0);
        expect(providerCalls).toBeGreaterThanOrEqual(1);
        const successorFinal = await waitFor(async () => heartbeat.getRun(successor.id).then(run => {
          if (run?.status === "failed") throw new Error(`native_operator_interrupt_successor_failed:${run.errorCode ?? "unknown"}`);
          return run?.status === "succeeded" ? run : null;
        }), "native_interrupt_successor_committed", 180_000);
        expect(successorFinal).toMatchObject({ runtimeMode: "native", status: "succeeded", nativePhase: "committed" });
        const [successorFinalization] = await db.select().from(nativeRunFinalizations).where(and(
          eq(nativeRunFinalizations.companyId, companyId), eq(nativeRunFinalizations.runId, successor.id),
          eq(nativeRunFinalizations.issueId, task.id)));
        expect(successorFinalization).toMatchObject({ phase: "committed", leaseOwner: null });
        const [successorResult] = await db.select().from(nativeRunResults).where(and(
          eq(nativeRunResults.companyId, companyId), eq(nativeRunResults.issueId, task.id), eq(nativeRunResults.runId, successor.id)));
        expect(successorResult).toMatchObject({ schemaStatus: "accepted", completionContractId: successor.completionContractId,
          resultJson: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done" } });
        await closeManagedAgentHostForRun(successor.id);
        await closeManagedAgentHostForRun(firstWake.id);
        settled = true;
      } finally {
        releasePreDispatch();
        if (!settled) await bounded(heartbeat.drainActiveRunExecutions(), "failure_cleanup_drain", 180_000).catch(() => undefined);
      }
    },
  });

}, 300_000);
