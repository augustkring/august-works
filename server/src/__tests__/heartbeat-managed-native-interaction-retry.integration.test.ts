import { and, eq, isNull } from "drizzle-orm";
import { agentExecutionManifests, agentWakeupRequests, orchestrationModelReservations, orchestrationWorkerAttempts, documents, heartbeatRuns, issueDocuments,
  issueThreadInteractions, issueRecoveryActions, issueComments, issues } from "@paperclipai/db";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof import("@paperclipai/db").createDb>;
let root = "";
beforeAll(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  root = await mkdtemp(join(tmpdir(), "managed-native-interaction-retry-"));
  vi.stubEnv("PAPERCLIP_HOME", root);
  database = await startEmbeddedPostgresTestDatabase("managed-native-interaction-retry-");
  const { createDb } = await import("@paperclipai/db");
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (root) await makeFixtureTreeWritable(root).then(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
}, 30_000);

function tool(body: Record<string, unknown>, wanted: string): string {
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  const found = tools.find(value => typeof value.name === "string" && (value.name === wanted ||
    ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${wanted}`)));
  if (typeof found?.name !== "string") throw new Error(`managed_native_interaction_retry_tool_missing_${wanted}`);
  return found.name;
}
function use(body: Record<string, unknown>, name: string, id: string, input: Record<string, unknown>) {
  return { stop_reason: "tool_use" as const, content: [{ type: "tool_use", id, name: tool(body, name), input }] };
}

async function runAcceptedInteractionSetupFailure(transient: boolean) {
  const binary = qualifiedOpenCodeBinary();
  if (!binary) throw new Error("qualified_opencode_binary_unavailable");
  let actualFirstRunId: string | null = null;
  let companyId = "", taskId = "", planId = "", interactionId: string | null = null;
  let planRevision: { documentId: string; revisionId: string; revisionNumber: number } | null = null;
  let continuationBootstrapFailed = false;
  let acceptedContinuationAdmission = false;
  const callsByRun = new Map<string, number>();

  await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: binary, timeoutSec: 300,
    schedulerMode: "serial",
    testBeforeNativeRunnerSpawn: async runId => {
      if (!acceptedContinuationAdmission || runId === actualFirstRunId || continuationBootstrapFailed) return;
      continuationBootstrapFailed = true;
      // Controlled transient setup fault before the real Runner process exists.
      // No Run, interaction, Host receipt, or retry row is fabricated by this seam.
      throw new Error(transient
        ? 'Sandbox provider "managed" is installed via plugin "fixture.managed", but its worker is not running.'
        : 'Sandbox provider "managed" is not installed or its plugin worker is not running.');
    },
    // The fixture calls providerReply before beforeProviderResponse, so a
    // revision read there reaches only the next call. Read the committed plan
    // revision and pending confirmation before each authenticated model request,
    // so call 2 and call 3 see what write_document and request_human_input saved.
    beforeManagedModelRequest: async ({ runId, issueId }) => {
      if (!actualFirstRunId) actualFirstRunId = runId;
      if (runId !== actualFirstRunId || !companyId || !taskId || issueId !== taskId) return;
      const [saved] = await db.select({ documentId: documents.id, revisionId: documents.latestRevisionId,
        revisionNumber: documents.latestRevisionNumber }).from(issueDocuments).innerJoin(documents,
        and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, taskId),
          eq(issueDocuments.key, "plan"))).limit(1);
      if (saved?.revisionId && saved.revisionNumber)
        planRevision = { documentId: saved.documentId, revisionId: saved.revisionId, revisionNumber: saved.revisionNumber };
      const [pending] = await db.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, taskId),
        eq(issueThreadInteractions.sourceRunId, actualFirstRunId), eq(issueThreadInteractions.kind, "request_confirmation"),
        eq(issueThreadInteractions.status, "pending"))).limit(1);
      if (pending) interactionId = pending.id;
    },
    providerReply: ({ body, execution }) => {
      const runId = execution.binding.runId;
      const callIndex = (callsByRun.get(runId) ?? 0) + 1;
      callsByRun.set(runId, callIndex);
      if (!actualFirstRunId) actualFirstRunId = runId;
      if (runId !== actualFirstRunId) throw new Error("unexpected_provider_call_after_transient_setup_failure");
      if (callIndex === 1) return use(body, "write_document", "interaction-retry-plan", {
        idempotencyKey: `interaction-retry:${runId}:plan`, key: "plan", title: "Bounded plan",
        body: "Continue only after the responsible Human accepts this exact plan.", baseRevisionId: null });
      if (callIndex === 2) {
        if (!planRevision) throw new Error("interaction_retry_plan_revision_missing");
        return use(body, "request_human_input", "interaction-retry-confirmation", {
          idempotencyKey: `interaction-retry:${runId}:confirmation`, interactionKind: "confirmation",
          title: "Review the saved plan", prompt: "Accept the saved plan before execution?",
          continuationPolicy: "wake_assignee_on_accept", resolverPolicy: "human_only",
          payload: { version: 1, prompt: "Accept this plan?", target: { type: "issue_document", issueId: taskId,
            documentId: planRevision.documentId, key: "plan", revisionId: planRevision.revisionId,
            revisionNumber: planRevision.revisionNumber } } });
      }
      if (callIndex === 3) {
        if (!interactionId) throw new Error("interaction_retry_confirmation_not_persisted");
        const contract = execution.completionContract.contract;
        return use(body, "paperclip_finish", "interaction-retry-yield", { schema: "paperclip.run_result.v1",
          reportedWorkDisposition: "yielded", summary: "Waiting for the responsible Human to accept the plan.",
          completionClaim: { contractRevision: contract.revision, objectiveSatisfied: false,
            criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "unknown", evidenceRefs: [] })),
            remainingWork: [{ description: "Wait for Human acceptance.", blocksCompletion: true }] }, evidence: [],
          verification: [], attentionRequests: [], artifacts: [], continuation: { kind: "response_wake",
            summary: "Resume after the Human accepts the plan.", idempotencyKey: `interaction-response:${interactionId}` } });
      }
      if (callIndex === 4) return { stop_reason: "end_turn", content: [{ type: "text", text: "I have finished waiting for Human acceptance." }] };
      throw new Error(`unexpected_interaction_retry_native_turn_${callIndex}`);
    },
    driveScheduler: async ({ actor, companyId: currentCompany, agentId, heartbeat, humanApi, facts, factsForRun }) => {
      if (!actor.userId) throw new Error("interaction_retry_current_human_missing");
      companyId = currentCompany;
      const task = await issueService(db).create(companyId, { title: "Accepted interaction retry",
        description: "Exercise an actual managed Native plan confirmation and its infrastructure retry.", status: "todo",
        responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId }, db, undefined,
        { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      taskId = task.id;
      const plans = orchestrationService(db);
      const plan = await plans.create(actor, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Save and obtain acceptance for one bounded plan",
          requiredOutputs: [{ kind: "task_document", key: "plan" }],
          businessInvariants: ["No continuation before Human acceptance"] },
        budgets: { maxModelCostMinor: 20, maxToolActions: 8, maxRetries: 2 }, workers: [{ key: "writer", issueId: task.id }] });
      planId = plan.id;
      await plans.decide(actor, companyId, plan.id, { expectedVersion: plan.version, action: "start",
        rationale: "Current Human authorizes the bounded plan and its persisted confirmation." });
      const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: actor.userId, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id } });
      expect(wake).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      const [predecessor] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake!.id));
      expect(predecessor).toMatchObject({ runtimeMode: "native", status: "succeeded", nativeIssueId: task.id });
      expect(predecessor?.resultJson).toMatchObject({ nativeResult: { schema: "paperclip.run_result.v1",
        reportedWorkDisposition: "yielded" } });
      expect(planRevision).not.toBeNull();
      const [pending] = await db.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.issueId, task.id), eq(issueThreadInteractions.sourceRunId, predecessor!.id),
        eq(issueThreadInteractions.kind, "request_confirmation"), eq(issueThreadInteractions.status, "pending"))).limit(1);
      expect(pending).toBeDefined();
      interactionId = pending!.id;
      acceptedContinuationAdmission = true;
      const accepted = await request(humanApi.app).post(`/api/issues/${task.id}/interactions/${pending!.id}/accept`)
        .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost").send({});
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ id: pending!.id, status: "accepted" });
      const failedRun = await vi.waitFor(async () => {
        const rows = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.nativeIssueId, task.id), isNull(heartbeatRuns.retryOfRunId)));
        const row = rows.find(candidate => candidate.id !== predecessor!.id);
        expect(row?.status).toBe("failed");
        return row!;
      }, { timeout: 90_000, interval: 100 });
      expect(continuationBootstrapFailed).toBe(true);
      expect(failedRun).toMatchObject({ runtimeMode: "native", nativeIssueId: task.id, errorCode: "setup_failed" });
      expect(failedRun.error).toContain(transient ? "is installed via plugin" : "is not installed or its plugin worker is not running");
      expect(factsForRun(failedRun.id).providerCallCount).toBe(0);
      expect(failedRun.contextSnapshot).toMatchObject({ issueId: task.id, taskId: task.id,
        interactionId: pending!.id, interactionStatus: "accepted" });
      // Runtime Fabric admits the real plan attempt while preparing its signed manifest;
      // that occurs before native-session-executor reaches the pre-spawn fault seam.
      const [failedManifest] = await db.select().from(agentExecutionManifests).where(and(
        eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, failedRun.id),
        eq(agentExecutionManifests.agentId, agentId)));
      expect(failedManifest).toBeDefined();
      const [failedAttempt] = await db.select().from(orchestrationWorkerAttempts).where(and(
        eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, planId),
        eq(orchestrationWorkerAttempts.runId, failedRun.id)));
      expect(failedAttempt).toMatchObject({ companyId, planId, runId: failedRun.id });
      if (transient) {
        const retry = await vi.waitFor(async () => {
          const rows = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.retryOfRunId, failedRun.id)));
          const row = rows[0];
          expect(row?.status).toBe("scheduled_retry");
          return row!;
        }, { timeout: 30_000, interval: 100 });
        expect(retry).toMatchObject({ status: "scheduled_retry", retryOfRunId: failedRun.id,
          scheduledRetryAttempt: 1, scheduledRetryReason: "interaction_continuation_infra_retry" });
        expect(retry.contextSnapshot).toMatchObject({ issueId: task.id, interactionId: pending!.id,
          interactionStatus: "accepted", scheduledRetryAttempt: 1 });
        const [retryWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, retry.wakeupRequestId!));
        expect(retryWake).toMatchObject({ reason: "interaction_continuation_infra_retry", payload: { issueId: task.id,
          interactionId: pending!.id, retryOfRunId: failedRun.id, scheduledRetryAttempt: 1 } });
        expect(facts().providerCallCount).toBeGreaterThanOrEqual(3);
        const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, planId));
        expect(attempts.map(row => row.runId)).toEqual(expect.arrayContaining([predecessor!.id, failedRun.id]));
        expect(attempts.some(row => row.runId === retry.id)).toBe(false);
        const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, planId));
        expect(reservations.some(row => row.workerAttemptId && attempts.some(attempt => attempt.id === row.workerAttemptId))).toBe(true);
        const [issue] = await db.select().from(issues).where(eq(issues.id, task.id));
        expect(issue?.executionRunId).toBe(retry.id);
      } else {
        const interaction = await vi.waitFor(async () => {
          const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, pending!.id));
          expect(row?.result).toMatchObject({ version: 1, outcome: "accepted", resumeFailure: {
            status: "needs_attention", errorCode: "setup_failed", runId: failedRun.id } });
          return row!;
        }, { timeout: 30_000, interval: 100 });
        expect(interaction.status).toBe("accepted");
        const retryRowsAfterEscalation = await db.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.retryOfRunId, failedRun.id)));
        expect(retryRowsAfterEscalation).toEqual([]);
        const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
        expect(runs.some(row => row.retryOfRunId === failedRun.id)).toBe(false);
        expect(runs.some(row => row.status === "scheduled_retry" &&
          row.scheduledRetryReason === "interaction_continuation_infra_retry")).toBe(false);
        const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, task.id));
        expect(issue?.status).toBe("blocked");
        const [recovery] = await db.select({ status: issueRecoveryActions.status, sourceIssueId: issueRecoveryActions.sourceIssueId })
          .from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, task.id));
        expect(recovery).toMatchObject({ status: "active", sourceIssueId: task.id });
        const comments = await db.select().from(issueComments).where(and(eq(issueComments.companyId, companyId),
          eq(issueComments.issueId, task.id)));
        const failureComments = comments.filter(comment => comment.authorType === "system" &&
          comment.body.includes("Agent failed to resume after approval: `setup_failed` — needs attention"));
        expect(failureComments).toHaveLength(1);
      }
      const [acceptedInteraction] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, pending!.id));
      expect(acceptedInteraction).toMatchObject({ status: "accepted", sourceRunId: predecessor!.id,
        resolvedByUserId: actor.userId });
    },
  });
}

it("schedules a bounded retry for an accepted interaction after a genuine managed Native predecessor", async () => {
  await runAcceptedInteractionSetupFailure(true);
}, 300_000);

it("escalates a permanent accepted-interaction setup failure without retrying the Native run", async () => {
  await runAcceptedInteractionSetupFailure(false);
}, 300_000);
