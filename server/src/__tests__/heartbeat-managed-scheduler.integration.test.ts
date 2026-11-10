import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, agents, heartbeatRuns, orchestrationModelReservations, orchestrationWorkerAttempts,
  issueDocuments, documents, documentRevisions, environmentLeases } from "@paperclipai/db";
import { verifyNativeCleanupRuntimeState } from "../services/execution-sandbox/run-lease-cleanup.js";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { projectManagedNativeCompletionDiagnostic } from "./helpers/managed-native-completion-diagnostic.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "heartbeat-managed-scheduler-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("heartbeat-managed-scheduler-");
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
}, 30000);

it("dispatches an ordinary scheduler-created capped Worker through current Sandbox admission and model reservation", async () => {
  const terminalDeadlineAt = Date.now() + 600_000;
  // Serial fixture transport authenticates each incoming model channel; the production scheduler still creates one ordinary Worker Run.
  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial",
    providerReply: ({ body, callIndex, execution }) => {
      const tools = body.tools as Array<{ name: string }>;
      const tool = (name: string) => {
        const found = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${name}`));
        if (!found) throw new Error(`scheduler_fixture_tool_missing_${name}`);
        return found.name;
      };
      if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "scheduler-write",
        name: tool("write_document"), input: { idempotencyKey: "scheduler-real-draft-output", key: "result",
          title: "Scheduler result", body: "A real scheduler-owned bounded result for Human review.", baseRevisionId: null } }] };
      if (callIndex === 2) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "scheduler-finish",
        name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
          summary: "Retained the scheduler's bounded result.", completionClaim: {
            contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true,
            criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
              status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
          evidence: [], verification: [], attentionRequests: [], artifacts: [] } }] };
      return { stop_reason: "end_turn", content: [{ type: "text", text: "The bounded result is ready for review." }] };
    },
    beforeProviderResponse: async ({ reservation, run, manifest, request, sourceReceipt }) => {
      expect(reservation).toMatchObject({ status: "dispatched", purpose: "worker_model" });
      expect(reservation.maximumMinor).toBeGreaterThan(0);
      expect(reservation.workerAttemptId).toBeTruthy();
      expect(reservation.providerWireReceipt).toMatchObject({ bodySha256: request.wireBodySha256 });
      expect(manifest.runId).toBe(run.id);
      expect(sourceReceipt).toBeTruthy();
    },
    driveScheduler: async ({ actor, companyId, agentId, gateway, heartbeat, facts, factsForRun }) => {
      const human = actor; // Reuse the factory's current session; a new passkey would revoke it.
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
      const task = await issueService(db).create(companyId, { title: "Ordinary scheduler bounded draft",
        description: "Retain one result document for Human review; make no external changes.",
        status: "todo", responsibleUserId: human.userId!, createdByUserId: human.userId!, assigneeAgentId: agentId },
        db, undefined, { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
      const plan = await orchestrationService(db).create(human, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Retain one bounded scheduler result for review",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review required"] },
        budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId: task.id }] });
      // The ordinary Worker entry cannot broaden first-party draft authority.
      await expect(gateway.qualifyDraft(db, { companyId, agentId,
        responsibleUserId: human.userId! })).rejects.toThrow("installed worker model transport");
      await expect(gateway.qualifyManagedWorker(db, { companyId, agentId,
        responsibleUserId: "missing-current-human" })).rejects.toThrow();
      await expect(gateway.qualifyManagedWorker(db, { companyId, agentId,
        responsibleUserId: human.userId! })).resolves.toMatchObject({
          providerKind: "opencode", maximumEnvelopeBytes: expect.any(Number),
        });
      const [originalAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (!originalAgent) throw new Error("scheduler_fixture_agent_missing");
      for (const drift of [{ model: "anthropic/unselected-model" }, { provider: "codex" }]) {
        await db.update(agents).set({ adapterConfig: { ...originalAgent.adapterConfig, ...drift } })
          .where(eq(agents.id, agentId));
        await expect(gateway.qualifyManagedWorker(db, { companyId, agentId,
          responsibleUserId: human.userId! })).rejects.toThrow();
      }
      await db.update(agents).set({ adapterConfig: originalAgent.adapterConfig }).where(eq(agents.id, agentId));
      expect(facts().providerCallCount).toBe(0);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id))).toEqual([]);
      await orchestrationService(db).decide(human, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Run the actual supported, capped Native scheduler route" });
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toEqual([]);
      const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: human.userId!, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id } });
      expect(wake).not.toBeNull();
      // A drain clears delayed session-resume timers; observe this Run's terminal state first.
      const remainingTerminalMs = terminalDeadlineAt - Date.now();
      if (remainingTerminalMs <= 0) throw new Error("scheduler_fixture_terminal_deadline_exhausted");
      await expect.poll(async () => {
        const [current] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, wake!.id)));
        return current ? ["succeeded", "failed", "cancelled", "interrupted", "timed_out"].includes(current.status) : false;
      }, { timeout: remainingTerminalMs }).toBe(true);
      await heartbeat.drainActiveRunExecutions();
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake!.id));
      expect(run, JSON.stringify({ code: run?.errorCode, error: run?.error })).toMatchObject({ status: "succeeded",
        runtimeMode: "native", nativeIssueId: task.id, responsibleUserId: human.userId });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, wake!.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ planId: plan.id, agentId, attempt: 1 });
      expect(attempts[0]!.executionManifestId).toBeTruthy();
      const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservations.length).toBeGreaterThanOrEqual(2);
      expect(reservations.every(row => row.purpose === "worker_model" && row.status === "completed" && row.workerAttemptId === attempts[0]!.id)).toBe(true);
      const outputs = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
        and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(outputs).toHaveLength(1);
      expect(outputs[0]?.body).toContain("real scheduler-owned bounded result");
      expect(run!.nativeProcessCleanupPending).toBe(false);
      const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, wake!.id)));
      expect(leases).toHaveLength(1);
      expect(leases[0]).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
      expect(leases[0]!.releasedAt).toBeInstanceOf(Date);
      const cleanup = await verifyNativeCleanupRuntimeState(db, { companyId, runId: wake!.id, leaseId: leases[0]!.id },
        leases[0]!.metadata?.remoteExecutionTermination);
      expect(cleanup).toMatchObject({ runId: wake!.id, leaseId: leases[0]!.id, state: "stopped" });
      const observed = facts();
      const runtime = factsForRun(wake!.id).sandboxRuntimeFacts;
      expect(observed.providerCallCount).toBe(reservations.length);
      expect(observed.issuerFacts).toEqual([{ scope: "worker_model", runId: wake!.id,
        manifestId: attempts[0]!.executionManifestId }]);
      expect(runtime?.relayAuthenticated).toBe(true);
      // These are observations of the actual authenticated ingress and its signed session, not the nonserial fixture transport.
      expect(observed.sandboxRuntimeFacts?.authenticatedModelTunnels).toBeGreaterThan(0);
      const injections = runtime?.appliedModelProfileInjections as Array<{ runId: string; leaseId: string; sessionKey: string }>;
      const sessionReceipts = runtime?.modelBrokerSessionReceipts as Array<{ phase: string; sessionKey: string }>;
      const starts = sessionReceipts.filter(row => row.phase === "start");
      expect(starts).toHaveLength(1);
      expect(typeof starts[0]?.sessionKey).toBe("string");
      expect(starts[0]?.sessionKey.length).toBeGreaterThan(0);
      expect(injections.length).toBeGreaterThan(0);
      expect(injections.every(row => row.runId === wake!.id && row.leaseId === leases[0]!.id && row.sessionKey === starts[0]?.sessionKey)).toBe(true);
      expect(sessionReceipts.at(-1)).toMatchObject({ phase: "stop", sessionKey: starts[0]?.sessionKey });
      expect(runtime?.attachedModelBrokerProviderCount).toBe(0);
      expect((runtime?.modelBrokerSessionReceipts as Array<{ phase: string }>).at(-1)?.phase).toBe("stop");
    },
  });
}, 600000);


import { agentExecutionManifests, agentWakeupRequests, issueRelations, issues,
  nativeRunFinalizations, nativeRunResults, statusDecisions, statusDecisionEffects, workAssessments } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { captureNativeBlockedHumanInteraction, assertNativeBlockedInteractionResult, assertNativePayloadSourceSetCurrent } from "../services/native-direct-input.js";
import { assertV7Authorization } from "../services/v7-authorization.js";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { CAPABILITY_SEMANTIC_TOOL_CATALOG } from "../vendor/paperclip-runner/index.js";
type ManagedSchedulerContext = Parameters<Parameters<typeof withManagedNativeHeartbeatFixture>[0]["driveScheduler"]>[0];
type ManagedReplyInput = Parameters<Parameters<typeof withManagedNativeHeartbeatFixture>[0]["providerReply"]>[0];

function domainSdkReply({ body, execution, runId }: ManagedReplyInput) {
  const name = "paperclip_block";
  const tools = body.tools as Array<{ name: string }>;
  const tool = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."]
    .some(prefix => value.name === `${prefix}${name}`));
  if (!tool) throw new Error(`dependency_sdk_tool_missing_${name}`);
  const contract = execution.completionContract.contract;
  return { stop_reason: "tool_use" as const, content: [{ type: "tool_use", id: `domain-result-${runId}`,
    name: tool.name, input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "blocked",
      summary: "The Human prerequisite is unresolved; no blocked work was performed.",
      completionClaim: { contractRevision: contract.revision, objectiveSatisfied: false,
        criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id,
          status: "not_satisfied", evidenceRefs: [] })),
        remainingWork: [{ description: "Wait for the Human prerequisite to complete.", blocksCompletion: true }] },
      evidence: [], verification: [], attentionRequests: [], artifacts: [],
      ...({ blocker: { reasonCode: "dependency_unresolved", owner: { kind: "user", name: "Responsible Human" },
        unblockAction: "Complete the existing prerequisite Task.", scope: "task_wide" } }) } }] };
}

async function createDomainSdkTask(context: ManagedSchedulerContext, title: string, status: "todo" | "blocked" = "todo") {
  return issueService(db).create(context.companyId, { title, description: "A bounded dependency scheduler task; honor current blockers.",
    status, responsibleUserId: context.actor.userId!, createdByUserId: context.actor.userId!, assigneeAgentId: context.agentId },
    db, undefined, { manualInputActor: context.actor, privacyActor: context.actor, sourceAccessActor: context.actor });
}

async function assertDomainSdkResult(context: ManagedSchedulerContext, runId: string, issueId: string,
  disposition: "blocked", deadlineAt: number) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("dependency_sdk_terminal_deadline_exhausted");
  await expect.poll(async () => {
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, context.companyId), eq(heartbeatRuns.id, runId)));
    return run && ["succeeded", "failed", "cancelled", "timed_out", "interrupted"].includes(run.status);
  }, { timeout: remaining }).toBe(true);
  await context.heartbeat.drainActiveRunExecutions();
  const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
  if (run?.nativePhase !== "committed") {
    const [finalization] = await db.select({ phase: nativeRunFinalizations.phase,
      failureCode: nativeRunFinalizations.failureCode, failureDetail: nativeRunFinalizations.failureDetail })
      .from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, context.companyId),
        eq(nativeRunFinalizations.runId, runId)));
    // The finalizer owns this closed projection; omit its raw message/next action.
    console.info("dependency_sdk_finalization_failure", JSON.stringify(projectManagedNativeCompletionDiagnostic({
      finalization, assessment: null, decision: null,
    }).finalization));
  }
  expect(run).toMatchObject({ companyId: context.companyId, agentId: context.agentId, nativeIssueId: issueId,
    responsibleUserId: context.actor.userId, status: "succeeded", runtimeMode: "native", nativePhase: "committed", nativeProcessCleanupPending: false });
  const results = await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId));
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ companyId: context.companyId, issueId, schemaStatus: "accepted",
    resultJson: { result: { reportedWorkDisposition: disposition } } });
  const assessments = await db.select().from(workAssessments).where(eq(workAssessments.runId, runId));
  expect(assessments).toHaveLength(1);
  expect(assessments[0]).toMatchObject({ issueId, resultId: results[0]!.id,
    assessmentJson: { reportedDisposition: disposition } });
  const decisions = await db.select().from(statusDecisions).where(eq(statusDecisions.runId, runId));
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({ issueId, assessmentId: assessments[0]!.id,
    toStatus: "blocked", applicationState: "applied" });
  expect(decisions[0]).toMatchObject({ reasonCode: "durable_dependency_blocker_bound", decisionJson: { effects: [] } });
  expect(await db.select().from(statusDecisionEffects).where(eq(statusDecisionEffects.decisionId, decisions[0]!.id)))
    .toEqual([]);
  const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, runId));
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ agentId: context.agentId, runId, executionManifestId: expect.any(String) });
  const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId));
  expect(manifests).toEqual([expect.objectContaining({ id: attempts[0]!.executionManifestId, runId })]);
  const reservations = await db.select().from(orchestrationModelReservations)
    .where(eq(orchestrationModelReservations.workerAttemptId, attempts[0]!.id));
  expect(reservations).toHaveLength(1);
  expect(reservations[0]).toMatchObject({ purpose: "worker_model", status: "completed" });
  const receipt = nativeRunInputSourceReceiptSchema.parse(run!.runnerProfileJson?.nativeInputSourceReceipt);
  expect(receipt.binding).toMatchObject({ companyId: context.companyId, issueId, agentId: context.agentId, runId });
  expect(context.factsForRun(runId).providerCallCount).toBe(1);
  expect(context.factsForRun(runId).issuerFacts).toEqual([{ scope: "worker_model", runId, manifestId: manifests[0]!.id }]);
  const leases = await db.select().from(environmentLeases).where(eq(environmentLeases.heartbeatRunId, runId));
  expect(leases).toHaveLength(1);
  expect(leases[0]).toMatchObject({ status: "expired", cleanupStatus: "success", leasePolicy: "ephemeral" });
  expect(await verifyNativeCleanupRuntimeState(db, { companyId: context.companyId, runId, leaseId: leases[0]!.id },
    leases[0]!.metadata?.remoteExecutionTermination)).toMatchObject({ runId, leaseId: leases[0]!.id, state: "stopped" });
  return run!;
}


it("answers a current Human dependency comment through capped read-only SDK admission without doing blocked work", async () => {
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  const deadlineAt = Date.now() + 600_000;
  let blockedId = "";
  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial", providerReply: input => {
      expect(input.issueId).toBe(blockedId);
      expect(input.callIndex).toBe(1);
      const names = (input.body.tools as Array<{ name: string }>).map(tool => ["paperclip_finish", "paperclip_block"].includes(tool.name) ? tool.name : tool.name.replace(/^(paperclip__|paperclip_|paperclip\.)/, ""));
      expect(names).toContain("paperclip_block");
      for (const write of ["write_document", "create_task", "create_project", "call_api", "self_remember"])
        expect(names).not.toContain(write);
      return domainSdkReply(input);
    }, beforeProviderResponse: async ({ reservation, run, manifest, request, sourceReceipt }) => {
      expect(reservation).toMatchObject({ status: "dispatched", purpose: "worker_model" });
      expect(reservation.maximumMinor).toBeGreaterThan(0);
      expect(reservation.providerWireReceipt).toMatchObject({ bodySha256: request.wireBodySha256 });
      expect(manifest.runId).toBe(run.id); expect(sourceReceipt).toBeTruthy();
    }, driveScheduler: async context => {
      const { actor, companyId, agentId, heartbeat } = context;
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (!agent) throw new Error("blocked_sdk_agent_missing");
      const runtime = agent.runtimeConfig as Record<string, unknown>;
      const priorHeartbeat = runtime.heartbeat as Record<string, unknown> | undefined;
      await db.update(agents).set({ runtimeConfig: { ...runtime, timeoutSec: 300,
        heartbeat: { ...priorHeartbeat, wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
      const task = await createDomainSdkTask(context, "Explain the actual unresolved prerequisite without doing work");
      blockedId = task.id;
      const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Explain the current blocker without performing the blocked work",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["No blocked work or external changes"] },
        budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "explain", issueId: task.id }] });
      await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Approve bounded capped work before any blocker exists" });
      const blocker = await issueService(db).create(companyId, { title: "Current unresolved Human prerequisite", status: "todo",
        responsibleUserId: actor.userId!, createdByUserId: actor.userId! }, db, undefined,
        { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      await issueService(db).update(task.id, { status: "blocked", blockedByIssueIds: [blocker.id],
        actorUserId: actor.userId!, privacyActor: actor });
      const [blockedBeforeResponse] = await db.select().from(issues).where(eq(issues.id, task.id));
      expect(blockedBeforeResponse?.payloadSourceSnapshot).toBeTruthy();
      expect(await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: actor.userId!, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id } })).toBeNull();
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toEqual([]);
      expect(context.facts().providerCallCount).toBe(0);
      const comment = await issueService(db).addComment(task.id, "Explain the current dependency without starting blocked work.",
        { userId: actor.userId! }, { manualInputActor: actor });
      const response = await heartbeat.wakeup(agentId, { source: "automation", triggerDetail: "system", reason: "issue_commented",
        requestedByActorType: "user", requestedByActorId: actor.userId!, payload: { issueId: task.id, commentId: comment.id },
        contextSnapshot: { issueId: task.id, commentId: comment.id, wakeCommentId: comment.id, wakeReason: "issue_commented" } });
      expect(response).not.toBeNull();
      const run = await assertDomainSdkResult(context, response!.id, task.id, "blocked", deadlineAt);
      expect(run.contextSnapshot).toMatchObject({ dependencyBlockedInteraction: true, unresolvedBlockerIssueIds: [blocker.id] });
      const [blockedAfterResponse] = await db.select().from(issues).where(eq(issues.id, task.id));
      expect(blockedAfterResponse).toMatchObject({ status: "blocked", unblockDescriptor: blockedBeforeResponse!.unblockDescriptor,
        statusVersion: blockedBeforeResponse!.statusVersion, lastStatusDecisionId: blockedBeforeResponse!.lastStatusDecisionId,
        payloadSourceSnapshot: blockedBeforeResponse!.payloadSourceSnapshot });
      expect((await db.select().from(issues).where(eq(issues.id, blocker.id)))[0]).toMatchObject({ status: "todo" });
      expect(await db.select().from(issueRelations).where(and(eq(issueRelations.issueId, blocker.id), eq(issueRelations.relatedIssueId, task.id))))
        .toEqual([expect.objectContaining({ type: "blocks" })]);
      const retainedDocuments = await db.select({ link: issueDocuments, revision: documentRevisions })
        .from(issueDocuments).innerJoin(documents, eq(documents.id, issueDocuments.documentId))
        .innerJoin(documentRevisions, eq(documentRevisions.id, documents.latestRevisionId))
        .where(eq(issueDocuments.issueId, task.id));
      // The server retains its own continuation record; no work document was
      // created through the read-only model catalog.
      expect(retainedDocuments).toHaveLength(1);
      expect(retainedDocuments[0]).toMatchObject({ link: { key: "continuation-summary" },
        revision: { createdByRunId: run.id, createdByAgentId: agentId } });
      // Current Human history reads use the original API owners. Retained
      // producer proof must remain readable after the actual Run terminates.
      await assertV7Authorization(db, actor, companyId, "issue:read", { type: "issue", companyId, issueId: task.id });
      await assertAnalyticalContextPayloadAccess(db, companyId, actor, { issueId: task.id });
      const receipt = nativeRunInputSourceReceiptSchema.parse(run.runnerProfileJson?.nativeInputSourceReceipt);
      const modelDispatches = receipt.dispatches.flatMap(entry => entry.inputs)
        .filter(source => source.kind === "worker_model_dispatch");
      expect(modelDispatches).toHaveLength(1);
      const dispatch = modelDispatches[0]!;
      const intents = run.runnerProfileJson?.nativeAwModelWireIntents as Array<Record<string, unknown>>;
      const matchingIntents = intents.filter(intent => intent.reservationId === dispatch.reservationId);
      expect(matchingIntents).toHaveLength(1);
      expect(matchingIntents[0]!.responseContentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(matchingIntents[0]!.responseContentHash).not.toBe(dispatch.responseHash);
      const [settled] = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.id, dispatch.reservationId));
      expect(settled).toMatchObject({ purpose: "worker_model", status: "completed",
        inputHash: dispatch.requestHash, providerResponseHash: dispatch.responseHash,
        providerWireReceipt: { callId: dispatch.callId, bodySha256: dispatch.wireBodyHash } });
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId: task.id, runId: run.id,
        actor, ...receipt.bootstrap })).resolves.toBeUndefined();
      const comments = await issueService(db).listComments(task.id);
      expect(comments).toContainEqual(expect.objectContaining({ createdByRunId: response!.id,
        body: expect.stringContaining("The Human prerequisite is unresolved") }));
      const [accepted] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, run.id));
      const originalResult = (accepted!.resultJson as { result: Record<string, unknown> }).result;
      const invalidDone = { ...originalResult, reportedWorkDisposition: "done" };
      // A real Human resolves the prerequisite; no rows are cleared and no new
      // model work is dispatched. Removing mutable context flags cannot upgrade
      // the original typed catalog/actual dispatch into an ordinary worker.
      await issueService(db).update(blocker.id, { status: "done", actorUserId: actor.userId!, privacyActor: actor });
      await issueService(db).update(task.id, { status: "todo", actorUserId: actor.userId!, privacyActor: actor });
      const originalContext = run.contextSnapshot as Record<string, unknown>;
      const { dependencyBlockedInteraction: _blocked, ...withoutBlockedContext } = originalContext;
      const { dependencyBlockedInteraction: _wakeBlocked, ...wakeContext } = withoutBlockedContext.paperclipWake as Record<string, unknown>;
      await db.update(heartbeatRuns).set({ contextSnapshot: { ...withoutBlockedContext, paperclipWake: wakeContext } }).where(eq(heartbeatRuns.id, run.id));
      const binding = { companyId, issueId: task.id, runId: run.id, agentId };
      await expect(captureNativeBlockedHumanInteraction(db, binding)).rejects.toThrow();
      await expect(assertNativeBlockedInteractionResult(db, binding, invalidDone)).rejects.toThrow();
      const originalProfile = run.runnerProfileJson as Record<string, unknown>;
      const { nativeOpenCodeSourceAuthority: _catalog, ...withoutCatalog } = originalProfile;
      await db.update(heartbeatRuns).set({ runnerProfileJson: withoutCatalog }).where(eq(heartbeatRuns.id, run.id));
      await expect(assertNativeBlockedInteractionResult(db, binding, invalidDone)).rejects.toThrow("catalog");
      const catalog = originalProfile.nativeOpenCodeSourceAuthority as Record<string, unknown>;
      const write = CAPABILITY_SEMANTIC_TOOL_CATALOG.find(tool => tool.operationId === "write_document")!;
      const schemas = [...catalog.toolSchemas as Record<string, unknown>[],
        { name: write.operationId, description: write.description, inputSchema: write.inputSchema }];
      await db.update(heartbeatRuns).set({ runnerProfileJson: { ...originalProfile,
        nativeOpenCodeSourceAuthority: { ...catalog, toolSchemas: schemas, toolSchemasHash: nativeSha256(schemas) } } })
        .where(eq(heartbeatRuns.id, run.id));
      await expect(assertNativeBlockedInteractionResult(db, binding, invalidDone)).rejects.toThrow("catalog");
      await db.update(heartbeatRuns).set({ runnerProfileJson: originalProfile }).where(eq(heartbeatRuns.id, run.id));
      // The immediately postterminal historical read above is required. A
      // later Human body change remains subject to its original source hash;
      // restoring a catalog never rebinds the earlier capture to new text.
      const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
      expect(runs.map(value => value.id)).toEqual([response!.id]);
      expect(context.facts().providerCallCount).toBe(1);
      const wakes = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId));
      expect(wakes.filter(wake => wake.runId === response!.id)).toEqual([expect.objectContaining({
        requestedByActorType: "user", requestedByActorId: actor.userId!, reason: "issue_commented" })]);
    } });
}, 600000);
