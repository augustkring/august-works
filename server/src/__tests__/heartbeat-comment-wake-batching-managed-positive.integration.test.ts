import { createHash } from "node:crypto";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentWakeupRequests, createDb, heartbeatRuns, issueComments, issues, issueWorkProducts, activityLog, nativeRunFinalizations, statusDecisions, workAssessments } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import type { NativeExecutionInput } from "../vendor/paperclip-runner/index.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { projectManagedNativeCompletionDiagnostic } from "./helpers/managed-native-completion-diagnostic.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home = "";
let completedTests = 0;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "heartbeat-comment-managed-positive-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  vi.stubEnv("PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS", "1");
  database = await startEmbeddedPostgresTestDatabase("heartbeat-comment-managed-positive-", { preserveDataOnFailure: () => completedTests !== 4 });
  db = createDb(database.connectionString);
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home && completedTests === 4) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
  else if (home) console.info("managed_comment_positive_failure_root_retained", JSON.stringify({ path: home }));
}, 30_000);

function toolName(body: Record<string, unknown>, wanted: string): string {
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  const found = tools.find(value => value.name === wanted || ["paperclip__", "paperclip_", "paperclip."]
    .some(prefix => typeof value.name === "string" && value.name === `${prefix}${wanted}`));
  if (typeof found?.name !== "string") throw new Error(`managed_comment_tool_missing_${wanted}`);
  return found.name;
}

function toolUse(body: Record<string, unknown>, name: string, id: string, input: Record<string, unknown>) {
  return { stop_reason: "tool_use" as const, content: [{ type: "tool_use", id, name: toolName(body, name), input }] };
}

const managedDocumentBody = "The actual managed run retained its bounded task result.";

async function acceptExactDocumentWorkProduct(input: {
  humanApi: { app: import("express").Express; humanCookie: string };
  companyId: string; taskId: string; runId: string; documentKey: string; userId: string;
}) {
  const read = () => request(input.humanApi.app)
    .get(`/api/issues/${input.taskId}/documents/${input.documentKey}`).set("Cookie", input.humanApi.humanCookie);
  const selected = await read();
  expect(selected.status).toBe(200);
  expect(selected.body).toMatchObject({ key: input.documentKey, body: managedDocumentBody });
  expect(selected.body.id).toEqual(expect.any(String));
  expect(selected.body.latestRevisionId).toEqual(expect.any(String));
  const documentId: string = selected.body.id;
  const revisionId: string = selected.body.latestRevisionId;
  const bodySha256 = createHash("sha256").update(selected.body.body).digest("hex");
  const metadata = { documentId, revisionId, bodySha256 };
  // Real current Human HTTP mutation: no direct accepted rows, model review
  // claims, source admission exceptions, or Task-status write.
  const created = await request(input.humanApi.app).post(`/api/issues/${input.taskId}/work-products`)
    .set("Cookie", input.humanApi.humanCookie).send({ type: "document", provider: "paperclip",
      externalId: documentId, title: "Human review of the retained managed document",
      status: "ready_for_review", reviewState: "needs_board_review", createdByRunId: input.runId, metadata });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ companyId: input.companyId, issueId: input.taskId,
    type: "document", provider: "paperclip", externalId: documentId, createdByRunId: input.runId, metadata });
  expect(created.body.id).toEqual(expect.any(String));
  const workProductId: string = created.body.id;
  // Reject a changed revision/body before Human acceptance instead of copying
  // a later output into the evidence of the originally reviewed revision.
  const current = await read();
  expect(current.status).toBe(200);
  expect(current.body).toMatchObject({ id: documentId, latestRevisionId: revisionId, body: managedDocumentBody });
  expect(createHash("sha256").update(current.body.body).digest("hex")).toBe(bodySha256);
  const approved = await request(input.humanApi.app).patch(`/api/work-products/${workProductId}`)
    .set("Cookie", input.humanApi.humanCookie).send({ reviewState: "approved" });
  expect(approved.status).toBe(200);
  expect(approved.body).toMatchObject({ id: workProductId, companyId: input.companyId, issueId: input.taskId,
    type: "document", provider: "paperclip", externalId: documentId, reviewState: "approved", metadata });
  const [accepted] = await db.select().from(issueWorkProducts).where(and(eq(issueWorkProducts.id, workProductId),
    eq(issueWorkProducts.companyId, input.companyId), eq(issueWorkProducts.issueId, input.taskId)));
  expect(accepted).toMatchObject({ createdByRunId: input.runId, reviewState: "approved", metadata });
  const reviews = await db.select().from(activityLog).where(and(eq(activityLog.companyId, input.companyId),
    eq(activityLog.entityId, input.taskId), eq(activityLog.action, "issue.work_product_updated")));
  expect(reviews).toContainEqual(expect.objectContaining({ actorType: "user", actorId: input.userId,
    details: expect.objectContaining({ workProductId, changedKeys: ["reviewState"] }) }));
  return `work_product:${workProductId}`;
}

function realTaskCompletion(body: Record<string, unknown>, callIndex: number,
  execution: NativeExecutionInput,
  prefix: string, acceptedEvidenceRef: string | null, intentionallyIncomplete = false) {
  if (callIndex === 1) return toolUse(body, "write_document", `${prefix}-document`, {
    idempotencyKey: `${prefix}-document`, key: `${prefix}-document`, title: "Managed comment wake result",
    body: managedDocumentBody, baseRevisionId: null,
  });
  if (callIndex === 2) {
    if (!acceptedEvidenceRef && !intentionallyIncomplete) throw new Error("managed_comment_human_evidence_missing");
    const contract = execution.completionContract.contract;
    return toolUse(body, "paperclip_finish", `${prefix}-finish`, { schema: "paperclip.run_result.v1",
      reportedWorkDisposition: "done", summary: "Completed the actual managed comment wake task.",
      completionClaim: { contractRevision: contract.revision, objectiveSatisfied: true,
        criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: acceptedEvidenceRef ? [acceptedEvidenceRef] : [] })),
        remainingWork: [] }, evidence: [], verification: acceptedEvidenceRef ? [{ commandOrCheck: "Current Human reviewed the exact retained document revision",
        status: "passed", artifactRef: acceptedEvidenceRef }] : [], attentionRequests: [], artifacts: [] });
  }
  return { stop_reason: "end_turn" as const, content: [{ type: "text", text: "The managed task is complete." }] };
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 30_000, intervalMs = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for managed comment fixture condition");
}

async function createAssignedTask(input: { actor: import("../services/authorization.js").AuthorizationActor;
  companyId: string; agentId: string; title: string }) {
  const task = await issueService(db).create(input.companyId, { title: input.title,
    description: "A bounded test task for the real managed heartbeat runner.", status: "todo", priority: "medium",
    responsibleUserId: input.actor.userId!, createdByUserId: input.actor.userId!, assigneeAgentId: input.agentId },
  db, undefined, { manualInputActor: input.actor, privacyActor: input.actor, sourceAccessActor: input.actor });
  await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
    heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, input.agentId));
  expect(task).toMatchObject({ executionPolicy: null, executionState: null });
  return task;
}

async function authorizeTask(input: { actor: import("../services/authorization.js").AuthorizationActor;
  companyId: string; taskId: string; expectedIssueUpdatedAt: Date; objective: string; outputKey: string }) {
  const plan = await orchestrationService(db).create(input.actor, input.companyId, {
    issueId: input.taskId, expectedIssueUpdatedAt: input.expectedIssueUpdatedAt.toISOString(), workload: "semantic", riskClass: "C0",
    completionContract: { objective: input.objective,
      requiredOutputs: [{ kind: "task_document", key: input.outputKey }], businessInvariants: ["No external side effects"] },
    budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId: input.taskId }],
  });
  await orchestrationService(db).decide(input.actor, input.companyId, plan.id,
    { expectedVersion: plan.version, action: "start", rationale: "Authorize this bounded managed scheduler test" });
  return plan;
}

async function verifyPlanAsCurrentHuman(input: {
  actor: import("../services/authorization.js").AuthorizationActor;
  companyId: string; planId: string;
}) {
  const verifier = verificationService(db);
  const packet = await verifier.packet(input.actor, input.companyId, input.planId);
  expect(packet.deterministicFailures).toEqual([]);
  expect(packet.policy.workerSelfCertification).toBe(false);
  const evidenceRefs = packet.evidence.map(item => item.ref);
  const review = await verifier.review(input.actor, input.companyId, input.planId, {
    expectedPlanVersion: packet.planVersion, workerId: packet.workerId, expectedResultHash: packet.resultHash,
    result: "pass", rationale: "The current Human reviewed the retained managed result against its active Plan contract.",
    objectiveSatisfied: true,
    businessInvariants: packet.contract.businessInvariants.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
    evidenceRequirements: packet.contract.evidenceRequirements.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
    prohibitedOutcomes: packet.contract.prohibitedOutcomes.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
  });
  expect(review).toMatchObject({ reviewerType: "human", result: "pass" });
}

async function expectHumanVerifiedTaskDone(input: {
  actor: import("../services/authorization.js").AuthorizationActor;
  companyId: string; taskId: string; runId: string; planId: string;
  drain: () => Promise<void>; providerCallCount: () => number;
}) {
  const [awaitingHuman] = await db.select({ status: issues.status, completedAt: issues.completedAt }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.taskId)));
  expect(awaitingHuman).toMatchObject({ status: "in_review", completedAt: null });
  const callsBeforeReview = input.providerCallCount();
  await verifyPlanAsCurrentHuman({ actor: input.actor, companyId: input.companyId, planId: input.planId });
  await input.drain();
  expect(input.providerCallCount()).toBe(callsBeforeReview);
  expect(await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.nativeIssueId, input.taskId))))
    .toHaveLength(1);
  const [finishedTask] = await db.select({ status: issues.status, completedAt: issues.completedAt }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.taskId)));
  await expectTaskDoneWithSafeFinalizationDiagnostic({ companyId: input.companyId, taskId: input.taskId,
    runId: input.runId, task: finishedTask });
}

async function expectTaskDoneWithSafeFinalizationDiagnostic(input: {
  companyId: string; taskId: string; runId: string;
  task: { status: string; completedAt: Date | null } | undefined;
}) {
  if (input.task?.status === "done" && input.task.completedAt !== null) {
    expect(input.task).toMatchObject({ status: "done" });
    expect(input.task.completedAt).not.toBeNull();
    return;
  }

  // Query the persisted authority records only after the normal assertion would fail.
  // The helper projects them to whitelisted enums, booleans and counts before display.
  const [finalization] = await db.select({ phase: nativeRunFinalizations.phase,
    failureCode: nativeRunFinalizations.failureCode, failureDetail: nativeRunFinalizations.failureDetail, assessmentId: nativeRunFinalizations.assessmentId,
    decisionId: nativeRunFinalizations.decisionId }).from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, input.companyId), eq(nativeRunFinalizations.issueId, input.taskId),
      eq(nativeRunFinalizations.runId, input.runId))).limit(1);
  const [decision] = await db.select({ reasonCode: statusDecisions.reasonCode, toStatus: statusDecisions.toStatus,
    applicationState: statusDecisions.applicationState, assessmentId: statusDecisions.assessmentId })
    .from(statusDecisions).where(and(eq(statusDecisions.companyId, input.companyId),
      eq(statusDecisions.issueId, input.taskId), eq(statusDecisions.runId, input.runId)))
    .orderBy(desc(statusDecisions.createdAt)).limit(1);
  const assessmentId = finalization?.assessmentId ?? decision?.assessmentId;
  const [assessment] = assessmentId ? await db.select({ assessmentJson: workAssessments.assessmentJson }).from(workAssessments).where(and(
      eq(workAssessments.companyId, input.companyId), eq(workAssessments.issueId, input.taskId),
      eq(workAssessments.runId, input.runId), eq(workAssessments.id, assessmentId))).limit(1) : [];
  const diagnostic = projectManagedNativeCompletionDiagnostic({
    finalization, decision, assessment: assessment?.assessmentJson,
  });
  expect({ status: input.task?.status ?? "missing", completedAtPresent: input.task?.completedAt != null },
    `Safe native completion diagnostic: ${JSON.stringify(diagnostic)}`)
    .toEqual({ status: "done", completedAtPresent: true });
}

// Failure-only, closed projection for an unexpected extra run. It follows the
// durable run->wakeupRequestId edge and emits only ID hashes, known enums and
// booleans; never include payload, comment, actor ID, or error text.
async function projectUnexpectedRunWakeRows(input: {
  runs: Array<typeof heartbeatRuns.$inferSelect>;
  companyId: string;
  taskId: string;
}) {
  const knownSources = new Set(["automation", "assignment", "on_demand", "timer"]);
  const knownReasons = new Set([
    "issue_assigned", "issue_execution_deferred", "issue_execution_promoted", "issue_status_changed",
    "issue_commented", "issue_reopened_via_comment", "issue_comment_mentioned",
    "issue_continuation_needed", "issue_children_completed", "issue_blockers_resolved",
  ]);
  const knownStatuses = new Set([
    "queued", "claimed", "coalesced", "skipped", "completed", "failed",
    "cancelled", "deferred_issue_execution",
  ]);
  const knownTriggers = new Set(["manual", "ping", "callback", "system"]);
  const digest = (value: string | null | undefined) => value
    ? createHash("sha256").update(value).digest("hex") : null;
  const closed = (value: string | null, allow: Set<string>) =>
    value === null ? null : (allow.has(value) ? value : "other");

  const projected = await Promise.all(input.runs.map(async run => {
    const [wake] = run.wakeupRequestId
      ? await db.select({ id: agentWakeupRequests.id, source: agentWakeupRequests.source,
          triggerDetail: agentWakeupRequests.triggerDetail, reason: agentWakeupRequests.reason,
          status: agentWakeupRequests.status, requestedByActorType: agentWakeupRequests.requestedByActorType })
        .from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, input.companyId),
          eq(agentWakeupRequests.id, run.wakeupRequestId))).limit(1)
      : [];
    const runIssueId = run.nativeIssueId ??
      (typeof run.contextSnapshot?.issueId === "string" ? run.contextSnapshot.issueId : null);
    return {
      runIdSha256: digest(run.id),
      wakeIdSha256: digest(wake?.id),
      reason: closed(wake?.reason ?? null, knownReasons),
      source: closed(wake?.source ?? null, knownSources),
      trigger: closed(wake?.triggerDetail ?? null, knownTriggers),
      status: closed(wake?.status ?? null, knownStatuses),
      runSource: closed(run.invocationSource, knownSources),
      runTrigger: closed(run.triggerDetail, knownTriggers),
      contextReason: closed(typeof run.contextSnapshot?.wakeReason === "string" ? run.contextSnapshot.wakeReason : null, knownReasons),
      sameTask: runIssueId === input.taskId,
      requestedByHuman: wake?.requestedByActorType === "user",
      originWasDeferred: wake?.reason === "issue_execution_promoted" ||
        wake?.reason === "issue_execution_deferred",
    };
  }));
  console.info("managed_comment_unexpected_runs_safe_projection", JSON.stringify(projected));
}

describe("heartbeat comment wake batching", () => {
  it("cancels an empty deferred comment wake instead of promoting deleted input", async () => {
    let providerEntered = false;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    let authenticatedRequests = 0;
    let firstProviderResponse = true;
    let providerRunId = "";
    let taskId = "";
    let acceptedEvidenceRef: string | null = null;
    let reviewDocument: (() => Promise<string>) | undefined;
    let firstRunId = "";
    let companyId = "";
    let agentId = "";

    try {
      await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
        providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution, "empty-deferred", acceptedEvidenceRef),
        beforeManagedModelRequest: async ({ runId }) => {
          if (firstRunId && runId !== firstRunId) throw new Error("empty_deferred_unexpected_second_run");
          authenticatedRequests++;
          if (authenticatedRequests === 2) {
            providerEntered = true; await providerGate;
            if (!reviewDocument) throw new Error("managed_comment_human_review_unbound");
            acceptedEvidenceRef = await reviewDocument();
          }
        },
        beforeProviderResponse: async ({ run }) => {
          if (firstProviderResponse) { firstProviderResponse = false; providerRunId = run.id; }
          if (firstRunId && run.id !== firstRunId) throw new Error("empty_deferred_unexpected_second_run");
        },
        driveScheduler: async ({ actor, companyId: fixtureCompanyId, agentId: fixtureAgentId, heartbeat, facts, factsForRun, humanApi }) => {
          try {
            companyId = fixtureCompanyId; agentId = fixtureAgentId;
          const task = await createAssignedTask({ actor, companyId, agentId, title: "Discard deferred follow-up" });
          taskId = task.id;
          const firstComment = await issueService(db).addComment(task.id, "First comment", { userId: actor.userId! },
            { manualInputActor: actor });
          const [currentTask] = await db.select({ updatedAt: issues.updatedAt }).from(issues).where(eq(issues.id, task.id));
          const plan = await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: currentTask!.updatedAt,
            objective: "Finish without a queued follow-up", outputKey: "empty-deferred-document" });
          reviewDocument = () => acceptExactDocumentWorkProduct({ humanApi, companyId, taskId: task.id,
            runId: firstRunId, documentKey: "empty-deferred-document", userId: actor.userId! });
          const firstRun = await heartbeat.wakeup(agentId, { source: "automation", triggerDetail: "system",
            reason: "issue_commented", payload: { issueId: task.id, commentId: firstComment.id },
            contextSnapshot: { issueId: task.id, taskId: task.id, commentId: firstComment.id, wakeReason: "issue_commented" },
            requestedByActorType: "user", requestedByActorId: actor.userId! });
          expect(firstRun).not.toBeNull(); firstRunId = firstRun!.id;
          await waitFor(async () => (await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, firstRunId)).then(rows => rows[0]?.status)) === "running");
          await waitFor(() => providerEntered && Boolean(providerRunId), 120_000);
          expect(providerRunId).toBe(firstRunId);

          const discardedComment = await issueService(db).addComment(task.id,
            "Delete this before the current turn finishes", { userId: actor.userId! }, { manualInputActor: actor });
          expect(await heartbeat.wakeup(agentId, { source: "automation", triggerDetail: "system", reason: "issue_commented",
            payload: { issueId: task.id, commentId: discardedComment.id },
            contextSnapshot: { issueId: task.id, taskId: task.id, commentId: discardedComment.id, wakeReason: "issue_commented" },
            requestedByActorType: "user", requestedByActorId: actor.userId! })).toBeNull();
          await waitFor(async () => (await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, "deferred_issue_execution"))).then(rows => rows.length)) === 1);
          const [deferredWake] = await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, "deferred_issue_execution")));
          // Queue lifecycle reason is separate from the original wake reason in its saved context.
          expect(deferredWake).toMatchObject({ source: "automation", triggerDetail: "system", reason: "issue_execution_deferred",
            requestedByActorType: "user", requestedByActorId: actor.userId,
            payload: { issueId: task.id, commentId: discardedComment.id } });
          expect(deferredWake?.payload?._paperclipWakeContext).toMatchObject({ issueId: task.id, taskId: task.id,
            commentId: discardedComment.id, wakeCommentId: discardedComment.id, wakeReason: "issue_commented" });
          await issueService(db).removeComment(discardedComment.id);
          releaseProvider();
          await heartbeat.drainActiveRunExecutions();

          const [finalWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferredWake!.id));
          expect(finalWake).toMatchObject({ id: deferredWake!.id, status: "cancelled", source: "automation",
            reason: "issue_execution_deferred", requestedByActorType: "user", requestedByActorId: actor.userId });
          expect(finalWake?.payload?._paperclipWakeContext).toMatchObject({ wakeReason: "issue_commented" });
          const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
          if (runs.length !== 1) await projectUnexpectedRunWakeRows({ runs, companyId, taskId: task.id });
          expect(runs).toHaveLength(1);
          expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native",
            invocationSource: "automation", triggerDetail: "system", nativeIssueId: task.id,
            responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
            contextSnapshot: expect.objectContaining({ issueId: task.id, taskId: task.id,
              commentId: firstComment.id, wakeReason: "issue_commented",
              paperclipWake: expect.objectContaining({ reason: "issue_commented" }) }) });
          expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
          const cancelled = await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, "cancelled")));
          expect(cancelled).toHaveLength(1);
          expect(cancelled[0]?.id).toBe(deferredWake!.id);
          await expectHumanVerifiedTaskDone({ actor, companyId, taskId, runId: firstRunId, planId: plan.id,
            drain: () => heartbeat.drainActiveRunExecutions(), providerCallCount: () => facts().providerCallCount });
          } finally { releaseProvider(); }
        },
      });
      completedTests++;
    } finally { releaseProvider?.(); }
  }, 600_000);

  it("cancels a deferred wake containing only a comment authored by the closing run", async () => {
    let providerEntered = false;
    let firstProviderResponse = true;
    let providerRunId = "";
    let firstRunId = "";
    let companyId = "";
    let agentId = "";

    let authenticatedRequests = 0;
    let injectSelfComment: (() => Promise<void>) | undefined;
    let acceptedEvidenceRef: string | null = null;
    let reviewDocument: (() => Promise<string>) | undefined;
    let deferredWake: typeof agentWakeupRequests.$inferSelect | undefined;

    await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
        providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution, "self-comment", acceptedEvidenceRef),
        beforeManagedModelRequest: async ({ runId }) => {
          if (firstRunId && runId !== firstRunId) throw new Error("self_comment_unexpected_second_run");
          authenticatedRequests++;
          if (authenticatedRequests === 2) {
            expect(runId).toBe(firstRunId);
            expect(injectSelfComment).toBeDefined();
            await injectSelfComment!();
            if (!reviewDocument) throw new Error("managed_comment_human_review_unbound");
            acceptedEvidenceRef = await reviewDocument();
          }
        },
        beforeProviderResponse: async ({ run, sourceReceipt }) => {
          if (firstProviderResponse) {
            firstProviderResponse = false; providerRunId = run.id;
            const [admittedWake] = await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, run.companyId), eq(agentWakeupRequests.agentId, run.agentId),
              eq(agentWakeupRequests.id, run.wakeupRequestId!), eq(agentWakeupRequests.runId, run.id)));
            expect(admittedWake).toMatchObject({ reason: "issue_assigned", source: "assignment", triggerDetail: "system",
              requestedByActorType: "system", requestedByActorId: null, runId: run.id });
            expect(run.contextSnapshot).toMatchObject({ issueId: run.nativeIssueId, taskId: run.nativeIssueId,
              wakeReason: "issue_assigned" });
            const wakePayload = run.contextSnapshot?.paperclipWake;
            expect(wakePayload).toMatchObject({ reason: "issue_assigned", issue: { id: run.nativeIssueId } });
            const receipt = nativeRunInputSourceReceiptSchema.parse(sourceReceipt);
            expect(receipt.binding).toMatchObject({ companyId: run.companyId, agentId: run.agentId,
              runId: run.id, issueId: run.nativeIssueId });
            expect(receipt.bootstrap.inputs.filter(source => source.kind === "native_task_wake"))
              .toEqual([expect.objectContaining({ runId: run.id, issueId: run.nativeIssueId,
                contentHash: nativeSha256(wakePayload) })]);
            providerEntered = true;
          }
          if (firstRunId && run.id !== firstRunId) throw new Error("self_comment_unexpected_second_run");
        },
        driveScheduler: async ({ actor, companyId: fixtureCompanyId, agentId: fixtureAgentId, heartbeat, facts, factsForRun, humanApi }) => {
          companyId = fixtureCompanyId; agentId = fixtureAgentId;
          const task = await createAssignedTask({ actor, companyId, agentId, title: "Self-comment must not reopen" });
          const plan = await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: task.updatedAt,
            objective: "Close the task and ignore the run-authored comment wake", outputKey: "self-comment-document" });
          reviewDocument = () => acceptExactDocumentWorkProduct({ humanApi, companyId, taskId: task.id,
            runId: firstRunId, documentKey: "self-comment-document", userId: actor.userId! });
          // Run the unchanged domain mutation between settled model requests, before fresh authority is read.
          injectSelfComment = async () => {
            // Use the real comment owner with the exact live Run as its attribution.
            const selfComment = await issueService(db).addComment(task.id, "Closing comment from the same run",
              { userId: actor.userId!, runId: firstRunId });
            const [commentRow] = await db.select().from(issueComments).where(eq(issueComments.id, selfComment.id));
            expect(commentRow).toMatchObject({ id: selfComment.id, authorUserId: actor.userId, createdByRunId: firstRunId });

            expect(await heartbeat.wakeup(agentId, { source: "automation", triggerDetail: "system", reason: "issue_commented",
              payload: { issueId: task.id, commentId: selfComment.id },
              contextSnapshot: { issueId: task.id, taskId: task.id, commentId: selfComment.id, wakeCommentId: selfComment.id,
                wakeReason: "issue_commented" }, requestedByActorType: "user", requestedByActorId: actor.userId! })).toBeNull();
            await waitFor(async () => (await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
              eq(agentWakeupRequests.status, "deferred_issue_execution"))).then(rows => rows.length)) === 1);
            [deferredWake] = await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
              eq(agentWakeupRequests.status, "deferred_issue_execution")));
            expect(deferredWake).toMatchObject({ source: "automation", triggerDetail: "system", reason: "issue_execution_deferred",
              requestedByActorType: "user", requestedByActorId: actor.userId,
              payload: { issueId: task.id, commentId: selfComment.id } });
            expect(deferredWake?.payload?._paperclipWakeContext).toMatchObject({ issueId: task.id, taskId: task.id,
              commentId: selfComment.id, wakeCommentId: selfComment.id, wakeReason: "issue_commented" });
          };
          const firstRun = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
            reason: "issue_assigned", payload: { issueId: task.id },
            contextSnapshot: { issueId: task.id, taskId: task.id, wakeReason: "issue_assigned" },
            requestedByActorType: "system", requestedByActorId: null });
          expect(firstRun).not.toBeNull(); firstRunId = firstRun!.id;
          await waitFor(async () => (await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, firstRunId)).then(rows => rows[0]?.status)) === "running");
          await waitFor(() => providerEntered && Boolean(providerRunId), 120_000);
          expect(providerRunId).toBe(firstRunId);

          await heartbeat.drainActiveRunExecutions();
          expect(authenticatedRequests).toBeGreaterThanOrEqual(2);
          expect(deferredWake).toBeDefined();

          const [finalWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferredWake!.id));
          expect(finalWake).toMatchObject({ id: deferredWake!.id, status: "cancelled",
            error: "Deferred wake contained only comments authored by the finishing run", source: "automation",
            reason: "issue_execution_deferred", requestedByActorType: "user", requestedByActorId: actor.userId });
          expect(finalWake?.payload?._paperclipWakeContext).toMatchObject({ wakeReason: "issue_commented" });
          const requests = await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId)));
          expect(requests.filter(request => request.status === "cancelled")).toHaveLength(1);
          const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
          if (runs.length !== 1) await projectUnexpectedRunWakeRows({ runs, companyId, taskId: task.id });
          expect(runs).toHaveLength(1);
          expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native",
            invocationSource: "assignment", triggerDetail: "system", nativeIssueId: task.id,
            responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
            contextSnapshot: expect.objectContaining({ issueId: task.id, taskId: task.id }) });
          // Status-decision wake coalescence updates current control metadata, not the admitted assignment above.
          const statusWakes = requests.filter(request => request.runId === firstRunId &&
            request.status === "coalesced" && request.reason === "issue_status_changed");
          expect(statusWakes).toEqual([]);
          expect(runs[0]?.contextSnapshot).toMatchObject({ wakeReason: "issue_assigned",
            paperclipWake: expect.objectContaining({ reason: "issue_assigned" }) });
          expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
          await expectHumanVerifiedTaskDone({ actor, companyId, taskId: task.id, runId: firstRunId, planId: plan.id,
            drain: () => heartbeat.drainActiveRunExecutions(), providerCallCount: () => facts().providerCallCount });
        },
      });
    completedTests++;
  }, 600_000);

  it("cancels a deferred comment wake when its only queued comment is deleted before promotion", async () => {
    let providerEntered = false;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    let authenticatedRequests = 0;
    let firstProviderResponse = true;
    let providerRunId = "";
    let firstRunId = "";
    let acceptedEvidenceRef: string | null = null;
    let reviewDocument: (() => Promise<string>) | undefined;
    let companyId = "";
    let agentId = "";

    try {
      await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
        providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution, "deleted-before-promotion", acceptedEvidenceRef),
        beforeManagedModelRequest: async ({ runId }) => {
          if (firstRunId && runId !== firstRunId) throw new Error("deleted_comment_unexpected_second_run");
          authenticatedRequests++;
          if (authenticatedRequests === 2) {
            providerEntered = true; await providerGate;
            if (!reviewDocument) throw new Error("managed_comment_human_review_unbound");
            acceptedEvidenceRef = await reviewDocument();
          }
        },
        beforeProviderResponse: async ({ run }) => {
          if (firstProviderResponse) { firstProviderResponse = false; providerRunId = run.id; }
          if (firstRunId && run.id !== firstRunId) throw new Error("deleted_comment_unexpected_second_run");
        },
        driveScheduler: async ({ actor, companyId: fixtureCompanyId, agentId: fixtureAgentId, heartbeat, facts, factsForRun, humanApi }) => {
          try {
            companyId = fixtureCompanyId; agentId = fixtureAgentId;
            const task = await createAssignedTask({ actor, companyId, agentId, title: "Deleted follow-up must not reopen" });
            const plan = await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: task.updatedAt,
              objective: "Complete the assigned task without promoting a deleted comment", outputKey: "deleted-before-promotion-document" });
          reviewDocument = () => acceptExactDocumentWorkProduct({ humanApi, companyId, taskId: task.id,
            runId: firstRunId, documentKey: "deleted-before-promotion-document", userId: actor.userId! });

            const firstRun = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
              reason: "issue_assigned", payload: { issueId: task.id },
              contextSnapshot: { issueId: task.id, taskId: task.id, wakeReason: "issue_assigned" },
              requestedByActorType: "system", requestedByActorId: null });
            expect(firstRun).not.toBeNull(); firstRunId = firstRun!.id;
            await waitFor(async () => (await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
              .where(eq(heartbeatRuns.id, firstRunId)).then(rows => rows[0]?.status)) === "running");
            await waitFor(() => providerEntered && Boolean(providerRunId), 120_000);
            expect(providerRunId).toBe(firstRunId);

            const queuedComment = await issueService(db).addComment(task.id,
              "Please look at this once you finish", { userId: actor.userId! }, { manualInputActor: actor });
            expect(await heartbeat.wakeup(agentId, { source: "automation", triggerDetail: "system", reason: "issue_commented",
              payload: { issueId: task.id, commentId: queuedComment.id },
              contextSnapshot: { issueId: task.id, taskId: task.id, commentId: queuedComment.id,
                wakeCommentId: queuedComment.id, wakeReason: "issue_commented" },
              requestedByActorType: "user", requestedByActorId: actor.userId! })).toBeNull();
            await waitFor(async () => (await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
              eq(agentWakeupRequests.status, "deferred_issue_execution"))).then(rows => rows.length)) === 1);
            const [deferredWake] = await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
              eq(agentWakeupRequests.status, "deferred_issue_execution")));
            expect(deferredWake).toMatchObject({ source: "automation", triggerDetail: "system", reason: "issue_execution_deferred",
              requestedByActorType: "user", requestedByActorId: actor.userId,
              payload: { issueId: task.id, commentId: queuedComment.id } });
            expect(deferredWake?.payload?._paperclipWakeContext).toMatchObject({ issueId: task.id, taskId: task.id,
              commentId: queuedComment.id, wakeCommentId: queuedComment.id, wakeReason: "issue_commented" });

            await issueService(db).removeComment(queuedComment.id);
            releaseProvider();
            await heartbeat.drainActiveRunExecutions();

            const [finalWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferredWake!.id));
            expect(finalWake).toMatchObject({ id: deferredWake!.id, status: "cancelled",
              error: "Queued messages were discarded before promotion", source: "automation", reason: "issue_execution_deferred",
              requestedByActorType: "user", requestedByActorId: actor.userId });
            expect(finalWake?.payload?._paperclipWakeContext).toMatchObject({ wakeReason: "issue_commented" });
            const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
            if (runs.length !== 1) await projectUnexpectedRunWakeRows({ runs, companyId, taskId: task.id });
            expect(runs).toHaveLength(1);
            expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native",
              invocationSource: "assignment", triggerDetail: "system", nativeIssueId: task.id,
              responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
              contextSnapshot: expect.objectContaining({ issueId: task.id, taskId: task.id, wakeReason: "issue_assigned",
                paperclipWake: expect.objectContaining({ reason: "issue_assigned" }) }) });
            expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
            const cancelled = await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
              eq(agentWakeupRequests.status, "cancelled")));
            expect(cancelled).toHaveLength(1);
            expect(cancelled[0]?.id).toBe(deferredWake!.id);
            await expectHumanVerifiedTaskDone({ actor, companyId, taskId: task.id, runId: firstRunId, planId: plan.id,
              drain: () => heartbeat.drainActiveRunExecutions(), providerCallCount: () => facts().providerCallCount });
          } finally { releaseProvider(); }
        },
      });
      completedTests++;
    } finally { releaseProvider?.(); }
  }, 600_000);

  it("retains an incomplete managed claim while a genuine status continuation coalesces without replacing its admitted wake", async () => {
    let firstRunId = "";
    let originalWakeHash: string | null = null;
    let originalNativeWakeSource: unknown;
    await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
      providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution,
        "incomplete-control", null, true),
      beforeProviderResponse: async ({ run, sourceReceipt }) => {
        if (originalWakeHash !== null) return;
        expect(run.id).toBe(firstRunId);
        const wakePayload = run.contextSnapshot?.paperclipWake;
        expect(wakePayload).toMatchObject({ reason: "issue_assigned", issue: { id: run.nativeIssueId } });
        originalWakeHash = nativeSha256(wakePayload);
        const receipt = nativeRunInputSourceReceiptSchema.parse(sourceReceipt);
        expect(receipt.binding).toMatchObject({ companyId: run.companyId, agentId: run.agentId,
          runId: run.id, issueId: run.nativeIssueId });
        const nativeWakeSources = receipt.bootstrap.inputs.filter(source => source.kind === "native_task_wake");
        expect(nativeWakeSources).toHaveLength(1);
        expect(nativeWakeSources[0]).toMatchObject({ kind: "native_task_wake", runId: run.id,
          issueId: run.nativeIssueId, contentHash: originalWakeHash });
        originalNativeWakeSource = structuredClone(nativeWakeSources[0]);
      },
      beforeManagedModelRequest: async ({ runId }) => {
        if (firstRunId && runId !== firstRunId) throw new Error("incomplete_control_unexpected_second_run");
      },
      driveScheduler: async ({ actor, companyId, agentId, heartbeat, factsForRun }) => {
        const task = await createAssignedTask({ actor, companyId, agentId, title: "Incomplete claim must retain its honest next step" });
        await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: task.updatedAt,
          objective: "Retain the bounded result without treating unsupported completion as proven", outputKey: "incomplete-control-document" });
        const first = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
          payload: { issueId: task.id }, contextSnapshot: { issueId: task.id, taskId: task.id, wakeReason: "issue_assigned" },
          requestedByActorType: "system", requestedByActorId: null });
        expect(first).not.toBeNull(); firstRunId = first!.id;
        await heartbeat.drainActiveRunExecutions();
        const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native", nativeIssueId: task.id,
          responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
          contextSnapshot: { source: "native_status_decision", statusDecisionSource: "native_status_decision",
            wakeReason: "issue_status_changed", paperclipWake: { reason: "issue_assigned", issue: { id: task.id } } } });
        expect(originalWakeHash).not.toBeNull();
        expect(originalNativeWakeSource).toBeDefined();
        expect(nativeSha256(runs[0]!.contextSnapshot?.paperclipWake)).toBe(originalWakeHash);
        const finalSourceReceipt = nativeRunInputSourceReceiptSchema.parse(runs[0]!.runnerProfileJson?.nativeInputSourceReceipt);
        expect(finalSourceReceipt.binding).toMatchObject({ companyId, agentId, runId: firstRunId, issueId: task.id });
        expect(finalSourceReceipt.bootstrap.inputs.filter(source => source.kind === "native_task_wake"))
          .toEqual([originalNativeWakeSource]);
        const [admitted] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, runs[0]!.wakeupRequestId!));
        expect(admitted).toMatchObject({ source: "assignment", reason: "issue_assigned", triggerDetail: "system",
          requestedByActorType: "system", requestedByActorId: null, runId: firstRunId });
        const decisions = await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId, companyId),
          eq(statusDecisions.issueId, task.id), eq(statusDecisions.runId, firstRunId)));
        expect(decisions).toContainEqual(expect.objectContaining({ toStatus: "in_progress", reasonCode: "completion_evidence_incomplete" }));
        const requests = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, agentId)));
        const statusWakes = requests.filter(wake => wake.runId === firstRunId && wake.status === "coalesced" && wake.reason === "issue_status_changed");
        expect(statusWakes.length).toBeGreaterThan(0);
        expect(statusWakes.every(wake => wake.source === "automation" && wake.requestedByActorType === "system" &&
          wake.requestedByActorId === "native-status-committer" && decisions.some(decision => decision.id === wake.payload?.nativeDecisionId))).toBe(true);
        const [unfinished] = await db.select({ status: issues.status, completedAt: issues.completedAt })
          .from(issues).where(eq(issues.id, task.id));
        expect(unfinished).toEqual({ status: "in_progress", completedAt: null });
        expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
      },
    });
    completedTests++;
  }, 600_000);


});
