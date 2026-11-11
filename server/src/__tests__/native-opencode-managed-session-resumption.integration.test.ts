import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, authSessions, createDb, documents, heartbeatRuns, heartbeatRunEvents, issueDocuments, issueThreadInteractions,
  nativeRunFinalizations, nativeRunResults, toolInvocations, workAssessments, statusDecisions } from "@paperclipai/db";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import type { PersistedNativeSession } from "../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";

const variants = ["unchanged", "newer_active", "stale_idle"] as const;
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home = "";
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "managed-opencode-resumption-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("managed-opencode-resumption-");
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
}, 30_000);

function toolName(body: Record<string, unknown>, wanted: string): string {
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  const found = tools.find(value => value.name === wanted || ["paperclip__", "paperclip_", "paperclip."]
    .some(prefix => value.name === `${prefix}${wanted}`));
  if (typeof found?.name !== "string") throw new Error(`managed_resumption_tool_missing_${wanted}`);
  return found.name;
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("managed_opencode_resumption_deadline_exhausted");
}

async function waitForValue<T>(value: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([value, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("managed_opencode_checkpoint_deadline_exhausted")), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe.each(variants)("genuine managed OpenCode checkpoint resumption (%s)", variant => {
  it("recovers the exact stored turn and keeps an accepted response wake in a fresh run", async () => {
    let targetIssueId: string | undefined;
    let originalRunId: string | undefined;
    let providerBoundaryObserved = false;
    let planDocument: { id: string; revisionId: string; revisionNumber: number } | undefined;
    let pendingInteractionId: string | undefined;
    let confirmationCallId: string | undefined;
    const confirmationPrompt = "Accept the saved implementation plan before continuing?";
    let capturedSnapshot: PersistedNativeSession | undefined;
    let capturedResolve!: (value: PersistedNativeSession) => void;
    const checkpointCaptured = new Promise<PersistedNativeSession>(resolve => { capturedResolve = resolve; });
    let releaseCheckpoint!: () => void;
    const checkpointGate = new Promise<void>(resolve => { releaseCheckpoint = resolve; });
    let injectedOnce = false;
    const callsByRun = new Map<string, number>();

    await withManagedNativeHeartbeatFixture({
      db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
      schedulerMode: "serial",
      providerReply: ({ body, execution, runId }) => {
        if (!originalRunId) originalRunId = runId;
        const callIndex = (callsByRun.get(runId) ?? 0) + 1;
        callsByRun.set(runId, callIndex);
        if (runId === originalRunId && callIndex === 1) {
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `resumption-plan-${runId}`,
            name: toolName(body, "write_document"), input: { idempotencyKey: `resumption:${runId}:plan`, key: "plan",
              title: "Implementation plan", body: "Use the managed Project workspace after the Human accepts this plan.",
              baseRevisionId: null } }] };
        }
        if (runId === originalRunId && variant !== "unchanged" && callIndex === 2) {
          if (!planDocument) throw new Error("managed_resumption_saved_plan_revision_missing");
          confirmationCallId = `resumption-confirm-${runId}`;
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: confirmationCallId,
            name: toolName(body, "request_human_input"), input: { idempotencyKey: `resumption-confirm:${runId}`,
              interactionKind: "confirmation", title: "Confirm the saved implementation plan",
              prompt: confirmationPrompt,
              continuationPolicy: "wake_assignee_on_accept", resolverPolicy: "human_only",
              payload: { version: 1, prompt: "Accept the saved implementation plan?", target: {
                type: "issue_document", issueId: execution.binding.issueId, documentId: planDocument.id,
                key: "plan", revisionId: planDocument.revisionId, revisionNumber: planDocument.revisionNumber } } } }] };
        }
        const contract = execution.completionContract.contract;
        const waitsForAcceptance = runId === originalRunId && variant !== "unchanged";
        const expectedFinishIndex = waitsForAcceptance ? 3 : (runId === originalRunId ? 2 : 1);
        if (callIndex === expectedFinishIndex) {
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `resumption-finish-${runId}`,
            name: toolName(body, "paperclip_finish"), input: { schema: "paperclip.run_result.v1",
              reportedWorkDisposition: waitsForAcceptance ? "yielded" : "done",
              summary: waitsForAcceptance ? "Waiting for the Human to accept the saved plan." :
                "Completed the bounded task under its original persisted completion contract.",
              completionClaim: { contractRevision: contract.revision, objectiveSatisfied: !waitsForAcceptance,
                criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id,
                  status: waitsForAcceptance ? "unknown" : "satisfied", evidenceRefs: [] })),
                remainingWork: waitsForAcceptance ? [{ description: "Continue after the Human accepts the saved plan.", blocksCompletion: true }] : [] },
              evidence: [], verification: [], attentionRequests: [], artifacts: [],
              ...(waitsForAcceptance && pendingInteractionId ? { continuation: { kind: "response_wake",
                summary: "Resume after the Human accepts the implementation plan.",
                idempotencyKey: `interaction-response:${pendingInteractionId}` } } : {}) } }] };
        }
        if (callIndex === expectedFinishIndex + 1)
          return { stop_reason: "end_turn", content: [{ type: "text", text: "The managed task is complete." }] };
        throw new Error(`managed_resumption_unexpected_provider_turn:${runId}:${callIndex}`);
      },
      beforeProviderResponse: async ({ run }) => {
        if (!originalRunId) originalRunId = run.id;
        if (run.id !== originalRunId || !targetIssueId) return;
        providerBoundaryObserved = true;
        const [savedPlan] = await db.select({ id: documents.id, revisionId: documents.latestRevisionId,
          revisionNumber: documents.latestRevisionNumber }).from(issueDocuments).innerJoin(documents,
          and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
          .where(and(eq(issueDocuments.issueId, targetIssueId), eq(issueDocuments.key, "plan"))).limit(1);
        if (savedPlan?.revisionId && savedPlan.revisionNumber)
          planDocument = { id: savedPlan.id, revisionId: savedPlan.revisionId, revisionNumber: savedPlan.revisionNumber };
      },
      afterPersistedNativeSessionCheckpoint: async ({ runId, snapshot }) => {
        // The fixture calls providerReply before beforeProviderResponse. Refresh
        // the document revision from the real DB after every canonical SDK
        // checkpoint so call 2 receives only a revision already committed by
        // write_document; never manufacture a target or revision locally.
        if (targetIssueId && snapshot.identity.issueId === targetIssueId) {
          const [savedPlan] = await db.select({ id: documents.id, revisionId: documents.latestRevisionId,
            revisionNumber: documents.latestRevisionNumber }).from(issueDocuments).innerJoin(documents,
            and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
            .where(and(eq(issueDocuments.companyId, snapshot.identity.companyId),
              eq(issueDocuments.issueId, targetIssueId), eq(issueDocuments.key, "plan"))).limit(1);
          if (savedPlan?.revisionId && savedPlan.revisionNumber)
            planDocument = { id: savedPlan.id, revisionId: savedPlan.revisionId,
              revisionNumber: savedPlan.revisionNumber };
        }
        if (injectedOnce || !targetIssueId || snapshot.identity.issueId !== targetIssueId ||
            !snapshot.providerSessionId || !providerBoundaryObserved) return;
        if (variant === "stale_idle") {
          if (snapshot.activeTurnId !== null) return;
          const events = await db.select({ eventType: heartbeatRunEvents.eventType }).from(heartbeatRunEvents)
            .where(eq(heartbeatRunEvents.runId, runId));
          // A genuine idle snapshot counts only after this exact run has already
          // recorded provider turn.started evidence (the SDK launch/checkpoint gap).
          if (!events.some(event => event.eventType === "turn.started")) return;
        } else if (typeof snapshot.activeTurnId !== "string" || !snapshot.activeTurnId) return;
        if (variant !== "unchanged") {
          const pending = await db.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions)
            .where(and(eq(issueThreadInteractions.issueId, targetIssueId),
              eq(issueThreadInteractions.kind, "request_confirmation"), eq(issueThreadInteractions.status, "pending")));
          if (!pending[0]) return;
          pendingInteractionId = pending[0].id;
        }
        injectedOnce = true;
        capturedSnapshot = structuredClone(snapshot);
        capturedResolve(structuredClone(snapshot));
        await checkpointGate;
        // This recognized provider transport failure is injected only after the
        // real SDK snapshot has been committed by the canonical control-plane port.
        throw new Error(`provider_transport_failed: controlled persisted-checkpoint interruption (${variant})`);
      },
      driveScheduler: async ({ actor, companyId, agentId, heartbeat, humanApi, factsForRun, closeManagedAgentHostForRun }) => {
        try {
        if (!actor.userId) throw new Error("managed_resumption_current_human_missing");
        const task = await issueService(db).create(companyId, { title: "Resume the persisted managed OpenCode turn",
          description: "Complete this bounded task under the original completion contract.", status: "todo",
          responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId }, db, undefined,
          { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
        targetIssueId = task.id;
        const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
          expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
          completionContract: { objective: variant === "unchanged" ? "Complete the bounded task" :
            "Save a plan, then continue after Human plan acceptance",
            requiredOutputs: [{ kind: "task_document", key: "plan" }],
            businessInvariants: ["Recovery retains the original contract"] },
          budgets: { maxModelCostMinor: 25, maxToolActions: 5 }, workers: [{ key: "writer", issueId: task.id }] });
        await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
          action: "start", rationale: "Authorize the actual managed OpenCode path" });
        const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
          requestedByActorType: "user", requestedByActorId: actor.userId, payload: { issueId: task.id },
          contextSnapshot: { issueId: task.id } });
        if (!wake) throw new Error("managed_resumption_original_run_missing");
        const checkpoint = await waitForValue(checkpointCaptured, 90_000);
        expect(capturedSnapshot).toEqual(checkpoint);
        expect(checkpoint.identity).toMatchObject({ companyId, runId: wake.id, issueId: task.id, agentId });
        const [persisted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
        expect(persisted?.runnerProfileJson).toMatchObject({ sessionCheckpoint: checkpoint,
          nativeExecutionInput: { completionContract: expect.any(Object), provider: { kind: "opencode" } } });
        const originalExecution = persisted!.runnerProfileJson!.nativeExecutionInput as Record<string, any>;
        const frozenContract = structuredClone(originalExecution.completionContract);

        if (variant !== "unchanged") {
          await waitFor(() => Boolean(pendingInteractionId));
          const [pendingQuestion] = await db.select().from(issueThreadInteractions)
            .where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, task.id),
              eq(issueThreadInteractions.id, pendingInteractionId!)));
          expect(pendingQuestion).toMatchObject({ companyId, issueId: task.id, sourceRunId: wake.id,
            createdByAgentId: agentId, kind: "request_confirmation", status: "pending" });
          await waitFor(async () => {
            const [current] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson,
              resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
            const profile = current?.runnerProfileJson as Record<string, any> | null;
            const captures = Array.isArray(profile?.nativeToolResultSourceCaptures)
              ? profile!.nativeToolResultSourceCaptures as Array<Record<string, any>> : [];
            return captures.find(value => value.callId === confirmationCallId &&
              value.tool === "request_human_input" && typeof value.resultDigest === "string") ?? null;
          }, "persisted_human_question_tool_result", 60_000);
          const [questionRun] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson,
            resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
          const questionProfile = questionRun!.runnerProfileJson as Record<string, any>;
          const questionCapture = (questionProfile.nativeToolResultSourceCaptures as Array<Record<string, any>>)
            .find(value => value.callId === confirmationCallId && value.tool === "request_human_input")!;
          expect(questionCapture).toMatchObject({ callId: confirmationCallId, tool: "request_human_input",
            eventSeq: expect.any(Number), attempt: expect.any(Number), resultDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            source: { kind: "tool_result", runId: wake.id, callId: confirmationCallId,
              toolName: "request_human_input", invocationId: expect.any(String) } });
          expect(questionCapture.source.contentHash).toBe(questionCapture.resultDigest);
          expect(questionCapture.questionInteractionOwner).toMatchObject({
            status: "pending", sourceVersion: expect.stringMatching(/^\d+(?:\.\d+)?$/), decisionSource: null,
          });
          expect(questionCapture.outputCapture).toMatchObject({ runId: wake.id, dispatch: {
            kind: expect.stringMatching(/^(worker_model_dispatch|conversation_model_dispatch)$/), runId: wake.id,
          }, managedOpenCodeToolUse: { callId: confirmationCallId, toolName: "request_human_input",
            argumentsHash: expect.stringMatching(/^[a-f0-9]{64}$/), responseContentHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
          const [questionInvocation] = await db.select().from(toolInvocations).where(and(
            eq(toolInvocations.companyId, companyId), eq(toolInvocations.id, questionCapture.source.invocationId),
            eq(toolInvocations.runId, wake.id), eq(toolInvocations.issueId, task.id), eq(toolInvocations.agentId, agentId),
            eq(toolInvocations.toolName, "request_human_input"), eq(toolInvocations.status, "succeeded"),
            eq(toolInvocations.resultHash, questionCapture.resultDigest)));
          expect(questionInvocation).toBeDefined();
          const toolReceipt = (questionRun!.resultJson as Record<string, any>).semanticToolReceipts?.[`resumption-confirm:${wake.id}`];
          expect(toolReceipt).toMatchObject({ operationId: "request_human_input", nativeInputDispatch: {
            callId: confirmationCallId, turnId: questionCapture.turnId, dispatchId: expect.stringMatching(/^[a-f0-9-]{36}$/),
            eventSeq: questionCapture.eventSeq, attempt: questionCapture.attempt } });
          expect(nativeSha256(toolReceipt.result)).toBe(questionCapture.resultDigest);
          expect(questionProfile.nativeInputSourceReceipt.additionalInputs).toEqual(expect.arrayContaining([
            expect.objectContaining({ responsibleUserId: actor.userId,
              inputs: expect.arrayContaining([expect.objectContaining({ kind: "tool_result", runId: wake.id,
                callId: confirmationCallId, toolName: "request_human_input", contentHash: questionCapture.resultDigest })]) }),
          ]));
          const [questionActivity] = await db.select({ details: activityLog.details }).from(activityLog).where(and(
            eq(activityLog.companyId, companyId), eq(activityLog.issueId, task.id),
            eq(activityLog.action, "issue.thread_interaction_created"),
            sql`${activityLog.details}->>'interactionId' = ${pendingInteractionId}`)).limit(1);
          expect(questionActivity).toBeDefined();
          const activityDetails = questionActivity!.details as Record<string, unknown>;
          expect(activityDetails).not.toHaveProperty("prompt");
          expect(activityDetails).not.toHaveProperty("summary");
          expect(Object.values(activityDetails)).not.toContain(confirmationPrompt);
          if (!actor.sessionId) throw new Error("managed_resumption_current_human_session_missing");
          const [currentSession] = await db.select({ id: authSessions.id, userId: authSessions.userId,
            expiresAt: authSessions.expiresAt }).from(authSessions).where(and(eq(authSessions.id, actor.sessionId),
              eq(authSessions.userId, actor.userId!), sql`${authSessions.expiresAt} > now()`)).limit(1);
          expect(currentSession).toBeDefined();
          const accepted = await request(humanApi.app)
            .post(`/api/issues/${task.id}/interactions/${pendingInteractionId}/accept`)
            .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost").send({});
          expect(accepted.status).toBe(200);
          expect(accepted.body).toMatchObject({ id: pendingInteractionId, status: "accepted" });
        }
        releaseCheckpoint();
        await expect.poll(async () => {
          const [run] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, wake.id));
          return run?.status === "failed";
        }, { timeout: 90_000 }).toBe(true);
        await heartbeat.drainActiveRunExecutions();
        const runtimeFacts = factsForRun(wake.id).sandboxRuntimeFacts as Record<string, unknown> | null;
        const closure = runtimeFacts?.nativeRunnerClosureWitness as Record<string, unknown> | undefined;
        expect(closure).toMatchObject({ present: true, phase: "stop_observed", launchMatched: true,
          identityMatched: true, processGone: true, stopReceiptMatched: true });
        expect(factsForRun(wake.id).providerCallCount).toBeGreaterThan(0);
        const [interrupted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
        expect(interrupted?.runnerProfileJson).toMatchObject({ sessionCheckpoint: checkpoint,
          nativeExecutionInput: { completionContract: frozenContract } });
        const [retryable] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake.id));
        expect(retryable).toMatchObject({ phase: "retryable_failure", leaseOwner: null });
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, wake.id))).toEqual([]);

        const recoveryDeadline = Date.now() + 120_000;
        let recovered: typeof interrupted | undefined;
        while (Date.now() < recoveryDeadline) {
          const [currentCoordinator] = await db.select().from(nativeRunFinalizations)
            .where(eq(nativeRunFinalizations.runId, wake.id));
          if (currentCoordinator?.phase === "committed") {
            recovered = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id)))[0];
            break;
          }
          if (currentCoordinator?.phase === "retryable_failure" && currentCoordinator.nextAttemptAt &&
              currentCoordinator.nextAttemptAt <= new Date()) {
            await heartbeat.reapOrphanedRuns({ staleThresholdMs: 0 });
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!recovered) throw new Error("managed_opencode_same_run_recovery_deadline_exhausted");
        expect(recovered).toMatchObject({ id: wake.id, runtimeMode: "native", nativeIssueId: task.id,
          completionContractId: interrupted?.completionContractId, status: "succeeded", nativePhase: "committed" });
        expect(recovered?.runnerProfileJson).toMatchObject({ nativeExecutionInput: { completionContract: frozenContract } });
        expect(callsByRun.get(wake.id)).toBeGreaterThan(1);
        const [result] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, wake.id));
        expect(result).toMatchObject({ runId: wake.id, completionContractId: interrupted?.completionContractId, schemaStatus: "accepted" });
        const [finalization] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake.id));
        expect(finalization).toMatchObject({ phase: "committed", resultId: result!.id });
        expect(await db.select().from(workAssessments).where(eq(workAssessments.runId, wake.id))).toHaveLength(1);
        expect(await db.select().from(statusDecisions).where(eq(statusDecisions.runId, wake.id))).toHaveLength(1);

        if (variant !== "unchanged") {
          await waitFor(async () => {
            const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
              eq(heartbeatRuns.nativeIssueId, task.id)));
            return runs.some(run => run.id !== wake.id && run.status === "succeeded" && run.contextSnapshot &&
              typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot) &&
              (run.contextSnapshot as Record<string, unknown>).interactionId === pendingInteractionId &&
              (run.contextSnapshot as Record<string, unknown>).sourceRunId === wake.id &&
              (run.contextSnapshot as Record<string, unknown>).forceFreshSession === true);
          }, 120_000);
          const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.nativeIssueId, task.id)));
          const followup = runs.find(run => run.id !== wake.id && run.contextSnapshot &&
            typeof run.contextSnapshot === "object" && (run.contextSnapshot as Record<string, unknown>).interactionId === pendingInteractionId);
          expect(followup).toBeDefined();
          expect(followup!.id).not.toBe(wake.id);
          expect(followup!.status).toBe("succeeded");
          const followupProfile = followup!.runnerProfileJson as Record<string, any>;
          expect(followupProfile.nativeInputSourceReceipt).toMatchObject({ binding: {
            companyId, issueId: task.id, agentId, responsibleUserId: actor.userId,
          } });
          expect(followupProfile.nativeInputSourceReceipt.bootstrap.inputs).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "interaction", issueId: task.id, interactionId: pendingInteractionId }),
          ]));
          await closeManagedAgentHostForRun(followup!.id);
        }
        await closeManagedAgentHostForRun(wake.id);
      } finally {
        releaseCheckpoint();
      }
      },
    });
  }, 900_000);
});
