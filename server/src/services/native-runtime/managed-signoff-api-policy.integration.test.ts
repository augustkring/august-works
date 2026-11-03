import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, agentExecutionManifests, agentWakeupRequests, agents, environmentLeases, heartbeatRuns, issues, statusDecisions, statusDecisionEffects, workAssessments } from "@paperclipai/db";
import { issueService } from "../issues.js";
import { verifyNativeCleanupRuntimeState } from "../execution-sandbox/run-lease-cleanup.js";
import { withManagedNativeHeartbeatFixture } from "../../__tests__/helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { createControlledNativeSignoffBackend } from "../../__tests__/helpers/controlled-native-signoff-backend.js";


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
      expect(facts().sandboxRuntimeFacts?.closedAgentHosts).toContain(managedAgentIds.executor);
      expect(facts().sandboxRuntimeFacts?.closedAgentHosts).not.toContain(managedAgentIds.reviewer);
      await assertStoppedLease(executorRun!.id);

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
