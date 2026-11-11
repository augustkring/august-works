import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { and, eq, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, agentExecutionManifests, agentWakeupRequests, agents, environmentLeases, heartbeatRuns, issues,
  statusDecisions, statusDecisionEffects, issueThreadInteractions, workAssessments, activityLog, companyMemberships,
  orchestrationModelReservations, orchestrationPlans, toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import { assertNativePayloadSourceSetCurrent, assertNativeTaskSourceOwnerCurrent } from "../native-direct-input.js";
import { captureNativeFinalizedStageTaskBodyRead, readNativeStageTaskBodyStep } from "../native-stage-task-body-source.js";
import type { AuthorizationActor } from "../authorization.js";
import { captureNativeFinalizedContinuationSummary } from "../execution-continuation.js";
import { captureNativeStageContinuationForDispatch } from "../native-stage-wake-source.js";
import { issueService } from "../issues.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { verifyNativeCleanupRuntimeState } from "../execution-sandbox/run-lease-cleanup.js";
import { withManagedNativeHeartbeatFixture } from "../../__tests__/helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { createControlledNativeSignoffBackend } from "../../__tests__/helpers/controlled-native-signoff-backend.js";
import { nativeSha256 } from "./canonical.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";


const postgresCause = (error: unknown): { code?: string; message?: string } => {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const value = current as { code?: string; message?: string; cause?: unknown };
    if (value.code) return value;
    current = value.cause;
  }
  return {};
};

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
let completed = false;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "managed-signoff-api-policy-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("managed-signoff-api-policy-", {
    preserveDataOnFailure: () => !completed,
  });
  db = createDb(database.connectionString);
}, 60_000);

afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home && completed) {
    await makeFixtureTreeWritable(home);
    await rm(home, { recursive: true, force: true });
  } else if (home) {
    console.info("managed_signoff_api_policy_failure_root_retained", JSON.stringify({ path: home }));
  }
}, 30_000);

it("denies an authenticated Reviewer's missing-comment decision on the actual stage wake without provider dispatch", async () => {
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  let issueId = "";
  let fixtureExecutorId = "";
  let fixtureReviewerId = "";
  let preNativeStageSummary: { runId: string; body: string } | null = null;
  const backendOwner = createControlledNativeSignoffBackend();
  const { controlsByRun, waitForBackend, controlledBackend } = backendOwner;
  await withManagedNativeHeartbeatFixture({
    db,
    root: home,
    opencodeBinary: qualifiedOpenCodeBinary(),
    timeoutSec: 300,
    schedulerMode: "serial",
    managedTwoAgentSignoff: true,
    controlledNativeSessionBackendFactory: controlledBackend,
    beforeNativeRuntimeSelection: async runId => {
      const [preNativeRun]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)).limit(1);
      const context=preNativeRun?.contextSnapshot as Record<string,unknown>|undefined;
      if(!preNativeRun || preNativeRun.agentId!==fixtureReviewerId || context?.source!=="issue.execution_stage") return;
      expect(preNativeRun).toMatchObject({status:"running",runtimeMode:"legacy",nativeIssueId:null});
      expect((preNativeRun.runnerProfileJson as Record<string,unknown>).nativeInputSourceReceipt).toBeFalsy();
      const reader:AuthorizationActor={type:"agent",source:"agent_jwt",companyId:preNativeRun.companyId,
        agentId:preNativeRun.agentId,runId:preNativeRun.id,onBehalfOfUserId:preNativeRun.responsibleUserId};
      const selected=await captureNativeStageContinuationForDispatch(db,{companyId:preNativeRun.companyId,
        issueId:String(context.issueId),receiver:preNativeRun,reader});
      expect(selected).toMatchObject({trigger:{runId:preNativeRun.id},summary:{stageEntryRead:{kind:"stage_entry"}}});
      preNativeStageSummary={runId:preNativeRun.id,body:selected!.summary!.body};
    },
    prepareNativeRuntimeContext: async ({ agentId }) => {
      if (!fixtureExecutorId) fixtureExecutorId = agentId;
      else if (!fixtureReviewerId && agentId !== fixtureExecutorId) fixtureReviewerId = agentId;
      else if (agentId !== fixtureExecutorId && agentId !== fixtureReviewerId)
        throw new Error("managed_signoff_api_policy_unexpected_agent_context");
    },
    providerReply: () => { throw new Error("managed_signoff_api_policy_provider_dispatch_unexpected"); },
    driveScheduler: async ({ actor, companyId, heartbeat, managedAgentIds, closeManagedAgentHostForRun, managedSignoff, facts, factsForRun }) => {
      try {
      if (!managedAgentIds || !managedSignoff) throw new Error("managed_signoff_fixture_missing_two_agent_routes");
      expect(managedAgentIds).toEqual({ executor: fixtureExecutorId, reviewer: fixtureReviewerId });
      const created = await request(managedSignoff.app).post(`/api/companies/${companyId}/issues`)
        .set("Cookie", managedSignoff.humanCookie)
        .send({ title: "Managed signoff API policy", description: "Exercise the real review-stage API without provider calls.",
          status: "todo", executionPolicy: { stages: [{ type: "review",
            participants: [{ type: "agent", agentId: managedAgentIds.reviewer }] }] } });
      expect(created.status).toBe(201);
      issueId = created.body.id as string;
      expect(issueId).toBeTruthy();
      await issueService(db).update(issueId, { assigneeAgentId: managedAgentIds.executor,
        actorUserId: actor.userId!, privacyActor: actor, companyGuard: companyId });
      const [initialTask] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1);
      const initialSnapshot = nativePayloadSourceSnapshotSchema.parse(initialTask?.payloadSourceSnapshot);
      expect(initialSnapshot.transforms).toBeUndefined();
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, managedAgentIds.executor));
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, managedAgentIds.reviewer));

      const executorWake = await heartbeat.wakeup(managedAgentIds.executor, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId!,
        payload: { issueId }, contextSnapshot: { issueId } });
      expect(executorWake).not.toBeNull();
      const executorControl = await waitForBackend(executorWake!.id);
      await executorControl.waitForStart();
      executorControl.release();
      const waitForTerminalRun = async (runId: string) => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const [run] = await db.select().from(heartbeatRuns)
            .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).limit(1);
          if (!run) throw new Error("managed_signoff_api_policy_run_missing");
          if (["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(run.status)) return run;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("managed_signoff_api_policy_run_terminal_timeout");
      };
      await waitForTerminalRun(executorWake!.id);
      const [executorRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.id, executorWake!.id))).limit(1);
      expect(executorRun).toMatchObject({ status: "succeeded", runtimeMode: "native", agentId: managedAgentIds.executor,
        nativeIssueId: issueId, responsibleUserId: actor.userId });
      const [executorManifest] = await db.select().from(agentExecutionManifests)
        .where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, executorRun!.id))).limit(1);
      expect(executorManifest).toBeTruthy();
      expect(factsForRun(executorRun!.id)).toMatchObject({ providerCallCount: 0, issuerFacts: [] });
      const assertStoppedLease = async (runId: string) => {
        const leases = await db.select().from(environmentLeases)
          .where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, runId)));
        expect(leases).toHaveLength(1);
        expect(leases[0]).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success",
          failureReason: "paperclip_runner_destroy_after_turn" });
        expect(leases[0]!.releasedAt).toBeInstanceOf(Date);
        expect(await verifyNativeCleanupRuntimeState(db, { companyId, runId, leaseId: leases[0]!.id },
          leases[0]!.metadata?.remoteExecutionTermination)).toMatchObject({ runId, leaseId: leases[0]!.id, state: "stopped" });
      };
      const [reviewStageIssue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1);
      expect(reviewStageIssue).toMatchObject({ status: "in_review", assigneeAgentId: managedAgentIds.reviewer });
      const reviewState = reviewStageIssue?.executionState && typeof reviewStageIssue.executionState === "object"
        ? reviewStageIssue.executionState as Record<string, unknown> : {};
      expect(reviewState).toMatchObject({ status: "pending", currentParticipant: { type: "agent", agentId: managedAgentIds.reviewer } });
      const reviewStageId = reviewState.currentStageId;
      if (typeof reviewStageId !== "string" || !reviewStageId) throw new Error("managed_signoff_api_policy_stage_id_missing");

      const [executorDecision] = await db.select().from(statusDecisions)
        .where(and(eq(statusDecisions.companyId, companyId), eq(statusDecisions.runId, executorRun!.id))).limit(1);
      expect(executorDecision).toMatchObject({ toStatus: "in_review", reasonCode: "execution_policy_stage_pending" });
      const [stageWake] = await db.select().from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, managedAgentIds.reviewer),
          eq(agentWakeupRequests.reason, "execution_review_requested"))).orderBy(agentWakeupRequests.requestedAt).limit(1);
      expect(stageWake).toBeTruthy();
      expect(stageWake).toMatchObject({ source: "assignment", requestedByActorType: "agent", requestedByActorId: managedAgentIds.executor });
      expect(stageWake!.payload).toMatchObject({ issueId,
        _paperclipWakeContext: { issueId, taskId: issueId, wakeReason: "execution_review_requested",
          source: "issue.execution_stage", statusDecisionSource: "native_status_decision" } });
      const stageWakeDispatchDeadline = Date.now() + 30_000;
      let dispatchedStageWake: typeof stageWake | null = null;
      while (Date.now() < stageWakeDispatchDeadline) {
        const [currentStageWake] = await db.select().from(agentWakeupRequests)
          .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.id, stageWake!.id))).limit(1);
        if (currentStageWake?.runId && currentStageWake.status === "coalesced") {
          dispatchedStageWake = currentStageWake;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(dispatchedStageWake).toMatchObject({ status: "coalesced" });
      expect(dispatchedStageWake?.runId).toBeTruthy();

      const stageWakeDeadline = Date.now() + 30_000;
      let reviewerRun: typeof heartbeatRuns.$inferSelect | null = null;
      while (!reviewerRun && Date.now() < stageWakeDeadline) {
        reviewerRun = await db.select().from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, dispatchedStageWake!.runId!))).limit(1)
          .then(rows => rows[0] ?? null);
        if (reviewerRun) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(reviewerRun).toBeTruthy();
      const reviewerControl = await waitForBackend(reviewerRun!.id);
      await reviewerControl.waitForStart();
      const [startedReviewerRun] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, reviewerRun!.id))).limit(1);
      if (!startedReviewerRun) throw new Error("managed_signoff_api_policy_started_reviewer_run_missing");
      reviewerRun = startedReviewerRun;
      expect(reviewerRun).toMatchObject({ status: "running", runtimeMode: "native", agentId: managedAgentIds.reviewer,
        nativeIssueId: issueId, responsibleUserId: actor.userId });
      const reviewerContext = reviewerRun!.contextSnapshot as Record<string, unknown>;
      expect(reviewerContext).toMatchObject({ source: "issue.execution_stage", statusDecisionSource: "native_status_decision",
        nativeStatusWakeIntentId: stageWake!.id });
      expect(reviewerContext.executionStage).toMatchObject({ wakeRole: "reviewer", stageType: "review", stageId: reviewStageId,
        currentParticipant: { type: "agent", agentId: managedAgentIds.reviewer } });
      const [reviewerManifest] = await db.select().from(agentExecutionManifests)
        .where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, reviewerRun!.id))).limit(1);
      expect(reviewerManifest).toBeTruthy();
      const reviewerProfile = reviewerRun!.runnerProfileJson as Record<string, unknown>;
      const inputReceipt = reviewerProfile.nativeInputSourceReceipt as { bootstrap?: { inputs?: Array<Record<string, unknown>> } } | null;
      const bootstrapInputs = inputReceipt?.bootstrap?.inputs ?? [];
      const capturedWake = bootstrapInputs.find(source => source.kind === "native_task_wake" &&
        source.runId === reviewerRun!.id && source.issueId === issueId);
      const capturedTask = bootstrapInputs.find(source => source.kind === "task" && source.issueId === issueId);
      const reviewerWake = reviewerContext.paperclipWake as Record<string, unknown>;
      expect(bootstrapInputs.filter(source => source.kind === "native_task_wake" && source.runId === reviewerRun!.id &&
        source.issueId === issueId)).toHaveLength(1);
      expect(bootstrapInputs.filter(source => source.kind === "task" && source.issueId === issueId)).toHaveLength(1);
      expect(capturedWake).toBeTruthy();
      expect(capturedTask).toBeTruthy();
      expect(capturedWake).toMatchObject({ contentHash: nativeSha256(reviewerWake) });
      const {nativeStageCommentApiEligible}=await import("../native-stage-comment-api.js");
      const stageApiBinding={companyId,issueId,runId:reviewerRun!.id,agentId:managedAgentIds.reviewer};
      expect(await nativeStageCommentApiEligible(db,stageApiBinding)).toBe(true);
      expect(await nativeStageCommentApiEligible(db,{...stageApiBinding,preparedSourceSet:nativeRunInputSourceReceiptSchema.parse(reviewerProfile.nativeInputSourceReceipt).bootstrap})).toBe(true);
      expect(await nativeStageCommentApiEligible(db,{...stageApiBinding,agentId:managedAgentIds.executor})).toBe(false);
      await db.update(heartbeatRuns).set({contextSnapshot:{...reviewerContext,wakeReason:"issue_status_changed"}}).where(eq(heartbeatRuns.id,reviewerRun!.id));
      expect(await nativeStageCommentApiEligible(db,stageApiBinding)).toBe(true);
      await db.update(heartbeatRuns).set({contextSnapshot:reviewerContext}).where(eq(heartbeatRuns.id,reviewerRun!.id));
      expect(reviewerWake.executionStage).toMatchObject({ wakeRole: "reviewer", stageType: "review", stageId: reviewStageId,
        currentParticipant: { type: "agent", agentId: managedAgentIds.reviewer } });
      const reviewerIssue = reviewerWake.issue as Record<string, unknown>;
      const workspaceSources = bootstrapInputs.filter(source => source.kind === "workspace_metadata" && source.runId === reviewerRun!.id);
      expect(workspaceSources).toHaveLength(1);
      const workspaceSource = workspaceSources[0];
      const stageWorkspaceCapture = workspaceSource ? { execution: parseNativeExecutionInput(reviewerProfile.nativeExecutionInput),
        source: workspaceSource as Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }> } : undefined;
      const stageCaptureInput = (runContext: Record<string, unknown>, payload: Record<string, unknown>) => ({
        companyId, runId: reviewerRun!.id, issueId, sourceVersion: String(capturedTask!.sourceVersion),
        task: { id: issueId, identifier: reviewerIssue.identifier as string | null, title: String(reviewerIssue.title),
          description: reviewerIssue.description as string | null, status: String(reviewerIssue.status),
          priority: String(reviewerIssue.priority), workMode: String(reviewerIssue.workMode) },
        runContext, payload, workspaceCapture: stageWorkspaceCapture,
        checkoutRunId: runContext.paperclipHarnessCheckedOut === true ? reviewerRun!.id : null,
        commentSources: [],
      });
      const { captureNativeExecutionStageTaskWakeSource } = await import("../native-stage-wake-source.js");
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(reviewerContext, reviewerWake))).toEqual(capturedWake);
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput({ ...reviewerContext,
        wakeReason: "issue_assigned" }, reviewerWake))).toEqual(capturedWake);
      const [stageIntentBeforeControl] = await db.select().from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.id, reviewerContext.nativeStatusWakeIntentId as string))).limit(1);
      const [deliveredWakeBeforeControl] = await db.select().from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.id, reviewerRun!.wakeupRequestId!))).limit(1);
      expect(stageIntentBeforeControl).toBeTruthy();
      expect(deliveredWakeBeforeControl).toBeTruthy();
      await db.update(agentWakeupRequests).set({ status: "skipped" })
        .where(eq(agentWakeupRequests.id, stageIntentBeforeControl!.id));
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(reviewerContext, reviewerWake))).toBeNull();
      expect(await nativeStageCommentApiEligible(db,stageApiBinding)).toBe(false);
      await db.update(agentWakeupRequests).set({ status: stageIntentBeforeControl!.status, runId: stageIntentBeforeControl!.runId })
        .where(eq(agentWakeupRequests.id, stageIntentBeforeControl!.id));
      await db.update(agentWakeupRequests).set({ status: "completed", runId: reviewerRun!.id })
        .where(eq(agentWakeupRequests.id, stageIntentBeforeControl!.id));
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(reviewerContext, reviewerWake))).toBeNull();
      await db.update(agentWakeupRequests).set({ status: "claimed", runId: reviewerRun!.id })
        .where(eq(agentWakeupRequests.id, stageIntentBeforeControl!.id));
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(reviewerContext, reviewerWake))).toBeNull();
      await db.update(agentWakeupRequests).set({ status: stageIntentBeforeControl!.status, runId: stageIntentBeforeControl!.runId })
        .where(eq(agentWakeupRequests.id, stageIntentBeforeControl!.id));
      await db.update(agentWakeupRequests).set({ status: "failed" })
        .where(eq(agentWakeupRequests.id, deliveredWakeBeforeControl!.id));
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(reviewerContext, reviewerWake))).toBeNull();
      await db.update(agentWakeupRequests).set({ status: deliveredWakeBeforeControl!.status })
        .where(eq(agentWakeupRequests.id, deliveredWakeBeforeControl!.id));
      const tamperedWake = structuredClone(reviewerWake);
      (tamperedWake.executionStage as Record<string, unknown>).stageId = randomUUID();
      const tamperedContext = { ...reviewerContext, paperclipWake: tamperedWake, executionStage: tamperedWake.executionStage };
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(tamperedContext, tamperedWake))).toBeNull();
      const missingIntent = { ...reviewerContext };
      delete missingIntent.nativeStatusWakeIntentId;
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(missingIntent, reviewerWake))).toBeNull();
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput({ ...reviewerContext,
        nativeStatusWakeIntentId: randomUUID() }, reviewerWake))).toBeNull();
      expect(facts().sandboxRuntimeFacts?.closedAgentHosts).toContain(managedAgentIds.executor);
      expect(facts().sandboxRuntimeFacts?.closedAgentHosts).not.toContain(managedAgentIds.reviewer);
      await assertStoppedLease(executorRun!.id);

      // Genuine machine-entry owners only: this backend produces its result through
      // normal Native finalization. It does not exercise an SDK/model/tool dispatch.
      const stageSnapshot = nativePayloadSourceSnapshotSchema.parse(reviewStageIssue!.payloadSourceSnapshot);
      expect(reviewStageIssue!.payloadSourceSnapshotInvalidated).toBe(false);
      expect(stageSnapshot.policy).toEqual(initialSnapshot.policy);
      expect(stageSnapshot.inputs).toEqual(initialSnapshot.inputs);
      expect(stageSnapshot.transforms).toHaveLength(1);
      const entryStep = stageSnapshot.transforms![0]!;
      if (entryStep.kind !== "native_stage_policy") throw new Error("managed_signoff_entry_transform_missing");
      expect(entryStep).toMatchObject({ ownerKind: "native_status_decision", runId: executorRun!.id,
        decisionId: executorDecision!.id, previousSnapshotDigest: initialSnapshot.digest,
        previousOwnerContentHash: initialSnapshot.owner.contentHash });
      expect((executorRun!.contextSnapshot as Record<string, unknown>).source).not.toBe("issue.execution_stage");
      const [stageHash] = await db.execute<{ hash: string; digestValid: boolean }>(sql`select
        public.aw_native_payload_body_hash('issue',to_jsonb(i)) as hash,
        i.payload_source_snapshot->>'digest'=encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as "digestValid"
        from issues i where i.company_id=${companyId}::uuid and i.id=${issueId}::uuid`);
      expect(stageHash).toEqual({ hash: stageSnapshot.owner.contentHash, digestValid: true });
      expect(capturedTask!.contentHash).toBe(stageHash!.hash);
      expect(reviewerProfile.nativeBootstrapTaskSource).toMatchObject({ input: capturedTask, payloadSourceSnapshot: stageSnapshot });
      const entryReceipt = await readNativeStageTaskBodyStep(db, { task: reviewStageIssue!, step: entryStep });
      expect(entryReceipt.originalSnapshot).toEqual(initialSnapshot);
      expect(entryReceipt.fromExecutionState).toEqual(initialTask!.executionState);
      expect(entryReceipt.toExecutionState).toEqual(reviewStageIssue!.executionState);
      const reviewerReader: AuthorizationActor = { type: "agent", source: "none", companyId,
        agentId: reviewerRun!.agentId, runId: reviewerRun!.id, onBehalfOfUserId: reviewerRun!.responsibleUserId };
      const finalizedEntry = () => captureNativeFinalizedStageTaskBodyRead(db, { companyId, issueId,
        runId: executorRun!.id, reader: reviewerReader });
      expect(await finalizedEntry()).toMatchObject({ kind: "stage_entry", runId: executorRun!.id,
        decisionId: executorDecision!.id, transitionIds: [entryStep.transitionId],
        taskCapture: { payloadSourceSnapshot: initialSnapshot } });
      const currentReceipt = nativeRunInputSourceReceiptSchema.parse(reviewerProfile.nativeInputSourceReceipt);
      const readReviewerSources = (scopeDb: Parameters<typeof assertNativePayloadSourceSetCurrent>[0] = db) =>
        assertNativePayloadSourceSetCurrent(scopeDb, { companyId, issueId, runId: reviewerRun!.id,
          actor: reviewerReader, ...currentReceipt.bootstrap });
      await expect(readReviewerSources()).resolves.toBeUndefined();
      const executorReceipt = nativeRunInputSourceReceiptSchema.parse((executorRun!.runnerProfileJson as Record<string, unknown>).nativeInputSourceReceipt);
      const oldTask = executorReceipt.bootstrap.inputs.find((source): source is Extract<NativePayloadSourceInput, { kind: "task" }> =>
        source.kind === "task" && source.issueId === issueId);
      expect(oldTask?.contentHash).toBe(initialSnapshot.owner.contentHash);
      expect(oldTask?.contentHash).not.toBe(stageHash!.hash);
      await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId, actor: reviewerReader, source: oldTask! })).rejects.toBeDefined();
      // Ordinary summary reads retain the same-Agent rule. Stage output is
      // selected only through the current Stage entry and its finalized proof.
      expect(await captureNativeFinalizedContinuationSummary({ db, companyId, issueId,
        agentId: reviewerRun!.agentId, receiverRunId: reviewerRun!.id, sourceRunId: executorRun!.id,
        reader: reviewerReader })).toBeNull();
      const stageContinuation = await captureNativeStageContinuationForDispatch(db,{companyId,issueId,
        receiver:reviewerRun!,reader:reviewerReader});
      expect(stageContinuation).toMatchObject({trigger:{runId:reviewerRun!.id,executorRunId:executorRun!.id,
        executorAgentId:executorRun!.agentId},summary:{stageEntryRead:{kind:"stage_entry",runId:executorRun!.id,
          agentId:executorRun!.agentId}}});
      expect(await captureNativeStageContinuationForDispatch(db,{companyId,issueId,receiver:reviewerRun!,
        reader:{...reviewerReader,onBehalfOfUserId:randomUUID()}})).toBeNull();
      expect(await captureNativeStageContinuationForDispatch(db,{companyId,issueId,
        receiver:{...reviewerRun!,responsibleUserId:randomUUID()},reader:reviewerReader})).toBeNull();
      expect(await captureNativeFinalizedContinuationSummary({db,companyId,issueId,agentId:reviewerRun!.agentId,
        receiverRunId:reviewerRun!.id,sourceRunId:executorRun!.id,reader:reviewerReader,
        stageEntryRead:stageContinuation!.summary!.stageEntryRead,stageTrigger:{...stageContinuation!.trigger,chainHash:"0".repeat(64)}})).toBeNull();
      expect((reviewerContext.executionContinuation as {completedWork?:string}).completedWork).toBe(stageContinuation!.summary!.body);
      expect((reviewerProfile.nativeBootstrapFinalizedContinuationSummary as {stageEntryRead?:{kind:string}}).stageEntryRead)
        .toMatchObject({kind:"stage_entry"});
      expect(parseNativeExecutionInput(reviewerProfile.nativeExecutionInput).task.prompt).toContain(stageContinuation!.summary!.body);
      expect(preNativeStageSummary).toEqual({runId:reviewerRun!.id,body:stageContinuation!.summary!.body});

      const forgedUpdate = async (kind: "literal" | "missing_receipt" | "copied_receipt" | "reordered" | "pruned") => {
        let reachedDeferredGuard = false;
        let rejection: unknown;
        try {
          await db.transaction(async tx => {
            const transitionId = kind === "copied_receipt" ? entryStep.transitionId : randomUUID();
            const forgedStep = { ...entryStep, transitionId, previousSnapshotDigest: stageSnapshot.digest,
              previousOwnerContentHash: stageSnapshot.owner.contentHash, nextOwnerContentHash: stageSnapshot.owner.contentHash };
            const transforms = kind === "pruned" ? [] : kind === "reordered" ? [forgedStep, entryStep]
              : [...stageSnapshot.transforms!, forgedStep];
            const value = { ...stageSnapshot, transforms };
            await tx.execute(sql`with original as (select to_jsonb(i) as row from issues i
              where i.company_id=${companyId}::uuid and i.id=${issueId}::uuid),
              changed as (select row || ${JSON.stringify(kind === "literal" ? { title: "Substituted literal" } : {})}::jsonb as row from original),
              projected as (select jsonb_set(${JSON.stringify(value)}::jsonb-'digest','{owner,contentHash}',
                to_jsonb(public.aw_native_payload_body_hash('issue',row))) as value,
                public.aw_native_payload_body_hash('issue',row) as hash from changed),
              body as (select case when ${kind}='literal' then jsonb_set(value,
                array['transforms',${String(transforms.length - 1)},'nextOwnerContentHash'],to_jsonb(hash)) else value end as value from projected),
              sealed as (select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) as snapshot from body)
              update issues i set payload_source_snapshot=sealed.snapshot,
                title=case when ${kind}='literal' then 'Substituted literal' else i.title end
              from sealed where i.company_id=${companyId}::uuid and i.id=${issueId}::uuid`);
            reachedDeferredGuard = true;
            await tx.execute(sql`set constraints issues_native_stage_source_owner immediate`);
          });
        } catch (error) { rejection = error; }
        expect(postgresCause(rejection).code).toBe("23514");
        if (kind === "missing_receipt" || kind === "copied_receipt") {
          expect(reachedDeferredGuard).toBe(true);
          expect(postgresCause(rejection).message).toContain("Native Stage source is not bound to its actual producer receipt");
        }
        const [restored] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
        expect(restored!.payloadSourceSnapshot).toEqual(stageSnapshot);
        expect(restored!.title).toBe(reviewStageIssue!.title);
      };
      for (const kind of ["literal", "missing_receipt", "copied_receipt", "reordered", "pruned"] as const) await forgedUpdate(kind);
      await expect(readReviewerSources()).resolves.toBeUndefined();
      const rollback = new Error("managed_signoff_source_negative_rollback");
      await expect(db.transaction(async tx => {
        const erased = await tx.delete(activityLog).where(and(eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId),
          eq(activityLog.action, "issue.payload_source_captured"))).returning({ id: activityLog.id });
        expect(erased).toHaveLength(1);
        await expect(readReviewerSources(tx)).rejects.toBeDefined();
        throw rollback;
      })).rejects.toBe(rollback);
      await expect(readReviewerSources()).resolves.toBeUndefined();
      await expect(db.transaction(async tx => {
        const revoked = await tx.update(companyMemberships).set({ status: "inactive" }).where(and(
          eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, actor.userId!))).returning({ id: companyMemberships.id });
        expect(revoked).toHaveLength(1);
        await expect(readReviewerSources(tx)).rejects.toBeDefined();
        // A real revoked Human cannot use the live Stage owner path even when
        // the actor/run identity otherwise matches the Reviewer exactly.
        await expect(captureNativeStageContinuationForDispatch(tx,{companyId,issueId,
          receiver:reviewerRun!,reader:reviewerReader})).resolves.toBeNull();
        throw rollback;
      })).rejects.toBe(rollback);
      await expect(readReviewerSources()).resolves.toBeUndefined();
      expect(await finalizedEntry()).not.toBeNull();

      const missingComment = await request(managedSignoff.app).patch(`/api/issues/${issueId}`)
        .set("Authorization", `Bearer ${managedSignoff.agentApiTokens.reviewer}`)
        .set("X-Paperclip-Run-Id", reviewerRun!.id)
        .send({ status: "done" });
      expect(missingComment.status).toBe(422);
      expect(JSON.stringify(missingComment.body)).toContain("comment");
      const [unchanged] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1);
      expect(unchanged).toMatchObject({ status: "in_review", assigneeAgentId: managedAgentIds.reviewer,
        executionState: expect.objectContaining({ status: "pending", currentStageId: reviewStageId,
          currentParticipant: { type: "agent", agentId: managedAgentIds.reviewer } }) });
      expect(factsForRun(reviewerRun!.id)).toMatchObject({ providerCallCount: 0, issuerFacts: [] });

      reviewerControl.release();
      await heartbeat.drainActiveRunExecutions();
      const [reviewerCompleted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, reviewerRun!.id)).limit(1);
      expect(reviewerCompleted).toMatchObject({ status: "succeeded", runtimeMode: "native", agentId: managedAgentIds.reviewer,
        nativeIssueId: issueId, responsibleUserId: actor.userId });
      await closeManagedAgentHostForRun(reviewerRun!.id);
      await assertStoppedLease(reviewerRun!.id);

      // Exercise a stale outbox control after a newer applied decision reuses
      // the same stage ID and Reviewer. The source rows remain FK-valid, and
      // the stale request carries the original decision/effect projection.
      const [priorAssessment] = await db.select().from(workAssessments)
        .where(and(eq(workAssessments.companyId, companyId), eq(workAssessments.runId, executorRun!.id),
          eq(workAssessments.id, executorDecision!.assessmentId))).limit(1);
      expect(priorAssessment).toBeTruthy();
      const [priorStageEffect] = await db.select().from(statusDecisionEffects)
        .where(and(eq(statusDecisionEffects.companyId, companyId), eq(statusDecisionEffects.issueId, issueId),
          eq(statusDecisionEffects.decisionId, executorDecision!.id), eq(statusDecisionEffects.effectKind, "execution_stage_wake"),
          eq(statusDecisionEffects.targetId, stageWake!.id))).limit(1);
      expect(priorStageEffect).toBeTruthy();
      const nextAssessmentId = randomUUID();
      const nextDecisionId = randomUUID();
      const priorIssueDecisions = await db.select({ decisionVersion: statusDecisions.decisionVersion })
        .from(statusDecisions).where(and(eq(statusDecisions.companyId, companyId), eq(statusDecisions.issueId, issueId)));
      const nextDecisionVersion = Math.max(0, ...priorIssueDecisions.map(row => row.decisionVersion)) + 1;
      await db.insert(workAssessments).values({
        id: nextAssessmentId,
        companyId,
        issueId,
        runId: executorRun!.id,
        turnId: priorAssessment!.turnId,
        contractId: priorAssessment!.contractId,
        resultId: priorAssessment!.resultId,
        triggerKind: priorAssessment!.triggerKind,
        triggerRef: priorAssessment!.triggerRef,
        triggerCapability: priorAssessment!.triggerCapability,
        triggerActorCompanyId: companyId,
        priorIssueStatus: "in_review",
        priorStatusVersion: reviewStageIssue!.statusVersion,
        priorDecisionId: executorDecision!.id,
        policyVersion: priorAssessment!.policyVersion,
        assessmentJson: priorAssessment!.assessmentJson,
        inputDigest: `managed-signoff-resubmission:${nextAssessmentId}`,
        supersedesAssessmentId: priorAssessment!.id,
      });
      await db.insert(statusDecisions).values({
        id: nextDecisionId,
        companyId,
        issueId,
        runId: executorRun!.id,
        assessmentId: nextAssessmentId,
        decisionVersion: nextDecisionVersion,
        policyVersion: executorDecision!.policyVersion,
        fromStatus: "in_review",
        toStatus: "in_review",
        reasonCode: "execution_policy_stage_pending",
        decisionJson: executorDecision!.decisionJson,
        decisionDigest: `managed-signoff-resubmission:${nextDecisionId}`,
        applicationState: "applied",
        supersedesDecisionId: executorDecision!.id,
        appliedAt: new Date(),
      });
      const nextReviewState = {
        ...reviewState,
        status: "pending",
        reviewRequest: { instructions: "Review the resubmitted work in the same stage." },
        lastDecisionOutcome: "changes_requested",
      };
      await db.update(issues).set({ statusVersion: reviewStageIssue!.statusVersion + 1,
        lastStatusDecisionId: nextDecisionId, executionState: nextReviewState })
        .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
      expect(await captureNativeExecutionStageTaskWakeSource(db, stageCaptureInput(reviewerContext, reviewerWake))).toBeNull();
      const staleIntentId = randomUUID();
      const existingEffectOrdinals = await db.select({ ordinal: statusDecisionEffects.ordinal }).from(statusDecisionEffects)
        .where(and(eq(statusDecisionEffects.companyId, companyId), eq(statusDecisionEffects.decisionId, executorDecision!.id)));
      const effectOrdinal = Math.max(0, ...existingEffectOrdinals.map(row => row.ordinal)) + 1;
      await db.insert(agentWakeupRequests).values({
        id: staleIntentId,
        companyId,
        agentId: managedAgentIds.reviewer,
        source: "assignment",
        triggerDetail: "system",
        reason: "execution_review_requested",
        payload: stageWake!.payload,
        requestedByActorType: "agent",
        requestedByActorId: managedAgentIds.executor,
        idempotencyKey: `issue.execution_stage:${issueId}:${executorDecision!.id}`,
      });
      await db.insert(statusDecisionEffects).values({
        companyId,
        issueId,
        decisionId: executorDecision!.id,
        ordinal: effectOrdinal,
        effectKind: "execution_stage_wake",
        targetType: "agent_wakeup_request",
        targetId: staleIntentId,
        idempotencyKey: `managed-signoff-stale-effect:${staleIntentId}`,
        payload: priorStageEffect!.payload,
        deliveryState: "pending",
      });
      const runIdsBeforeStaleDispatch = (await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, issueId))))
        .map(run => run.id).sort();
      const staleDispatch = await heartbeat.dispatchPendingNativeStatusWakeups({ companyId });
      expect(staleDispatch).toMatchObject({ dispatched: 0 });
      const [staleIntent] = await db.select().from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.id, staleIntentId))).limit(1);
      expect(staleIntent).toMatchObject({ status: "skipped", runId: null,
        error: "Native execution stage wake is no longer current" });
      const [generationBoundIssue] = await db.select().from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1);
      expect(generationBoundIssue).toMatchObject({ status: "in_review", assigneeAgentId: managedAgentIds.reviewer,
        lastStatusDecisionId: nextDecisionId,
        executionState: expect.objectContaining({ status: "pending", currentStageId: reviewStageId,
          currentParticipant: { type: "agent", agentId: managedAgentIds.reviewer },
          reviewRequest: { instructions: "Review the resubmitted work in the same stage." },
          lastDecisionOutcome: "changes_requested" }) });
      expect((await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, issueId))))
        .map(run => run.id).sort()).toEqual(runIdsBeforeStaleDispatch);
      } finally {
        backendOwner.close();
        await heartbeat.drainActiveRunExecutions();
      }
    },
  });
  expect(issueId).toBeTruthy();
  completed = true;
}, 600_000);

it("executes the declared Reviewer comment and terminal result from one actual managed model response", async()=>{
  completed=false;
  let issueId="",executorId="",reviewerId="";
  const calls=new Map<string,number>();
  await withManagedNativeHeartbeatFixture({db,root:home,opencodeBinary:qualifiedOpenCodeBinary(),timeoutSec:180,
    schedulerMode:"serial",managedTwoAgentSignoff:true,
    providerReply:({body,execution,runId})=>{
      const number=(calls.get(runId)??0)+1;calls.set(runId,number);
      if(number!==1)throw new Error("managed_stage_comment_unexpected_fresh_model_turn");
      const tools=body.tools as Array<{name:string;input_schema?:unknown}>;
      const tool=(name:string)=>{
        const found=tools.find(value=>value.name===name || ["paperclip__","paperclip_","paperclip."].some(prefix=>value.name===`${prefix}${name}`));
        if(!found)throw new Error(`managed_stage_comment_missing_tool_${name}`);
        return found;
      };
      const finish={type:"tool_use",id:`finish-${runId}`,name:tool("paperclip_finish").name,input:{schema:"paperclip.run_result.v1",
        reportedWorkDisposition:"done",summary:"Completed the declared stage with the required decision comment.",
        completionClaim:{contractRevision:execution.completionContract.contract.revision,objectiveSatisfied:true,
          criteria:execution.completionContract.contract.criteria.map(criterion=>({criterionId:criterion.id,status:"satisfied",evidenceRefs:[]})),remainingWork:[]},
        evidence:[],verification:[],attentionRequests:[],artifacts:[]}};
      const api=tool("call_api");
      if(execution.binding.agentId===executorId){
        expect(JSON.stringify(api)).not.toContain("POST /api/issues/{id}/comments");
        return {stop_reason:"tool_use",content:[finish]};
      }
      if(execution.binding.agentId!==reviewerId)throw new Error("managed_stage_comment_foreign_reviewer");
      expect(JSON.stringify(api)).toContain("POST /api/issues/{id}/comments");
      expect(JSON.stringify(api)).toContain(issueId);
      return {stop_reason:"tool_use",content:[{type:"tool_use",id:`stage-comment-${runId}`,name:api.name,
        input:{operationId:"POST /api/issues/{id}/comments",pathParams:{id:issueId},body:{body:"## Review: APPROVED\nThe declared work satisfies the review criteria."}}},finish]};
    },
    driveScheduler:async({actor,companyId,heartbeat,managedAgentIds,managedSignoff,factsForRun})=>{
      if(!managedAgentIds || !managedSignoff)throw new Error("managed_stage_comment_two_agents_missing");
      executorId=managedAgentIds.executor;reviewerId=managedAgentIds.reviewer;
      const created=await request(managedSignoff.app).post(`/api/companies/${companyId}/issues`).set("Cookie",managedSignoff.humanCookie)
        .send({title:"Actual managed Reviewer decision",description:"Complete the declared review with one same-Task decision comment.",status:"todo",
          executionPolicy:{stages:[{type:"review",participants:[{type:"agent",agentId:reviewerId}]}]}});
      expect(created.status).toBe(201);issueId=created.body.id;
      await issueService(db).update(issueId,{assigneeAgentId:executorId,actorUserId:actor.userId!,privacyActor:actor,companyGuard:companyId});
      const wake=await heartbeat.wakeup(executorId,{source:"assignment",triggerDetail:"system",reason:"issue_assigned",requestedByActorType:"user",
        requestedByActorId:actor.userId!,payload:{issueId},contextSnapshot:{issueId}});
      expect(wake).not.toBeNull();
      const runs=()=>db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.nativeIssueId,issueId)));
      await expect.poll(async()=>{
        const rows=await runs();return rows.length===2 && rows.every(run=>["succeeded","failed","cancelled","timed_out"].includes(run.status));
      },{timeout:360_000}).toBe(true);
      await heartbeat.drainActiveRunExecutions();
      const rows=await runs();expect(rows).toHaveLength(2);
      const reviewer=rows.find(run=>run.agentId===reviewerId);
      expect(reviewer,JSON.stringify(rows.map(run=>({id:run.id,status:run.status,errorCode:run.errorCode})))).toMatchObject({status:"succeeded",runtimeMode:"native",responsibleUserId:actor.userId});
      for(const run of rows){expect(calls.get(run.id)).toBe(1);expect(factsForRun(run.id).providerCallCount).toBe(1)}
      if(!reviewer)throw new Error("managed_stage_comment_reviewer_missing");
      const profile=reviewer.runnerProfileJson as Record<string,unknown>;
      const captures=profile.nativeToolResultSourceCaptures as Array<Record<string,unknown>>;
      const stage=captures.filter(capture=>capture.stageComment!==undefined);
      expect(stage).toHaveLength(1);
      const witness=stage[0]!.stageComment as import("../native-stage-comment-api.js").NativeManagedStageCommentCapture;
      expect(witness).toMatchObject({operationId:"POST /api/issues/{id}/comments",callId:`stage-comment-${reviewer.id}`});
      const apiReceipts=(reviewer.resultJson as Record<string,unknown>).apiToolReceipts as Record<string,Record<string,unknown>>;
      const api=Object.values(apiReceipts).find(value=>value.callId===witness.callId);
      expect(api).toMatchObject({state:"completed",operationId:"POST /api/issues/{id}/comments",method:"POST",pathAndQuery:`/api/issues/${issueId}/comments`,
        result:expect.objectContaining({ok:true,status:201,data:expect.objectContaining({id:witness.commentId,issueId,createdByRunId:reviewer.id})})});
      const {operationId:_operationId,...response}=api!.result as Record<string,unknown>;
      const {readNativeManagedStageCommentCapture}=await import("../native-stage-comment-api.js");
      expect(await readNativeManagedStageCommentCapture(db,{companyId,issueId,runId:reviewer.id,agentId:reviewerId,callId:witness.callId,
        argumentsHash:witness.argumentsHash,result:{...response,apiOperationId:api!.operationId},outputCapture:witness.outputCapture,reader:actor})).toEqual(witness);
      const {captureNativeFinalizedStageConsumption}=await import("../native-stage-wake-source.js");
      expect(await captureNativeFinalizedStageConsumption(db,{companyId,issueId,runId:reviewer.id,reader:actor})).toBeTruthy();
      const [task]=await db.select().from(issues).where(eq(issues.id,issueId));
      expect(task).toMatchObject({status:"done"});
      // A historical acknowledgement never offers a new Stage call profile.
      const {nativeStageCommentApiEligible}=await import("../native-stage-comment-api.js");
      expect(await nativeStageCommentApiEligible(db,{companyId,issueId,runId:reviewer.id,agentId:reviewerId})).toBe(false);
    },
  });
  completed=true;
},600_000);

it("captures the exact native completion review source for a real managed Reviewer run", async () => {
  completed = false;
  let issueId = "";
  let executorId = "";
  let reviewerId = "";
  const calls = new Map<string, number>();
  await withManagedNativeHeartbeatFixture({
    db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 180,
    schedulerMode: "serial", managedTwoAgentSignoff: true,
    providerReply: ({ body, execution, runId }) => {
      calls.set(runId, (calls.get(runId) ?? 0) + 1);
      const callIndex = calls.get(runId)!;
      if (callIndex > 3) throw new Error("native_review_source_unexpected_provider_replay");
      if (callIndex === 3) return { stop_reason: "end_turn", content: [{ type: "text", text: "The bounded review turn is complete." }] };
      const tools = body.tools as Array<{ name: string; input_schema?: unknown }>;
      const tool = (name: string) => {
        const found = tools.find(value => value.name === name ||
          ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${name}`));
        if (!found) throw new Error(`native_review_source_missing_tool_${name}`);
        return found;
      };
      const reviewer = execution.binding.agentId === reviewerId;
      if (!reviewer && execution.binding.agentId !== executorId) throw new Error("native_review_source_unassigned_agent");
      if (reviewer) {
        const names = tools.map(value => value.name.replace(/^(?:paperclip__|paperclip_|paperclip\.)/, ""));
        expect(names).toContain("resolve_review");
        expect(names).not.toEqual(expect.arrayContaining(["write_document", "create_task", "create_project", "call_api", "self_remember"]));
      }
      if (!reviewer && callIndex === 1) return { stop_reason: "tool_use", content: [{
        type: "tool_use", id: `write-${runId}`, name: tool("write_document").name,
        input: { idempotencyKey: `review-result-${runId}`, key: "review-result", title: "Submitted work",
          body: "The bounded task output is ready for the separately assigned Reviewer.", baseRevisionId: null },
      }] };
      if (reviewer && callIndex === 1) {
        expect(execution.task.title).toMatch(/^Review:/);
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `resolve-${runId}`,
          name: tool("resolve_review").name, input: { decision: "accept" } }] };
      }
      const finish = {
        type: "tool_use", id: `finish-${runId}`, name: tool("paperclip_finish").name,
        input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: reviewer ? "done" : "needs_review",
          summary: reviewer ? "Reviewed the submitted work and accepted the assigned completion review." : "Prepared the work for independent review.",
          completionClaim: { contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true,
            criteria: execution.completionContract.contract.criteria.map((criterion: { id: string }) =>
              ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
          evidence: [], verification: [],
          attentionRequests: reviewer ? [] : [{ kind: "review", ownerClass: "agent", summary: "Review the completed work against the task.", targetAgentId: reviewerId }],
          artifacts: [] },
      };
      return { stop_reason: "tool_use", content: [finish] };
    },
    driveScheduler: async ({ actor, companyId, heartbeat, managedAgentIds, managedSignoff }) => {
      if (!managedAgentIds || !managedSignoff) throw new Error("native_review_source_two_agents_missing");
      executorId = managedAgentIds.executor;
      reviewerId = managedAgentIds.reviewer;
      const created = await request(managedSignoff.app).post(`/api/companies/${companyId}/issues`)
        .set("Cookie", managedSignoff.humanCookie).send({ title: "Native completion review source closure",
          description: "Complete the work, then have the separately assigned Reviewer inspect and accept it.", status: "todo" });
      expect(created.status).toBe(201);
      issueId = created.body.id as string;
      await issueService(db).update(issueId, { assigneeAgentId: executorId, actorUserId: actor.userId!,
        privacyActor: actor, companyGuard: companyId });
      const [plannedTask] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1);
      if (!plannedTask || !actor.userId) throw new Error("native_review_source_current_human_plan_input_missing");
      const plan = await orchestrationService(db).create(actor, companyId, { issueId,
        expectedIssueUpdatedAt: plannedTask.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Complete the assigned task, then independently review its completion.",
          requiredOutputs: [{ kind: "task_document", key: "review-result" }],
          businessInvariants: ["A separate assigned Reviewer decides the completion review"] },
        budgets: { maxModelCostMinor: 20, maxToolActions: 10 }, workers: [{ key: "writer", issueId }] });
      await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Authorize this bounded managed Native completion-review test" });
      const wake = await heartbeat.wakeup(executorId, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId!,
        payload: { issueId }, contextSnapshot: { issueId } });
      expect(wake).toBeTruthy();
      const deadline = Date.now() + 360_000;
      let runs: typeof heartbeatRuns.$inferSelect[] = [];
      while (Date.now() < deadline) {
        runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
          or(eq(heartbeatRuns.nativeIssueId, issueId), sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`)));
        if (runs.length === 2 && runs.every(run => ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status))) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await heartbeat.drainActiveRunExecutions();
      expect(runs).toHaveLength(2);
      const sourceRun = runs.find(run => run.agentId === executorId)!;
      const reviewerRun = runs.find(run => run.agentId === reviewerId)!;
      expect(sourceRun).toMatchObject({ status: "succeeded", nativePhase: "committed", nativeProcessCleanupPending: false });
      expect(reviewerRun).toMatchObject({ status: "succeeded", nativePhase: "committed", nativeProcessCleanupPending: false });
      const [completedReviewPlan] = await db.select().from(orchestrationPlans).where(and(
        eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, plan.id))).limit(1);
      expect(completedReviewPlan?.status).toBe("running");
      const pausedReviewPlan = await orchestrationService(db).decide(actor, companyId, plan.id, {
        expectedVersion: completedReviewPlan!.version, action: "pause",
        rationale: "Pause after review to verify retained receipt history.",
      });
      expect(pausedReviewPlan).toMatchObject({ status: "paused", version: completedReviewPlan!.version + 1 });
      expect([2, 3]).toContain(calls.get(sourceRun.id));
      expect([2, 3]).toContain(calls.get(reviewerRun.id));
      const reviewerProfile = reviewerRun.runnerProfileJson as Record<string, unknown>;
      const reviewerModelIntents = Array.isArray(reviewerProfile.nativeAwModelWireIntents)
        ? reviewerProfile.nativeAwModelWireIntents.filter(value => value && typeof value === "object" &&
          (value as Record<string, unknown>).modelPurpose === "review_model") as Array<Record<string, unknown>> : [];
      expect(reviewerModelIntents.length).toBeGreaterThan(0);
      const reviewerReservations = await db.select().from(orchestrationModelReservations).where(and(
        eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.purpose, "review_model"),
        eq(orchestrationModelReservations.reviewRunId, reviewerRun.id)));
      expect(reviewerReservations).toHaveLength(reviewerModelIntents.length);
      expect(reviewerReservations.every(row => row.status === "completed" && row.workerAttemptId === null && row.workerId === null &&
        row.reviewAgentId === reviewerId && row.reviewSourceRunId === sourceRun.id && row.reviewIssueId === issueId)).toBe(true);
      const immutableReviewReservation = reviewerReservations[0]!;
      const reservationRebindError = await db.update(orchestrationModelReservations).set({
        reviewPlanVersion: immutableReviewReservation.reviewPlanVersion! + 1,
      }).where(and(eq(orchestrationModelReservations.companyId, companyId),
        eq(orchestrationModelReservations.id, immutableReviewReservation.id))).returning().then(() => null, error => error);
      expect(postgresCause(reservationRebindError).code).toBe("23514");
      expect(postgresCause(reservationRebindError).message).toContain("review_model_reservation_binding_immutable");
      const [retainedReviewReservation] = await db.select().from(orchestrationModelReservations).where(and(
        eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.id, immutableReviewReservation.id),
      )).limit(1);
      expect(retainedReviewReservation).toMatchObject({ status: immutableReviewReservation.status,
        reviewInteractionId: immutableReviewReservation.reviewInteractionId,
        reviewPlanVersion: immutableReviewReservation.reviewPlanVersion });
      expect(reviewerModelIntents.every(intent => reviewerReservations.some(row => row.id === intent.reservationId &&
        row.inputHash === intent.requestHash))).toBe(true);
      const [resolveInvocation] = await db.select().from(toolInvocations).where(and(
        eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, reviewerRun.id),
        eq(toolInvocations.toolName, "resolve_review"), eq(toolInvocations.status, "succeeded"))).limit(1);
      expect(resolveInvocation).toBeTruthy();
      const [decision] = await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId, companyId),
        eq(statusDecisions.issueId, issueId), eq(statusDecisions.runId, sourceRun.id))).limit(1);
      expect(decision).toMatchObject({ applicationState: "applied", toStatus: "in_review" });
      const [effect] = await db.select().from(statusDecisionEffects).where(and(eq(statusDecisionEffects.companyId, companyId),
        eq(statusDecisionEffects.issueId, issueId), eq(statusDecisionEffects.decisionId, decision!.id),
        eq(statusDecisionEffects.effectKind, "bind_reviewer"), eq(statusDecisionEffects.targetType, "issue_thread_interaction"))).limit(1);
      expect(effect?.targetId).toBeTruthy();
      const [interaction] = await db.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.issueId, issueId), eq(issueThreadInteractions.id, effect!.targetId!))).limit(1);
      expect(interaction).toMatchObject({ sourceRunId: sourceRun.id, addresseeAgentId: reviewerId });
      const profile = reviewerRun.runnerProfileJson as Record<string, unknown>;
      const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
      const wakeSource = receipt.bootstrap.inputs.find((input): input is Extract<NativePayloadSourceInput, { kind: "native_task_wake" }> =>
        input.kind === "native_task_wake" && input.runId === reviewerRun.id && input.issueId === issueId);
      expect(wakeSource?.nativeReview).toMatchObject({ reviewerRunId: reviewerRun.id, reviewerAgentId: reviewerId,
        interactionId: interaction!.id, decisionId: decision!.id, sourceRunId: sourceRun.id, sourceAgentId: executorId,
        sourceReceiptDigest: nativeRunInputSourceReceiptSchema.parse((sourceRun.runnerProfileJson as Record<string, unknown>)
          .nativeInputSourceReceipt).digest });
      const reader: AuthorizationActor = { type: "agent", source: "none", companyId, agentId: reviewerId,
        runId: reviewerRun.id, onBehalfOfUserId: reviewerRun.responsibleUserId };
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId, runId: reviewerRun.id, actor: reader,
        ...receipt.bootstrap })).resolves.toBeUndefined();
      const reviewMarker = receipt.dispatches.flatMap(dispatch => dispatch.inputs).find((input): input is Extract<NativePayloadSourceInput,
        { kind: "review_model_dispatch" }> => input.kind === "review_model_dispatch" && input.runId === reviewerRun.id);
      const reviewDispatch = reviewMarker && receipt.dispatches.find(dispatch => {
        const finalInput = dispatch.inputs.at(-1);
        return finalInput?.kind === "review_model_dispatch" && finalInput.reservationId === reviewMarker.reservationId;
      });
      expect(reviewDispatch).toBeTruthy();
      const reviewPlanId = reviewerReservations[0]!.planId;
      if (!reviewPlanId) throw new Error("review_model_reservation_missing_plan_id");
      const [reviewPlan] = await db.select().from(orchestrationPlans).where(and(
        eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, reviewPlanId))).limit(1);
      expect(reviewPlan).toMatchObject({ status: "paused" });
      expect(reviewPlan!.version).toBeGreaterThan(reviewerReservations[0]!.reviewPlanVersion!);
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId, runId: reviewerRun.id, actor: reader,
        policy: reviewDispatch!.policy, inputs: reviewDispatch!.inputs })).resolves.toBeUndefined();
      const forgedInputs = [...reviewDispatch!.inputs.slice(0, -1), { ...reviewMarker!, planId: randomUUID() }];
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId, runId: reviewerRun.id, actor: reader,
        policy: reviewDispatch!.policy, inputs: forgedInputs })).rejects.toBeDefined();
      const originalSummary = interaction!.summary;
      try {
        await db.update(issueThreadInteractions).set({ summary: `${originalSummary} changed after capture` })
          .where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.id, interaction!.id)));
        await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId, runId: reviewerRun.id, actor: reader,
          ...receipt.bootstrap })).rejects.toBeDefined();
      } finally {
        await db.update(issueThreadInteractions).set({ summary: originalSummary })
          .where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.id, interaction!.id)));
      }
    },
  });
  completed = true;
}, 600_000);
