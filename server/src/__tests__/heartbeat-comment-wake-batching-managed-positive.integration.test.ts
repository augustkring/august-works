import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentWakeupRequests, createDb, heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import type { NativeExecutionInput } from "../vendor/paperclip-runner/index.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home = "";
let completedTests = 0;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "heartbeat-comment-managed-positive-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  vi.stubEnv("PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS", "1");
  database = await startEmbeddedPostgresTestDatabase("heartbeat-comment-managed-positive-", { preserveDataOnFailure: () => completedTests !== 3 });
  db = createDb(database.connectionString);
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home && completedTests === 3) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
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

function realTaskCompletion(body: Record<string, unknown>, callIndex: number,
  execution: NativeExecutionInput,
  prefix: string) {
  if (callIndex === 1) return toolUse(body, "write_document", `${prefix}-document`, {
    idempotencyKey: `${prefix}-document`, key: `${prefix}-document`, title: "Managed comment wake result",
    body: "The actual managed run retained its bounded task result.", baseRevisionId: null,
  });
  if (callIndex === 2) {
    const contract = execution.completionContract.contract;
    return toolUse(body, "paperclip_finish", `${prefix}-finish`, { schema: "paperclip.run_result.v1",
      reportedWorkDisposition: "done", summary: "Completed the actual managed comment wake task.",
      completionClaim: { contractRevision: contract.revision, objectiveSatisfied: true,
        criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })),
        remainingWork: [] }, evidence: [], verification: [], attentionRequests: [], artifacts: [] });
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
}

describe("heartbeat comment wake batching", () => {
  it("cancels an empty deferred comment wake instead of promoting deleted input", async () => {
    let providerEntered = false;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    let firstProviderResponse = true;
    let providerRunId = "";
    let taskId = "";
    let firstRunId = "";
    let companyId = "";
    let agentId = "";

    try {
      await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
        providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution, "empty-deferred"),
        beforeProviderResponse: async ({ run }) => {
          if (firstProviderResponse) { firstProviderResponse = false; providerRunId = run.id; providerEntered = true; await providerGate; }
          if (firstRunId && run.id !== firstRunId) throw new Error("empty_deferred_unexpected_second_run");
        },
        driveScheduler: async ({ actor, companyId: fixtureCompanyId, agentId: fixtureAgentId, heartbeat, factsForRun }) => {
          try {
            companyId = fixtureCompanyId; agentId = fixtureAgentId;
          const task = await createAssignedTask({ actor, companyId, agentId, title: "Discard deferred follow-up" });
          taskId = task.id;
          const firstComment = await issueService(db).addComment(task.id, "First comment", { userId: actor.userId! },
            { manualInputActor: actor });
          const [currentTask] = await db.select({ updatedAt: issues.updatedAt }).from(issues).where(eq(issues.id, task.id));
          await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: currentTask!.updatedAt,
            objective: "Finish without a queued follow-up", outputKey: "empty-deferred-document" });
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
          expect(runs).toHaveLength(1);
          expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native",
            invocationSource: "automation", triggerDetail: "system", nativeIssueId: task.id,
            responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
            contextSnapshot: expect.objectContaining({ issueId: task.id, taskId: task.id,
              commentId: firstComment.id, wakeReason: "issue_commented" }) });
          expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
          const cancelled = await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, "cancelled")));
          expect(cancelled).toHaveLength(1);
          expect(cancelled[0]?.id).toBe(deferredWake!.id);
          const [finishedTask] = await db.select({ status: issues.status, completedAt: issues.completedAt })
            .from(issues).where(eq(issues.id, taskId));
          expect(finishedTask).toMatchObject({ status: "done" });
          expect(finishedTask?.completedAt).not.toBeNull();
          } finally { releaseProvider(); }
        },
      });
      completedTests++;
    } finally { releaseProvider?.(); }
  }, 600_000);

  it("cancels a deferred wake containing only a comment authored by the closing run", async () => {
    let providerEntered = false;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    let firstProviderResponse = true;
    let providerRunId = "";
    let firstRunId = "";
    let companyId = "";
    let agentId = "";

    try {
      await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
        providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution, "self-comment"),
        beforeProviderResponse: async ({ run }) => {
          if (firstProviderResponse) { firstProviderResponse = false; providerRunId = run.id; providerEntered = true; await providerGate; }
          if (firstRunId && run.id !== firstRunId) throw new Error("self_comment_unexpected_second_run");
        },
        driveScheduler: async ({ actor, companyId: fixtureCompanyId, agentId: fixtureAgentId, heartbeat, factsForRun }) => {
          try {
            companyId = fixtureCompanyId; agentId = fixtureAgentId;
          const task = await createAssignedTask({ actor, companyId, agentId, title: "Self-comment must not reopen" });
          await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: task.updatedAt,
            objective: "Close the task and ignore the run-authored comment wake", outputKey: "self-comment-document" });
          const firstRun = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
            reason: "issue_assigned", payload: { issueId: task.id },
            contextSnapshot: { issueId: task.id, taskId: task.id, wakeReason: "issue_assigned" },
            requestedByActorType: "system", requestedByActorId: null });
          expect(firstRun).not.toBeNull(); firstRunId = firstRun!.id;
          await waitFor(async () => (await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, firstRunId)).then(rows => rows[0]?.status)) === "running");
          await waitFor(() => providerEntered && Boolean(providerRunId), 120_000);
          expect(providerRunId).toBe(firstRunId);

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
          const [deferredWake] = await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
            eq(agentWakeupRequests.status, "deferred_issue_execution")));
          expect(deferredWake).toMatchObject({ source: "automation", triggerDetail: "system", reason: "issue_execution_deferred",
            requestedByActorType: "user", requestedByActorId: actor.userId,
            payload: { issueId: task.id, commentId: selfComment.id } });
          expect(deferredWake?.payload?._paperclipWakeContext).toMatchObject({ issueId: task.id, taskId: task.id,
            commentId: selfComment.id, wakeCommentId: selfComment.id, wakeReason: "issue_commented" });
          releaseProvider();
          await heartbeat.drainActiveRunExecutions();

          const [finalWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, deferredWake!.id));
          expect(finalWake).toMatchObject({ id: deferredWake!.id, status: "cancelled",
            error: "Deferred wake contained only comments authored by the finishing run", source: "automation",
            reason: "issue_execution_deferred", requestedByActorType: "user", requestedByActorId: actor.userId });
          expect(finalWake?.payload?._paperclipWakeContext).toMatchObject({ wakeReason: "issue_commented" });
          const requests = await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId)));
          expect(requests.filter(request => request.status === "cancelled")).toHaveLength(1);
          const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
          expect(runs).toHaveLength(1);
          expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native",
            invocationSource: "assignment", triggerDetail: "system", nativeIssueId: task.id,
            responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
            contextSnapshot: expect.objectContaining({ issueId: task.id, taskId: task.id, wakeReason: "issue_assigned" }) });
          expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
          const [issueAfterPromotion] = await db.select({ status: issues.status, completedAt: issues.completedAt })
            .from(issues).where(eq(issues.id, task.id));
          expect(issueAfterPromotion).toMatchObject({ status: "done" });
          expect(issueAfterPromotion?.completedAt).not.toBeNull();
          } finally { releaseProvider(); }
        },
      });
      completedTests++;
    } finally { releaseProvider?.(); }
  }, 600_000);

  it("cancels a deferred comment wake when its only queued comment is deleted before promotion", async () => {
    let providerEntered = false;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    let firstProviderResponse = true;
    let providerRunId = "";
    let firstRunId = "";
    let companyId = "";
    let agentId = "";

    try {
      await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
        providerReply: ({ body, callIndex, execution }) => realTaskCompletion(body, callIndex, execution, "deleted-before-promotion"),
        beforeProviderResponse: async ({ run }) => {
          if (firstProviderResponse) { firstProviderResponse = false; providerRunId = run.id; providerEntered = true; await providerGate; }
          if (firstRunId && run.id !== firstRunId) throw new Error("deleted_comment_unexpected_second_run");
        },
        driveScheduler: async ({ actor, companyId: fixtureCompanyId, agentId: fixtureAgentId, heartbeat, factsForRun }) => {
          try {
            companyId = fixtureCompanyId; agentId = fixtureAgentId;
            const task = await createAssignedTask({ actor, companyId, agentId, title: "Deleted follow-up must not reopen" });
            await authorizeTask({ actor, companyId, taskId: task.id, expectedIssueUpdatedAt: task.updatedAt,
              objective: "Complete the assigned task without promoting a deleted comment", outputKey: "deleted-before-promotion-document" });

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
            expect(runs).toHaveLength(1);
            expect(runs[0]).toMatchObject({ id: firstRunId, status: "succeeded", runtimeMode: "native",
              invocationSource: "assignment", triggerDetail: "system", nativeIssueId: task.id,
              responsibleUserId: actor.userId, nativeProcessCleanupPending: false,
              contextSnapshot: expect.objectContaining({ issueId: task.id, taskId: task.id, wakeReason: "issue_assigned" }) });
            expect((await factsForRun(firstRunId)).providerCallCount).toBeGreaterThan(0);
            const cancelled = await db.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
              eq(agentWakeupRequests.status, "cancelled")));
            expect(cancelled).toHaveLength(1);
            expect(cancelled[0]?.id).toBe(deferredWake!.id);
            const [finishedTask] = await db.select({ status: issues.status, completedAt: issues.completedAt })
              .from(issues).where(eq(issues.id, task.id));
            expect(finishedTask).toMatchObject({ status: "done" });
            expect(finishedTask?.completedAt).not.toBeNull();
          } finally { releaseProvider(); }
        },
      });
      completedTests++;
    } finally { releaseProvider?.(); }
  }, 600_000);

});
