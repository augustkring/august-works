import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentExecutionManifests,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  agentWakeupRequests,
  agents,
  billingAccountCompanies,
  billingAccounts,
  companies,
  companySecrets,
  companySecretVersions,
  completionContracts,
  contextManifests,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueExecutionDecisions,
  issues,
  nativeRunResults,
  orchestrationModelReservations,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimePolicySnapshots,
  runtimeSandboxBindings,
  runtimeVersionCatalog,
  statusDecisionEffects,
  statusDecisions,
  toolInvocations,
  workAssessments,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";

// MS1f decisions 4 and 6. The execution-policy stage Reviewer of a planned Task
// is a kind of the reviewer lane. Real rows for the stage wake chain (intent,
// effect, applied stage-pending decision, executor Run, delivered wake), the
// plan, its Worker and source attempt, the Task's execution state, the
// reservations and the tool-charge trigger. Replaced, as in the MS1h4 and
// MS1h12 tests: V7 authorization, run policy/write gates, authored procedures,
// the provider/connection/profile/quote owners of qualifyWorkerTransport, the
// committed source witness (its source checks mirror the completion witness),
// and the stage-comment decision (the comment route's own parser and policy
// projection, tested in native-stage-comment-api.test.ts).
const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  provider: null as Record<string, unknown> | null,
  selection: null as Record<string, unknown> | null,
  quoteMinor: 1,
  witness: null as Record<string, unknown> | null,
  stageCommentDecision: (async () => false) as (input: { companyId: string; issueId: string; runId: string; agentId: string;
    arguments: unknown }) => Promise<boolean>,
}));
vi.mock("../v7-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("../v7-authorization.js")>(),
  assertV7Authorization: async () => undefined,
}));
vi.mock("../../agent-run-cancellation.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../agent-run-cancellation.js")>(),
  assertAgentRunPolicyAllowed: async () => undefined,
  assertAgentRunWriteAllowed: async () => undefined,
}));
vi.mock("../agents/authoring-procedures.js", async importOriginal => ({
  ...await importOriginal<typeof import("../agents/authoring-procedures.js")>(),
  assertAuthoredProceduresCurrent: async () => null,
}));
vi.mock("./native-review-participant.js", async importOriginal => ({
  ...await importOriginal<typeof import("./native-review-participant.js")>(),
  captureNativeStageReviewSourceWitness: async (_db: unknown, input: { assignment: { sourceRun: { id: string };
    sourceDecision: { id: string } } }) => state.witness && ({ ...state.witness, sourceRunId: input.assignment.sourceRun.id,
    decisionId: input.assignment.sourceDecision.id }),
}));
vi.mock("../native-stage-comment-api.js", async importOriginal => ({
  ...await importOriginal<typeof import("../native-stage-comment-api.js")>(),
  nativeStageCommentApiDecisionCurrent: (_db: unknown, input: Parameters<typeof state.stageCommentDecision>[0]) =>
    state.stageCommentDecision(input),
}));
vi.mock("../agent-provider-bindings.js", async importOriginal => {
  const original = await importOriginal<typeof import("../agent-provider-bindings.js")>();
  return { ...original, agentProviderBindingService: (db: never) => ({ ...original.agentProviderBindingService(db),
    assertRuntime: async () => state.provider }) };
});
vi.mock("../ai-connections.js", async importOriginal => {
  const original = await importOriginal<typeof import("../ai-connections.js")>();
  return { ...original, aiConnectionService: (db: never) => ({ ...original.aiConnectionService(db),
    select: async () => state.selection }) };
});
vi.mock("../orchestration/worker-model-profiles.js", async importOriginal => ({
  ...await importOriginal<typeof import("../orchestration/worker-model-profiles.js")>(),
  selectWorkerModelProfile: () => state.profile,
}));
vi.mock("../orchestration/model-reservations.js", async importOriginal => ({
  ...await importOriginal<typeof import("../orchestration/model-reservations.js")>(),
  quoteModelReservation: () => ({ maximumMinor: state.quoteMinor }),
}));

import { currentNativeReviewerRun, getNativeExecutionStageReviewAssignment, nativeReviewerLaneRecorded,
  nativeReviewerLaneRun, readNativeStageReviewContext } from "./native-review-participant.js";
import { nativeManagedModelIssuer, nativeModelSessionOwnerLane, nativeReviewerModelCredentialExact } from "../runtime/control.js";
import { createRuntimeToolsToken } from "../../runtime-tools-token.js";
import { withOrchestrationNativeTool } from "../orchestration/native-tool-boundary.js";
import { admitOrchestrationHeartbeat } from "../orchestration/orchestration-admission.js";
import { registerNativeDraftGateway } from "../orchestration/native-draft-runtime.js";
import { workerModelGateway } from "../orchestration/worker-model-gateway.js";
import { nativeStageReviewerOutcome } from "./native-run-finalizer.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "./canonical.js";
import { captureNativeStageContinuationOwner, nativeStageDeliveredReasonMatches, nativeStageIntentBoundToDeliveredRun,
  nativeStageReviewerRunCapturable, nativeStageReviewerRunUnselected } from "../native-stage-wake-source.js";
import { policyFixture } from "../../__tests__/helpers/sandbox-fixture.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

describeDb("execution-policy stage Reviewer lane under a plan (MS1f decision 4)", () => {
  let db!: Db;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("native-stage-reviewer-lane-");
    db = createDb(temporary.connectionString);
    process.env.PAPERCLIP_AGENT_JWT_SECRET = `ms1f-${randomUUID()}`;
    // The flags aw_v7_orchestration_tool_charge and the V7 gates require.
    await instanceSettingsService(db as never).getExperimental();
    await db.execute(sql`update instance_settings set experimental = coalesce(experimental, '{}'::jsonb) ||
      '{"orchestration_v7":true,"readiness_engine_v7":true,"enableWorkflowsV1":true,"enableFoundationV1":true,"enableContextEngineV1":true,"agent_runtime_fabric_v5":true,"agent_identities_v5":true,"agent_provider_bindings_v5":true}'::jsonb
      where singleton_key = 'default'`);
    registerNativeDraftGateway(db as never, workerModelGateway(db as never, { profiles: [], sourceSha: "f".repeat(40),
      protectedEvidenceOrigin: "https://protected.test.invalid" }) as never);
  }, 60_000);
  afterAll(async () => {
    registerNativeDraftGateway(db as never, undefined);
    if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
    await temporary?.cleanup();
  });

  const sourceCanonical = "a".repeat(64);
  const stageState = (ids: { stage: string; reviewer: string; executor: string }, overrides: Record<string, unknown> = {}) => ({
    status: "pending", currentStageId: ids.stage, currentStageIndex: 0, currentStageType: "review",
    currentParticipant: { type: "agent", agentId: ids.reviewer, userId: null },
    returnAssignee: { type: "agent", agentId: ids.executor, userId: null }, reviewRequest: null,
    completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null, ...overrides });

  /** One planned Task in review at its declared review stage: the executor's
   * committed source Run (the plan Worker's single succeeded attempt) and its
   * applied `execution_policy_stage_pending` decision, the stage wake chain to
   * the Reviewer, and the Reviewer's running Run holding the execution lease.
   * `selfReview`: the plan Worker (executor) is the Reviewer. `preNative`: the
   * Reviewer Run is still its unresolved pre-binding row (manifest admission). */
  async function seed(variant: { selfReview?: true; preNative?: true; startedAt?: Date } = {}) {
    const ids = { company: randomUUID(), otherCompany: randomUUID(), executor: randomUUID(), reviewer: randomUUID(),
      outsider: randomUUID(), issue: randomUUID(), sourceRun: randomUUID(), reviewerRun: randomUUID(), decision: randomUUID(),
      stage: randomUUID(), intent: randomUUID(), delivered: randomUUID(), contract: randomUUID(), result: randomUUID(),
      assessment: randomUUID(), user: `user-${randomUUID()}`, plan: randomUUID(), worker: randomUUID(), attempt: randomUUID(),
      manifest: randomUUID(), contextManifest: randomUUID(), secret: randomUUID() };
    if (variant.selfReview) ids.executor = ids.reviewer;
    const prefix = (id: string) => `S${id.replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    await db.insert(companies).values([
      { id: ids.company, name: "Stage reviewer", issuePrefix: prefix(ids.company) },
      { id: ids.otherCompany, name: "Other company", issuePrefix: prefix(ids.otherCompany) },
    ]);
    const adapterConfig = { provider: "opencode", model: "anthropic/claude-fixture" };
    await db.insert(agents).values([
      ...(variant.selfReview ? [] : [{ id: ids.executor, companyId: ids.company, name: "Executor", adapterType: "paperclip_runner",
        status: "idle", adapterConfig }]),
      { id: ids.reviewer, companyId: ids.company, name: "Reviewer", adapterType: "paperclip_runner", status: "running", adapterConfig },
      { id: ids.outsider, companyId: ids.company, name: "Outsider", adapterType: "paperclip_runner", status: "running", adapterConfig },
    ]);
    const executionStage = { wakeRole: "reviewer", stageId: ids.stage, stageType: "review",
      currentParticipant: { type: "agent", agentId: ids.reviewer, userId: null },
      returnAssignee: { type: "agent", agentId: ids.executor, userId: null }, reviewRequest: null, lastDecisionOutcome: null,
      allowedActions: ["approve", "request_changes"] };
    await db.insert(issues).values({ id: ids.issue, companyId: ids.company, title: "Planned task", status: "in_review",
      statusVersion: 1, lastStatusDecisionId: ids.decision, assigneeAgentId: ids.reviewer,
      executionPolicy: { mode: "normal", commentRequired: true, stages: [{ id: ids.stage, type: "review", approvalsNeeded: 1,
        participants: [{ id: randomUUID(), type: "agent", agentId: ids.reviewer, userId: null }] }] },
      executionState: stageState(ids) });
    await db.insert(completionContracts).values({ id: ids.contract, companyId: ids.company, issueId: ids.issue, revision: 1,
      schemaVersion: "aw.completion-contract.v7", policyVersion: "test", risk: "low", completionAuthority: "server_arbiter",
      incompleteCriteriaPolicy: "block", contractJson: { objective: "Write the planned report",
        criteria: [{ id: "output_report", requirement: "The report document exists" }],
        v7: { objective: "Write the planned report for this Task", requiredOutputs: [{ kind: "task_document", key: "report", jsonSchema: null }],
          businessInvariants: ["The report is accurate"], evidenceRequirements: [], prohibitedOutcomes: [], requiredPostconditions: [] } },
      canonicalSha256: "c".repeat(64), createdByActorType: "agent", createdByActorId: ids.executor });
    const context = { issueId: ids.issue, taskId: ids.issue, wakeReason: "execution_review_requested",
      source: "issue.execution_stage", statusDecisionSource: "native_status_decision", executionStage,
      nativeStatusWakeIntentId: ids.intent, paperclipWake: { reason: "execution_review_requested", executionStage } };
    await db.insert(heartbeatRuns).values([
      { id: ids.sourceRun, companyId: ids.company, agentId: ids.executor, status: "succeeded", runtimeMode: "native",
        scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user,
        nativePhase: "committed", completionContractId: ids.contract, createdAt: new Date(Date.now() - 60_000) },
      { id: ids.reviewerRun, companyId: ids.company, agentId: ids.reviewer, status: "running",
        runtimeMode: variant.preNative ? "legacy" : "native", scopeKind: "issue", issueId: ids.issue,
        nativeIssueId: variant.preNative ? null : ids.issue, responsibleUserId: ids.user, startedAt: new Date(),
        contextSnapshot: context },
    ]);
    await db.transaction(async tx => {
      await tx.insert(heartbeatRunEvents).values({ companyId: ids.company, runId: ids.sourceRun, agentId: ids.executor, seq: 1,
        eventType: "native.local_process_stopped", payload: {} });
      await tx.update(heartbeatRuns).set({ nativeProcessCleanupPending: false }).where(eq(heartbeatRuns.id, ids.sourceRun));
    });
    await db.insert(nativeRunResults).values({ id: ids.result, companyId: ids.company, issueId: ids.issue, runId: ids.sourceRun,
      completionContractId: ids.contract, serverFingerprint: randomUUID(), schemaStatus: "accepted", resultJson: {},
      canonicalSha256: sourceCanonical });
    await db.insert(workAssessments).values({ id: ids.assessment, companyId: ids.company, issueId: ids.issue, runId: ids.sourceRun,
      contractId: ids.contract, resultId: ids.result, triggerKind: "test", triggerActorCompanyId: ids.company,
      priorIssueStatus: "in_progress", priorStatusVersion: 0, policyVersion: "test", assessmentJson: {}, inputDigest: randomUUID() });
    await db.insert(statusDecisions).values({ id: ids.decision, companyId: ids.company, issueId: ids.issue, runId: ids.sourceRun,
      assessmentId: ids.assessment, decisionVersion: 1, policyVersion: "test", fromStatus: "in_progress", toStatus: "in_review",
      reasonCode: "execution_policy_stage_pending", decisionJson: { projectedStatusVersion: 1 }, decisionDigest: "e".repeat(64),
      applicationState: "applied", appliedAt: new Date() });
    const wakePayload = { issueId: ids.issue, mutation: "update", executionStage };
    await db.insert(agentWakeupRequests).values([
      { id: ids.intent, companyId: ids.company, agentId: ids.reviewer, source: "assignment", reason: "execution_review_requested",
        payload: { ...wakePayload, _paperclipWakeContext: { source: "issue.execution_stage", issueId: ids.issue, taskId: ids.issue,
          executionStage } }, status: "coalesced", requestedByActorType: "agent", requestedByActorId: ids.executor,
        idempotencyKey: `issue.execution_stage:${ids.issue}:${ids.decision}`, runId: ids.reviewerRun },
      { id: ids.delivered, companyId: ids.company, agentId: ids.reviewer, source: "assignment", reason: "execution_review_requested",
        payload: wakePayload, status: "claimed", requestedByActorType: "system",
        requestedByActorId: `native-status-wake-dispatch:${ids.intent}`, runId: ids.reviewerRun },
    ]);
    await db.insert(statusDecisionEffects).values({ companyId: ids.company, issueId: ids.issue, decisionId: ids.decision, ordinal: 0,
      effectKind: "execution_stage_wake", targetType: "agent_wakeup_request", targetId: ids.intent,
      idempotencyKey: `stage-wake:${ids.decision}`, deliveryState: "delivered", payload: { agentId: ids.reviewer,
        reason: "execution_review_requested", source: "assignment", requestedByActorType: "agent", requestedByActorId: ids.executor,
        executionStage } });
    await db.update(heartbeatRuns).set({ wakeupRequestId: ids.delivered }).where(eq(heartbeatRuns.id, ids.reviewerRun));
    await db.update(issues).set({ executionRunId: ids.reviewerRun }).where(eq(issues.id, ids.issue));
    // Agent creation records the presence and its provider binding.
    for (const agentId of new Set([ids.executor, ids.reviewer, ids.outsider])) {
      const [presence] = await db.select().from(agentPresenceRuntimeBindings).where(and(
        eq(agentPresenceRuntimeBindings.companyId, ids.company), eq(agentPresenceRuntimeBindings.agentId, agentId)));
      if (!presence) throw new Error("fixture_presence_missing");
      await db.update(agentProviderBindings).set({ status: "active", capabilitySnapshotHash: "9".repeat(64) })
        .where(eq(agentProviderBindings.id, presence.providerBindingId));
      await db.update(agentPresenceRuntimeBindings).set({ status: "active", providerProfileRef: `presence:${agentId}` })
        .where(eq(agentPresenceRuntimeBindings.id, presence.id));
    }
    const [reviewerAgent] = await db.select({ identity: agents.agentIdentityId }).from(agents).where(eq(agents.id, ids.reviewer));
    await db.insert(contextManifests).values({ id: ids.contextManifest, companyId: ids.company, runId: ids.reviewerRun,
      agentId: ids.reviewer, issueId: ids.issue, queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) });
    await db.insert(agentExecutionManifests).values({ id: ids.manifest, companyId: ids.company, runId: ids.reviewerRun,
      agentId: ids.reviewer, agentIdentityId: reviewerAgent!.identity, contextManifestId: ids.contextManifest,
      manifest: { responsibleUserId: ids.user, capabilities: [], providers: [], executionScope: { delegatedScopes: [] } } as never,
      policySnapshotHash: "c".repeat(64), hash: "d".repeat(64) });
    // The running single-worker plan: the executor's Worker on this Task and its succeeded source attempt.
    await db.insert(orchestrationPlans).values({ id: ids.plan, companyId: ids.company, issueId: ids.issue,
      completionContractId: ids.contract, mode: "single_worker", actionClass: "internal_draft", riskClass: "C0",
      supervisionMode: "none", verificationMode: "deterministic", humanOversightMode: "human_review", createdBy: ids.user,
      budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1, maxRetries: 0, maxWallClockSeconds: 3600,
        maxToolActions: 5, maxModelCostMinor: 1000 } });
    await db.insert(orchestrationWorkers).values({ id: ids.worker, companyId: ids.company, planId: ids.plan, issueId: ids.issue,
      agentId: ids.executor, completionContractId: ids.contract, workerKey: "writer", dependsOn: [], status: "waiting",
      attemptCount: 1 });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: variant.startedAt ?? new Date(), version: 2,
      executionPrincipal: { type: "user", userId: ids.user } }).where(eq(orchestrationPlans.id, ids.plan));
    await db.insert(orchestrationWorkerAttempts).values({ id: ids.attempt, companyId: ids.company, planId: ids.plan,
      workerId: ids.worker, agentId: ids.executor, runId: ids.sourceRun, attempt: 1, status: "succeeded",
      executionManifestId: ids.manifest, finishedAt: new Date() });
    // The Reviewer's qualified managed transport (owners replaced above) and its current credential version.
    await db.insert(companySecrets).values({ id: ids.secret, companyId: ids.company, key: `ms1f-${ids.secret}`,
      name: "Reviewer model credential" });
    await db.insert(companySecretVersions).values({ secretId: ids.secret, version: 1, material: {},
      valueSha256: "1".repeat(64), fingerprintSha256: "2".repeat(64) });
    const [presence] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, ids.reviewer));
    state.profile = { id: randomUUID(), transport: "server-anthropic-messages-v1", tariff: { model: "claude-fixture" },
      providerBindingId: presence!.providerBindingId, providerSnapshotHash: "3".repeat(64),
      qualifiedConfigurationHash: "4".repeat(64), providerProfileRef: `presence:${ids.reviewer}`, binding: { mode: "explicit" },
      inputTokensUpperBound: 1000, maxOutputTokens: 1024, maximumEnvelopeBytes: 100_000 };
    state.provider = { provider: { id: presence!.providerBindingId, capabilitySnapshotHash: "3".repeat(64) },
      runtime: { conformanceSnapshotHash: "3".repeat(64), qualifiedConfigurationHash: "4".repeat(64),
        providerProfileRef: `presence:${ids.reviewer}` } };
    state.selection = { connection: { id: randomUUID(), config: {}, updatedAt: new Date(0) },
      grant: { id: randomUUID(), updatedAt: new Date(0), credentialSecretRefs: [{ configPath: "ai.credential", secretId: ids.secret }] },
      attribution: { method: "api_key" } };
    state.quoteMinor = 1;
    state.witness = { sourceReceiptDigest: "7".repeat(64), sourceResultId: ids.result, sourceResultCanonicalSha256: sourceCanonical };
    return { ...ids, executionStage };
  }
  type Ids = Awaited<ReturnType<typeof seed>>;

  const reviewerRunRow = async (ids: Ids) => (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, ids.reviewerRun)))[0]!;
  const assignment = async (ids: Ids, mode?: "pending" | "recorded") => getNativeExecutionStageReviewAssignment(db as never, {
    companyId: ids.company, issueId: ids.issue, agentId: ids.reviewer, run: await reviewerRunRow(ids), executionRun: true,
    ...(mode ? { mode } : {}) });
  const predicate = (ids: Ids) => currentNativeReviewerRun(db as never, { companyId: ids.company, agentId: ids.reviewer,
    runId: ids.reviewerRun, issueId: ids.issue, manifestId: ids.manifest });
  const lane = async (ids: Ids, kind?: "completion" | "execution_stage") => nativeReviewerLaneRun(db as never, {
    companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun, issueId: ids.issue, manifestId: ids.manifest,
    contextSnapshot: (await reviewerRunRow(ids)).contextSnapshot, ...(kind ? { kind } : {}) });

  /** The Reviewer Run's stage-bound `review_model` reservation in the given state. */
  async function stageReservation(ids: Ids, status: "completed" | "dispatched" = "completed") {
    const [row] = await db.insert(orchestrationModelReservations).values({ companyId: ids.company, planId: ids.plan,
      purpose: "review_model", principalUserId: ids.user, idempotencyKey: `review-model-messages:stage:${ids.decision}:${randomUUID()}`,
      requestHash: "1".repeat(64), inputHash: "2".repeat(64), authorityHash: "3".repeat(64), maximumMinor: 10,
      quote: { version: 1, currency: "USD", provider: "anthropic", model: "fixture-model", maximumMinor: 10,
        inputTokensUpperBound: 100, maxOutputTokens: 100, sourceSha: "4".repeat(40), tariffHash: "5".repeat(64),
        qualificationHash: "6".repeat(64), expiresAt: new Date(Date.now() + 300_000).toISOString() } as never,
      expiresAt: new Date(Date.now() + 240_000), reviewIssueId: ids.issue, reviewStageId: ids.stage, reviewDecisionId: ids.decision,
      reviewSourceRunId: ids.sourceRun, reviewSourceResultId: ids.result, reviewSourceWorkerId: ids.worker,
      reviewSourceAgentId: ids.executor, reviewSourceAttemptId: ids.attempt, reviewSourceReceiptDigest: "7".repeat(64),
      reviewSourceResultCanonicalSha256: sourceCanonical, reviewAgentId: ids.reviewer, reviewRunId: ids.reviewerRun,
      reviewExecutionManifestId: ids.manifest, reviewPlanVersion: 2 }).returning();
    await db.update(orchestrationModelReservations).set({ status: "dispatched", dispatchedAt: new Date() })
      .where(eq(orchestrationModelReservations.id, row!.id));
    await db.update(orchestrationModelReservations).set({ providerWireReceipt: { version: 1, reservationId: row!.id,
      requestHash: "1".repeat(64), method: "POST", endpoint: "https://api.anthropic.com/v1/messages",
      bodySha256: "8".repeat(64), callId: "messages:fixture" } }).where(eq(orchestrationModelReservations.id, row!.id));
    if (status === "completed") await db.update(orchestrationModelReservations).set({ status: "completed",
      completedAt: new Date(), providerResponseHash: "9".repeat(64), usage: { inputTokens: 1, outputTokens: 1 } })
      .where(eq(orchestrationModelReservations.id, row!.id));
    return row!.id;
  }
  /** This Run's own decision on the stage, as the comment route records it
   * (under a plan the final approval holds the Task for plan verification). */
  async function recordStageDecision(ids: Ids, runId = ids.reviewerRun) {
    const [decision] = await db.insert(issueExecutionDecisions).values({ companyId: ids.company, issueId: ids.issue,
      stageId: ids.stage, stageType: "review", actorAgentId: ids.reviewer, outcome: "approved", body: "## Review: APPROVED",
      createdByRunId: runId }).returning();
    await db.update(issues).set({ assigneeAgentId: ids.executor, executionState: stageState(ids, { status: "completed",
      currentStageId: null, currentStageIndex: null, currentStageType: null, currentParticipant: null,
      completedStageIds: [ids.stage], lastDecisionId: decision!.id, lastDecisionOutcome: "approved" }) })
      .where(eq(issues.id, ids.issue));
    return decision!.id;
  }
  /** A tool invocation row of the Reviewer Run, as the boundary writes it. */
  const invocation = (ids: Ids, tool: string, args: unknown, overrides: Partial<typeof toolInvocations.$inferInsert> = {}) =>
    db.insert(toolInvocations).values({ companyId: ids.company, runId: ids.reviewerRun, issueId: ids.issue, agentId: ids.reviewer,
      actorType: "agent", actorId: ids.reviewer, idempotencyKey: `aw-native-tool:${ids.reviewerRun}:${randomUUID()}`,
      idempotencyRequestHash: randomUUID(), toolName: tool, argumentsHash: nativeSha256(args), riskLevel: "low",
      policyDecision: "allow", approvalState: "not_required", status: "executing", startedAt: new Date(), ...overrides })
      .returning().then(rows => ({ id: rows[0]!.id }), (error: { cause?: { code?: string; message?: string } }) =>
        ({ code: error.cause?.code, message: error.cause?.message }));
  async function ledger(ids: Ids) {
    const [row] = await db.select({ used: orchestrationPlans.toolActionsUsed }).from(orchestrationPlans)
      .where(eq(orchestrationPlans.id, ids.plan));
    const charges = await db.execute(sql`select invocation_id from orchestration_tool_charges where plan_id = ${ids.plan}`);
    return { used: row!.used, charges: (charges as unknown as Array<{ invocation_id: string }>).map(value => value.invocation_id) };
  }
  const unadmittedTrigger = { code: "23514", message: "orchestration_tool_requires_admitted_attempt" };
  const fixtureQuote = () => ({ version: 1, currency: "USD", provider: "anthropic", model: "fixture-model", maximumMinor: 10,
    inputTokensUpperBound: 100, maxOutputTokens: 100, sourceSha: "4".repeat(40), tariffHash: "5".repeat(64),
    qualificationHash: "6".repeat(64), expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const constraintOf = (error: { code?: string; message?: string; cause?: { code?: string; message?: string } }) =>
    `${(error.cause ?? error).code}:${/check constraint "([^"]+)"/.exec((error.cause ?? error).message ?? "")?.[1] ?? (error.cause ?? error).message}`;
  const stageComment = (ids: Ids) => ({ operationId: "POST /api/issues/{id}/comments", pathParams: { id: ids.issue },
    body: { body: "## Review: APPROVED\n\nThe report is complete." } });

  describe("stage Reviewer wake context", () => {
    it("reads only a reviewer-role review stage wake from a native status decision", async () => {
      const ids = await seed();
      const context = (await reviewerRunRow(ids)).contextSnapshot as Record<string, unknown>;
      expect(readNativeStageReviewContext(context)).toEqual({ nativeStatusWakeIntentId: ids.intent, stageId: ids.stage,
        issueId: ids.issue });
      const stage = context.executionStage as Record<string, unknown>;
      for (const changed of [
        { ...context, executionStage: { ...stage, wakeRole: "approver" } },
        { ...context, executionStage: { ...stage, wakeRole: "executor" } },
        { ...context, executionStage: { ...stage, stageType: "approval" } },
        { ...context, nativeStatusWakeIntentId: undefined },
        { ...context, statusDecisionSource: undefined },
        { ...context, source: "issue.assignment" },
        { ...context, taskId: randomUUID() },
        { ...context, nativeReviewInteractionId: randomUUID(), nativeReviewDecisionId: randomUUID() },
      ]) expect(readNativeStageReviewContext(changed)).toBeNull();
    });
  });

  describe("stage assignment and the reviewer-lane predicates", () => {
    it("admits the current stage Reviewer (the assignee, no worker attempt) on the reviewer lane", async () => {
      const ids = await seed();
      await expect(assignment(ids)).resolves.toMatchObject({ kind: "execution_stage", stageId: ids.stage, intentId: ids.intent,
        sourceDecision: { id: ids.decision }, sourceRun: { id: ids.sourceRun }, sourceAttempt: { id: ids.attempt },
        sourceWorker: { id: ids.worker }, recordedDecision: null });
      await expect(predicate(ids)).resolves.toBe(true);
      await expect(lane(ids)).resolves.toBe(true);
      await expect(lane(ids, "execution_stage")).resolves.toBe(true);
      // The boundary admits resolve_review only on the completion kind.
      await expect(lane(ids, "completion")).resolves.toBe(false);
    });

    const refusals: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      ["the stage not pending", ids => db.update(issues).set({ executionState: stageState(ids, { status: "changes_requested" }) })
        .where(eq(issues.id, ids.issue))],
      ["another participant", ids => db.update(issues).set({ executionState: stageState(ids, {
        currentParticipant: { type: "agent", agentId: ids.outsider, userId: null } }) }).where(eq(issues.id, ids.issue))],
      ["a return assignee that is not the plan Worker", ids => db.update(issues).set({ executionState: stageState(ids, {
        returnAssignee: { type: "agent", agentId: ids.reviewer, userId: null } }) }).where(eq(issues.id, ids.issue))],
      ["another stage", ids => db.update(issues).set({ executionState: stageState(ids, { currentStageId: randomUUID() }) })
        .where(eq(issues.id, ids.issue))],
      ["a Reviewer that is no longer the assignee", ids => db.update(issues).set({ assigneeAgentId: ids.executor })
        .where(eq(issues.id, ids.issue))],
      ["a Task no longer in review", ids => db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, ids.issue))],
      ["a later status decision", ids => db.update(issues).set({ lastStatusDecisionId: randomUUID() }).where(eq(issues.id, ids.issue))],
      ["another Run holding the execution lease", ids => db.update(issues).set({ executionRunId: ids.sourceRun })
        .where(eq(issues.id, ids.issue))],
      ["a stale status-wake intent", async ids => {
        const run = await reviewerRunRow(ids);
        await db.update(heartbeatRuns).set({ contextSnapshot: { ...(run.contextSnapshot as object), nativeStatusWakeIntentId: randomUUID() } })
          .where(eq(heartbeatRuns.id, ids.reviewerRun));
      }],
      ["a delivered wake that is not the intent's dispatch receipt", ids => db.update(agentWakeupRequests)
        .set({ requestedByActorId: `native-status-wake-dispatch:${randomUUID()}` }).where(eq(agentWakeupRequests.id, ids.delivered))],
      ["a decision that is not the stage-pending decision", ids => db.update(statusDecisions)
        .set({ reasonCode: "completion_evidence_incomplete" }).where(eq(statusDecisions.id, ids.decision))],
      ["a source Run with process cleanup pending", ids => db.transaction(async tx => {
        await tx.insert(heartbeatRunEvents).values({ companyId: ids.company, runId: ids.sourceRun, agentId: ids.executor, seq: 2,
          eventType: "native.process_start_requested", payload: {} });
        await tx.update(heartbeatRuns).set({ nativeProcessCleanupPending: true }).where(eq(heartbeatRuns.id, ids.sourceRun));
      })],
      ["no plan worker attempt of the source Run", ids => db.delete(orchestrationWorkerAttempts)
        .where(eq(orchestrationWorkerAttempts.id, ids.attempt))],
      ["a plan worker attempt of the Reviewer Run itself", ids => db.insert(orchestrationWorkerAttempts).values({
        companyId: ids.company, planId: ids.plan, workerId: ids.worker, agentId: ids.reviewer, runId: ids.reviewerRun,
        attempt: 2, status: "running" })],
    ];
    it.each(refusals)("refuses %s", async (name, change) => {
      const ids = await seed();
      await expect(lane(ids)).resolves.toBe(true);
      await change(ids);
      await expect(lane(ids)).resolves.toBe(false);
      // The stage assignment itself refuses every case but the Reviewer's own
      // worker attempt (the lane base refuses that one).
      if (name !== "a plan worker attempt of the Reviewer Run itself") await expect(assignment(ids)).resolves.toBeNull();
    });

    it("refuses a stage Reviewer who is the plan Worker (independence)", async () => {
      const ids = await seed({ selfReview: true });
      await expect(assignment(ids)).resolves.toBeNull();
      await expect(predicate(ids)).resolves.toBe(false);
      await expect(lane(ids)).resolves.toBe(false);
    });

    it("records the stage lane only with a stage-bound reservation and this Run's own stage decision (MS1h17)", async () => {
      const ids = await seed();
      const recorded = () => nativeReviewerLaneRecorded(db as never, { companyId: ids.company, runId: ids.reviewerRun });
      await expect(recorded()).resolves.toBe(false);
      await stageReservation(ids);
      await expect(recorded()).resolves.toBe(false);
      await expect(assignment(ids, "recorded")).resolves.toBeNull();
      // Another Run's decision on the stage is not this Run's record.
      const other = await db.insert(issueExecutionDecisions).values({ companyId: ids.company, issueId: ids.issue, stageId: ids.stage,
        stageType: "review", actorAgentId: ids.reviewer, outcome: "approved", body: "x", createdByRunId: ids.sourceRun }).returning();
      await expect(recorded()).resolves.toBe(false);
      await db.delete(issueExecutionDecisions).where(eq(issueExecutionDecisions.id, other[0]!.id));
      const decisionId = await recordStageDecision(ids);
      await expect(recorded()).resolves.toBe(true);
      await expect(assignment(ids, "recorded")).resolves.toMatchObject({ recordedDecision: { id: decisionId } });
      // After its decision the Reviewer is no longer the current pending Reviewer.
      await expect(predicate(ids)).resolves.toBe(false);
    });

    it("never records a plan-less stage Reviewer (no stage-bound reservation)", async () => {
      const ids = await seed();
      await recordStageDecision(ids);
      await expect(nativeReviewerLaneRecorded(db as never, { companyId: ids.company, runId: ids.reviewerRun })).resolves.toBe(false);
    });

    it("puts the stage Reviewer on the RuntimeControl reviewer session lane with a stage review_model capability (MS1h7)", async () => {
      const ids = await seed();
      const run = await reviewerRunRow(ids);
      const source = { run, manifest: { id: ids.manifest }, attempt: null, source: { task: { id: ids.issue } } };
      await expect(nativeModelSessionOwnerLane(db as never, source as never)).resolves.toBe("reviewer");
      expect(nativeManagedModelIssuer({ providerConformanceBootstrap: false, contextSnapshot: run.contextSnapshot,
        hasWorkerAttempt: false, hasConversationIdentity: false })).toBe("review");
      expect(nativeManagedModelIssuer({ providerConformanceBootstrap: false, contextSnapshot: run.contextSnapshot,
        hasWorkerAttempt: true, hasConversationIdentity: false })).toBe("worker");
      const binding = { kind: "execution_stage" as const, planId: ids.plan, issueId: ids.issue, stageId: ids.stage,
        decisionId: ids.decision, sourceRunId: ids.sourceRun, sourceWorkerId: ids.worker, sourceAgentId: ids.executor,
        sourceAttemptId: ids.attempt, sourceResultId: ids.result, sourceReceiptDigest: "7".repeat(64),
        sourceResultCanonicalSha256: sourceCanonical, reviewerAgentId: ids.reviewer, reviewerRunId: ids.reviewerRun,
        executionManifestId: ids.manifest, expectedPlanVersion: 2 };
      const token = (reviewModelBinding: unknown) => ({ capabilityToken: createRuntimeToolsToken({ companyId: ids.company,
        agentId: ids.reviewer, runId: ids.reviewerRun, responsibleUserId: ids.user, scope: "review_model",
        reviewModelBinding: reviewModelBinding as never })!.token });
      expect(nativeReviewerModelCredentialExact(source as never, token(binding))).toBe(true);
      const { kind: _kind, stageId: _stageId, ...completion } = binding;
      // A completion-kind binding for a stage Reviewer wake is refused.
      expect(nativeReviewerModelCredentialExact(source as never, token({ ...completion, interactionId: randomUUID() }))).toBe(false);
    });

    it("gives the stage Reviewer's own result a status-preserving reviewer outcome only under a plan", async () => {
      const ids = await seed();
      const run = await reviewerRunRow(ids);
      await expect(nativeStageReviewerOutcome(db as never, run, ids.issue)).resolves.toBe("pending");
      await recordStageDecision(ids);
      await expect(nativeStageReviewerOutcome(db as never, run, ids.issue)).resolves.toBe("resolved");
      await db.update(issues).set({ executionState: stageState(ids, { status: "changes_requested" }) }).where(eq(issues.id, ids.issue));
      await expect(nativeStageReviewerOutcome(db as never, run, ids.issue)).resolves.toBe("stale");
      // Plan-less: the ordinary arbiter (no reviewer outcome).
      await db.update(orchestrationPlans).set({ status: "cancelled" }).where(eq(orchestrationPlans.id, ids.plan));
      await expect(nativeStageReviewerOutcome(db as never, run, ids.issue)).resolves.toBeNull();
    });
  });

  describe("sandbox policy guard trigger (migration 0582, MS1h3)", () => {
    it("admits the stage Reviewer through the unchanged assignee clause, and refuses it once the Task returns to the Worker", async () => {
      const ids = await seed();
      const image = "fixture.invalid/stage-reviewer-policy@sha256:" + "b".repeat(64);
      await db.insert(runtimeVersionCatalog).values({ imageDigest: image, providerVersion: "fixture", stateFormat: "v1",
        hostAgentMinimumVersion: "6.0.0", conformance: { fixtureOnly: true }, status: "approved" }).onConflictDoNothing();
      await db.insert(runtimeCapacityProfiles).values({ key: "stage-reviewer-policy-fixture", cpuMillis: 1000, memoryBytes: 1073741824n,
        diskBytes: 10737418240n, pidsLimit: 128, qualified: false }).onConflictDoNothing();
      await instanceSettingsService(db as never).updateExperimental({ sandbox_abstraction_v7: true });
      const [account] = await db.insert(billingAccounts).values({ displayName: "Stage policy", payerUserId: ids.user }).returning();
      await db.insert(billingAccountCompanies).values({ companyId: ids.company, billingAccountId: account!.id });
      const [cell] = await db.insert(runtimeCells).values({ companyId: ids.company, billingAccountId: account!.id,
        capacityProfile: "stage-reviewer-policy-fixture", desiredImageDigest: image, status: "STOPPED", isolationMode: "company_cell" }).returning();
      const capabilitySnapshot = { fixture: "stage-reviewer-policy", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
      const boundaryPolicy = policyFixture();
      const [binding] = await db.insert(runtimeSandboxBindings).values({ companyId: ids.company, runtimeCellId: cell!.id,
        cellGeneration: cell!.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy,
        boundaryPolicyHash: nativeSha256(boundaryPolicy), capabilitySnapshot: capabilitySnapshot as never,
        capabilitySnapshotHash: nativeSha256(capabilitySnapshot), status: "stopped", createdByUserId: ids.user }).returning();
      let version = 0;
      const qualify = () => db.insert(runtimePolicySnapshots).values({ companyId: ids.company, bindingId: binding!.id,
        runtimeCellId: cell!.id, agentId: ids.reviewer, executionManifestId: ids.manifest, policyVersion: ++version,
        policyHash: "f".repeat(64), capabilitySnapshotHash: binding!.capabilitySnapshotHash, compilation: { proverResult: "pass",
          compiledPolicy: { riskClass: "C2", credentials: { mode: "none", bindings: [] } } } as never,
        authorityHash: "a".repeat(64), sourcePolicyRefs: [], status: "qualified", expiresAt: new Date(Date.now() + 600_000) })
        .returning().then(rows => rows[0]!.id, (error: { cause?: { code?: string; message?: string } }) =>
          ({ code: error.cause?.code, message: error.cause?.message }));
      await expect(qualify()).resolves.toEqual(expect.any(String));
      await db.update(issues).set({ assigneeAgentId: ids.executor }).where(eq(issues.id, ids.issue));
      await expect(qualify()).resolves.toEqual({ code: "23514", message: expect.stringContaining("sandbox_policy_current_execution_required") });
    });
  });

  describe("migration 0585: stage-bound review reservations and Reviewer tool charges", () => {
    it("accepts a stage-bound review_model reservation and refuses one naming both or neither review subject", async () => {
      const ids = await seed();
      await expect(stageReservation(ids)).resolves.toEqual(expect.any(String));
      const interaction = randomUUID();
      const attempt = (subject: { reviewInteractionId: string | null; reviewStageId: string | null }) =>
        db.execute(sql`insert into orchestration_model_reservations (company_id, plan_id, purpose, principal_user_id, idempotency_key,
          request_hash, input_hash, authority_hash, quote, maximum_minor, expires_at, review_issue_id, review_interaction_id,
          review_stage_id, review_decision_id, review_source_run_id, review_source_result_id, review_source_worker_id,
          review_source_agent_id, review_source_attempt_id, review_source_receipt_digest, review_source_result_canonical_sha256,
          review_agent_id, review_run_id, review_execution_manifest_id, review_plan_version)
          values (${ids.company}, ${ids.plan}, 'review_model', ${ids.user}, ${`subject-${randomUUID()}`}, ${"1".repeat(64)},
          ${"2".repeat(64)}, ${"3".repeat(64)}, ${JSON.stringify(fixtureQuote())}::jsonb, 10, now() + interval '4 minutes',
          ${ids.issue}, ${subject.reviewInteractionId}, ${subject.reviewStageId}, ${ids.decision}, ${ids.sourceRun}, ${ids.result},
          ${ids.worker}, ${ids.executor}, ${ids.attempt}, ${"7".repeat(64)}, ${sourceCanonical}, ${ids.reviewer}, ${ids.reviewerRun},
          ${ids.manifest}, 2)`).then(() => "inserted", constraintOf);
      await expect(attempt({ reviewInteractionId: interaction, reviewStageId: ids.stage }))
        .resolves.toBe("23514:orchestration_model_reservation_scope_ck");
      await expect(attempt({ reviewInteractionId: null, reviewStageId: null }))
        .resolves.toBe("23514:orchestration_model_reservation_scope_ck");
      // No other purpose may carry a stage.
      const worker = (stage: string | null) => db.execute(sql`insert into orchestration_model_reservations (company_id, plan_id,
        worker_id, purpose, principal_user_id, idempotency_key, request_hash, input_hash, authority_hash, quote, maximum_minor,
        expires_at, review_stage_id) values (${ids.company}, ${ids.plan}, ${ids.worker}, 'worker_model', ${ids.user},
        ${`worker-${randomUUID()}`}, ${"1".repeat(64)}, ${"2".repeat(64)}, ${"3".repeat(64)},
        ${JSON.stringify(fixtureQuote())}::jsonb, 10, now() + interval '4 minutes', ${stage})`).then(() => "inserted", constraintOf);
      await expect(worker(null)).resolves.toBe("inserted");
      await expect(worker(ids.stage)).resolves.toBe("23514:orchestration_model_reservation_scope_ck");
    });

    it("keeps the stage of a review reservation immutable", async () => {
      const ids = await seed();
      const id = await stageReservation(ids);
      const changed = await db.update(orchestrationModelReservations).set({ reviewStageId: randomUUID() })
        .where(eq(orchestrationModelReservations.id, id)).then(() => "updated", (error: { cause?: { message?: string } }) => error.cause?.message);
      expect(changed).toBe("review_model_reservation_binding_immutable");
    });

    it("charges the stage Reviewer's stage-comment call_api once to the plan", async () => {
      const ids = await seed();
      await stageReservation(ids);
      const first = await invocation(ids, "call_api", stageComment(ids));
      expect(first).toEqual({ id: expect.any(String) });
      expect(await ledger(ids)).toEqual({ used: 1, charges: [(first as { id: string }).id] });
      // Settling the invocation does not charge it again.
      await db.update(toolInvocations).set({ status: "succeeded", resultHash: "0".repeat(64) })
        .where(eq(toolInvocations.id, (first as { id: string }).id));
      expect(await ledger(ids)).toEqual({ used: 1, charges: [(first as { id: string }).id] });
      // Once the Reviewer's decision completed the stage, no further call_api is charged.
      await recordStageDecision(ids);
      await expect(invocation(ids, "call_api", stageComment(ids))).resolves.toEqual(unadmittedTrigger);
      expect((await ledger(ids)).used).toBe(1);
    });

    it("charges a stage Reviewer's read of a declared output document once, and refuses any other read", async () => {
      const ids = await seed();
      await stageReservation(ids);
      const read = await invocation(ids, "read_document", { key: "report" }, { riskLevel: "read" });
      expect(read).toEqual({ id: expect.any(String) });
      expect(await ledger(ids)).toEqual({ used: 1, charges: [(read as { id: string }).id] });
      await expect(invocation(ids, "read_document", { key: "notes" }, { riskLevel: "read" })).resolves.toEqual(unadmittedTrigger);
      await expect(invocation(ids, "read_document", { key: "report", revision: 1 }, { riskLevel: "read" }))
        .resolves.toEqual(unadmittedTrigger);
      expect((await ledger(ids)).used).toBe(1);
    });

    const otherRows: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      ["write_document", ids => invocation(ids, "write_document", { key: "report", body: "x" })],
      ["create_task", ids => invocation(ids, "create_task", { title: "x", status: "backlog" })],
      ["resolve_review", ids => invocation(ids, "resolve_review", { decision: "accept" })],
      ["get_task_context", ids => invocation(ids, "get_task_context", {}, { riskLevel: "read" })],
      ["call_api while the stage is no longer pending", async ids => {
        await db.update(issues).set({ executionState: stageState(ids, { status: "changes_requested" }) }).where(eq(issues.id, ids.issue));
        return invocation(ids, "call_api", stageComment(ids));
      }],
      ["call_api from another participant", async ids => {
        await db.update(issues).set({ executionState: stageState(ids, {
          currentParticipant: { type: "agent", agentId: ids.outsider, userId: null } }) }).where(eq(issues.id, ids.issue));
        return invocation(ids, "call_api", stageComment(ids));
      }],
      ["call_api while the plan Worker is the return assignee no more", async ids => {
        await db.update(issues).set({ executionState: stageState(ids, {
          returnAssignee: { type: "agent", agentId: ids.outsider, userId: null } }) }).where(eq(issues.id, ids.issue));
        return invocation(ids, "call_api", stageComment(ids));
      }],
      ["call_api keyed to another Run", ids => invocation(ids, "call_api", stageComment(ids),
        { idempotencyKey: `aw-native-tool:${ids.sourceRun}:${randomUUID()}` })],
      ["call_api without a reviewer wake", async ids => {
        const run = await reviewerRunRow(ids);
        await db.update(heartbeatRuns).set({ contextSnapshot: { ...(run.contextSnapshot as object), source: "issue.assignment" } })
          .where(eq(heartbeatRuns.id, ids.reviewerRun));
        return invocation(ids, "call_api", stageComment(ids));
      }],
      ["call_api on a paused plan", async ids => {
        await db.update(orchestrationPlans).set({ status: "paused" }).where(eq(orchestrationPlans.id, ids.plan));
        return invocation(ids, "call_api", stageComment(ids));
      }],
    ];
    it("refuses the stage-comment call_api without a completed stage-bound reservation", async () => {
      const ids = await seed();
      await stageReservation(ids, "dispatched");
      await expect(invocation(ids, "call_api", stageComment(ids))).resolves.toEqual(unadmittedTrigger);
      await expect(invocation(ids, "read_document", { key: "report" }, { riskLevel: "read" })).resolves.toEqual(unadmittedTrigger);
      expect(await ledger(ids)).toEqual({ used: 0, charges: [] });
    });

    it.each(otherRows)("refuses every other Reviewer tool row: %s", async (_name, write) => {
      const ids = await seed();
      await stageReservation(ids);
      await expect(write(ids)).resolves.toEqual(unadmittedTrigger);
      expect(await ledger(ids)).toEqual({ used: 0, charges: [] });
    });
  });

  describe("Native tool boundary: the stage Reviewer's comment and declared reads", () => {
    const binding = (ids: Ids) => ({ companyId: ids.company, issueId: ids.issue, agentId: ids.reviewer, runId: ids.reviewerRun });
    const unadmitted = "Native tools require the plan's admitted worker attempt";
    async function invocations(ids: Ids) {
      return db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, ids.company),
        eq(toolInvocations.runId, ids.reviewerRun)));
    }

    it("admits the current stage-comment call_api, writes and charges its invocation once, and settles it", async () => {
      const ids = await seed();
      await stageReservation(ids);
      const decided: unknown[] = [];
      state.stageCommentDecision = async input => { decided.push(input.arguments); return true; };
      const effect = vi.fn(async () => ({ ok: true, status: 201, apiOperationId: "POST /api/issues/{id}/comments",
        data: { id: randomUUID(), issueId: ids.issue } }));
      const result = await withOrchestrationNativeTool(db as never, binding(ids),
        { tool: "call_api", callId: "stage-comment-1", arguments: stageComment(ids) }, effect);
      expect(effect).toHaveBeenCalledTimes(1);
      const rows = await invocations(ids);
      expect(rows).toEqual([expect.objectContaining({ toolName: "call_api", status: "succeeded", riskLevel: "low",
        idempotencyKey: `aw-native-tool:${ids.reviewerRun}:stage-comment-1`, argumentsHash: nativeSha256(stageComment(ids)),
        resultHash: nativeSha256(result) })]);
      expect(await ledger(ids)).toEqual({ used: 1, charges: [rows[0]!.id] });
      // Checked before the transaction and again inside it.
      expect(decided).toEqual([stageComment(ids), stageComment(ids)]);
    });

    it("refuses a call_api that is not the current stage-comment decision", async () => {
      const ids = await seed();
      await stageReservation(ids);
      state.stageCommentDecision = async () => false;
      const effect = vi.fn(async () => ({ ok: true }));
      await expect(withOrchestrationNativeTool(db as never, binding(ids),
        { tool: "call_api", callId: "stage-comment-2", arguments: stageComment(ids) }, effect)).rejects.toThrow(unadmitted);
      expect(effect).not.toHaveBeenCalled();
      expect(await invocations(ids)).toEqual([]);
    });

    it("re-checks the stage-comment decision inside the charging transaction", async () => {
      const ids = await seed();
      await stageReservation(ids);
      let calls = 0;
      state.stageCommentDecision = async () => ++calls === 1;
      const effect = vi.fn(async () => ({ ok: true }));
      await expect(withOrchestrationNativeTool(db as never, binding(ids),
        { tool: "call_api", callId: "stage-comment-3", arguments: stageComment(ids) }, effect))
        .rejects.toThrow("The Native review tool action is no longer current for this Reviewer Run");
      expect(effect).not.toHaveBeenCalled();
      expect(await ledger(ids)).toEqual({ used: 0, charges: [] });
    });

    it("re-checks the reviewer lane inside the charging transaction", async () => {
      const ids = await seed();
      await stageReservation(ids);
      state.stageCommentDecision = async () => true;
      const effect = vi.fn(async () => ({ ok: true }));
      const { outcome } = await db.transaction(async tx => {
        await lockAnalyticalCompany(tx as never, ids.company);
        const pending = withOrchestrationNativeTool(db as never, binding(ids),
          { tool: "call_api", callId: "stage-comment-4", arguments: stageComment(ids) }, effect)
          .then(() => "admitted", (error: Error) => error.message);
        for (let i = 0; i < 400; i++) {
          const waiting = await db.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`);
          if ((waiting as unknown as Array<{ n: number }>)[0]!.n > 0) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        await tx.update(issues).set({ executionState: stageState(ids, { status: "changes_requested" }) }).where(eq(issues.id, ids.issue));
        return { outcome: pending };
      });
      await expect(outcome).resolves.toBe("The Native review tool action is no longer current for this Reviewer Run");
      expect(effect).not.toHaveBeenCalled();
      expect(await ledger(ids)).toEqual({ used: 0, charges: [] });
    });

    it("surfaces a missing completed reservation as a typed conflict", async () => {
      const ids = await seed();
      await stageReservation(ids, "dispatched");
      state.stageCommentDecision = async () => true;
      await expect(withOrchestrationNativeTool(db as never, binding(ids),
        { tool: "call_api", callId: "stage-comment-5", arguments: stageComment(ids) }, async () => ({ ok: true })))
        .rejects.toMatchObject({ status: 409 });
      expect(await ledger(ids)).toEqual({ used: 0, charges: [] });
    });

    it("admits and charges a declared output read once, and refuses every other read and tool", async () => {
      const ids = await seed();
      await stageReservation(ids);
      state.stageCommentDecision = async () => true;
      const read = vi.fn(async () => ({ document: { key: "report", body: "Report" } }));
      await withOrchestrationNativeTool(db as never, binding(ids), { tool: "read_document", callId: "read-1", arguments: { key: "report" } }, read);
      expect(read).toHaveBeenCalledTimes(1);
      const rows = await invocations(ids);
      expect(rows).toEqual([expect.objectContaining({ toolName: "read_document", status: "succeeded", riskLevel: "read" })]);
      expect(await ledger(ids)).toEqual({ used: 1, charges: [rows[0]!.id] });
      for (const call of [
        { tool: "read_document", arguments: { key: "notes" } },
        { tool: "read_document", arguments: { key: "report", revision: 1 } },
        { tool: "list_documents", arguments: {} },
        { tool: "get_task_context", arguments: {} },
        { tool: "write_document", arguments: { key: "report", body: "x" } },
        { tool: "resolve_review", arguments: { decision: "accept" } },
      ]) {
        const effect = vi.fn(async () => ({ ok: true }));
        await expect(withOrchestrationNativeTool(db as never, binding(ids), { ...call, callId: `other-${randomUUID()}` }, effect))
          .rejects.toThrow(unadmitted);
        expect(effect).not.toHaveBeenCalled();
      }
      expect((await ledger(ids)).used).toBe(1);
    });

    it("refuses the stage path for a Run that is not the current stage Reviewer", async () => {
      const ids = await seed({ selfReview: true });
      state.stageCommentDecision = async () => true;
      const effect = vi.fn(async () => ({ ok: true }));
      await expect(withOrchestrationNativeTool(db as never, binding(ids),
        { tool: "call_api", callId: "stage-comment-6", arguments: stageComment(ids) }, effect)).rejects.toThrow(unadmitted);
      expect(effect).not.toHaveBeenCalled();
    });
  });

  describe("orchestration admission of the stage Reviewer (decision 4, option D2)", () => {
    const admit = (ids: Ids) => db.transaction(tx => admitOrchestrationHeartbeat(tx as never, { companyId: ids.company,
      issueId: ids.issue, agentId: ids.reviewer, runId: ids.reviewerRun, responsibleUserId: ids.user,
      executionManifestId: ids.manifest }, [], db as never));
    const attempts = (ids: Ids) => db.select().from(orchestrationWorkerAttempts).where(and(
      eq(orchestrationWorkerAttempts.companyId, ids.company), eq(orchestrationWorkerAttempts.runId, ids.reviewerRun)));

    it("admits the current stage Reviewer before the worker scope, with no worker attempt", async () => {
      const ids = await seed({ preNative: true });
      const [planBefore] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, ids.plan));
      await expect(admit(ids)).resolves.toBeNull();
      expect(await attempts(ids)).toEqual([]);
      const [planAfter] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, ids.plan));
      expect(planAfter).toMatchObject({ version: planBefore!.version, retriesUsed: planBefore!.retriesUsed,
        toolActionsUsed: planBefore!.toolActionsUsed, modelCostReserved: planBefore!.modelCostReserved });
    });

    const refusals: Array<[string, (ids: Ids) => Promise<unknown>, string]> = [
      ["the stage is not pending", ids => db.update(issues).set({ executionState: stageState(ids, { status: "changes_requested" }) })
        .where(eq(issues.id, ids.issue)), "The execution-stage review is no longer current for this Reviewer Run"],
      ["the status-wake intent is stale", async ids => {
        const run = await reviewerRunRow(ids);
        await db.update(heartbeatRuns).set({ contextSnapshot: { ...(run.contextSnapshot as object), nativeStatusWakeIntentId: randomUUID() } })
          .where(eq(heartbeatRuns.id, ids.reviewerRun));
      }, "The execution-stage review is no longer current for this Reviewer Run"],
      ["the plan is paused", ids => db.update(orchestrationPlans).set({ status: "paused" }).where(eq(orchestrationPlans.id, ids.plan)),
        "The accepted plan, source attempt, Human principal or deadline changed"],
      ["the plan model budget is short", async () => { state.quoteMinor = 2_000; },
        "The accepted plan has insufficient remaining model budget for the qualified Reviewer call"],
      ["the plan tool-action budget is used up", ids => db.update(orchestrationPlans).set({ toolActionsUsed: 5 })
        .where(eq(orchestrationPlans.id, ids.plan)), "The original accepted plan has no remaining review tool-action budget"],
      ["the source witness changed", async () => { state.witness = null; },
        "The current committed execution-stage review source is unavailable"],
    ];
    it.each(refusals)("refuses when %s", async (_name, change, message) => {
      const ids = await seed({ preNative: true });
      await change(ids);
      await expect(admit(ids)).rejects.toThrow(message);
      expect(await attempts(ids)).toEqual([]);
    });

    it("refuses when the plan deadline expired", async () => {
      const ids = await seed({ preNative: true, startedAt: new Date(Date.now() - 7_200_000) });
      await expect(admit(ids)).rejects.toThrow("The accepted plan, source attempt, Human principal or deadline changed");
      expect(await attempts(ids)).toEqual([]);
    });

    it("issues the running stage Reviewer only a stage-bound review_model capability that the sandbox-exec read accepts", async () => {
      const ids = await seed();
      await db.update(heartbeatRuns).set({ completionContractId: ids.contract, completionContractSha256: "c".repeat(64) })
        .where(eq(heartbeatRuns.id, ids.reviewerRun));
      const models = workerModelGateway(db as never, { profiles: [], sourceSha: "f".repeat(40),
        protectedEvidenceOrigin: "https://protected.test.invalid" });
      const minted = await models.issueForReviewRun({ companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun,
        responsibleUserId: ids.user });
      const { verifyRuntimeToolsToken } = await import("../../runtime-tools-token.js");
      const claims = verifyRuntimeToolsToken(minted.token, "review_model");
      expect(claims?.review_model).toEqual({ kind: "execution_stage", planId: ids.plan, issueId: ids.issue, stageId: ids.stage,
        decisionId: ids.decision, sourceRunId: ids.sourceRun, sourceWorkerId: ids.worker, sourceAgentId: ids.executor,
        sourceAttemptId: ids.attempt, sourceResultId: ids.result, sourceReceiptDigest: "7".repeat(64),
        sourceResultCanonicalSha256: sourceCanonical, reviewerAgentId: ids.reviewer, reviewerRunId: ids.reviewerRun,
        executionManifestId: ids.manifest, expectedPlanVersion: 2 });
      const current = await db.transaction(tx => models.currentReviewBinding(tx as never, claims!,
        { companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun }));
      expect(current?.binding).toEqual(claims!.review_model);
      // After its own stage decision no new capability is issued (pending review required).
      await recordStageDecision(ids);
      await expect(models.issueForReviewRun({ companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun,
        responsibleUserId: ids.user })).rejects.toThrow();
    });

    it("refuses a stage Reviewer who is the plan Worker, without falling back to worker admission", async () => {
      const ids = await seed({ preNative: true, selfReview: true });
      await expect(admit(ids)).rejects.toThrow("The execution-stage review is no longer current for this Reviewer Run");
      expect(await attempts(ids)).toEqual([]);
    });
  });
  // MS1f phase 4. Bootstrap selects the stage continuation owner while it builds
  // the Reviewer's first dispatch envelope: before `paperclipWake` is rendered
  // into the Run context and before Native selection. The context's own stage
  // and wake reason stand in only in that window; the stage Reviewer's
  // dispatch receipt may be the promoted row of a deferred stage wake.
  describe("stage continuation owner at bootstrap (MS1f phase 4)", () => {
    const reader = (ids: Ids) => ({ type: "agent" as const, source: "agent_jwt" as const, companyId: ids.company,
      agentId: ids.reviewer, runId: ids.reviewerRun, onBehalfOfUserId: ids.user });
    const owner = async (ids: Ids, extra: Partial<Parameters<typeof captureNativeStageContinuationOwner>[1]> = {}) =>
      (await captureNativeStageContinuationOwner(db as never, { companyId: ids.company, issueId: ids.issue,
        receiver: await reviewerRunRow(ids), reader: reader(ids), ...extra }))?.trigger ?? null;
    const setContext = async (ids: Ids, change: (context: Record<string, unknown>) => Record<string, unknown>) => {
      const run = await reviewerRunRow(ids);
      await db.update(heartbeatRuns).set({ contextSnapshot: change({ ...(run.contextSnapshot as Record<string, unknown>) }) })
        .where(eq(heartbeatRuns.id, ids.reviewerRun));
    };
    const unrendered = ({ paperclipWake: _wake, ...context }: Record<string, unknown>) => context;
    /** The pre-render, pre-selection Reviewer Run that bootstrap reads. */
    const bootstrapSeed = async () => {
      const ids = await seed({ preNative: true });
      await setContext(ids, unrendered);
      return ids;
    };
    /** The same Run after bootstrap rendered its wake and selected Native. */
    const renderAndSelect = async (ids: Ids) => {
      await setContext(ids, context => ({ ...context, paperclipWake: { reason: context.wakeReason,
        executionStage: context.executionStage } }));
      await db.update(heartbeatRuns).set({ runtimeMode: "native", nativeIssueId: ids.issue, runtimeModeResolvedAt: new Date() })
        .where(eq(heartbeatRuns.id, ids.reviewerRun));
    };
    /** The dispatcher's deferred receipt, later promoted: the intent stays
     * coalesced with no Run, and promotion rewrote the receipt's reason. */
    const promoteReceipt = async (ids: Ids, receiptKey: string | null = `issue.execution_stage:${ids.issue}:${ids.decision}`) => {
      await db.update(agentWakeupRequests).set({ status: "coalesced", runId: null }).where(eq(agentWakeupRequests.id, ids.intent));
      await db.update(agentWakeupRequests).set({ reason: "issue_execution_promoted", idempotencyKey: receiptKey })
        .where(eq(agentWakeupRequests.id, ids.delivered));
    };

    it("selects the owner from the unrendered context before Native selection, and the rendered selected Run agrees", async () => {
      const ids = await bootstrapSeed();
      const atBootstrap = await owner(ids);
      expect(atBootstrap).toMatchObject({ runId: ids.reviewerRun, agentId: ids.reviewer, intentId: ids.intent,
        decisionId: ids.decision, executorRunId: ids.sourceRun, executorAgentId: ids.executor,
        reason: "execution_review_requested", stageHash: nativeSha256(ids.executionStage) });
      await renderAndSelect(ids);
      await expect(owner(ids)).resolves.toEqual(atBootstrap);
    });

    const unrenderedRefusals: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      ["a Run already selected for Native", ids => db.update(heartbeatRuns).set({ runtimeMode: "native", nativeIssueId: ids.issue,
        runtimeModeResolvedAt: new Date() }).where(eq(heartbeatRuns.id, ids.reviewerRun))],
      ["a Run resolved to the legacy runtime", ids => db.update(heartbeatRuns).set({ runtimeModeResolvedAt: new Date() })
        .where(eq(heartbeatRuns.id, ids.reviewerRun))],
      ["a legacy Run that names a Native Task", ids => db.update(heartbeatRuns).set({ nativeIssueId: ids.issue })
        .where(eq(heartbeatRuns.id, ids.reviewerRun))],
      ["a context stage that is not the intent's stage", ids => setContext(ids, context => ({ ...context,
        executionStage: { ...ids.executionStage, allowedActions: ["approve"] } }))],
      ["a context stage of another stage", ids => setContext(ids, context => ({ ...context,
        executionStage: { ...ids.executionStage, stageId: randomUUID() } }))],
      ["no context stage", ids => setContext(ids, ({ executionStage: _stage, ...context }) => context)],
      ["a context wake reason of an approval", ids => setContext(ids, context => ({ ...context,
        wakeReason: "execution_approval_requested" }))],
      ["no context wake reason", ids => setContext(ids, ({ wakeReason: _reason, ...context }) => context)],
      // A rendered key never falls back to the context, even before selection.
      ["a rendered wake with no stage", ids => setContext(ids, context => ({ ...context,
        paperclipWake: { reason: "execution_review_requested", executionStage: null } }))],
      ["a rendered wake with another reason", ids => setContext(ids, context => ({ ...context,
        paperclipWake: { reason: "issue_assigned", executionStage: ids.executionStage } }))],
      ["a null rendered wake", ids => setContext(ids, context => ({ ...context, paperclipWake: null }))],
    ];
    for (const [name, change] of unrenderedRefusals) {
      it(`refuses ${name}`, async () => {
        const ids = await bootstrapSeed();
        await expect(owner(ids)).resolves.not.toBeNull();
        await change(ids);
        await expect(owner(ids)).resolves.toBeNull();
      });
    }

    it("refuses an unrendered context for a historical selection", async () => {
      const ids = await bootstrapSeed();
      await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, ids.reviewerRun));
      await expect(owner(ids, { historicalConsumption: { runId: ids.reviewerRun } as never })).resolves.toBeNull();
    });

    it("binds a promoted dispatch receipt of a deferred stage wake to its intent", async () => {
      const ids = await bootstrapSeed();
      const before = await owner(ids);
      await promoteReceipt(ids);
      const promoted = await owner(ids);
      expect(promoted).toMatchObject({ intentId: ids.intent, reason: "execution_review_requested",
        stageHash: before!.stageHash, decisionId: ids.decision });
      await renderAndSelect(ids);
      await expect(owner(ids)).resolves.toEqual(promoted);
    });

    const promotedRefusals: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      ["a promoted receipt keyed to another stage decision", ids => promoteReceipt(ids, `issue.execution_stage:${ids.issue}:${randomUUID()}`)],
      ["a promoted receipt with no key", ids => promoteReceipt(ids, null)],
      ["an unpromoted receipt with a coalesced intent and no Run", ids => db.update(agentWakeupRequests)
        .set({ status: "coalesced", runId: null }).where(eq(agentWakeupRequests.id, ids.intent))],
      ["a receipt with another reason", ids => db.update(agentWakeupRequests).set({ reason: "issue_assigned" })
        .where(eq(agentWakeupRequests.id, ids.delivered))],
      ["a promoted receipt whose intent coalesced into another Run", async ids => {
        await promoteReceipt(ids);
        await db.update(agentWakeupRequests).set({ runId: ids.sourceRun }).where(eq(agentWakeupRequests.id, ids.intent));
      }],
      ["a promoted receipt whose intent is still queued", async ids => {
        await promoteReceipt(ids);
        await db.update(agentWakeupRequests).set({ status: "queued" }).where(eq(agentWakeupRequests.id, ids.intent));
      }],
      ["a promoted receipt whose intent changed reason", async ids => {
        await promoteReceipt(ids);
        await db.update(agentWakeupRequests).set({ reason: "issue_execution_promoted" }).where(eq(agentWakeupRequests.id, ids.intent));
      }],
    ];
    for (const [name, change] of promotedRefusals) {
      it(`refuses ${name}`, async () => {
        const ids = await bootstrapSeed();
        await expect(owner(ids)).resolves.not.toBeNull();
        await change(ids);
        await expect(owner(ids)).resolves.toBeNull();
      });
    }

    it("matches a receipt reason and intent binding only for the intent's own reason or its exact promotion", () => {
      const key = "issue.execution_stage:issue:decision";
      const reason = "execution_review_requested";
      expect(nativeStageDeliveredReasonMatches({ delivered: { reason, idempotencyKey: null }, intent: { idempotencyKey: key }, reason }))
        .toBe(true);
      expect(nativeStageDeliveredReasonMatches({ delivered: { reason: "issue_execution_promoted", idempotencyKey: key },
        intent: { idempotencyKey: key }, reason })).toBe(true);
      for (const delivered of [{ reason: "issue_execution_promoted", idempotencyKey: "other" },
        { reason: "issue_execution_promoted", idempotencyKey: null }, { reason: "issue_assigned", idempotencyKey: key },
        { reason: null, idempotencyKey: key }]) {
        expect(nativeStageDeliveredReasonMatches({ delivered, intent: { idempotencyKey: key }, reason })).toBe(false);
      }
      expect(nativeStageDeliveredReasonMatches({ delivered: { reason: "issue_execution_promoted", idempotencyKey: "" },
        intent: { idempotencyKey: "" }, reason })).toBe(false);
      expect(nativeStageDeliveredReasonMatches({ delivered: { reason: "issue_execution_promoted", idempotencyKey: null },
        intent: { idempotencyKey: null }, reason })).toBe(false);

      const promoted = { reason: "issue_execution_promoted", idempotencyKey: key, runId: "run" };
      const bound = (intent: { status: string; runId: string | null; idempotencyKey: string | null },
        delivered: { reason: string | null; idempotencyKey: string | null; runId: string | null } = promoted) =>
        nativeStageIntentBoundToDeliveredRun({ intent, delivered, runId: "run" });
      expect(bound({ status: "coalesced", runId: "run", idempotencyKey: key }, { ...promoted, reason })).toBe(true);
      expect(bound({ status: "claimed", runId: null, idempotencyKey: key }, { ...promoted, reason })).toBe(true);
      expect(bound({ status: "coalesced", runId: null, idempotencyKey: key })).toBe(true);
      expect(bound({ status: "coalesced", runId: null, idempotencyKey: key }, { ...promoted, reason })).toBe(false);
      expect(bound({ status: "coalesced", runId: null, idempotencyKey: key }, { ...promoted, runId: "other" })).toBe(false);
      expect(bound({ status: "coalesced", runId: null, idempotencyKey: key }, { ...promoted, idempotencyKey: "other" })).toBe(false);
      expect(bound({ status: "coalesced", runId: null, idempotencyKey: null }, { ...promoted, idempotencyKey: null })).toBe(false);
      expect(bound({ status: "coalesced", runId: "other", idempotencyKey: key })).toBe(false);
      expect(bound({ status: "queued", runId: null, idempotencyKey: key })).toBe(false);
      expect(bound({ status: "claimed", runId: "run", idempotencyKey: key })).toBe(false);
    });

    it("captures a stage Task wake only for the Native Run on this Task or its unselected running Run", () => {
      const issueId = randomUUID();
      const unselected = { status: "running", runtimeMode: "legacy", nativeIssueId: null, runtimeModeResolvedAt: null, issueId };
      expect(nativeStageReviewerRunUnselected(unselected)).toBe(true);
      expect(nativeStageReviewerRunCapturable(unselected, issueId)).toBe(true);
      expect(nativeStageReviewerRunCapturable({ ...unselected, runtimeMode: "native", nativeIssueId: issueId,
        runtimeModeResolvedAt: new Date(), status: "succeeded" }, issueId)).toBe(true);
      for (const run of [
        { ...unselected, issueId: randomUUID() },
        { ...unselected, issueId: null },
        { ...unselected, status: "queued" },
        { ...unselected, status: "succeeded" },
        { ...unselected, runtimeModeResolvedAt: new Date() },
        { ...unselected, nativeIssueId: randomUUID() },
        { ...unselected, runtimeMode: "native" },
        { ...unselected, runtimeMode: "native", nativeIssueId: randomUUID() },
      ]) expect(nativeStageReviewerRunCapturable(run, issueId)).toBe(false);
    });
  });
});
