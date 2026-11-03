import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agentWakeupRequests, companyMemberships, createDb, heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { buildExecutionContinuation, type NativeTaskContinuationCapture } from "../services/execution-continuation.js";
import { buildNativeBootstrapSourceSet, captureNativeTaskWakeSource } from "../services/native-runtime/native-execution-input.js";
import { assertNativePayloadSourceSetCurrent } from "../services/native-direct-input.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";

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

async function fixture(otherHumanHistory = false) {
  const f = await seedV5Presences(db), actor = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
  const tasks = issueService(db);
  const task = await tasks.create(f.home, { title: "Source-owner continuation Task", description: "Original Task context",
    status: "in_progress", assigneeAgentId: f.presence.id, responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
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
    wakeupRequestId: wake.id, contextSnapshot: context }).returning();
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
  const receiptBody = { version: 1 as const, binding: { companyId: f.home, issueId: task.id, agentId: f.presence.id,
    runId: run.id, responsibleUserId: f.userId }, bootstrap: { executionInputDigest: nativeSha256({ componentReader: run.id }), ...sourceSet },
    dispatches: [], additionalInputs: [] };
  const receipt = nativeRunInputSourceReceiptSchema.parse({ ...receiptBody, digest: nativeSha256(receiptBody) });
  await db.update(heartbeatRuns).set({ contextSnapshot: { ...context, executionContinuation: envelope, paperclipWake: payload },
    runnerProfileJson: { nativeInputSourceReceipt: receipt } }).where(eq(heartbeatRuns.id, run.id));
  const reader = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home,
    agentId: f.presence.id, runId: run.id, onBehalfOfUserId: f.userId };
  const validate = () => assertNativePayloadSourceSetCurrent(db, { companyId: f.home, issueId: task.id, runId: run.id,
    actor: reader, ...sourceSet });
  return { f, task, comment, run, wake, envelope, capture, validate };
}

it("captures a real initial Human comment and independently revalidates its selected source rendition", async () => {
  const f = await fixture();
  expect(f.capture.envelope).toEqual(f.envelope);
  expect(f.capture.envelope.originCommentIds).toEqual([f.comment.id]);
  expect(f.capture.envelope.objective).toBe(f.comment.body);
  await expect(f.validate()).resolves.toBeUndefined();
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
