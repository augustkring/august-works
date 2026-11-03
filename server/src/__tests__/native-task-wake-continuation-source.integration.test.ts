import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agentWakeupRequests, companyMemberships, createDb, heartbeatRuns, issueComments, issues, issueThreadInteractions, toolInvocations, toolActionRequests } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { buildExecutionContinuation, type NativeTaskContinuationCapture } from "../services/execution-continuation.js";
import { nativeRuntimeContextFixture } from "../services/native-runtime/runtime-context.test-fixture.js";
import { buildNativeExecutionInput } from "../services/native-runtime/native-execution-input.js";
import { buildNativeBootstrapSourceSet, captureNativeTaskWakeSource, exactNativeTaskContinuation } from "../services/native-runtime/native-execution-input.js";
import { mergeCoalescedContextSnapshot } from "../services/heartbeat.js";
import { assertNativePayloadSourceSetCurrent } from "../services/native-direct-input.js";
import { captureNativeGovernedPendingInteractions, materializeNativeInteractionResponses,
  type NativeGovernedInteractionContinuationCapture } from "../services/native-runtime/native-interaction-bridge.js";
import { commitToolActionReview } from "../services/tool-action-review.js";

// Source-owner component fixtures only. The running row and structural input
// receipt represent a reader scope; they are NOT SDK/provider/Run admission or
// an accepted result. Task/comment snapshots come from actual Human services.
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
beforeAll(async () => {
  database = await startEmbeddedPostgresTestDatabase("native-wake-continuation-owner-");
  db = createDb(database.connectionString);
  await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
}, 60_000);
afterAll(async () => { await database?.cleanup(); });

async function jsonbSha256(value: unknown): Promise<string> {
  const [row] = await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to((${JSON.stringify(value)}::jsonb)::text,'UTF8')),'hex') as digest`);
  if (!row) throw new Error("component_jsonb_digest_missing");
  return row.digest;
}

function buildSourceReaderExecutionInput(input: Pick<Parameters<typeof buildNativeExecutionInput>[0],
  "companyId" | "runId" | "agentId" | "issue" | "taskPrompt" | "wakePayload" | "interactionResponses">) {
  return buildNativeExecutionInput({ ...input,
    workspace: { id: randomUUID(), cwd: "/workspace", repoUrl: null, repoRef: null, branchName: null },
    normalizedSessionId: randomUUID(), provider: "codex",
    completionContract: { id: randomUUID(), sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1",
      contract: { revision: "1", objective: "Produce a bounded task result", criteria: [{ id: "result", requirement: "Return a task result" }] } },
    runtimeContext: nativeRuntimeContextFixture() });
}

async function writeFirstReceipt(input: {
  companyId: string; issueId: string; agentId: string; runId: string; responsibleUserId: string;
  sourceSet: Exclude<ReturnType<typeof buildNativeBootstrapSourceSet>, null>;
  executionInput: ReturnType<typeof buildNativeExecutionInput>; contextSnapshot: Record<string, unknown>;
}) {
  const receiptBody = { version: 1 as const, binding: { companyId: input.companyId, issueId: input.issueId,
    agentId: input.agentId, runId: input.runId, responsibleUserId: input.responsibleUserId },
    bootstrap: { executionInputDigest: await jsonbSha256(input.executionInput), ...input.sourceSet },
    dispatches: [], additionalInputs: [] };
  const receipt = nativeRunInputSourceReceiptSchema.parse({ ...receiptBody, digest: await jsonbSha256(receiptBody) });
  await db.update(heartbeatRuns).set({ contextSnapshot: input.contextSnapshot,
    runnerProfileJson: { nativeExecutionInput: input.executionInput, nativeInputSourceReceipt: receipt } })
    .where(eq(heartbeatRuns.id, input.runId));
  return receipt;
}

async function fixture(otherHumanHistory = false, deferFirstReceipt = false) {
  const f = await seedV5Presences(db), actor = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
  const tasks = issueService(db);
  const task = await tasks.create(f.home, { title: "Source-owner continuation Task", description: "Original Task context",
    status: "todo", assigneeAgentId: f.presence.id, responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
    { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
  if (otherHumanHistory) {
    const otherUserId = `other-human-${randomUUID()}`;
    const otherActor = await seedCurrentHumanSourceActor(db, [f.home], otherUserId);
    await tasks.addComment(task.id, "Earlier readable history from another Human.", { userId: otherUserId },
      { manualInputActor: otherActor, createdAt: "2026-10-01T00:00:00.000Z" });
  }
  const comment = await tasks.addComment(task.id, "The real current Human request.", { userId: f.userId }, { manualInputActor: actor });
  const [wake] = await db.insert(agentWakeupRequests).values({ companyId: f.home, agentId: f.presence.id,
    source: "automation", triggerDetail: "system", reason: "issue_commented", status: "claimed",
    requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: task.id, commentId: comment.id } }).returning();
  if (!wake) throw new Error("component_wake_missing");
  const context = { issueId: task.id, wakeReason: "issue_commented", commentId: comment.id };
  const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, issueId: task.id,
    nativeIssueId: task.id, runtimeMode: "native", status: "running", responsibleUserId: f.userId,
    wakeupRequestId: wake.id, nativeInputSourceProtocolVersion: 1, contextSnapshot: context }).returning();
  if (!run) throw new Error("component_reader_missing");
  await db.update(agentWakeupRequests).set({ runId: run.id }).where(eq(agentWakeupRequests.id, wake.id));
  let selected: NativeTaskContinuationCapture | null = null;
  const envelope = await buildExecutionContinuation({ db, companyId: f.home, issueId: task.id, agentId: f.presence.id,
    runId: run.id, context, summary: null, exposeLowTrustRaw: false,
    onContinuationSourceCapture: capture => { selected = capture; } });
  const capture = selected as NativeTaskContinuationCapture | null;
  if (!capture) throw new Error("component_final_capture_missing");
  const [owner] = await db.select({ task: issues, version: sql<string>`extract(epoch from ${issues.updatedAt})::text`,
    hash: sql<string>`public.aw_native_payload_body_hash('issue',to_jsonb(${issues}))` }).from(issues).where(eq(issues.id, task.id));
  if (!owner) throw new Error("component_task_owner_missing");
  const payload = { reason: "issue_commented", executionContinuation: envelope, attachmentOmissions: [], externalChatProvider: null,
    recovery: null, issue: { id: task.id, identifier: task.identifier, title: task.title, description: task.description,
      descriptionTruncated: false, status: task.status, priority: task.priority, workMode: task.workMode },
    agentMessage: null, childIssueSummaries: [], childIssueSummaryTruncated: false, dispositionRepair: null,
    livenessContinuation: null, interactionKind: null, interactionStatus: null, interactionId: null, sourceRunId: null,
    externalChatQuestionResponse: null, externalInteractionContinuation: false, checkboxSelection: null,
    checkedOutByHarness: false, externalChatExecutionBound: false, simplifiedEnglishInteractions: false,
    dependencyBlockedInteraction: false, treeHoldInteraction: false, activeTreeHold: {}, unresolvedBlockerIssueIds: [],
    unresolvedBlockerSummaries: [], executionStage: null, taskWatchdog: null, skillTest: null, continuationSummary: null,
    commentIds: [], latestCommentId: null, comments: [], annotationDeltas: [], planReviewContext: null, documentReviewContext: null,
    commentWindow: { requestedCount: 0, includedCount: 0, missingCount: 0 }, truncated: false, fallbackFetchNeeded: false };
  const wakeSource = captureNativeTaskWakeSource({ companyId: f.home, issueId: task.id, agentId: f.presence.id, runId: run.id,
    responsibleUserId: f.userId, wakeupRequestId: wake.id, persistedWakeReason: "issue_commented", sourceVersion: owner.version,
    task: { id: task.id, identifier: task.identifier, title: task.title, description: task.description,
      status: task.status, priority: task.priority, workMode: task.workMode }, payload, continuationCapture: capture });
  expect(wakeSource).toBeTruthy(); if (!wakeSource) throw new Error("component_wake_not_closed");
  const markdown = task.title;
  const sourceSet = buildNativeBootstrapSourceSet({ companyId: f.home, issueId: task.id, agentId: f.presence.id, runId: run.id,
    renderedMarkdown: markdown, renderedMarkdownDigest: createHash("sha256").update(markdown).digest("hex"),
    references: [{ kind: "task", id: task.id }], candidates: [{ kind: "task", id: task.id,
      input: { kind: "task", issueId: task.id, sourceVersion: owner.version, contentHash: owner.hash },
      payloadSourceSnapshot: owner.task.payloadSourceSnapshot }], runtimeInputs: [], contextManifestIds: [], rolePackInputs: [],
    unsupportedInputPresent: false,
    taskWakeCommentCandidates: capture.commentSources.map(value => ({ kind: "comment", id: value.input.commentId,
      input: value.input, payloadSourceSnapshot: value.payloadSourceSnapshot })), additionalInputs: [wakeSource] });
  expect(sourceSet).toBeTruthy(); if (!sourceSet) throw new Error("component_source_set_missing");
  // The DB receipt trigger requires the actual typed native execution input.
  // This component-only reader fixture does not create a dispatch intent or
  // claim an accepted model/worker result.
  const executionInput = deferFirstReceipt ? null : buildSourceReaderExecutionInput({ companyId: f.home, runId: run.id, agentId: f.presence.id,
    issue: { id: task.id, identifier: task.identifier, title: task.title, description: task.description, workMode: task.workMode },
    taskPrompt: task.title, wakePayload: payload });
  const receipt = executionInput ? await writeFirstReceipt({ companyId: f.home, issueId: task.id,
    agentId: f.presence.id, runId: run.id, responsibleUserId: f.userId, sourceSet, executionInput,
    contextSnapshot: { ...context, executionContinuation: envelope, paperclipWake: payload } }) : null;
  const reader = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home,
    agentId: f.presence.id, runId: run.id, onBehalfOfUserId: f.userId };
  const validate = () => assertNativePayloadSourceSetCurrent(db, { companyId: f.home, issueId: task.id, runId: run.id,
    actor: reader, ...sourceSet });
  return { f, task, comment, run, wake, envelope, capture, validate, sourceSet, reader, payload, executionInput, receipt };
}

it("captures a real initial Human comment and independently revalidates its selected source rendition", async () => {
  const f = await fixture();
  expect(f.capture.envelope).toEqual(f.envelope);
  expect(f.capture.envelope.originCommentIds).toEqual([f.comment.id]);
  expect(f.capture.envelope.objective).toBe(f.comment.body);
  await expect(f.validate()).resolves.toBeUndefined();
}, 30_000);


it("revalidates the original admitted wake after a status-control wake coalesces into current Run context", async () => {
  const f = await fixture(); await f.validate();
  const [beforeRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
  const [beforeWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wake.id));
  if (!beforeRun || !beforeWake) throw new Error("component_original_wake_missing");
  const context = mergeCoalescedContextSnapshot(beforeRun.contextSnapshot, { issueId: f.task.id,
    taskId: f.task.id, source: "native_status_decision", statusDecisionSource: "native_status_decision",
    wakeReason: "issue_status_changed" });
  await db.update(heartbeatRuns).set({ contextSnapshot: context }).where(eq(heartbeatRuns.id, f.run.id));
  const [current] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
  expect(current?.contextSnapshot).toMatchObject({ wakeReason: "issue_status_changed" });
  expect(current?.contextSnapshot?.paperclipWake).toEqual(beforeRun.contextSnapshot?.paperclipWake);
  expect(current?.runnerProfileJson).toEqual(beforeRun.runnerProfileJson);
  expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wake.id))).toEqual([beforeWake]);
  await expect(f.validate()).resolves.toBeUndefined();
}, 30_000);

it.each(["reason", "missing_run_binding", "foreign_company", "foreign_agent", "foreign_run"] as const)(
  "rejects original admitted wake %s changes despite unchanged sealed payload and input receipt", async mutation => {
    const f = await fixture(); await f.validate();
    const [before] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    if (mutation === "reason") await db.update(agentWakeupRequests).set({ reason: "issue_status_changed" })
      .where(eq(agentWakeupRequests.id, f.wake.id));
    else if (mutation === "missing_run_binding") await db.update(agentWakeupRequests).set({ runId: null })
      .where(eq(agentWakeupRequests.id, f.wake.id));
    else if (mutation === "foreign_company") await db.update(agentWakeupRequests).set({ companyId: f.f.guest })
      .where(eq(agentWakeupRequests.id, f.wake.id));
    else if (mutation === "foreign_agent") await db.update(agentWakeupRequests).set({ agentId: f.f.guestPresence.id })
      .where(eq(agentWakeupRequests.id, f.wake.id));
    else await db.update(agentWakeupRequests).set({ runId: randomUUID() }).where(eq(agentWakeupRequests.id, f.wake.id));
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(after?.contextSnapshot).toEqual(before?.contextSnapshot);
    expect(after?.runnerProfileJson).toEqual(before?.runnerProfileJson);
    await expect(f.validate()).rejects.toBeDefined();
  }, 30_000);

it("retains another legitimate Human's readable history without promoting it to this trigger", async () => {
  const f = await fixture(true);
  expect(f.capture.envelope.messages).toHaveLength(2);
  expect(f.capture.envelope.messages[0]!.authorId).not.toBe(f.f.userId);
  expect(f.capture.envelope.originCommentIds).toEqual([f.comment.id]);
  await expect(f.validate()).resolves.toBeUndefined();
}, 30_000);

it.each(["edit", "delete", "revoke", "forged_wake", "cross_company_wake"] as const)("rejects %s after the original capture", async mutation => {
  const f = await fixture(); await f.validate();
  if (mutation === "edit") await db.update(issueComments).set({ body: "Changed original source" }).where(eq(issueComments.id, f.comment.id));
  else if (mutation === "delete") await db.delete(issueComments).where(eq(issueComments.id, f.comment.id));
  else if (mutation === "revoke") await db.update(companyMemberships).set({ status: "inactive" })
    .where(and(eq(companyMemberships.companyId, f.f.home), eq(companyMemberships.principalId, f.f.userId)));
  else if (mutation === "forged_wake") await db.update(agentWakeupRequests)
    .set({ payload: { issueId: f.task.id, commentId: randomUUID() } }).where(eq(agentWakeupRequests.id, f.wake.id));
  else {
    const [foreignWake] = await db.insert(agentWakeupRequests).values({ companyId: f.f.guest, agentId: f.f.guestPresence.id,
      source: "automation", reason: "issue_commented", requestedByActorType: "user", requestedByActorId: f.f.userId,
      payload: { commentId: f.comment.id } }).returning();
    if (!foreignWake) throw new Error("component_foreign_wake_missing");
    await db.update(heartbeatRuns).set({ wakeupRequestId: foreignWake.id }).where(eq(heartbeatRuns.id, f.run.id));
  }
  await expect(f.validate()).rejects.toBeDefined();
}, 30_000);

// Explicit persisted PENDING domain inputs, never an accepted model/worker/tool
// result. The real source reader and Human review owner consume these rows.
async function pendingFixture(base?: Awaited<ReturnType<typeof fixture>>, deferFirstReceipt = false) {
  const f = base ?? await fixture(false, deferFirstReceipt);
  const [producer] = await db.insert(heartbeatRuns).values({ companyId: f.f.home, agentId: f.f.presence.id,
    issueId: f.task.id, nativeIssueId: f.task.id, runtimeMode: "native", status: "running", responsibleUserId: f.f.userId,
    contextSnapshot: { issueId: f.task.id } }).returning();
  if (!producer) throw new Error("component_pending_producer_missing");
  const invocationId = randomUUID(), requestId = randomUUID(), interactionId = randomUUID(), expiresAt = new Date(Date.now() + 60_000);
  const argsHash = "a".repeat(64);
  await db.insert(toolInvocations).values({ id: invocationId, companyId: f.f.home, issueId: f.task.id,
    agentId: f.f.presence.id, runId: producer.id, toolName: "railway_update_variable", argumentsHash: argsHash,
    status: "awaiting_approval", approvalState: "pending" });
  await db.insert(issueThreadInteractions).values({ id: interactionId, companyId: f.f.home, issueId: f.task.id,
    kind: "request_confirmation", status: "pending", continuationPolicy: "wake_assignee", sourceRunId: producer.id,
    sourceCommentId: f.comment.id, originCommentIds: [f.comment.id], createdByAgentId: f.f.presence.id,
    requestedResolverPolicy: "human_only", effectiveResolverPolicy: "human_only", resolverPolicyProvenance: "explicit",
    effectiveResolverPolicySource: "requested", payload: { version: 1, prompt: "Review the pending action.", toolAction: {
      version: 1, actionRequestId: requestId, invocationId, toolName: "railway_update_variable", toolDisplayName: "Update variable",
      connectionId: null, applicationId: null, appDisplayName: null, risk: "write", previewMarkdown: "Update this exact variable.",
      argumentsSummaryJson: "{}", argumentsHash: argsHash, expiresAt: expiresAt.toISOString() } } });
  await db.insert(toolActionRequests).values({ id: requestId, companyId: f.f.home, issueId: f.task.id,
    invocationId, interactionId, status: "pending", canonicalArgumentsHash: argsHash, canonicalArgumentsSummary: { summary: "Exact pending source-owner component arguments" },
    requestedByAgentId: f.f.presence.id, expiresAt });
  const capture = () => captureNativeGovernedPendingInteractions({ db, companyId: f.f.home, issueId: f.task.id,
    runId: f.run.id, agentId: f.f.presence.id, interactionIds: [interactionId] });
  return { ...f, producer, invocationId, requestId, interactionId, capture };
}

it("binds an unresolved reference to its real pending request, invocation and original Run without granting a response", async () => {
  const f = await pendingFixture(), captures = await f.capture();
  expect(captures).toHaveLength(1);
  expect(captures[0]!.projection).toMatchObject({ interactionId: f.interactionId, sourceRunId: f.producer.id,
    requestStatus: "pending", invocationStatus: "awaiting_approval" });
  expect(captures[0]).not.toHaveProperty("nativeResponse");
  const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.id, f.invocationId));
  expect(invocation?.status).toBe("awaiting_approval"); expect(invocation?.completedAt).toBeNull();
}, 30_000);

it.each(["arguments", "expiry", "deleted", "revoked_reader", "changed_run", "resolved"] as const)("rejects pending owner %s mutations", async mutation => {
  const f = await pendingFixture(); await f.capture();
  if (mutation === "arguments") await db.update(toolActionRequests).set({ canonicalArgumentsHash: "b".repeat(64) }).where(eq(toolActionRequests.id, f.requestId));
  else if (mutation === "expiry") await db.update(toolActionRequests).set({ expiresAt: new Date(0) }).where(eq(toolActionRequests.id, f.requestId));
  else if (mutation === "deleted") await db.delete(toolActionRequests).where(eq(toolActionRequests.id, f.requestId));
  else if (mutation === "revoked_reader") await db.update(companyMemberships).set({ status: "inactive" })
    .where(and(eq(companyMemberships.companyId, f.f.home), eq(companyMemberships.principalId, f.f.userId)));
  else if (mutation === "changed_run") await db.update(toolInvocations).set({ runId: f.run.id }).where(eq(toolInvocations.id, f.invocationId));
  else await commitToolActionReview(db, { companyId: f.f.home, issueId: f.task.id, interactionId: f.interactionId,
    actionRequestId: f.requestId, decision: "rejected", reason: "The actual Human declines.", actor: { userId: f.f.userId } });
  await expect(f.capture()).rejects.toBeDefined();
}, 30_000);

it("captures distinct Native and continuation renditions only after the actual Human decline owner commits", async () => {
  const f = await pendingFixture();
  await commitToolActionReview(db, { companyId: f.f.home, issueId: f.task.id, interactionId: f.interactionId,
    actionRequestId: f.requestId, decision: "rejected", reason: "  Do not perform the action.  ", actor: { userId: f.f.userId } });
  const selected: NativeGovernedInteractionContinuationCapture[] = [];
  const responses = await materializeNativeInteractionResponses({ db, companyId: f.f.home, issueId: f.task.id,
    runId: f.run.id, agentId: f.f.presence.id, interactionIds: [f.interactionId], onContinuationSourceCapture: value => { selected.push(value); } });
  expect(selected).toHaveLength(1);
  expect(selected[0]!.nativeResponse).toEqual(responses[0]);
  expect(responses[0]!.response.result).toMatchObject({ reason: "Do not perform the action." });
  expect(selected[0]!.projection.humanResponse).toMatchObject({ id: f.interactionId, status: "rejected", resolvedByUserId: f.f.userId,
    result: { outcome: "rejected", reason: "  Do not perform the action.  " } });
  expect(selected[0]!.nativeSource.contentHash).not.toBe(selected[0]!.continuationSource.contentHash);
  const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.id, f.invocationId));
  expect(invocation?.status).toBe("denied");
}, 30_000);

it("independently rejects a changed governed rendition after the actual Human decline", async () => {
  const f = await pendingFixture(undefined, true);
  await commitToolActionReview(db, { companyId: f.f.home, issueId: f.task.id, interactionId: f.interactionId,
    actionRequestId: f.requestId, decision: "rejected", actor: { userId: f.f.userId } });
  const selected: NativeGovernedInteractionContinuationCapture[] = [];
  const responses = await materializeNativeInteractionResponses({ db, companyId: f.f.home, issueId: f.task.id,
    runId: f.run.id, agentId: f.f.presence.id, interactionIds: [f.interactionId], onContinuationSourceCapture: value => { selected.push(value); } });
  if (selected.length !== 1) throw new Error("component_governed_source_missing");
  const sourceSet = { policy: f.sourceSet.policy,
    inputs: [...f.sourceSet.inputs, selected[0]!.nativeSource, selected[0]!.continuationSource] };
  const executionInput = buildSourceReaderExecutionInput({ companyId: f.f.home, runId: f.run.id, agentId: f.f.presence.id,
    issue: { id: f.task.id, identifier: f.task.identifier, title: f.task.title, description: f.task.description, workMode: f.task.workMode },
    taskPrompt: f.task.title, wakePayload: f.payload, interactionResponses: responses });
  await writeFirstReceipt({ companyId: f.f.home, issueId: f.task.id, agentId: f.f.presence.id, runId: f.run.id,
    responsibleUserId: f.f.userId, sourceSet, executionInput,
    contextSnapshot: { issueId: f.task.id, wakeReason: "issue_commented", commentId: f.comment.id,
      executionContinuation: f.envelope, paperclipWake: f.payload } });
  const validate = () => assertNativePayloadSourceSetCurrent(db, { companyId: f.f.home, issueId: f.task.id,
    runId: f.run.id, actor: f.reader, ...sourceSet });
  await expect(validate()).resolves.toBeUndefined();
  await db.update(toolActionRequests).set({ canonicalArgumentsHash: "b".repeat(64) }).where(eq(toolActionRequests.id, f.requestId));
  await expect(validate()).rejects.toBeDefined();
}, 30_000);

it("assembles a real pending-note continuation and revalidates its unresolved owner through the complete source reader", async () => {
  const f = await pendingFixture(undefined, true);
  let captured: NativeTaskContinuationCapture | null = null;
  const envelope = await buildExecutionContinuation({ db, companyId: f.f.home, issueId: f.task.id, agentId: f.f.presence.id,
    runId: f.run.id, context: { issueId: f.task.id, wakeReason: "issue_commented", commentId: f.comment.id },
    summary: null, exposeLowTrustRaw: false, onContinuationSourceCapture: value => { captured = value; } });
  const capture = captured as NativeTaskContinuationCapture | null;
  if (!capture) throw new Error("component_pending_capture_missing");
  expect(envelope.unresolvedInteractionIds).toEqual([f.interactionId]);
  expect(envelope.humanResponses).toEqual([]); expect(envelope.interactionOutcomes).toEqual([]);
  expect(exactNativeTaskContinuation({ value: envelope, companyId: f.f.home, issueId: f.task.id, runId: f.run.id,
    agentId: f.f.presence.id, responsibleUserId: f.f.userId, wakeupRequestId: f.wake.id,
    wakeReason: "issue_commented", capture })).toBe(capture);
  const taskInput = f.sourceSet.inputs.find(source => source.kind === "task" && source.issueId === f.task.id);
  if (!taskInput || taskInput.kind !== "task") throw new Error("component_pending_task_source_missing");
  const payload = { ...f.payload, executionContinuation: envelope };
  const wake = captureNativeTaskWakeSource({ companyId: f.f.home, issueId: f.task.id, runId: f.run.id,
    agentId: f.f.presence.id, responsibleUserId: f.f.userId, wakeupRequestId: f.wake.id,
    persistedWakeReason: "issue_commented", sourceVersion: taskInput.sourceVersion, continuationCapture: capture,
    task: { id: f.task.id, identifier: f.task.identifier, title: f.task.title, description: f.task.description,
      status: f.task.status, priority: f.task.priority, workMode: f.task.workMode }, payload });
  if (!wake || !capture.pendingInteractions?.length) throw new Error("component_pending_wake_not_closed");
  const sourceSet = { policy: f.sourceSet.policy,
    inputs: [...f.sourceSet.inputs.filter(source => source.kind !== "native_task_wake"), ...capture.pendingInteractions.map(value => value.source), wake] };
  const executionInput = buildSourceReaderExecutionInput({ companyId: f.f.home, runId: f.run.id, agentId: f.f.presence.id,
    issue: { id: f.task.id, identifier: f.task.identifier, title: f.task.title, description: f.task.description, workMode: f.task.workMode },
    taskPrompt: f.task.title, wakePayload: payload });
  await writeFirstReceipt({ companyId: f.f.home, issueId: f.task.id, agentId: f.f.presence.id, runId: f.run.id,
    responsibleUserId: f.f.userId, sourceSet, executionInput,
    contextSnapshot: { issueId: f.task.id, wakeReason: "issue_commented", commentId: f.comment.id,
      executionContinuation: envelope, paperclipWake: payload } });
  const validate = () => assertNativePayloadSourceSetCurrent(db, { companyId: f.f.home, issueId: f.task.id,
    runId: f.run.id, actor: f.reader, ...sourceSet });
  await expect(validate()).resolves.toBeUndefined();
  await db.update(toolActionRequests).set({ expiresAt: new Date(0) }).where(eq(toolActionRequests.id, f.requestId));
  await expect(validate()).rejects.toBeDefined();
}, 30_000);

// Live domain-owner coverage only: no accepted parent receipt/SDK row is seeded.
it("retains an unchanged live pending sibling when a Human resolves the other governed request", async () => {
  const a = await pendingFixture(), b = await pendingFixture(a);
  const before = await b.capture();
  await commitToolActionReview(db, { companyId:a.f.home,issueId:a.task.id,interactionId:a.interactionId,
    actionRequestId:a.requestId,decision:"rejected",actor:{userId:a.f.userId} });
  const terminal: NativeGovernedInteractionContinuationCapture[] = [];
  await materializeNativeInteractionResponses({db,companyId:a.f.home,issueId:a.task.id,runId:a.run.id,
    agentId:a.f.presence.id,interactionIds:[a.interactionId],onContinuationSourceCapture:value=>{terminal.push(value);}});
  expect(terminal).toHaveLength(1);
  expect(await b.capture()).toEqual(before);
  await expect(a.capture()).rejects.toBeDefined();
  const [untouched] = await db.select().from(toolInvocations).where(eq(toolInvocations.id,b.invocationId));
  expect(untouched?.status).toBe("awaiting_approval");expect(untouched?.completedAt).toBeNull();
},30_000);
