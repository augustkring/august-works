import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, agents, agentRuntimeState, agentExecutionManifests, agentWakeupRequests, createDb, documentRevisions, documents, heartbeatRuns, issueDocuments, issues, issueRecoveryActions,
  nativeRunFinalizations, nativeRunResults, orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts, toolInvocations, issueTreeHolds, issueComments, companyMemberships, issueThreadInteractions, executionWorkspaces, workspaceOperations, heartbeatRunEvents } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { prepareGenuineNativeDraftConformanceFixture } from "./helpers/prepare-genuine-native-draft-conformance-fixture.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { projectRoutes } from "../routes/projects.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workerModelGateway } from "../services/orchestration/worker-model-gateway.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { registerNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { issueService } from "../services/issues.js";
import { attentionService } from "../services/attention.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { accessService } from "../services/access.js";
import { documentService } from "../services/documents.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { assertNativeDocumentRevisionCurrentSourceAccess, assertNativePayloadSourceSetCurrent } from "../services/native-direct-input.js";
import { captureNativeExplicitHumanSource } from "../services/execution-continuation.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { issueTreeControlService } from "../services/issue-tree-control.js";
import { heartbeatService, nativeExecutionFailureLogFields } from "../services/heartbeat.js";
import { issueRecoveryActionService } from "../services/issue-recovery-actions.js";
import { agentPauseService } from "../services/experience/agent-pause.js";
import {
  CHAT_CONTROL_RECOVERY_ADMISSION_KEY,
  CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE,
  chatControlRecoveryAdmission,
  readChatControlRecoveryAdmission,
} from "../services/chat-control-recovery-stop.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { createRunSecretRedactionRegistry } from "../services/run-secret-redaction.js";
import { REDACTED_EVENT_VALUE } from "../redaction.js";
import { nativeCommentProjectionHash, nativeSha256 } from "../services/native-runtime/canonical.js";
import { parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";

// This is the installed one-call text controller's software transport fixture,
// copied from v7-worker-model-gateway's actual-heartbeat case. It does not
// qualify OpenCode, an external provider, or a physical Sandbox Host.
const execFileAsync = promisify(execFile);
const sourceSha = "a".repeat(40);
const credential = "fixture-private-worker-secret-12345";
const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) throw new Error(`Dependency draft fixture requires embedded PostgreSQL: ${support.reason}`);

async function makeWritable(target: string): Promise<void> {
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory()) for (const name of await readdir(target)) await makeWritable(join(target, name));
}

describe("dependency scheduling through the installed Native text draft controller", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home = "";
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "dependency-native-draft-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "dependency-native-draft");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "private-fixture-signing-master-123456789");
    database = await startEmbeddedPostgresTestDatabase("dependency-native-draft-");
    db = createDb(database.connectionString, { maxConnections: 3 });
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableNativeRunner: true, enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true });
  }, 60_000);
  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (home) { await makeWritable(home); await rm(home, { recursive: true, force: true }); }
  });

  async function seedInstalledDraft() {
    const f = await seedV5Presences(db);
    const qualified = await prepareGenuineNativeDraftConformanceFixture({ db, f, sourceSha,
      credential, model: "fixture-worker-model-20261005" });
    await db.update(agents).set({
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    }).where(eq(agents.id, f.presence.id));
    return { f, human: qualified.currentHuman, profile: qualified.primaryProfile, model: qualified.model,
      conformanceRunIds: qualified.conformanceRunIds };
  }

  async function assertFirstBootstrapSourceCase(redactSecret: boolean) {
    const fixture = await seedInstalledDraft();
    const { f } = fixture;
    let taskId = "", planId = "", planDocumentId = "", planRevisionId = "", questionId = "", commentId = "", deletedCommentId = "";
    let questionVersion = "", commentCreatedAt = "", commentUpdatedAt = "";
    const secret = "fixture-inline-secret-value";
    const commentBody = `Original native inline wake comment${redactSecret ? ` ${secret}` : ""}`;
    const answerText = `Continue with the current request${redactSecret ? ` ${secret}` : ""}`;
    const delivered = (value: string) => redactSecret ? value.replace(secret, REDACTED_EVENT_VALUE) : value;
    let providerFetchCalls = 0;
    let reachedDispatch = false;
    let cancellation: Promise<unknown> | null = null;
    let cancellationError: unknown;
    let sourceAssertionError: unknown;
    const observedDispatch: { value: { profile: Record<string, unknown>; taskVersion: string; taskOwnerHash: string;
      taskPayloadSourceSnapshot: unknown; taskPayloadSourceSnapshotDigestValid: boolean | null;
      planPayloadSourceSnapshot: unknown; commentPayloadSourceSnapshot: unknown; commentVersion: string } | null } = { value: null };
    let releaseDispatch!: () => void;
    const dispatchGate = new Promise<void>(resolve => { releaseDispatch = resolve; });
    const nativeFetch: typeof guardedRemoteHttpFetch = async () => {
      providerFetchCalls++;
      throw new Error("First-bootstrap source test must stop before provider HTTP dispatch");
    };

    await withInstalledDraftTransport(fixture, nativeFetch, async heartbeat => {
      try {
        const { task, plan } = await createDraftPlan(fixture, "First-bootstrap source capture");
        taskId = task.id; planId = plan.id;
        const planDocument = await documentService(db).upsertIssueDocument({ issueId: taskId, key: "plan",
          format: "markdown", body: "Original native bootstrap plan", createdByUserId: f.userId, manualInputActor: fixture.human });
        if (!planDocument.document.latestRevisionId) throw new Error("first_bootstrap_plan_revision_missing");
        planDocumentId = planDocument.document.id; planRevisionId = planDocument.document.latestRevisionId;
        const interactionService = issueThreadInteractionService(db);
        const pending = await interactionService.create({ id: taskId, companyId: f.home }, {
          kind: "ask_user_questions", continuationPolicy: "wake_assignee",
          payload: { version: 1, questions: [{ id: "direction", prompt: "Which direction?", selectionMode: "single",
            options: [{ id: "continue", label: "Continue", freeText: true }] }] },
        }, { userId: f.userId, requestActor: fixture.human });
        const interaction = await interactionService.answerQuestions({ id: taskId, companyId: f.home, status: task.status }, pending.id,
          { answers: [{ questionId: "direction", optionIds: ["continue"], otherText: answerText }] },
          { userId: f.userId, requestActor: fixture.human });
        questionId = interaction.id;
        questionVersion = await db.select({ version: sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text` })
          .from(issueThreadInteractions).where(eq(issueThreadInteractions.id, questionId)).then(rows => rows[0]!.version);
        const deletedBody = "Deleted continuation body must stay absent";
        const [deletedComment] = await db.insert(issueComments).values({ companyId: f.home, issueId: taskId, body: deletedBody,
          authorUserId: f.userId, deletedAt: new Date() }).returning({ id: issueComments.id });
        deletedCommentId = deletedComment!.id;
        const comment = await issueService(db).addComment(taskId, commentBody, { userId: f.userId },
          { authorType: "user", manualInputActor: fixture.human, clientRequestId: randomUUID() });
        commentId = comment.id;
        commentCreatedAt = comment.createdAt.toISOString(); commentUpdatedAt = comment.updatedAt.toISOString();
        const runId = (await heartbeat.wakeup(f.presence.id, { source: "automation", triggerDetail: "system",
          reason: "issue_commented", requestedByActorType: "user", requestedByActorId: f.userId,
          payload: { issueId: taskId, commentId, mutation: "interaction", interactionId: questionId,
            interactionKind: "ask_user_questions", interactionStatus: "answered", sourceCommentId: null, sourceRunId: null },
          idempotencyKey: `interaction:${questionId}:answered`, allowRunCoalescing: false,
          contextSnapshot: { issueId: taskId, taskId,
            wakeReason: "issue_commented", wakeCommentId: commentId, wakeCommentIds: [commentId],
            interactionId: questionId, interactionKind: "ask_user_questions", interactionStatus: "answered" } }))?.id;
        if (!runId) throw new Error("first_bootstrap_wake_missing");
        try {
          await vi.waitFor(() => { expect(observedDispatch.value).not.toBeNull(); }, { timeout: 60_000, interval: 25 });
        } catch {
          throw new Error("first_bootstrap_dispatch_gate_not_reached");
        }
        const capturedDispatch = observedDispatch.value;
        if (!capturedDispatch) throw new Error("first_bootstrap_dispatch_capture_missing");
        try {
          const profile = capturedDispatch.profile;
          const selectedInput = parseNativeExecutionInput(profile.nativeExecutionInput);
          const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
          expect(run).toMatchObject({ id: runId, status: "running", runtimeMode: "native", nativeIssueId: taskId,
            responsibleUserId: f.userId });
          expect(run!.wakeupRequestId).toBeTruthy();
          const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, planId));
          expect(attempts).toHaveLength(1);
          expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id, planId });
          expect(attempts[0]!.executionManifestId).toBeTruthy();
          const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId));
          expect(manifests).toHaveLength(1);
          expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
          expect(profile.nativeBootstrapAuthoredSources).toEqual({ inputs: [
            { kind: "runtime_instructions", agentId: f.presence.id,
              bundleDigest: selectedInput.runtimeContext.instructions.bundle.digest,
              manifestDigest: selectedInput.runtimeContext.instructions.bundle.manifestDigest },
            ...selectedInput.runtimeContext.skills.map(skill => ({ kind: "runtime_skill" as const,
              key: skill.key, versionId: skill.versionId, bundleDigest: skill.bundle.digest,
              manifestDigest: skill.bundle.manifestDigest })),
          ], contextManifests: [] });
          expect(profile.nativeBootstrapRolePackSources).toEqual([]);
          const taskPayloadSourceSnapshot = nativePayloadSourceSnapshotSchema.parse(capturedDispatch.taskPayloadSourceSnapshot);
          expect(taskPayloadSourceSnapshot.owner).toMatchObject({ kind: "issue", companyId: f.home,
            id: taskId, contentHash: capturedDispatch.taskOwnerHash });
          expect(taskPayloadSourceSnapshot.digest).toMatch(/^[a-f0-9]{64}$/);
          expect(capturedDispatch.taskPayloadSourceSnapshotDigestValid).toBe(true);
          expect(profile.nativeBootstrapTaskSource).toEqual({ input: { kind: "task", issueId: taskId,
            sourceVersion: capturedDispatch.taskVersion, contentHash: capturedDispatch.taskOwnerHash },
            payloadSourceSnapshot: taskPayloadSourceSnapshot });
          const planPayloadSourceSnapshot = nativePayloadSourceSnapshotSchema.parse(capturedDispatch.planPayloadSourceSnapshot);
          expect(planPayloadSourceSnapshot.owner).toMatchObject({ kind: "document_revision", companyId: f.home, id: planRevisionId });
          expect(profile.nativeBootstrapTaskPlanSources).toEqual([{ input: { kind: "document_revision", documentId: planDocumentId,
            revisionId: planRevisionId, issueId: taskId,
            contentHash: createHash("sha256").update("Original native bootstrap plan").digest("hex") }, payloadSourceSnapshot: planPayloadSourceSnapshot }]);
          expect(profile.nativeBootstrapPlanningSources).toEqual([]);
          const commentPayloadSourceSnapshot = nativePayloadSourceSnapshotSchema.parse(capturedDispatch.commentPayloadSourceSnapshot);
          expect(commentPayloadSourceSnapshot.owner).toMatchObject({ kind: "comment", companyId: f.home, id: commentId });
          const expectedCommentSource = { input: { kind: "comment", issueId: taskId, commentId: commentId,
            sourceVersion: capturedDispatch.commentVersion,
            contentHash: nativeCommentProjectionHash({ body: delivered(commentBody), presentation: null, metadata: null }) },
            payloadSourceSnapshot: commentPayloadSourceSnapshot };
          expect(profile.nativeBootstrapInlineWakeCommentSources).toEqual([expectedCommentSource]);
          expect(profile.nativeBootstrapWakeCommentSources).toEqual({ request: expectedCommentSource, context: expectedCommentSource });
          expect(profile.nativeBootstrapContinuationCommentSources).toEqual([{
            ...expectedCommentSource,
            input: { ...expectedCommentSource.input, contentHash: nativeSha256({
              id: commentId, authorType: "user", authorId: f.userId, createdByRunId: null,
              body: delivered(commentBody), createdAt: commentCreatedAt,
              updatedAt: commentUpdatedAt, deleted: false, sourceTrust: null,
            }) },
          }]);
          expect(selectedInput).toMatchObject({ interactionResponses: [{ interactionId: questionId,
            kind: "ask_user_questions", response: { status: "answered", result: { answers: [{ questionId: "direction",
              optionIds: ["continue"], otherText: delivered(answerText) }] } } }] });
          expect(profile.nativeBootstrapInteractionSources).toEqual([{ kind: "interaction", issueId: taskId,
            interactionId: questionId, sourceVersion: questionVersion,
            contentHash: nativeSha256(selectedInput.interactionResponses[0]) }]);
          expect(JSON.stringify(selectedInput)).not.toContain(deletedBody);
          expect(JSON.stringify(selectedInput)).not.toContain(deletedCommentId);
          expect(JSON.stringify(selectedInput)).toContain(delivered(commentBody));
          if (redactSecret) expect(JSON.stringify(selectedInput)).not.toContain(secret);
          expect(JSON.stringify(selectedInput)).toContain("Original native bootstrap plan");
        } catch (error) {
          sourceAssertionError = error;
        }

        let requested = false;
        try {
          cancellation = heartbeat.cancelRun(runId).catch(error => { cancellationError = error; });
          requested = await vi.waitFor(async () => {
            const [current] = await db.select({ resultJson: heartbeatRuns.resultJson })
              .from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
            const result = current?.resultJson as Record<string, unknown> | null | undefined;
            const state = (result?.executionCancellation as Record<string, unknown> | undefined)?.state;
            const startupRequestedAt = (result?.startupCancellation as Record<string, unknown> | undefined)?.requestedAt;
            if (state === "requested" || typeof startupRequestedAt === "string") return true;
            throw new Error("first_bootstrap_cancellation_not_requested");
          }, { timeout: 10_000, interval: 25 });
          if (requested) {
            await issueService(db).update(taskId, { title: "Later Task title", actorUserId: f.userId,
              privacyActor: fixture.human, companyGuard: f.home });
            await documentService(db).upsertIssueDocument({ issueId: taskId, key: "plan", format: "markdown",
              body: "Later plan revision", baseRevisionId: planRevisionId });
            await issueService(db).tombstoneComment(commentId, { actorType: "user", userId: f.userId });
            await db.update(issueThreadInteractions).set({ title: "Later question title", updatedAt: new Date() })
              .where(eq(issueThreadInteractions.id, questionId));
          }
          const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
          expect(after!.runnerProfileJson).toEqual(capturedDispatch.profile);
        } finally {
          releaseDispatch();
        }
        await heartbeat.drainActiveRunExecutions();
        await cancellation;
        expect(cancellationError).toBeUndefined();
        expect(requested).toBe(true);
        expect(reachedDispatch).toBe(true);
        expect(providerFetchCalls).toBe(0);
        const finalRun = await heartbeat.getRun(runId);
        expect({ status: finalRun?.status, runtimeMode: finalRun?.runtimeMode })
          .toMatchObject({ status: "cancelled", runtimeMode: "native" });
        expect((finalRun?.resultJson as Record<string, unknown> | null)?.startupPreparationSettledAt).toEqual(expect.any(String));
        if (sourceAssertionError) throw sourceAssertionError;
      } finally { releaseDispatch(); }
    }, async ({ runId, issueId, stage }) => {
      if (stage === "claim" && redactSecret)
        await createRunSecretRedactionRegistry(db).register(f.home, runId, secret);
      if (stage !== "dispatch") return;
      reachedDispatch = true;
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      const [taskVersion] = await db.execute<{ version: string; ownerHash: string; snapshot: unknown; digestValid: boolean | null }>(sql`select
        extract(epoch from i.updated_at)::text as version,
        public.aw_native_payload_body_hash('issue',to_jsonb(i)) as "ownerHash",
        i.payload_source_snapshot as snapshot,
        (i.payload_source_snapshot->>'digest') = encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as "digestValid"
        from issues i where i.id=${issueId}::uuid`);
      const [planOwner] = await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
        .from(documentRevisions).where(eq(documentRevisions.id, planRevisionId));
      const [commentVersion] = await db.execute<{ version: string; snapshot: unknown }>(sql`select
        extract(epoch from updated_at)::text as version, payload_source_snapshot as snapshot
        from issue_comments where id=${commentId}::uuid`);
      observedDispatch.value = { profile: structuredClone(run!.runnerProfileJson as Record<string, unknown>),
        taskVersion: taskVersion!.version, taskOwnerHash: taskVersion!.ownerHash,
        taskPayloadSourceSnapshot: taskVersion!.snapshot, taskPayloadSourceSnapshotDigestValid: taskVersion!.digestValid,
        planPayloadSourceSnapshot: planOwner!.payloadSourceSnapshot, commentPayloadSourceSnapshot: commentVersion!.snapshot,
        commentVersion: commentVersion!.version };
      await dispatchGate;
    });
    expect(providerFetchCalls).toBe(0);
  }

  it("captures first-bootstrap Task, plan, and wake sources without secret redaction before provider dispatch", async () => {
    await assertFirstBootstrapSourceCase(false);
  }, 60_000);

  it("captures first-bootstrap Task, plan, and wake sources with secret redaction before provider dispatch", async () => {
    await assertFirstBootstrapSourceCase(true);
  }, 60_000);

  it("holds a completed Native Text result for canonical Human Plan verification", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    const output = "A retained Native Text result awaiting Human verification.";
    let calls = 0;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      expect(++calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      expect(String(init.body)).not.toContain(credential);
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const entry = await createDraftPlan(fixture, "Hold completed Native Text output for Human verification");
      const wake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id }, contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" } });
      if (!wake) throw new Error("human_verification_native_text_wake_missing");
      await heartbeat.drainActiveRunExecutions();
      expect(calls).toBe(1);
      await assertCompletedDraft(fixture, entry, wake.id, output);
      const [awaitingHuman] = await db.select({ status: issues.status }).from(issues)
        .where(and(eq(issues.companyId, f.home), eq(issues.id, entry.task.id)));
      expect(awaitingHuman?.status).toBe("in_review");
      const settings = instanceSettingsService(db), priorFeatures = await settings.getExperimental();
      try {
        await settings.updateExperimental({ supervision_v7: true, verifier_v7: true });
        const verifier = verificationService(db), packet = await verifier.packet(fixture.human, f.home, entry.plan.id);
        expect(packet.deterministicFailures).toEqual([]);
        expect(packet.policy.workerSelfCertification).toBe(false);
        const evidenceRefs = packet.evidence.map(item => item.ref);
        const review = await verifier.review(fixture.human, f.home, entry.plan.id, {
          expectedPlanVersion: packet.planVersion, workerId: packet.workerId, expectedResultHash: packet.resultHash,
          result: "pass", rationale: "The Human reviewed the retained Native Text result against the current Plan contract.",
          objectiveSatisfied: true,
          businessInvariants: packet.contract.businessInvariants.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
          evidenceRequirements: packet.contract.evidenceRequirements.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
          prohibitedOutcomes: packet.contract.prohibitedOutcomes.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
        });
        expect(review).toMatchObject({ reviewerType: "human", result: "pass" });
        expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, entry.plan.id)))[0]?.status)
          .toBe("completed");
        expect((await db.select().from(issues).where(eq(issues.id, entry.task.id)))[0]?.status).toBe("done");
      } finally {
        await settings.updateExperimental({ supervision_v7: priorFeatures.supervision_v7, verifier_v7: priorFeatures.verifier_v7 });
      }
    });
  }, 60_000);

  it("continues once after a Human withdraws the last review interaction, then creates a fresh review path", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model, human } = fixture;
    const outputs = [
      "Initial internal draft retained for Human review.",
      "One bounded review-path recovery draft retained for Human review.",
    ];
    let calls = 0;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const index = ++calls - 1;
      expect(index).toBeLessThan(outputs.length);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: outputs[index] }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const entry = await createDraftPlan(fixture, "Recover the lost review path once", undefined, undefined,
        { maxModelCostMinor: 9, maxToolActions: 5 });
      const initial = await heartbeat.wakeup(f.presence.id, {
        source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        payload: { issueId: entry.task.id },
        requestedByActorType: "user", requestedByActorId: f.userId,
        contextSnapshot: { issueId: entry.task.id, taskId: entry.task.id, wakeReason: "issue_assigned" },
      });
      expect(initial).not.toBeNull();
      if (!initial) throw new Error("native_review_path_source_run_missing");
      await heartbeat.drainActiveRunExecutions();

      const [sourceRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, initial.id));
      expect(sourceRun).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: entry.task.id });
      const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, entry.task.id));
      expect(sourceIssue?.status).toBe("in_review");
      if (!sourceIssue) throw new Error("native_review_path_source_issue_missing");
      const sourceAttention = (await issueService(db).listReviewAttention(f.home, [sourceIssue]))
        .get(entry.task.id) ?? { state: "none", paths: [], reason: null };
      expect(sourceAttention.state).not.toBe("stalled");
      expect(sourceAttention.paths.map(path => path.kind)).toContain("interaction");
      const pendingInteractions = await db.select({ id: issueThreadInteractions.id, kind: issueThreadInteractions.kind,
        status: issueThreadInteractions.status }).from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, f.home), eq(issueThreadInteractions.issueId, entry.task.id),
        eq(issueThreadInteractions.status, "pending")));
      expect(pendingInteractions).toHaveLength(1);
      const pendingInteraction = pendingInteractions[0]!;
      if (human.type !== "board" || human.source !== "session" || !human.sessionId)
        throw new Error("native_review_recovery_requires_current_human_session");
      const interactionRoutes = express();
      interactionRoutes.use(express.json());
      interactionRoutes.use((req, _res, next) => {
        req.actor = { type: "board", source: "session", userId: f.userId, sessionId: human.sessionId, companyIds: [f.home],
          memberships: [{ companyId: f.home, membershipRole: "owner", status: "active" }] };
        next();
      });
      interactionRoutes.use("/api", issueRoutes(db, {} as never, { heartbeat }));
      interactionRoutes.use(errorHandler);
      if (pendingInteraction.kind === "ask_user_questions") {
        await request(interactionRoutes).post(`/api/issues/${entry.task.id}/interactions/${pendingInteraction.id}/cancel`)
          .send({ reason: "Human withdrew the pending question before lost-path recovery." }).expect(200);
      } else {
        expect(["request_confirmation", "request_checkbox_confirmation"]).toContain(pendingInteraction.kind);
        await request(interactionRoutes).post(`/api/issues/${entry.task.id}/interactions/${pendingInteraction.id}/reject`)
          .send({ reason: "Human requests changes before bounded review continuation." }).expect(200);
      }
      const interactionWakes = await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, f.home), eq(agentWakeupRequests.agentId, f.presence.id),
        eq(agentWakeupRequests.reason, "issue_commented"),
        sql`${agentWakeupRequests.payload}->>'interactionId' = ${pendingInteraction.id}`));
      expect(interactionWakes).toHaveLength(1);
      expect(interactionWakes[0]).toMatchObject({ requestedByActorType: "user", requestedByActorId: f.userId,
        payload: expect.objectContaining({ issueId: entry.task.id, interactionId: pendingInteraction.id }) });
      const [resolvedInteraction] = await db.select({ kind: issueThreadInteractions.kind,
        status: issueThreadInteractions.status, result: issueThreadInteractions.result,
        resolvedByUserId: issueThreadInteractions.resolvedByUserId }).from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, f.home), eq(issueThreadInteractions.issueId, entry.task.id),
        eq(issueThreadInteractions.id, pendingInteraction.id)));
      expect(resolvedInteraction).toMatchObject({ resolvedByUserId: f.userId });
      expect(resolvedInteraction?.status).toBe(pendingInteraction.kind === "ask_user_questions" ? "cancelled" : "rejected");
      if (pendingInteraction.kind === "ask_user_questions") expect((resolvedInteraction?.result as { cancelled?: boolean } | null)?.cancelled).toBe(true);
      else expect((resolvedInteraction?.result as { outcome?: string } | null)?.outcome).toBe("rejected");
      await heartbeat.drainActiveRunExecutions();
      const [interactionWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, interactionWakes[0]!.id));
      expect(interactionWake?.status).toBe("completed");
      expect(calls).toBe(2);
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home),
        notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      expect(runs).toHaveLength(2);
      expect(runs.map(run => ({ status: run.status, runtimeMode: run.runtimeMode }))).toEqual([
        { status: "succeeded", runtimeMode: "native" }, { status: "succeeded", runtimeMode: "native" },
      ]);
      // The installed AWText controller settles in-process and owns no OS process.
      // The retained-run projection must therefore close from its own settled event,
      // while never recording process-start or fabricated local-stop evidence.
      expect(runs.every(run => run.nativeProcessCleanupPending === false &&
        run.processPid === null && run.processGroupId === null)).toBe(true);
      const lifecycleEvents = await db.select({ runId: heartbeatRunEvents.runId, seq: heartbeatRunEvents.seq,
        eventType: heartbeatRunEvents.eventType, payload: heartbeatRunEvents.payload })
        .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, f.home),
          inArray(heartbeatRunEvents.runId, runs.map(run => run.id))));
      expect(lifecycleEvents.filter(event => event.eventType === "native.in_process_backend_admitted")).toHaveLength(2);
      const admittedByRun = new Map(lifecycleEvents.filter(event => event.eventType === "native.in_process_backend_admitted")
        .map(event => [event.runId, event.seq]));
      const settledEvents = lifecycleEvents.filter(event => event.eventType === "native.in_process_backend_settled");
      expect(settledEvents).toHaveLength(2);
      expect(settledEvents.every(event => (event.payload as { admissionEventSeq?: number }).admissionEventSeq === admittedByRun.get(event.runId))).toBe(true);
      expect(lifecycleEvents.some(event => event.eventType === "native.process_start_requested" ||
        event.eventType === "native.local_process_stopped")).toBe(false);
      expect(interactionWake?.runId).toBeTruthy();
      expect(interactionWake?.runId).not.toBe(initial.id);
      const freshReviewInteractions = await db.select({ id: issueThreadInteractions.id, kind: issueThreadInteractions.kind,
        status: issueThreadInteractions.status, sourceRunId: issueThreadInteractions.sourceRunId }).from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, f.home), eq(issueThreadInteractions.issueId, entry.task.id),
        eq(issueThreadInteractions.status, "pending")));
      expect(freshReviewInteractions).toHaveLength(1);
      const freshReviewInteraction = freshReviewInteractions[0]!;
      expect(freshReviewInteraction).toMatchObject({ kind: "request_confirmation", status: "pending", sourceRunId: interactionWake!.runId });
      expect(freshReviewInteraction.id).not.toBe(pendingInteraction.id);
      const attention = await issueService(db).listReviewAttention(f.home,
        [{ id: entry.task.id, companyId: f.home, status: "in_review" }]);
      expect(attention.get(entry.task.id)?.state).toBe("covered");
      expect(attention.get(entry.task.id)?.paths.filter(path => path.kind === "interaction").map(path => path.ref))
        .toEqual([freshReviewInteraction.id]);
      const feed = await attentionService(db).list(f.home, { userId: f.userId });
      expect(feed.items.filter(item => item.subject.id === entry.task.id)
        .flatMap(item => item.decisionVerbs.map(verb => verb.id))).not.toContain("choose_review_path");
    });
  }, 60_000);

  it("coalesces wakes behind an owner-managed active execution hold and resumes through the installed controller", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    let calls = 0;
    const output = "One internal draft retained for Human review after execution recovery.";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      expect(++calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const entry = await createDraftPlan(fixture, "Native recovery hold");
      const recovery = issueRecoveryActionService(db);
      const action = await recovery.upsertSourceScoped({ companyId: f.home, sourceIssueId: entry.task.id,
        kind: "active_run_watchdog", ownerType: "board", returnOwnerAgentId: f.presence.id,
        cause: "legacy_execution_requires_reconciliation", fingerprint: entry.task.id,
        nextAction: "Reconcile the stopped native execution before admitting a replacement Run." });
      await Promise.all(Array.from({ length: 6 }, (_, i) => heartbeat.wakeup(f.presence.id, {
        source: "automation", triggerDetail: "system", reason: "issue_continuation_needed",
        requestedByActorType: "system", requestedByActorId: "native-recovery-hold-test",
        idempotencyKey: `native-recovery-hold:${i}`, payload: { issueId: entry.task.id },
        contextSnapshot: { issueId: entry.task.id },
      })));
      const holds = await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, f.home), eq(agentWakeupRequests.reason, "execution_reconciliation_required"),
        sql`${agentWakeupRequests.payload}->>'issueId' = ${entry.task.id}`));
      expect(holds).toHaveLength(1);
      expect(holds[0]).toMatchObject({ status: "skipped", runId: null,
        reason: "execution_reconciliation_required", coalescedCount: 5,
        payload: { issueId: entry.task.id, executionWait: { recoveryActionId: action.id } } });
      expect(calls).toBe(0);
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home),
        notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toHaveLength(0);
      await recovery.resolveActiveForIssue({ companyId: f.home, sourceIssueId: entry.task.id,
        actionId: action.id, status: "resolved", outcome: "restored",
        resolutionNote: "The Human resolved the execution recovery hold." });

      const resumed = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id }, contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" } });
      expect(resumed).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      expect(calls).toBe(1);
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home),
        notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      expect(runs).toHaveLength(1);
      await assertCompletedDraft(fixture, entry, resumed!.id, output);
      expect((await db.select().from(issues).where(eq(issues.id, entry.task.id)))[0]!.status).not.toBe("done");
    });
  }, 60_000);

  it("retains a resolved no-replay fence until an execution owner records safe continuation", async () => {
    const fixture = await seedInstalledDraft();
    const { f } = fixture;
    await withInstalledDraftTransport(fixture, async () => {
      throw new Error("A replay-blocked hold must stop before Native Text dispatch");
    }, async heartbeat => {
      const entry = await createDraftPlan(fixture, "Keep blocked execution from replaying");
      const recovery = issueRecoveryActionService(db);
      const action = await recovery.upsertSourceScoped({ companyId: f.home, sourceIssueId: entry.task.id,
        kind: "active_run_watchdog", ownerType: "board", returnOwnerAgentId: f.presence.id,
        cause: "legacy_execution_requires_reconciliation", fingerprint: entry.task.id,
        evidence: { automaticRecovery: { replay: "blocked", actionOutcome: "unknown" } },
        nextAction: "Reconcile the stopped execution before admitting a replacement Run." });
      await recovery.resolveActiveForIssue({ companyId: f.home, sourceIssueId: entry.task.id,
        actionId: action.id, status: "resolved", outcome: "blocked",
        resolutionNote: "The recovery record is resolved for display; replay remains blocked." });

      await Promise.all(Array.from({ length: 6 }, (_, i) => heartbeat.wakeup(f.presence.id, {
        source: "automation", triggerDetail: "system", reason: "issue_continuation_needed",
        requestedByActorType: "system", requestedByActorId: "native-no-replay-fence-test",
        idempotencyKey: `native-no-replay:${i}`, payload: { issueId: entry.task.id },
        contextSnapshot: { issueId: entry.task.id },
      })));
      expect(await getExecutionBlocker(db, f.home, entry.task.id)).toMatchObject({ recoveryActionId: action.id });
      const waits = await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, f.home), eq(agentWakeupRequests.reason, "execution_reconciliation_required"),
        sql`${agentWakeupRequests.payload}->>'issueId' = ${entry.task.id}`));
      expect(waits).toHaveLength(1);
      expect(waits[0]).toMatchObject({ status: "skipped", runId: null,
        reason: "execution_reconciliation_required", coalescedCount: 5,
        payload: { issueId: entry.task.id, executionWait: { recoveryActionId: action.id } } });
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home),
        notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toHaveLength(0);
    });
  }, 60_000);

  it("keeps an unknown NativeText charge blocked until a Human continues through the stopped-run owner", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model, human } = fixture;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let calls = 0;
    const observed: { signal?: AbortSignal; reservationId?: string; aborted: boolean } = { aborted: false };
    const output = "Fresh internal draft after explicit Human continuation.";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      if (calls === 1) {
        const signal = init.signal;
        if (!(signal instanceof AbortSignal) || !entry) throw new Error("native_text_stop_fixture_missing");
        observed.signal = signal;
        const [reservation] = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, entry.plan.id));
        if (!reservation?.providerWireReceipt) throw new Error("native_text_unknown_charge_receipt_missing");
        observed.reservationId = reservation.id;
        await new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            observed.aborted = true;
            const error = new Error("Controlled NativeText request observed canonical Stop");
            error.name = "AbortError";
            reject(error);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
      }
      if (calls !== 2) throw new Error("native_text_continuation_dispatch_count_invalid");
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      entry = await createDraftPlan(fixture, "Stop an unknown NativeText model response");
      const stopped = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id }, contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" } });
      expect(stopped).not.toBeNull();
      if (!stopped) throw new Error("native_text_stoppable_run_missing");
      await vi.waitFor(() => expect(observed.reservationId).toEqual(expect.any(String)), { timeout: 20_000, interval: 25 });
      expect(observed.signal?.aborted).toBe(false);
      const cancellation = heartbeat.cancelRun(stopped.id, "Human stopped the in-flight NativeText request", {
        resultJson: { cancelledByActorType: "user", cancelledByUserId: f.userId },
      });
      await vi.waitFor(() => expect(observed.aborted).toBe(true), { timeout: 10_000, interval: 25 });
      expect(observed.signal?.aborted).toBe(true);
      expect(await cancellation).toMatchObject({ id: stopped.id, status: "cancelled", runtimeMode: "native" });
      await heartbeat.drainActiveRunExecutions();

      const [sourceRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, stopped.id));
      expect(sourceRun).toMatchObject({ status: "cancelled", runtimeMode: "native", driverKind: "aw_text_messages",
        nativeIssueId: entry.task.id, responsibleUserId: f.userId });
      const [sourceReservation] = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.id, observed.reservationId!));
      expect(sourceReservation).toMatchObject({ status: "unknown", providerResponseHash: null, usage: null });
      const [hold] = await db.select().from(issueRecoveryActions).where(and(
        eq(issueRecoveryActions.companyId, f.home), eq(issueRecoveryActions.sourceIssueId, entry.task.id)));
      expect(hold).toMatchObject({ status: "active", cause: "uncertain_provider_action", evidence: {
        runId: stopped.id, modelReservationId: observed.reservationId,
        automaticRecovery: { actionOutcome: "unknown", replay: "blocked", runId: stopped.id,
          reservationId: observed.reservationId },
      } });
      expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.retryOfRunId, stopped.id))))
        .toHaveLength(0);
      await issueRecoveryActionService(db).resolveActiveForIssue({ companyId: f.home,
        sourceIssueId: entry.task.id, actionId: hold!.id, status: "resolved", outcome: "blocked",
        resolutionNote: "The notice is resolved; the unknown model response remains a no-replay fence." });
      expect(await getExecutionBlocker(db, f.home, entry.task.id)).toMatchObject({ recoveryActionId: hold!.id, runId: stopped.id });

      const plans = orchestrationService(db);
      const [pausedPlan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, entry.plan.id));
      if (!pausedPlan) throw new Error("native_text_unknown_plan_missing");
      if (pausedPlan.status !== "cancelled") await plans.decide(human, f.home, pausedPlan.id, {
        expectedVersion: pausedPlan.version, action: "cancel", rationale: "Replace the stopped plan with a fresh Human-reviewed continuation.",
      });
      const [task] = await db.select().from(issues).where(eq(issues.id, entry.task.id));
      if (!task) throw new Error("native_text_recovery_task_missing");
      const nextPlan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
        workload: "semantic", riskClass: "C0", completionContract: { objective: "Continue after review of the stopped request",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
        budgets: { maxModelCostMinor: 3, maxToolActions: 3 }, workers: [{ key: "native-writer-recovery", issueId: task.id }] });
      await plans.decide(human, f.home, nextPlan.id, { expectedVersion: nextPlan.version, action: "start",
        rationale: "Authorize one fresh text-only internal draft after inspecting the stopped NativeText request." });
      const comment = await issueService(db).addComment(task.id,
        "Continue with one fresh internal draft; do not replay or infer the stopped response.", { userId: f.userId },
        { authorType: "user", manualInputActor: human });
      const resumed = await heartbeat.wakeup(f.presence.id, { source: "automation", triggerDetail: "system",
        reason: "issue_commented", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: task.id, commentId: comment.id },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_commented", wakeCommentId: comment.id } });
      expect(resumed).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      const [resumedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, resumed!.id));
      const [resumedFinalization] = await db.select().from(nativeRunFinalizations)
        .where(eq(nativeRunFinalizations.runId, resumed!.id));
      const [resumedIssue] = await db.select().from(issues).where(eq(issues.id, task.id));
      const resumedAttention = resumedIssue
        ? (await issueService(db).listReviewAttention(f.home, [resumedIssue])).get(task.id) ?? null
        : null;
      const resumedActions = await db.select().from(issueRecoveryActions).where(and(
        eq(issueRecoveryActions.companyId, f.home), eq(issueRecoveryActions.sourceIssueId, task.id)));
      if (calls !== 2) throw new Error(`native_text_explicit_continuation_did_not_dispatch:${JSON.stringify({
        run: resumedRun && { status: resumedRun.status, errorCode: resumedRun.errorCode,
          nativePhase: resumedRun.nativePhase },
        finalization: resumedFinalization && { phase: resumedFinalization.phase, failureCode: resumedFinalization.failureCode },
        issue: resumedIssue && { status: resumedIssue.status, assigneeAgentPresent: Boolean(resumedIssue.assigneeAgentId),
          assigneeUserPresent: Boolean(resumedIssue.assigneeUserId),
          executionState: resumedIssue.executionState && typeof resumedIssue.executionState === "object" &&
            "status" in resumedIssue.executionState ? resumedIssue.executionState.status : null },
        attention: resumedAttention && { state: resumedAttention.state, pathKinds: resumedAttention.paths.map(path => path.kind),
          pathCount: resumedAttention.paths.length },
        actions: resumedActions.map(action => ({ status: action.status, outcome: action.outcome,
          cause: action.cause, hasUnknownLiability: Boolean(action.evidence.automaticRecovery &&
            typeof action.evidence.automaticRecovery === "object" &&
            (action.evidence.automaticRecovery as Record<string, unknown>).actionOutcome === "unknown"),
          replay: action.evidence.automaticRecovery && typeof action.evidence.automaticRecovery === "object"
            ? (action.evidence.automaticRecovery as Record<string, unknown>).replay : null,
          hasExplicitUserContinuation: Boolean(action.evidence.explicitUserContinuation) })),
      })}`);
      expect(await getExecutionBlocker(db, f.home, task.id)).toBeNull();
      const [continuedHold] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, hold!.id));
      expect(continuedHold).toMatchObject({ status: "resolved", outcome: "cancelled", evidence: {
        explicitUserContinuation: { previousRunId: stopped.id, commentId: comment.id, runId: resumed!.id },
        automaticRecovery: { actionOutcome: "unknown", replay: "explicit_user_continuation" },
      } });
      await assertCompletedDraft(fixture, { task, plan: nextPlan }, resumed!.id, output);
      const completedReceipt = nativeRunInputSourceReceiptSchema.parse(resumedRun!.runnerProfileJson?.nativeInputSourceReceipt);
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId: f.home, issueId: task.id, runId: resumed!.id,
        actor: fixture.human, ...completedReceipt.bootstrap })).resolves.toBeUndefined();
      const laterHumanComment = await issueService(db).addComment(task.id,
        "A later Human note must not replace the stopped request's original source comment.", { userId: f.userId },
        { authorType: "user", manualInputActor: fixture.human });
      expect(laterHumanComment.id).not.toBe(comment.id);
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId: f.home, issueId: task.id, runId: resumed!.id,
        actor: fixture.human, ...completedReceipt.bootstrap })).resolves.toBeUndefined();
      const nextResponsibleUserId = "historical-source-reader-" + randomUUID();
      await seedCurrentHumanSourceActor(db, [f.home], nextResponsibleUserId);
      await issueService(db).update(task.id, { responsibleUserId: nextResponsibleUserId,
        actorUserId: f.userId, privacyActor: fixture.human });
      expect((await db.select({ responsibleUserId: issues.responsibleUserId }).from(issues)
        .where(eq(issues.id, task.id)))[0]?.responsibleUserId).toBe(nextResponsibleUserId);
      // The original Human remains independently authorized by company access;
      // historical source proof must not demand today's Task assignment.
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId: f.home, issueId: task.id, runId: resumed!.id,
        actor: fixture.human, ...completedReceipt.bootstrap })).resolves.toBeUndefined();
      const savedContext = resumedRun!.contextSnapshot as Record<string, unknown>;
      const savedWake = savedContext.paperclipWake as Record<string, unknown>;
      const historicalProof = await captureNativeExplicitHumanSource({ db, companyId: f.home, issueId: task.id,
        agentId: f.presence.id, receiverRunId: resumed!.id, context: savedContext,
        envelope: savedWake.executionContinuation as Parameters<typeof captureNativeExplicitHumanSource>[0]["envelope"],
        historicalSourceRead: true });
      expect(historicalProof).toMatchObject({ receiverRunId: resumed!.id, sourceRunId: stopped.id,
        commentId: comment.id, reservationStatus: "unknown", reservationPurpose: "worker_model" });
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, stopped.id)))[0]?.status).toBe("cancelled");
      expect((await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.id, sourceReservation!.id)))[0])
        .toMatchObject({ status: "unknown", providerResponseHash: null, usage: null });
    });
  }, 60_000);

  it("resumes a reopened Task from its captured continuation summary on a fresh Human assignment wake", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    const outputs = ["First ordinary Native Text draft for Human review.", "Second ordinary Native Text draft after reopening.",
      "Third ordinary Native Text draft retaining the earlier Source history."];
    let calls = 0;
    const providerBodies: string[] = [];
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const index = ++calls;
      expect(index).toBeLessThanOrEqual(3);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      expect(String(init.body)).not.toContain(credential);
      providerBodies.push(String(init.body));
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: outputs[index - 1] }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    const verifyByHuman = async (entry: Awaited<ReturnType<typeof createDraftPlan>>) => {
      const settings = instanceSettingsService(db), priorFeatures = await settings.getExperimental();
      try {
        await settings.updateExperimental({ supervision_v7: true, verifier_v7: true });
        const verifier = verificationService(db), packet = await verifier.packet(fixture.human, f.home, entry.plan.id);
        expect(packet.deterministicFailures).toEqual([]);
        expect(packet.policy.workerSelfCertification).toBe(false);
        const evidenceRefs = packet.evidence.map(item => item.ref);
        const review = await verifier.review(fixture.human, f.home, entry.plan.id, {
          expectedPlanVersion: packet.planVersion, workerId: packet.workerId, expectedResultHash: packet.resultHash,
          result: "pass", rationale: "The Human reviewed the retained Native Text result against the current Plan contract.",
          objectiveSatisfied: true,
          businessInvariants: packet.contract.businessInvariants.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
          evidenceRequirements: packet.contract.evidenceRequirements.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
          prohibitedOutcomes: packet.contract.prohibitedOutcomes.map((_, index) => ({ index, satisfied: true, evidenceRefs })),
        });
        expect(review).toMatchObject({ reviewerType: "human", result: "pass" });
      } finally {
        await settings.updateExperimental({ supervision_v7: priorFeatures.supervision_v7, verifier_v7: priorFeatures.verifier_v7 });
      }
    };

    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const first = await createDraftPlan(fixture, "First Native Text draft for continuation-summary regression");
      const firstWake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: first.task.id }, contextSnapshot: { issueId: first.task.id, wakeReason: "issue_assigned" } });
      if (!firstWake) throw new Error("summary_only_first_human_wake_missing");
      await heartbeat.drainActiveRunExecutions();
      expect(calls).toBe(1);
      await assertCompletedDraft(fixture, first, firstWake.id, outputs[0]!);
      expect((await db.select().from(issues).where(eq(issues.id, first.task.id)))[0]?.status).toBe("in_review");
      const firstSummary = await documentService(db).getIssueDocumentByKey(first.task.id, "continuation-summary");
      expect(firstSummary?.latestRevisionId).toBeTruthy();
      const [summaryLink] = await db.select({ documentId: issueDocuments.documentId }).from(issueDocuments)
        .where(and(eq(issueDocuments.issueId, first.task.id), eq(issueDocuments.key, "continuation-summary")));
      expect(summaryLink?.documentId).toBeTruthy();
      const [capturedSummaryRevision] = await db.select({ revision: documentRevisions })
        .from(documentRevisions).where(and(eq(documentRevisions.id, firstSummary!.latestRevisionId), eq(documentRevisions.documentId, summaryLink!.documentId)));
      expect(capturedSummaryRevision?.revision.createdByRunId).toBe(firstWake.id);
      expect(capturedSummaryRevision?.revision.payloadSourceSnapshot).toBeNull();
      expect(capturedSummaryRevision?.revision.payloadSourceSnapshotInvalidated).toBe(false);

      await verifyByHuman(first);
      expect((await db.select().from(issues).where(eq(issues.id, first.task.id)))[0]?.status).toBe("done");

      const reopened = await issueService(db).update(first.task.id, { status: "todo", actorUserId: f.userId, privacyActor: fixture.human });
      expect(reopened?.status).toBe("todo");
      const task = reopened!;
      const secondPlan = await orchestrationService(db).create(fixture.human, f.home, {
        issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Second Native Text draft after reopening", requiredOutputs: [{ kind: "task_document", key: "result" }],
          businessInvariants: ["Human review remains required"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }],
      });
      await orchestrationService(db).decide(fixture.human, f.home, secondPlan.id, { expectedVersion: secondPlan.version,
        action: "start", rationale: "Admit the reopened Task's second ordinary Native Text draft for Human review" });
      const priorComments = await db.select().from(issueComments).where(eq(issueComments.issueId, task.id));
      const [priorRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, firstWake.id));
      const priorResult = (priorRun?.resultJson as Record<string, unknown> | null)?.nativeResult as Record<string, unknown> | undefined;
      expect(priorComments).toHaveLength(1);
      expect(priorComments[0]).toMatchObject({ createdByRunId: firstWake.id, authorAgentId: f.presence.id,
        authorType: "agent", payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null,
        payloadSourceSnapshotInvalidated: false, body: priorResult?.summary });
      const administrativeRows = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id));
      console.info("reopened_assignment_interaction_owner", administrativeRows.map(row => ({
        kind: row.kind, status: row.status, result: row.result, sourceRunMatches: row.sourceRunId === firstWake.id,
        createdByAgentMatches: row.createdByAgentId === f.presence.id, resolvedByHumanMatches: row.resolvedByUserId === f.userId,
        resolvedByAgentPresent: Boolean(row.resolvedByAgentId), resolvedByRunPresent: Boolean(row.resolvedByRunId),
        resolvedAtPresent: Boolean(row.resolvedAt) })));
      const second = { task, plan: secondPlan };
      const secondWake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: task.id }, contextSnapshot: { issueId: task.id, wakeReason: "issue_assigned" } });
      if (!secondWake) throw new Error("summary_only_second_human_wake_missing");
      await heartbeat.drainActiveRunExecutions();
      if (calls !== 2) {
        const [failed] = await db.select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode,
          error: heartbeatRuns.error }).from(heartbeatRuns).where(eq(heartbeatRuns.id, secondWake.id));
        console.info("reopened_assignment_failure", { ...nativeExecutionFailureLogFields({ error: new Error(failed?.error ?? ""),
          runId: "fixture", failureCode: failed?.errorCode ?? "unknown" }), status: failed?.status,
          errorCodeSha256: createHash("sha256").update(failed?.errorCode ?? "").digest("hex"),
          errorSha256: createHash("sha256").update(failed?.error ?? "").digest("hex"), errorLength: failed?.error?.length ?? 0 });
      }
      expect(calls).toBe(2);
      await assertCompletedDraft(fixture, second, secondWake.id, outputs[1]!);
      const [secondRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, secondWake.id));
      const [firstRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, firstWake.id));
      const firstNativeResult = (firstRun?.resultJson as Record<string, unknown> | null)?.nativeResult as Record<string, unknown> | undefined;
      const acceptedSummary = typeof firstNativeResult?.summary === "string" ? firstNativeResult.summary : null;
      const selectedSummary = (secondRun?.runnerProfileJson as Record<string, unknown> | null)?.nativeBootstrapFinalizedContinuationSummary as
        { sourceRunId?: string; body?: string } | null;
      const capturedCommentSources = (secondRun?.runnerProfileJson as Record<string, unknown> | null)?.nativeBootstrapContinuationCommentSources as
        Array<{ input?: { commentId?: string }; acceptedPresentationOwner?: {
          commentSourceIdentity?: { commentId?: string }; acceptedSummaryOwner?: { sourceRunId?: string; body?: string };
        } }> | undefined;
      const selectedContinuation = (secondRun?.contextSnapshot as Record<string, unknown> | null)?.executionContinuation as
        { coverage?: { kind?: string; throughCommentId?: string | null; summaryThroughCommentId?: string | null } } | undefined;
      const issueInteractions = await issueThreadInteractionService(db).listForIssue(task.id);
      const issueClosedInteraction = issueInteractions.filter(value => value.kind === "request_confirmation" && value.status === "expired" &&
        value.result?.outcome === "issue_closed");
      expect(issueClosedInteraction).toHaveLength(1);
      expect(issueClosedInteraction[0]).toMatchObject({ sourceRunId: firstWake.id, createdByAgentId: null,
        resolvedByUserId: f.userId, resolvedByAgentId: null, resolvedByRunId: null, result: { version: 1, outcome: "issue_closed", reason: null } });
      const issueClosedActivity = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home),
        eq(activityLog.action, "issue.thread_interaction_expired"), eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, task.id), sql`${activityLog.details}->>'interactionId' = ${issueClosedInteraction[0]!.id}`));
      expect(issueClosedActivity).toHaveLength(1);
      expect(issueClosedActivity[0]!.details).toMatchObject({ interactionId: issueClosedInteraction[0]!.id,
        interactionKind: "request_confirmation", interactionStatus: "expired", source: "issue.status_transition.issue_closed",
        result: issueClosedInteraction[0]!.result });
      const sourceReceipt = nativeRunInputSourceReceiptSchema.parse(
        (secondRun?.runnerProfileJson as Record<string, unknown> | null)?.nativeInputSourceReceipt);
      expect(sourceReceipt.bootstrap.policy.runIds).toContain(firstWake.id);
      expect(sourceReceipt.bootstrap.inputs).toContainEqual(expect.objectContaining({ kind: "interaction", issueId: task.id,
        interactionId: issueClosedInteraction[0]!.id }));
      const secondContinuation = (secondRun?.contextSnapshot as Record<string, unknown> | null)?.executionContinuation as
        { humanResponses?: Array<{ id: string }>; interactionOutcomes: Array<{ id: string; kind: string; status: string; result: unknown }> } | undefined;
      expect(secondContinuation?.interactionOutcomes).toContainEqual({ id: issueClosedInteraction[0]!.id, kind: "request_confirmation",
        status: "expired", result: issueClosedInteraction[0]!.result });
      expect(secondContinuation?.humanResponses ?? []).not.toContainEqual(expect.objectContaining({ id: issueClosedInteraction[0]!.id }));
      expect(acceptedSummary).toBeTruthy();
      expect(selectedSummary).toMatchObject({ sourceRunId: firstWake.id, body: acceptedSummary });
      expect(capturedCommentSources).toHaveLength(1);
      expect(capturedCommentSources?.[0]).toMatchObject({ input: { commentId: priorComments[0]!.id },
        acceptedPresentationOwner: { commentSourceIdentity: { commentId: priorComments[0]!.id },
          acceptedSummaryOwner: { sourceRunId: firstWake.id, body: acceptedSummary } } });
      expect(selectedContinuation?.coverage).toEqual({ kind: "full_task_history",
        throughCommentId: priorComments[0]!.id, summaryThroughCommentId: null });
      expect(providerBodies[1]).toContain(acceptedSummary!);
      expect(providerBodies[1]).not.toContain("# Continuation Summary");
      const resultDocument = await documentService(db).getIssueDocumentByKey(task.id, "result");
      if (!resultDocument?.latestRevisionId) throw new Error("reopened_task_result_revision_missing");
      const sourceRead = () => assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: f.home,
        issueId: task.id, revisionId: resultDocument.latestRevisionId!, actor: fixture.human, requireLatest: false });
      await expect(sourceRead()).resolves.toBeUndefined();
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]?.status).toBe("in_review");
      await verifyByHuman(second);
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]?.status).toBe("done");
      await expect(sourceRead()).resolves.toBeUndefined();
      const reopenedAgain = await issueService(db).update(task.id, { status: "todo", actorUserId: f.userId, privacyActor: fixture.human });
      if (!reopenedAgain) throw new Error("third_native_task_reopen_missing");
      const thirdPlan = await orchestrationService(db).create(fixture.human, f.home, {
        issueId: task.id, expectedIssueUpdatedAt: reopenedAgain.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Third Native Text draft with retained Source history",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }],
      });
      await orchestrationService(db).decide(fixture.human, f.home, thirdPlan.id, { expectedVersion: thirdPlan.version,
        action: "start", rationale: "Admit the third bounded Native Text draft after independent Human review" });
      const thirdHistory = await db.select().from(issueComments).where(eq(issueComments.issueId, task.id));
      const thirdWake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_assigned" } });
      if (!thirdWake) throw new Error("third_native_task_wake_missing");
      await heartbeat.drainActiveRunExecutions();
      expect(calls).toBe(3);
      const third = { task: reopenedAgain, plan: thirdPlan };
      await assertCompletedDraft(fixture, third, thirdWake.id, outputs[2]!);
      const [thirdRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, thirdWake.id));
      const thirdReceipt = nativeRunInputSourceReceiptSchema.parse(thirdRun?.runnerProfileJson?.nativeInputSourceReceipt);
      expect(thirdReceipt.bootstrap.policy.runIds).toEqual(expect.arrayContaining([firstWake.id, secondWake.id]));
      expect(thirdRun?.runnerProfileJson?.nativeBootstrapFinalizedContinuationSummary).toMatchObject({ sourceRunId: secondWake.id });
      const thirdContinuation = thirdRun?.contextSnapshot?.executionContinuation as
        { messages: Array<{ id: string }>; interactionOutcomes: Array<{ id: string }> };
      expect(thirdContinuation.messages.map(value => value.id).sort()).toEqual(thirdHistory.map(value => value.id).sort());
      expect(thirdContinuation.interactionOutcomes).toHaveLength(2);
      const thirdDocument = await documentService(db).getIssueDocumentByKey(task.id, "result");
      if (!thirdDocument?.latestRevisionId) throw new Error("third_native_output_revision_missing");
      const thirdSourceRead = () => assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: f.home,
        issueId: task.id, revisionId: thirdDocument.latestRevisionId!, actor: fixture.human });
      await verifyByHuman(third);
      await expect(sourceRead()).resolves.toBeUndefined();
      await expect(thirdSourceRead()).resolves.toBeUndefined();
      const savedActivityDetails = issueClosedActivity[0]!.details!;
      await db.update(activityLog).set({ details: { ...savedActivityDetails, source: "forged_issue_close" } })
        .where(and(eq(activityLog.companyId, f.home), eq(activityLog.id, issueClosedActivity[0]!.id)));
      await expect(sourceRead()).rejects.toMatchObject({ status: 403 });
      await db.update(activityLog).set({ details: savedActivityDetails })
        .where(and(eq(activityLog.companyId, f.home), eq(activityLog.id, issueClosedActivity[0]!.id)));
      await expect(sourceRead()).resolves.toBeUndefined();
      await db.update(heartbeatRuns).set({ resultJson: sql`coalesce(${heartbeatRuns.resultJson}, '{}'::jsonb) ||
        jsonb_build_object('nativeResult', jsonb_build_object('summary', 'withdrawn parent result'))` })
        .where(eq(heartbeatRuns.id, firstWake.id));
      await expect(sourceRead()).rejects.toMatchObject({ status: 403 });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(inArray(orchestrationWorkerAttempts.planId,
        [first.plan.id, second.plan.id, third.plan.id]));
      const reservations = await db.select().from(orchestrationModelReservations).where(inArray(orchestrationModelReservations.planId,
        [first.plan.id, second.plan.id, third.plan.id]));
      expect(new Set(attempts.map(row => row.runId)).size).toBe(3);
      expect(new Set(reservations.map(row => row.id)).size).toBe(3);
    });
  }, 60_000);

  it("keeps a one-document Task idle while blocked, then completes one scheduler Run for Human review", async () => {
    const fixture = await seedInstalledDraft();
    const { f, human, profile, model } = fixture;

    const tasks = issueService(db);
    const blocker = await tasks.create(f.home, { title: "Human dependency", description: "A Human must resolve this dependency.",
      status: "todo", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const draft = await tasks.create(f.home, { title: "Draft after the Human dependency resolves",
      description: "Retain one internal text document for Human review; no tools or external side effects.",
      status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, blockedByIssueIds: [blocker.id],
      actorUserId: f.userId, privacyActor: human });
    if (!task) throw new Error("dependency_draft_task_missing");
    expect(nativePayloadSourceSnapshotSchema.safeParse(task.payloadSourceSnapshot).success).toBe(true);

    let calls = 0, planId = "", observedBody = "";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      observedBody = String(init.body);
      expect(JSON.parse(observedBody)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(observedBody).tools).toBeUndefined();
      const dispatched = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, planId));
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: "The dependency is resolved. Retained internal draft for Human review." }],
        usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    const consumer = workerModelGateway(db, { profiles: [profile], sourceSha,
      protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(createToolGatewayService(db))); app.use(errorHandler);
    const server = createServer(app);
    const priorApiUrl = process.env.PAPERCLIP_API_URL;
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    const substitution = vi.fn(() => { throw new Error("Installed draft controller must not use the provider backend seam"); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("dependency_draft_api_listener_missing");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${address.port}`;
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, { nativeSessionBackendFactory: substitution });
      expect((await request(server).post("/mcp/gateways/not-a-token")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })).status).toBe(401);
      const plans = orchestrationService(db);
      const plan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
        workload: "semantic", riskClass: "C0", completionContract: { objective: "Retain one internal draft after its dependency resolves",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
      planId = plan.id;
      await plans.decide(human, f.home, plan.id, { expectedVersion: plan.version, action: "start",
        rationale: "Start the existing bounded text controller only after dependency scheduling admits the Task" });
      const blockedWake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_assigned" } });
      expect(blockedWake).toBeNull();
      const blockedRequests = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.agentId, f.presence.id),
        eq(agentWakeupRequests.reason, "issue_dependencies_blocked")));
      expect(blockedRequests).toHaveLength(1);
      expect(blockedRequests[0]).toMatchObject({ status: "skipped" });
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toEqual([]);
      expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id))).toEqual([]);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id))).toEqual([]);
      expect(calls).toBe(0);
      expect(substitution).not.toHaveBeenCalled();

      await tasks.update(blocker.id, { status: "done", actorUserId: f.userId, privacyActor: human });
      const readyWake = await heartbeat.wakeup(f.presence.id, { source: "automation", triggerDetail: "system", reason: "issue_blockers_resolved",
        requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_blockers_resolved" } });
      expect(readyWake).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ id: readyWake!.id, nativeIssueId: task.id, responsibleUserId: f.userId,
        runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ runId: readyWake!.id, agentId: f.presence.id });
      const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, readyWake!.id));
      expect(manifests).toHaveLength(1);
      expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
      const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ workerAttemptId: attempts[0]!.id, status: "completed", maximumMinor: 3,
        usage: { inputTokens: 10, outputTokens: 20 } });
      expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0])
        .toMatchObject({ toolActionsUsed: 2, modelCostReserved: 3 });
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, readyWake!.id)))
        .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
      const receipt = nativeRunInputSourceReceiptSchema.parse(runs[0]!.runnerProfileJson?.nativeInputSourceReceipt);
      expect(receipt.binding).toMatchObject({ companyId: f.home, agentId: f.presence.id, issueId: task.id, runId: readyWake!.id });
      expect(receipt.bootstrap.inputs.map(source => source.kind)).toEqual(expect.arrayContaining(["task", "context", "workspace_metadata"]));
      expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body)
        .toBe("The dependency is resolved. Retained internal draft for Human review.");
      const revisions = await db.select({ revision: documentRevisions }).from(issueDocuments)
        .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
          eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
        .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]!.revision.payloadSourceProtocolVersion).toBe(1);
      const outputSources = nativePayloadSourceSnapshotSchema.parse(revisions[0]!.revision.payloadSourceSnapshot);
      expect(outputSources.inputs.map(source => source.kind)).toEqual(expect.arrayContaining([
        "task", "completion_contract", "runtime_instructions", "worker_model_dispatch",
      ]));
      const wireIntents = runs[0]!.runnerProfileJson?.nativeAwModelWireIntents;
      if (!Array.isArray(wireIntents) || wireIntents.length !== 1) throw new Error("dependency_draft_wire_intent_missing");
      const wireIntent: unknown = wireIntents[0];
      if (!wireIntent || typeof wireIntent !== "object" || !("requestHash" in wireIntent) || !("wireBodyHash" in wireIntent))
        throw new Error("dependency_draft_wire_intent_invalid");
      expect(wireIntent.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(wireIntent.wireBodyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(outputSources.inputs).toContainEqual(expect.objectContaining({
        kind: "worker_model_dispatch", runId: readyWake!.id, reservationId: reservations[0]!.id,
        requestHash: wireIntent.requestHash, wireBodyHash: wireIntent.wireBodyHash,
      }));
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.status).not.toBe("done");
      expect(observedBody).toContain("assignedRuntimeContext");
      expect(observedBody).not.toContain(credential);
      expect(calls).toBe(1);
      expect(substitution).not.toHaveBeenCalled();
    } finally {
      try { await heartbeat?.drainActiveRunExecutions(); }
      finally {
        registerNativeDraftGateway(db, undefined);
        if (priorApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = priorApiUrl;
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }, 60_000);
  it.each(["manual", "forged_payload"] as const)("adopts another Human's retained comment queue only through the installed Native startup owner: %s", async mode => {
    const fixture = await seedInstalledDraft();
    const { f, human, model } = fixture;
    const operatorId = `adopting-human-${randomUUID()}`;
    const operator = await seedCurrentHumanSourceActor(db, [f.home], operatorId);
    const tasks = issueService(db);
    const task = await tasks.create(f.home, { title: "Retained Human comment queue",
      description: "Retain one bounded internal draft for Human review.", status: "todo", workMode: "standard",
      responsibleUserId: f.userId, createdByUserId: f.userId, assigneeAgentId: f.presence.id }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const comment = await tasks.addComment(task.id, "Original Human input retained for the next admitted turn.",
      { userId: f.userId }, { manualInputActor: human });
    // This is the retained queue state exercised by the legacy adoption case.
    // It grants no runtime, source, provider, or paid-dispatch qualification.
    const [pending] = await db.insert(agentWakeupRequests).values({ companyId: f.home, agentId: f.presence.id,
      source: "automation", reason: "issue_commented", status: "deferred_issue_execution",
      requestedByActorType: "user", requestedByActorId: f.userId,
      payload: { issueId: task.id, commentId: comment.id, _paperclipWakeContext: { wakeCommentIds: [comment.id] } },
    }).returning();
    let calls = 0, planId = "";
    const output = "Original Human comment retained in an operator-authorized draft.";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      expect(++calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, planId));
      expect(reservations).toEqual([expect.objectContaining({ status: "dispatched", maximumMinor: 3,
        principalUserId: operatorId })]);
      init.signal?.throwIfAborted();
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const plans = orchestrationService(db);
      const [currentTask] = await db.select({ updatedAt: issues.updatedAt }).from(issues)
        .where(and(eq(issues.companyId, f.home), eq(issues.id, task.id)));
      if (!currentTask) throw new Error("retained_queue_task_missing");
      const plan = await plans.create(operator, f.home, { issueId: task.id, expectedIssueUpdatedAt: currentTask.updatedAt.toISOString(),
        workload: "semantic", riskClass: "C0", completionContract: { objective: "Retain one internal queued-comment draft",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
      await plans.decide(operator, f.home, plan.id, { expectedVersion: plan.version, action: "start",
        rationale: "Current Human adopts the saved comment input through the existing bounded draft owner" });
      planId = plan.id;
      const wake = await heartbeat.wakeup(f.presence.id, { ...(mode === "manual" ? { manualUserWake: true } : {}),
        source: "on_demand", triggerDetail: "manual", reason: "issue_commented",
        requestedByActorType: mode === "manual" ? "user" : "agent",
        requestedByActorId: mode === "manual" ? operatorId : f.presence.id,
        payload: { issueId: task.id, ...(mode === "forged_payload" ? { manualUserWake: true } : {}) },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_commented", responsibleUserId: operatorId } });
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      if (mode === "forged_payload") {
        expect(calls).toBe(0);
        expect(runs.some(run => run.responsibleUserId === operatorId)).toBe(false);
        const requests = await db.select().from(agentWakeupRequests).where(and(
          eq(agentWakeupRequests.companyId, f.home), eq(agentWakeupRequests.requestedByActorType, "agent")));
        expect(requests).not.toHaveLength(0);
        expect(requests.every(row => row.payload?.manualUserWake === undefined)).toBe(true);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id)))
          .toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.companyId, f.home))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(task.id, "result")).toBeNull();
        expect((await db.select().from(issueComments).where(eq(issueComments.id, comment.id)))[0]!.authorUserId).toBe(f.userId);
        return;
      }
      expect(wake).not.toBeNull();
      expect(runs.map(run => ({ id: run.id, status: run.status, runtimeMode: run.runtimeMode,
        responsibleUserId: run.responsibleUserId, errorCode: run.errorCode }))).toEqual([
        { id: wake!.id, status: "succeeded", runtimeMode: "native", responsibleUserId: operatorId, errorCode: null },
      ]);
      expect(runs[0]!.contextSnapshot?.wakeCommentIds).toEqual([comment.id]);
      expect(runs[0]!.activeIdentityContextId).toBeTruthy();
      expect(runs[0]!.contextSnapshot?.originIdentityContextId).toBeUndefined();
      expect(runs[0]!.contextSnapshot?.retryOfRunId).toBeUndefined();
      const receipt = nativeRunInputSourceReceiptSchema.parse(runs[0]!.runnerProfileJson?.nativeInputSourceReceipt);
      expect(receipt.binding).toMatchObject({ runId: wake!.id, responsibleUserId: operatorId, issueId: task.id });
      const [queue] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, pending!.id));
      expect(queue).toMatchObject({ status: "coalesced", runId: wake!.id });
      const [originalComment] = await db.select().from(issueComments).where(eq(issueComments.id, comment.id));
      expect(originalComment!.authorUserId).toBe(f.userId);
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.responsibleUserId).toBe(f.userId);
      expect(plan.createdBy).toBe(operatorId);
      const [attempt] = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
      expect(attempt).toMatchObject({ runId: wake!.id, agentId: f.presence.id });
      const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.id, attempt!.executionManifestId!));
      expect(manifest!.manifest).toMatchObject({ responsibleUserId: operatorId });
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, wake!.id)))
        .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
      const document = await documentService(db).getIssueDocumentByKey(task.id, "result");
      expect(document).toMatchObject({ body: output });
      if (!document?.latestRevisionId) throw new Error("adopted_queue_result_revision_missing");
      const sourceRead = () => assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: f.home,
        issueId: task.id, revisionId: document.latestRevisionId!, actor: operator });
      await expect(sourceRead()).resolves.toBeUndefined();
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.status).not.toBe("done");
      // A replacement receipt with the same comments cannot become the original
      // adoption Source. The retained output binds the exact saved queue ID.
      await db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.id, pending!.id));
      await db.insert(agentWakeupRequests).values({ companyId: f.home, agentId: f.presence.id,
        source: "automation", reason: "issue_commented", status: "coalesced", runId: wake!.id,
        requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: task.id, commentId: comment.id, _paperclipWakeContext: { wakeCommentIds: [comment.id] } },
      });
      await expect(sourceRead()).rejects.toThrow("A Native task wake source changed");
      expect(calls).toBe(1);
    });
  }, 60_000);

  it("keeps the Task owner as Native Run responsibility for a canonical automated wake requested by another Human", async () => {
    const fixture = await seedInstalledDraft();
    const { f, human, model } = fixture;
    const requesterId = `automated-wake-requester-${randomUUID()}`;
    const requester = await seedCurrentHumanSourceActor(db, [f.home], requesterId);
    const tasks = issueService(db);
    const blocker = await tasks.create(f.home, { title: "Human-resolved dependency", description: "A current Human resolves this blocker.",
      status: "todo", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const draft = await tasks.create(f.home, { title: "Task-owner draft after automated dependency wake",
      description: "Retain one internal text document for Human review; no tools or external side effects.",
      status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, blockedByIssueIds: [blocker.id],
      actorUserId: f.userId, privacyActor: human });
    if (!task) throw new Error("automated_wake_native_task_missing");
    expect(task.responsibleUserId).toBe(f.userId);
    expect(nativePayloadSourceSnapshotSchema.safeParse(task.payloadSourceSnapshot).success).toBe(true);

    let calls = 0, planId = "";
    const output = "Task-owner draft retained for Human review after the dependency resolves.";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      expect(++calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, planId));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };

    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const plans = orchestrationService(db);
      const plan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
        workload: "semantic", riskClass: "C0", completionContract: {
          objective: "Retain one internal draft after its dependency resolves",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"],
        }, budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
      await plans.decide(human, f.home, plan.id, { expectedVersion: plan.version, action: "start",
        rationale: "Start the existing bounded text controller only after canonical dependency readiness" });
      planId = plan.id;
      const routeApp = express();
      routeApp.use(express.json());
      if (requester.type !== "board" || requester.source !== "session" || !requester.sessionId)
        throw new Error("automated_wake_requires_second_current_human_session");
      routeApp.use((req, _res, next) => {
        req.actor = { type: "board", source: "session", userId: requesterId,
          sessionId: requester.sessionId, companyIds: requester.companyIds };
        next();
      });
      routeApp.use("/api", issueRoutes(db, {} as never, { heartbeat }));
      routeApp.use(errorHandler);

      expect(calls).toBe(0);
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toHaveLength(0);
      // The canonical PATCH producer uses the second seeded current Human. Do not
      // synthesize a heartbeat request or set manualUserWake in this case.
      await request(routeApp).patch(`/api/issues/${blocker.id}`).send({ status: "done" }).expect(200);
      let wake: typeof agentWakeupRequests.$inferSelect | undefined;
      await vi.waitFor(async () => {
        const rows = await db.select().from(agentWakeupRequests).where(and(
          eq(agentWakeupRequests.companyId, f.home), eq(agentWakeupRequests.agentId, f.presence.id),
          eq(agentWakeupRequests.reason, "issue_blockers_resolved")));
        expect(rows).toHaveLength(1);
        wake = rows[0];
        expect(wake?.runId).toBeTruthy();
      }, { timeout: 20_000, interval: 25 });
      expect(wake).toMatchObject({ source: "automation", triggerDetail: "system", reason: "issue_blockers_resolved",
        requestedByActorType: "user", requestedByActorId: requesterId,
        payload: { issueId: task.id, resolvedBlockerIssueId: blocker.id, blockerIssueIds: [blocker.id], mutation: "blocker_done" } });
      expect(plan.createdBy).toBe(f.userId);
      expect(task.responsibleUserId).toBe(f.userId);
      await heartbeat.drainActiveRunExecutions();
      await assertCompletedDraft(fixture, { task, plan }, wake!.runId!, output);
      const [completed] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake!.runId!));
      const receipt = nativeRunInputSourceReceiptSchema.parse(completed!.runnerProfileJson?.nativeInputSourceReceipt);
      expect(receipt.binding.responsibleUserId).toBe(f.userId);
      const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, wake!.runId!));
      expect(manifest!.manifest).toMatchObject({ responsibleUserId: f.userId });
      const [reservation] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservation!.principalUserId).toBe(f.userId);
      expect(calls).toBe(1);
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]?.responsibleUserId).toBe(f.userId);
      const linkedResult = await db.select().from(issueDocuments).where(and(
        eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(linkedResult).toHaveLength(1);
    });
  }, 60_000);

  it.each([false, true])("contains a queued second Human Run after canonical membership withdrawal (withdraw: %s)", async revokeSecondHuman => {
    const fixture = await seedInstalledDraft();
    const { f, human, profile, model } = fixture;
    const secondHumanId = `capacity-second-human-${randomUUID()}`;
    const secondHuman = await seedCurrentHumanSourceActor(db, [f.home], secondHumanId);
    const tasks = issueService(db);
    const plans = orchestrationService(db);
    const taskPlans: { task: Awaited<ReturnType<typeof tasks.create>>; plan: Awaited<ReturnType<typeof plans.create>> }[] = [];
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
    let calls = 0;
    const dispatchedPlanIds: string[] = [];
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const call = ++calls;
      expect(call).toBeLessThanOrEqual(2);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const current = taskPlans[call - 1]!;
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, current.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      dispatchedPlanIds.push(current.plan.id);
      if (call === 1) await firstResponse;
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: `Internal draft ${call} retained for Human review.` }],
        usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    const consumer = workerModelGateway(db, { profiles: [profile], sourceSha,
      protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(createToolGatewayService(db))); app.use(errorHandler);
    const server = createServer(app);
    const priorApiUrl = process.env.PAPERCLIP_API_URL;
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    const substitution = vi.fn(() => { throw new Error("Installed draft controller must not use the provider backend seam"); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("capacity_draft_api_listener_missing");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${address.port}`;
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, { nativeSessionBackendFactory: substitution });
      for (const ordinal of [1, 2]) {
        const draft = await tasks.create(f.home, { title: `Capacity-controlled internal draft ${ordinal}`,
          description: "Retain one internal text document for Human review; no interactive tools or external effects.",
          status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
          { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
        const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, actorUserId: f.userId, privacyActor: human });
        if (!task) throw new Error("capacity_draft_task_missing");
        const planOwner = ordinal === 1 ? human : secondHuman;
        const plan = await plans.create(planOwner, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
          workload: "semantic", riskClass: "C0", completionContract: { objective: `Retain internal draft ${ordinal} for Human review`,
            requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
          budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
        await plans.decide(planOwner, f.home, plan.id, { expectedVersion: plan.version, action: "start",
          rationale: "Admit the existing one-call document controller subject to actual scheduler capacity" });
        taskPlans.push({ task, plan });
      }
      const first = await heartbeat!.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: taskPlans[0]!.task.id }, contextSnapshot: { issueId: taskPlans[0]!.task.id, wakeReason: "issue_assigned" } });
      expect(first).not.toBeNull();
      try {
        await vi.waitFor(() => {
          expect(calls).toBe(1);
          expect(dispatchedPlanIds).toEqual([taskPlans[0]!.plan.id]);
        }, { timeout: 30_000, interval: 25 });
      } catch {
        const [run] = await db.select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode,
          nativePhase: heartbeatRuns.nativePhase }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, first!.id)));
        const category = (value: unknown) => typeof value === "string"
          ? (/^[a-z0-9_:-]{1,96}$/i.test(value) ? value : "other") : null;
        throw new Error(`capacity_draft_first_dispatch_wait_failed:${JSON.stringify({
          status: category(run?.status), errorCode: category(run?.errorCode), nativePhase: category(run?.nativePhase),
        })}`);
      }
      const activeRun = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, first!.id)))[0];
      expect(activeRun).toMatchObject({ status: "running", errorCode: null });
      expect(activeRun?.wakeupRequestId).toBeTruthy();
      const second = await heartbeat!.wakeup(f.presence.id, { manualUserWake: true, source: "on_demand", triggerDetail: "manual",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: secondHumanId,
        payload: { issueId: taskPlans[1]!.task.id }, contextSnapshot: { issueId: taskPlans[1]!.task.id, wakeReason: "issue_assigned" } });
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first!.id);
      const queued = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, second!.id));
      expect(queued[0]).toMatchObject({ status: "queued", responsibleUserId: secondHumanId,
        contextSnapshot: { issueId: taskPlans[1]!.task.id } });
      const [secondWake] = await db.select().from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, queued[0]!.wakeupRequestId!));
      expect(secondWake).toMatchObject({ companyId: f.home, agentId: f.presence.id, runId: second!.id,
        requestedByActorType: "user", requestedByActorId: secondHumanId,
        payload: { manualUserWake: true, issueId: taskPlans[1]!.task.id } });
      expect(taskPlans[1]!.plan.createdBy).toBe(secondHumanId);
      expect(taskPlans[1]!.task.responsibleUserId).toBe(f.userId);
      expect(calls).toBe(1);
      expect(dispatchedPlanIds).toEqual([taskPlans[0]!.plan.id]);
      expect(await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, taskPlans[1]!.plan.id))).toEqual([]);
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, second!.id))).toEqual([]);
      if (revokeSecondHuman) {
        const [membership] = await db.select().from(companyMemberships).where(and(
          eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, secondHumanId), eq(companyMemberships.status, "active")));
        expect(membership).toBeTruthy();
        const updatedMembership = await accessService(db).updateMember(f.home, membership!.id, { status: "suspended" }, f.userId);
        expect(updatedMembership).toMatchObject({ id: membership!.id, principalId: secondHumanId, status: "suspended" });
        // This is the same responsibility-withdrawal owner called by the access route.
        const cancellation = await heartbeat!.cancelRunsForResponsibleHuman(f.home, secondHumanId,
          "Cancelled because the responsible Human's company access was withdrawn");
        expect(cancellation).toEqual({ scanned: 1, cancelled: 1 });
        const cancelledRun = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, second!.id)))[0];
        expect(cancelledRun).toMatchObject({ id: second!.id, status: "cancelled",
          responsibleUserId: secondHumanId, errorCode: "responsible_user_access_withdrawn" });
        const [cancelledWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, secondWake!.id));
        expect(cancelledWake).toMatchObject({ status: "cancelled", runId: second!.id });
        expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, taskPlans[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, taskPlans[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, second!.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, second!.id))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(taskPlans[1]!.task.id, "result")).toBeNull();
        expect((await db.select().from(issues).where(eq(issues.id, taskPlans[1]!.task.id)))[0]?.responsibleUserId).toBe(f.userId);
      }
      // The first real Native text-controller HTTP request is still held above.
      // Age its actual Run row, then ask a second service instance to reap it.
      // The module-shared activeRunExecutions ownership guard must retain the
      // original running Run and claimed assignment wake until the owner settles.
      await db.update(heartbeatRuns).set({ updatedAt: new Date("2026-03-19T00:00:00.000Z") })
        .where(eq(heartbeatRuns.id, first!.id));
      const reaperHeartbeat = heartbeatService(db);
      expect(await reaperHeartbeat.reapOrphanedRuns({ staleThresholdMs: 1 }))
        .toEqual({ reaped: 0, runIds: [] });
      const heldRun = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, first!.id)))[0];
      expect(heldRun).toMatchObject({ id: first!.id, status: "running", errorCode: null });
      const heldWake = (await db.select().from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, activeRun!.wakeupRequestId!)))[0];
      expect(heldWake).toMatchObject({ status: "claimed", runId: first!.id });
      expect(substitution).not.toHaveBeenCalled();
      releaseFirst();
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      expect(runs).toHaveLength(2);
      expect(dispatchedPlanIds).toEqual(revokeSecondHuman ? [taskPlans[0]!.plan.id] : taskPlans.map(({ plan }) => plan.id));
      expect(calls).toBe(revokeSecondHuman ? 1 : 2);
      for (const [index, { task, plan }] of taskPlans.entries()) {
        const runId = index === 0 ? first!.id : second!.id;
        const run = runs.find(candidate => candidate.id === runId);
        const expectedResponsibleUserId = index === 0 ? f.userId : secondHumanId;
        if (index === 1 && revokeSecondHuman) {
          expect(run).toMatchObject({ nativeIssueId: null, runtimeMode: "legacy", runtimeModeResolvedAt: null,
            contextSnapshot: { issueId: task.id }, responsibleUserId: secondHumanId,
            status: "cancelled", errorCode: "responsible_user_access_withdrawn" });
          expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id))).toEqual([]);
          expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId))).toEqual([]);
          expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id))).toEqual([]);
          expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId))).toEqual([]);
          expect(await documentService(db).getIssueDocumentByKey(task.id, "result")).toBeNull();
          expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]?.responsibleUserId).toBe(f.userId);
          continue;
        }
        expect(run).toMatchObject({ nativeIssueId: task.id, responsibleUserId: expectedResponsibleUserId,
          runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
        const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id });
        const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId));
        expect(manifests).toHaveLength(1);
        expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
        expect(manifests[0]!.manifest).toMatchObject({ responsibleUserId: expectedResponsibleUserId });
        const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
        expect(reservations).toHaveLength(1);
        expect(reservations[0]).toMatchObject({ workerAttemptId: attempts[0]!.id, status: "completed", maximumMinor: 3,
          usage: { inputTokens: 10, outputTokens: 20 } });
        expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0])
          .toMatchObject({ toolActionsUsed: 2, modelCostReserved: 3 });
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId)))
          .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
        const receipt = nativeRunInputSourceReceiptSchema.parse(run?.runnerProfileJson?.nativeInputSourceReceipt);
        expect(receipt.binding).toMatchObject({ companyId: f.home, agentId: f.presence.id, issueId: task.id, runId });
        expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body)
          .toBe(`Internal draft ${index + 1} retained for Human review.`);
        const revisions = await db.select({ revision: documentRevisions }).from(issueDocuments)
          .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
          .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
            eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
          .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
        expect(revisions).toHaveLength(1);
        const source = nativePayloadSourceSnapshotSchema.parse(revisions[0]!.revision.payloadSourceSnapshot);
        const intents = run?.runnerProfileJson?.nativeAwModelWireIntents;
        if (!Array.isArray(intents) || intents.length !== 1) throw new Error("capacity_draft_wire_intent_missing");
        const intent: unknown = intents[0];
        if (!intent || typeof intent !== "object" || !("requestHash" in intent) || !("wireBodyHash" in intent))
          throw new Error("capacity_draft_wire_intent_invalid");
        expect(intent.requestHash).toMatch(/^[a-f0-9]{64}$/);
        expect(intent.wireBodyHash).toMatch(/^[a-f0-9]{64}$/);
        expect(source.inputs).toContainEqual(expect.objectContaining({ kind: "worker_model_dispatch", runId,
          reservationId: reservations[0]!.id, requestHash: intent.requestHash, wireBodyHash: intent.wireBodyHash }));
        const completedTask = (await db.select().from(issues).where(eq(issues.id, task.id)))[0];
        expect(completedTask?.status).not.toBe("done");
        expect(completedTask?.responsibleUserId).toBe(f.userId);
      }
      expect(substitution).not.toHaveBeenCalled();
    } finally {
      releaseFirst();
      try { await heartbeat?.drainActiveRunExecutions(); }
      finally {
        registerNativeDraftGateway(db, undefined);
        if (priorApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = priorApiUrl;
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }, 60_000);
  it.each([false, true])("keeps a paused Native Text Task run-free for ordinary and forged wakes, then admits the current Human comment (trigger question: %s)", async triggerQuestion => {
    const fixture = await seedInstalledDraft();
    const { f, human, model } = fixture;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let calls = 0;
    const output = "The held Task has a bounded internal draft for Human review.";
    const privateReason = "PRIVATE-ANCESTOR-HOLD-REASON-794318";
    const inlineSecret = "PRIVATE-INLINE-COMMENT-SECRET-519274";
    const privatePolicyNote = "PRIVATE-ANCESTOR-RELEASE-NOTE-294751";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      expect(body).not.toContain(inlineSecret);
      expect(body).toContain(REDACTED_EVENT_VALUE);
      expect(body).not.toContain(privateReason);
      expect(body).not.toContain(privatePolicyNote);
      expect(body).not.toContain("releasePolicy");
      if (!entry) throw new Error("paused_draft_plan_missing");
      const [reservation] = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservation).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const ancestor = await issueService(db).create(f.home, { title: "Original pause ancestor",
        description: "Original independently captured pause root.", status: "todo", workMode: "standard",
        responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
        { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
      entry = await createDraftPlan(fixture, "Human comment interaction under a pause hold", ancestor.id);
      const originalPlanBody = "Original plan retained with the delivered internal draft.";
      const originalPlan = await documentService(db).upsertIssueDocument({ issueId: entry.task.id, key: "plan", format: "markdown",
        body: originalPlanBody, createdByUserId: f.userId, manualInputActor: human });
      const originalPlanRevisionId = originalPlan.document.latestRevisionId!;
      const questionService = issueThreadInteractionService(db);
      const pendingQuestion = await questionService.create({ id: entry.task.id, companyId: f.home }, {
        kind: "ask_user_questions", payload: { version: 1, questions: [{ id: "direction", prompt: "Which direction?",
          selectionMode: "single", options: [{ id: "internal", label: "Prepare the internal draft" }] }] },
      }, { userId: f.userId, requestActor: human });
      const answeredQuestion = await questionService.answerQuestions({ id: entry.task.id, companyId: f.home, status: entry.task.status },
        pendingQuestion.id, { answers: [{ questionId: "direction", optionIds: ["internal"] }] }, { userId: f.userId, requestActor: human });
      const [hold] = await db.insert(issueTreeHolds).values({
        companyId: f.home, rootIssueId: ancestor.id, mode: "pause", status: "active",
        reason: privateReason,
        releasePolicy: { strategy: "manual", note: privatePolicyNote },
      }).returning();
      expect(hold).toBeDefined();
      const ordinary = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id }, contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" } });
      expect(ordinary).toBeNull();
      const [suppressed] = await db.select().from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, f.home), eq(agentWakeupRequests.agentId, f.presence.id)));
      expect(suppressed).toMatchObject({ status: "skipped", reason: "issue_tree_hold_active" });
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toEqual([]);
      expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entry.plan.id))).toEqual([]);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id))).toEqual([]);
      expect(calls).toBe(0);

      const comment = await issueService(db).addComment(entry.task.id,
        `Please prepare a short internal draft while preserving the pause. ${inlineSecret}`, { userId: f.userId },
        { authorType: "user", manualInputActor: human });
      expect(comment).toMatchObject({ issueId: entry.task.id, authorType: "user", authorUserId: f.userId });
      const forged = await heartbeat.wakeup(f.presence.id, { source: "on_demand", triggerDetail: "manual",
        reason: "issue_commented", payload: { issueId: entry.task.id, commentId: comment.id },
        requestedByActorType: "agent", requestedByActorId: f.presence.id });
      expect(forged).toBeNull();
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toEqual([]);
      expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entry.plan.id))).toEqual([]);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id))).toEqual([]);
      expect(calls).toBe(0);

      const interaction = await heartbeat.wakeup(f.presence.id, { source: "automation", triggerDetail: "system",
        reason: "issue_commented", payload: { issueId: entry.task.id, commentId: comment.id,
          ...(triggerQuestion ? { mutation: "interaction", interactionId: answeredQuestion.id,
            interactionKind: "ask_user_questions", interactionStatus: "answered", sourceCommentId: null, sourceRunId: null } : {}) },
        ...(triggerQuestion ? { idempotencyKey: `interaction:${answeredQuestion.id}:answered`, allowRunCoalescing: false } : {}),
        requestedByActorType: "user", requestedByActorId: f.userId,
        contextSnapshot: { issueId: entry.task.id, commentId: comment.id, wakeCommentId: comment.id,
          wakeReason: "issue_commented", source: "issue.comment",
          ...(triggerQuestion ? { interactionId: answeredQuestion.id, interactionKind: "ask_user_questions", interactionStatus: "answered" } : {}) } });
      expect(interaction).not.toBeNull();
      const [interactionRun] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, interaction!.id)));
      expect(interactionRun?.contextSnapshot).toMatchObject({ treeHoldInteraction: true,
        activeTreeHold: { holdId: hold!.id, rootIssueId: ancestor.id, mode: "pause", interaction: true, reason: privateReason } });
      await vi.waitFor(() => { expect(calls).toBe(1); }, { timeout: 20_000, interval: 25 });
      await heartbeat.drainActiveRunExecutions();
      expect(calls).toBe(1);
      await assertCompletedDraft(fixture, entry, interaction!.id, output);
      const [heldAfterInteraction] = await db.select({ status: issueTreeHolds.status }).from(issueTreeHolds)
        .where(and(eq(issueTreeHolds.companyId, f.home), eq(issueTreeHolds.id, hold!.id)));
      expect(heldAfterInteraction).toMatchObject({ status: "active" });
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ id: interaction!.id, nativeIssueId: entry.task.id,
        responsibleUserId: f.userId, runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
      const receipt = nativeRunInputSourceReceiptSchema.parse(runs[0]!.runnerProfileJson?.nativeInputSourceReceipt);
      // Historical read context cannot activate direct-response session recovery.
      const directResponses = parseNativeExecutionInput(runs[0]!.runnerProfileJson?.nativeExecutionInput).interactionResponses;
      if (triggerQuestion) expect(directResponses.map(response => response.interactionId)).toEqual([answeredQuestion.id]);
      else expect(directResponses).toEqual([]);
      expect(receipt.bootstrap.inputs).toContainEqual(expect.objectContaining({ kind: "task", issueId: ancestor.id }));
      const wake = (runs[0]!.contextSnapshot as Record<string, unknown>).paperclipWake as Record<string, unknown>;
      expect(wake.activeTreeHold).toEqual({ holdId: hold!.id, rootIssueId: ancestor.id, mode: "pause", interaction: true });
      expect(wake.planReviewContext).toMatchObject({ documentKey: "plan", latestRevisionId: originalPlanRevisionId, interaction: null });
      expect(receipt.bootstrap.inputs).toContainEqual(expect.objectContaining({ kind: "document_revision", revisionId: originalPlanRevisionId }));
      const questionSources = receipt.bootstrap.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "interaction" }> =>
        source.kind === "interaction" && source.interactionId === answeredQuestion.id);
      expect(questionSources).toHaveLength(2);
      expect(new Set(questionSources.map(source => source.contentHash)).size).toBe(2);
      expect(JSON.stringify(wake)).not.toContain(privateReason);
      expect(JSON.stringify(wake)).not.toContain(privatePolicyNote);
      const [revision] = await db.select({ id: documentRevisions.id }).from(issueDocuments)
        .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
        .innerJoin(documentRevisions, eq(documentRevisions.id, documents.latestRevisionId))
        .where(and(eq(issueDocuments.issueId, entry.task.id), eq(issueDocuments.key, "result")));
      if (!revision) throw new Error("pause_source_result_revision_missing");
      const sourceRead = (sourceDb = db, actor = human, companyId = f.home) =>
        assertNativeDocumentRevisionCurrentSourceAccess(sourceDb, { companyId, issueId: entry!.task.id, revisionId: revision.id, actor });
      await expect(sourceRead()).resolves.toBeUndefined();
      await issueTreeControlService(db).releaseHold(f.home, ancestor.id, hold!.id,
        { actor: { actorType: "user", actorId: f.userId, userId: f.userId } });
      await expect(sourceRead()).resolves.toBeUndefined();
      // The delivered rendition depends on the original plan, not forever on
      // its latest pointer. The original revision and current ACL still apply.
      await documentService(db).upsertIssueDocument({ issueId: entry.task.id, key: "plan", format: "markdown",
        body: "A later plan must not replace the delivered original rendition.", baseRevisionId: originalPlanRevisionId });
      await expect(sourceRead()).resolves.toBeUndefined();
      expect(calls).toBe(1);
      await expect(sourceRead(db, human, randomUUID())).rejects.toMatchObject({ status: 403 });
      await expect(sourceRead(db, { type: "none", source: "none" })).rejects.toMatchObject({ status: 403 });
      const viewer = await seedCurrentHumanSourceActor(db, [f.home], `pause-viewer-${randomUUID()}`);
      await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(
        eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, viewer.userId!)));
      await expect(sourceRead(db, viewer)).resolves.toBeUndefined();
      // Rollback each corruption so every refusal is independent and the
      // final positive still uses the original sealed prefix and current ACL.
      let mutationIndex = 0;
      const unexpectedSourceAcceptances: number[] = [];
      const rejectedMutation = (mutate: (tx: typeof db) => Promise<unknown>, actor = human) => db.transaction(async rawTx => {
        const index = ++mutationIndex;
        const tx = rawTx as unknown as typeof db;
        await tx.execute(sql`savepoint pause_source_negative`);
        try {
          await mutate(tx);
          await sourceRead(tx, actor).then(() => { unexpectedSourceAcceptances.push(index); },
            error => { expect(error).toMatchObject({ status: 403 }); });
        } finally { await tx.execute(sql`rollback to savepoint pause_source_negative`); }
      });
      await rejectedMutation(tx => tx.update(issues).set({ visibility: "private" }).where(eq(issues.id, ancestor.id)), viewer);
      await rejectedMutation(tx => tx.update(companyMemberships).set({ status: "suspended" }).where(and(
        eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId))));
      await rejectedMutation(tx => tx.update(issueComments).set({ deletedAt: new Date() }).where(eq(issueComments.id, comment.id)));
      await rejectedMutation(async tx => {
        const [withdrawn] = await tx.update(documentRevisions).set({ payloadSourceSnapshot: null })
          .where(eq(documentRevisions.id, originalPlanRevisionId))
          .returning({ invalidated: documentRevisions.payloadSourceSnapshotInvalidated });
        expect(withdrawn?.invalidated).toBe(true);
      });
      await rejectedMutation(tx => tx.update(issueDocuments).set({ key: "former-plan" })
        .where(and(eq(issueDocuments.issueId, entry!.task.id), eq(issueDocuments.key, "plan"))));
      await rejectedMutation(tx => tx.update(issueThreadInteractions).set({ resolvedByUserId: "forged-question-human" })
        .where(eq(issueThreadInteractions.id, answeredQuestion.id)));
      await rejectedMutation(tx => tx.update(issueThreadInteractions).set({ resolvedByAgentId: f.presence.id })
        .where(eq(issueThreadInteractions.id, answeredQuestion.id)));
      await rejectedMutation(tx => tx.update(issueThreadInteractions).set({ sourceRunId: interaction!.id })
        .where(eq(issueThreadInteractions.id, answeredQuestion.id)));
      await rejectedMutation(tx => tx.update(issueThreadInteractions).set({ updatedAt: new Date() })
        .where(eq(issueThreadInteractions.id, answeredQuestion.id)));
      await rejectedMutation(tx => tx.update(agentWakeupRequests).set({ requestedByActorId: "forged-human" })
        .where(eq(agentWakeupRequests.id, runs[0]!.wakeupRequestId!)));
      await rejectedMutation(tx => tx.update(issueTreeHolds).set({ rootIssueId: entry!.task.id }).where(eq(issueTreeHolds.id, hold!.id)));
      await rejectedMutation(tx => tx.update(heartbeatRuns).set({ contextSnapshot: { ...runs[0]!.contextSnapshot,
        paperclipWake: { ...wake, activeTreeHold: { ...(wake.activeTreeHold as object), holdId: randomUUID() } } } })
        .where(eq(heartbeatRuns.id, interaction!.id)));
      // The original receipt trigger atomically refuses this statement before
      // a reader can see a changed prefix. Keep that guard enabled.
      await expect(db.update(heartbeatRuns).set({ runnerProfileJson: { ...runs[0]!.runnerProfileJson,
        nativeInputSourceReceipt: { ...receipt, bootstrap: { ...receipt.bootstrap, inputs: receipt.bootstrap.inputs
          .filter(source => !(source.kind === "task" && source.issueId === ancestor.id)) } } } })
        .where(eq(heartbeatRuns.id, interaction!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(sourceRead()).resolves.toBeUndefined();
      expect(calls).toBe(1);
      expect(unexpectedSourceAcceptances).toEqual([]);
    }, async ({ stage, runId }) => {
      if (stage === "claim") await createRunSecretRedactionRegistry(db).register(f.home, runId, inlineSecret);
    });
  }, 60_000);
  it("runs unrelated assigned Native Text tasks concurrently under separate issue claims", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    await db.update(agents).set({ runtimeConfig: { heartbeat: {
      enabled: false, wakeOnDemand: true, maxConcurrentRuns: 2,
    } } }).where(eq(agents.id, f.presence.id));

    const entries: Awaited<ReturnType<typeof createDraftPlan>>[] = [];
    const dispatchedPlanIds: string[] = [];
    let closing = false;
    const releaseResponses: Array<() => void> = [];
    let calls = 0;
    const output = (ordinal: number) => `Unrelated Native draft ${ordinal} retained for Human review.`;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const ordinal = ++calls;
      expect(ordinal).toBeLessThanOrEqual(2);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const entry = entries[ordinal - 1];
      if (!entry) throw new Error("unrelated_native_draft_plan_missing");
      dispatchedPlanIds.push(entry.plan.id);
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      await new Promise<void>(resolve => {
        if (closing) resolve();
        else releaseResponses.push(resolve);
      });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output(ordinal) }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const releaseBoth = () => { for (const release of releaseResponses.splice(0)) release(); };
      try {
        entries.push(await createDraftPlan(fixture, "Unrelated issue claim one"));
        entries.push(await createDraftPlan(fixture, "Unrelated issue claim two"));
        expect(entries[0]!.task.id).not.toBe(entries[1]!.task.id);
        const wake = (issueId: string) => heartbeat.wakeup(f.presence.id, {
          source: "assignment", triggerDetail: "system", reason: "issue_assigned",
          requestedByActorType: "user", requestedByActorId: f.userId,
          payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" },
        });
        const first = await wake(entries[0]!.task.id);
        expect(first).not.toBeNull();
        await vi.waitFor(() => { expect(calls).toBe(1); }, { timeout: 10_000, interval: 25 });
        const second = await wake(entries[1]!.task.id);
        expect(second).not.toBeNull();
        expect(second!.id).not.toBe(first!.id);
        await vi.waitFor(() => { expect(calls).toBe(2); }, { timeout: 10_000, interval: 25 });

        const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
        expect(runs).toHaveLength(2);
        expect(new Set(runs.map(run => run.id))).toEqual(new Set([first!.id, second!.id]));
        expect(dispatchedPlanIds).toHaveLength(2);
        expect(new Set(dispatchedPlanIds)).toEqual(new Set(entries.map(entry => entry.plan.id)));
        for (const [index, entry] of entries.entries()) {
          const runId = index === 0 ? first!.id : second!.id;
          const run = runs.find(candidate => candidate.id === runId);
          expect(run).toMatchObject({ nativeIssueId: entry.task.id, responsibleUserId: f.userId,
            runtimeMode: "native", driverKind: "aw_text_messages", status: "running", error: null });
          const [issue] = await db.select().from(issues).where(eq(issues.id, entry.task.id));
          expect(issue).toMatchObject({ assigneeAgentId: f.presence.id, executionRunId: runId });
          const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entry.plan.id));
          expect(attempts).toHaveLength(1);
          expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id });
          expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id)))
            .toEqual([expect.objectContaining({ status: "dispatched", workerAttemptId: attempts[0]!.id })]);
          expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId))).toEqual([]);
          expect(await documentService(db).getIssueDocumentByKey(entry.task.id, "result")).toBeNull();
        }
        expect(calls).toBe(2);
        releaseBoth();
        await heartbeat.drainActiveRunExecutions();
        for (const [index, entry] of entries.entries()) {
          const runId = index === 0 ? first!.id : second!.id;
          await assertCompletedDraft(fixture, entry, runId, output(index + 1));
        }
        expect(calls).toBe(2);
        expect(new Set(dispatchedPlanIds)).toEqual(new Set(entries.map(entry => entry.plan.id)));
      } finally {
        closing = true;
        releaseBoth();
      }
    });
  }, 60_000);

  // Same current-Human/Plan and installed HTTP/listener owners as the two
  // cases above. The new cases share only their identical local setup/proofs.
  async function createDraftPlan(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>, title: string, parentId?: string,
    project?: { projectId: string; projectWorkspaceId: string }, budgets: { maxModelCostMinor: number; maxToolActions: number } =
      { maxModelCostMinor: 6, maxToolActions: 3 }) {
    const { f, human } = fixture;
    const tasks = issueService(db), plans = orchestrationService(db);
    const draft = await tasks.create(f.home, { title, description: "Retain one internal document for Human review; no interactive tools or external effects.",
      status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId,
      ...(project ? { projectId: project.projectId, projectWorkspaceId: project.projectWorkspaceId,
        executionWorkspaceSettings: { mode: "isolated_workspace" } } : {}), ...(parentId ? { parentId } : {}) }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, actorUserId: f.userId, privacyActor: human });
    if (!task) throw new Error("dependency_domain_draft_missing");
    const plan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
      workload: "semantic", riskClass: "C0", completionContract: { objective: title,
        requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
      budgets, workers: [{ key: "native-writer", issueId: task.id }] });
    await plans.decide(human, f.home, plan.id, { expectedVersion: plan.version, action: "start",
      rationale: "Admit one eligible internal document through the installed controller and real scheduler" });
    return { task, plan };
  }

  async function withInstalledDraftTransport(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>,
    fetch: typeof guardedRemoteHttpFetch, drive: (heartbeat: ReturnType<typeof heartbeatService>) => Promise<void>,
    beforeChatControlRecoveryCheck?: (input: { runId: string; issueId: string; stage: "claim" | "dispatch" }) => Promise<void>,
    beforeNativeRuntimeSelection?: (runId: string) => Promise<void>) {
    const consumer = workerModelGateway(db, { profiles: [fixture.profile], sourceSha,
      protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(createToolGatewayService(db))); app.use(errorHandler);
    const server = createServer(app), priorApiUrl = process.env.PAPERCLIP_API_URL;
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    const substitution = vi.fn(() => { throw new Error("Installed draft controller must not use the provider backend seam"); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("dependency_domain_api_listener_missing");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${address.port}`;
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, {
        nativeSessionBackendFactory: substitution,
        ...(beforeChatControlRecoveryCheck ? { beforeChatControlRecoveryCheck } : {}),
        ...(beforeNativeRuntimeSelection ? { beforeNativeRuntimeSelection } : {}),
      });
      await drive(heartbeat);
      expect(substitution).not.toHaveBeenCalled();
    } finally {
      try { await heartbeat?.drainActiveRunExecutions(); }
      finally {
        registerNativeDraftGateway(db, undefined);
        if (priorApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = priorApiUrl;
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }

  async function createCanonicalGitWorkspace(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>) {
    const repoRoot = await mkdtemp(join(tmpdir(), "native-finalize-git-"));
    await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.email", "fixture@example.test"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.name", "Native Finalize Fixture"], { cwd: repoRoot });
    await writeFile(join(repoRoot, "README.md"), "managed native workspace\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoRoot });
    const app = express(); app.use(express.json());
    app.use(((req, _res, next) => {
      req.actor = { type: "board", source: "session", userId: fixture.f.userId,
        sessionId: fixture.human.sessionId ?? undefined, companyIds: [fixture.f.home],
        memberships: [{ companyId: fixture.f.home, membershipRole: "owner", status: "active" }] };
      next();
    }) as import("express").RequestHandler);
    app.use("/api", projectRoutes(db)); app.use(errorHandler);
    // The complete Human constructor captures the Project and its exact initial workspace together.
    const response = await request(app).post(`/api/companies/${fixture.f.home}/projects`).send({
      name: "Native Finalize Git Project", workspace: { name: "Primary", cwd: repoRoot, isPrimary: true } });
    expect(response.status).toBe(201);
    expect(response.body.workspaces).toHaveLength(1);
    const workspaceId: unknown = response.body.workspaces[0]?.id;
    if (typeof response.body.id !== "string" || typeof workspaceId !== "string")
      throw new Error("canonical_human_git_project_workspace_missing");
    return { projectId: response.body.id as string, projectWorkspaceId: workspaceId, repoRoot };
  }

  async function finalizeWorkspaceFixture(companyId: string, taskId: string) {
    const [workspace] = await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.sourceIssueId, taskId)));
    if (!workspace?.cwd || !workspace.branchName) throw new Error("native_finalize_git_workspace_missing");
    return workspace;
  }

  const branchFinalizeOutput = "Retain this bounded text result for Human review.";
  function finalizeTransport(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>, onDispatch: () => Promise<void>) {
    return (async (url: Parameters<typeof guardedRemoteHttpFetch>[0], init: Parameters<typeof guardedRemoteHttpFetch>[1]) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model: fixture.model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      await onDispatch();
      return new Response(JSON.stringify({ type: "message", role: "assistant", model: fixture.model, stop_reason: "end_turn",
        content: [{ type: "text", text: branchFinalizeOutput }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof guardedRemoteHttpFetch;
  }

  async function runNativeBranchFinalize(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>, transition: "repair" | "adopt" | "persist") {
    const settings = instanceSettingsService(db), priorFeatures = await settings.getExperimental();
    await settings.updateExperimental({ enableIsolatedWorkspaces: true });
    try {
      const { f } = fixture, git = await createCanonicalGitWorkspace(fixture);
      let entry: Awaited<ReturnType<typeof createDraftPlan>>;
      let workspaceId = "", originalBranch = "", calls = 0;
      const fetch = finalizeTransport(fixture, async () => {
        expect(++calls).toBe(1);
        const workspace = await finalizeWorkspaceFixture(f.home, entry.task.id);
        workspaceId = workspace.id; originalBranch = workspace.branchName!;
        const branch = `publish-${entry.task.id.slice(0, 8)}`;
        await execFileAsync("git", ["checkout", "-b", branch], { cwd: workspace.cwd! });
        if (transition === "adopt") {
          await writeFile(join(workspace.cwd!, "publish.txt"), "publish branch work\n");
          await execFileAsync("git", ["add", "publish.txt"], { cwd: workspace.cwd! });
          await execFileAsync("git", ["commit", "-m", "Add publish branch work"], { cwd: workspace.cwd! });
        }
        if (transition === "persist") await db.update(executionWorkspaces).set({ branchName: branch, updatedAt: new Date() }).where(eq(executionWorkspaces.id, workspace.id));
      });
      await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
        entry = await createDraftPlan(fixture, `Native finalization ${transition}`, undefined, git);
        const wake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
          requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: entry.task.id },
          contextSnapshot: { issueId: entry.task.id, projectId: git.projectId, wakeReason: "issue_assigned" } });
        if (!wake) throw new Error("native_finalize_branch_wake_missing");
        await heartbeat.drainActiveRunExecutions();
        await assertCompletedDraft(fixture, entry, wake.id, branchFinalizeOutput);
        expect(calls).toBe(1);
        const [finishedRun] = await db.select({ errorCode: heartbeatRuns.errorCode }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, wake.id)));
        expect(finishedRun?.errorCode).toBeNull();
        const [runtimeState] = await db.select({ lastRunId: agentRuntimeState.lastRunId }).from(agentRuntimeState)
          .where(and(eq(agentRuntimeState.companyId, f.home), eq(agentRuntimeState.agentId, f.presence.id)));
        expect(runtimeState?.lastRunId).toBe(wake.id);
        const ops = await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.companyId, f.home), eq(workspaceOperations.heartbeatRunId, wake.id), eq(workspaceOperations.phase, "workspace_finalize")));
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ status: "succeeded", executionWorkspaceId: workspaceId });
        if (transition === "repair") {
          expect(await execFileAsync("git", ["branch", "--show-current"], { cwd: (await finalizeWorkspaceFixture(f.home, entry.task.id)).cwd! })).toMatchObject({ stdout: `${originalBranch}\n` });
          const publishBranch = `publish-${entry.task.id.slice(0, 8)}`;
          const repairs = await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.companyId, f.home),
            eq(workspaceOperations.heartbeatRunId, wake.id), eq(workspaceOperations.phase, "worktree_prepare")));
          expect(repairs).toEqual(expect.arrayContaining([expect.objectContaining({ command: `git checkout ${originalBranch}`,
            status: "succeeded", executionWorkspaceId: workspaceId, metadata: expect.objectContaining({
              branchIncoherenceRepair: true, expectedBranchName: originalBranch, actualBranchName: publishBranch,
              executionWorkspaceId: workspaceId, sourceIssueId: entry.task.id }) })]));
          expect(ops[0]!.metadata).toMatchObject({ managedGitWorktreeBranch: { executionWorkspaceId: workspaceId,
            valid: true, reasonCode: null, expectedBranchName: originalBranch, actualBranchName: originalBranch },
            managedGitWorktreeBranchRepair: { attempted: true, succeeded: true,
              initial: expect.objectContaining({ valid: false, reasonCode: "branch_mismatch",
                expectedBranchName: originalBranch, actualBranchName: publishBranch }) } });
        } else if (transition === "adopt") {
          expect(ops[0]!.metadata).toMatchObject({ managedGitWorktreeBranch: expect.objectContaining({ executionWorkspaceId: workspaceId, valid: true, reasonCode: null,
            expectedBranchName: `publish-${entry.task.id.slice(0, 8)}`, actualBranchName: `publish-${entry.task.id.slice(0, 8)}` }),
            managedGitWorktreeBranchRepair: expect.objectContaining({ attempted: true, succeeded: true }) });
          expect((await db.select({ branchName: executionWorkspaces.branchName }).from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)))[0]?.branchName).toBe(originalBranch);
          expect(originalBranch).not.toBe(`publish-${entry.task.id.slice(0, 8)}`);
        } else {
          const branch = `publish-${entry.task.id.slice(0, 8)}`;
          expect((await db.select({ branchName: executionWorkspaces.branchName }).from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)))[0]?.branchName).toBe(branch);
          expect(ops[0]!.metadata).toMatchObject({ managedGitWorktreeBranch: { executionWorkspaceId: workspaceId, valid: true, reasonCode: null, expectedBranchName: branch, actualBranchName: branch } });
        }
      });
      await rm(git.repoRoot, { recursive: true, force: true });
    } finally {
      await settings.updateExperimental({ enableIsolatedWorkspaces: priorFeatures.enableIsolatedWorkspaces });
    }
  }

  it("repairs clean Native Text branch drift before successful workspace finalization", async () => {
    await runNativeBranchFinalize(await seedInstalledDraft(), "repair");
  }, 60_000);

  it("adopts a Native Text forward branch with commits without persisting the workspace branch", async () => {
    await runNativeBranchFinalize(await seedInstalledDraft(), "adopt");
  }, 60_000);

  it("allows Native Text finalization after the branch transition is persisted", async () => {
    await runNativeBranchFinalize(await seedInstalledDraft(), "persist");
  }, 60_000);

  async function assertCompletedDraft(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>,
    entry: Awaited<ReturnType<typeof createDraftPlan>>, runId: string, body: string) {
    const { f } = fixture; const { task, plan } = entry;
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
    expect(run).toMatchObject({ nativeIssueId: task.id, responsibleUserId: f.userId,
      runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
    const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id });
    const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId));
    expect(manifests).toHaveLength(1);
    expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
    const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ workerAttemptId: attempts[0]!.id, status: "completed", maximumMinor: 3,
      usage: { inputTokens: 10, outputTokens: 20 } });
    expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0])
      .toMatchObject({ toolActionsUsed: 2, modelCostReserved: 3 });
    expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId)))
      .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
    const receipt = nativeRunInputSourceReceiptSchema.parse(run?.runnerProfileJson?.nativeInputSourceReceipt);
    expect(receipt.binding).toMatchObject({ companyId: f.home, agentId: f.presence.id, issueId: task.id, runId });
    expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body)
      .toBe(body);
    const revisions = await db.select({ revision: documentRevisions }).from(issueDocuments)
      .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
      .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
        eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
      .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
    expect(revisions).toHaveLength(1);
    const source = nativePayloadSourceSnapshotSchema.parse(revisions[0]!.revision.payloadSourceSnapshot);
    const intents = run?.runnerProfileJson?.nativeAwModelWireIntents;
    if (!Array.isArray(intents) || intents.length !== 1) throw new Error("capacity_draft_wire_intent_missing");
    const intent: unknown = intents[0];
    if (!intent || typeof intent !== "object" || !("requestHash" in intent) || !("wireBodyHash" in intent))
      throw new Error("capacity_draft_wire_intent_invalid");
    expect(intent.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(intent.wireBodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source.inputs).toContainEqual(expect.objectContaining({ kind: "worker_model_dispatch", runId,
      reservationId: reservations[0]!.id, requestHash: intent.requestHash, wireBodyHash: intent.wireBodyHash }));
    expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.status).not.toBe("done");
  }

  it("coalesces two durable status-wake domain inputs into one real installed-controller Run", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let calls = 0;
    const output = "One coalesced internal draft retained for Human review.";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      expect(++calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      expect(String(init.body)).toContain("assignedRuntimeContext");
      expect(String(init.body)).not.toContain(credential);
      if (!entry) throw new Error("coalesced_draft_plan_missing");
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      entry = await createDraftPlan(fixture, "Retain the coalesced status-wake draft");
      const issueId = entry.task.id;
      // Explicit dispatcher input-domain fixture only: these outbox inputs are
      // not evidence that a real Native status committer emitted them. Run,
      // attempt, manifest, reservation and accepted output remain owner-created.
      const payload = { issueId, taskId: issueId,
        _paperclipWakeContext: { issueId, taskId: issueId, source: "native_status_decision" } };
      const intents = await db.insert(agentWakeupRequests).values([
        { companyId: f.home, agentId: f.presence.id, source: "automation", triggerDetail: "system",
          reason: "issue_children_completed", payload, requestedByActorType: "system",
          requestedByActorId: "native-status-committer", idempotencyKey: `native-parent:${issueId}` },
        { companyId: f.home, agentId: f.presence.id, source: "automation", triggerDetail: "system",
          reason: "issue_blockers_resolved", payload, requestedByActorType: "system",
          requestedByActorId: "native-status-committer", idempotencyKey: `native-dependency:${issueId}` },
      ]).returning({ id: agentWakeupRequests.id });
      expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)))).toEqual([]);
      expect(await heartbeat.dispatchPendingNativeStatusWakeups({ companyId: f.home }))
        .toMatchObject({ scanned: 2, dispatched: 1, recovered: 1 });
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
      expect(runs).toHaveLength(1);
      const deliveries = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, f.home),
        inArray(agentWakeupRequests.requestedByActorId, intents.map(intent => `native-status-wake-dispatch:${intent.id}`))));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.runId).toBe(runs[0]!.id);
      expect(runs[0]).toMatchObject({ contextSnapshot: { source: "native_status_decision", statusDecisionSource: "native_status_decision" } });
      const persisted = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, f.home),
        inArray(agentWakeupRequests.id, intents.map(intent => intent.id))));
      expect(persisted).toHaveLength(2);
      for (const intent of persisted) expect(intent).toMatchObject({ status: "coalesced", runId: runs[0]!.id });
      await assertCompletedDraft(fixture, entry, runs[0]!.id, output);
      expect(calls).toBe(1);
    });
  }, 60_000);

  it("cancels a genuinely queued Task after a Human adds its blocker, repairs its stale pointer, and completes ready work", async () => {
    const fixture = await seedInstalledDraft();
    const { f, human, model } = fixture;
    const entries: Awaited<ReturnType<typeof createDraftPlan>>[] = [];
    const dispatchedPlans: string[] = [];
    let calls = 0;
    let releaseHolder!: () => void;
    const holderResponse = new Promise<void>(resolve => { releaseHolder = resolve; });
    const output = (ordinal: number) => `Queue repair internal draft ${ordinal} retained for Human review.`;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const ordinal = ++calls;
      expect(ordinal).toBeLessThanOrEqual(2);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      expect(String(init.body)).toContain("assignedRuntimeContext");
      expect(String(init.body)).not.toContain(credential);
      const entry = entries[ordinal === 1 ? 0 : 2];
      if (!entry) throw new Error("queue_repair_dispatch_plan_missing");
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      dispatchedPlans.push(entry.plan.id);
      if (ordinal === 1) await holderResponse;
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output(ordinal) }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      try {
        for (const title of ["Capacity holder draft", "Draft blocked after queue admission", "Independent ready draft"])
          entries.push(await createDraftPlan(fixture, title));
        const wake = (issueId: string) => heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
          reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
          payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" } });
        const holder = await wake(entries[0]!.task.id);
        expect(holder).not.toBeNull();
        await vi.waitFor(() => { expect(calls).toBe(1); expect(dispatchedPlans).toEqual([entries[0]!.plan.id]); },
          { timeout: 10_000, interval: 25 });
        const blocked = await wake(entries[1]!.task.id), ready = await wake(entries[2]!.task.id);
        expect(blocked).not.toBeNull(); expect(ready).not.toBeNull();
        expect(new Set([holder!.id, blocked!.id, ready!.id]).size).toBe(3);
        for (const id of [blocked!.id, ready!.id])
          expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, id)))[0]?.status).toBe("queued");
        const [modernQueuedIssue] = await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id));
        expect(modernQueuedIssue).toMatchObject({ executionRunId: null, executionAgentNameKey: null, executionLockedAt: null });
        expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, blocked!.id))).toEqual([]);
        // Explicit legacy/corrupt persisted-pointer input: the actual scheduler
        // created this queued Run above. This does not claim a real modern
        // execution owner stamped the pointer, or fabricate a running/accepted Run.
        const legacyPointer = { executionRunId: blocked!.id, executionAgentNameKey: "fixture-legacy-queued-owner",
          executionLockedAt: new Date() };
        await db.update(issues).set(legacyPointer).where(and(eq(issues.companyId, f.home), eq(issues.id, entries[1]!.task.id)));
        expect((await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id)))[0]).toMatchObject(legacyPointer);
        const tasks = issueService(db);
        const blocker = await tasks.create(f.home, { title: "Human-added unresolved prerequisite", status: "todo",
          responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
          { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
        await tasks.update(entries[1]!.task.id, { blockedByIssueIds: [blocker.id], actorUserId: f.userId, privacyActor: human });
        expect((await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id)))[0]).toMatchObject(legacyPointer);
        expect(calls).toBe(1);
        releaseHolder();
        await heartbeat.drainActiveRunExecutions();
        await heartbeat.resumeQueuedRuns();
        await heartbeat.drainActiveRunExecutions();
        const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
        expect(runs).toHaveLength(3);
        const blockedRun = runs.find(run => run.id === blocked!.id);
        expect(blockedRun).toMatchObject({ status: "cancelled", errorCode: "issue_dependencies_blocked",
          resultJson: expect.objectContaining({ stopReason: "issue_dependencies_blocked" }) });
        expect(blockedRun!.finishedAt).toBeInstanceOf(Date);
        const [blockedWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, blockedRun!.wakeupRequestId!));
        expect(blockedWake).toMatchObject({ status: "skipped" });
        expect(blockedWake!.error).toContain("dependencies are still blocked");
        expect((await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id)))[0])
          .toMatchObject({ executionRunId: null, executionAgentNameKey: null, executionLockedAt: null });
        expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, blocked!.id))).toEqual([]);
        expect(await db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, f.home), eq(toolInvocations.runId, blocked!.id)))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(entries[1]!.task.id, "result")).toBeNull();
        expect(dispatchedPlans).toEqual([entries[0]!.plan.id, entries[2]!.plan.id]);
        expect(calls).toBe(2);
        await assertCompletedDraft(fixture, entries[0]!, holder!.id, output(1));
        await assertCompletedDraft(fixture, entries[2]!, ready!.id, output(2));
        expect(runs.every(run => run.status !== "queued" && run.status !== "running")).toBe(true);
      } finally { releaseHolder(); }
    });
  }, 60_000);

  it.each(["intact", "lost", "copied"] as const)(
    "persists and consumes the chat-control admission marker on a real Native Text C0 Plan: %s",
    async mode => {
      const fixture = await seedInstalledDraft();
      const { f, model } = fixture;
      const entries: Awaited<ReturnType<typeof createDraftPlan>>[] = [];
      const wakeIds: string[] = [];
      let releaseFirst!: () => void;
      const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
      let calls = 0;
      const dispatchedPlanIds: string[] = [];
      const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
        const call = ++calls;
        expect(call).toBeLessThanOrEqual(2);
        expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
        expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
        expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
        expect(JSON.parse(String(init.body)).tools).toBeUndefined();
        expect(String(init.body)).toContain("assignedRuntimeContext");
        expect(String(init.body)).not.toContain(credential);
        const entry = entries[call - 1];
        if (!entry) throw new Error("marker_native_draft_plan_missing");
        dispatchedPlanIds.push(entry.plan.id);
        const reservations = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, entry.plan.id));
        expect(reservations).toHaveLength(1);
        expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
        if (call === 1) await firstResponse;
        init.signal?.throwIfAborted();
        return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
          content: [{ type: "text", text: `Marker ${call} internal draft retained for Human review.` }],
          usage: { input_tokens: 10, output_tokens: 20 } }),
        { status: 200, headers: { "content-type": "application/json" } });
      };
      let secondDispatchMarkerObserved = false;
      await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
        try {
          entries.push(await createDraftPlan(fixture, "Marker admission holder draft"));
          entries.push(await createDraftPlan(fixture, "Marker admission queued draft"));
          // Domain-shaped user-origin automation input matching issue-comment wake provenance;
          // it claims no HTTP-route execution or system continuation ancestry.
          const userAutomationWake = (issueId: string) => heartbeat.wakeup(f.presence.id, {
            source: "automation", triggerDetail: "system", reason: "issue_commented",
            requestedByActorType: "user", requestedByActorId: f.userId,
            payload: { issueId, mutation: "comment" },
            contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_commented", source: "issue.comment" },
          });
          const first = await userAutomationWake(entries[0]!.task.id);
          expect(first).not.toBeNull();
          wakeIds.push(first!.id);
          expect(first).toMatchObject({ invocationSource: "automation" });
          await vi.waitFor(() => {
            expect(calls).toBe(1);
            expect(dispatchedPlanIds).toEqual([entries[0]!.plan.id]);
          }, { timeout: 10_000, interval: 25 });
          const [activeFirst] = await db.select().from(heartbeatRuns)
            .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, first!.id)));
          expect(activeFirst).toMatchObject({ invocationSource: "automation", runtimeMode: "native", driverKind: "aw_text_messages", status: "running" });

          const second = await userAutomationWake(entries[1]!.task.id);
          expect(second).not.toBeNull();
          wakeIds.push(second!.id);
          expect(second).toMatchObject({ invocationSource: "automation" });
          expect((await db.select().from(heartbeatRuns)
            .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, second!.id))))[0])
            .toMatchObject({ status: "queued" });
          expect(calls).toBe(1);
          expect(dispatchedPlanIds).toEqual([entries[0]!.plan.id]);
          expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id))).toEqual([]);
          expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
          expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, second!.id))).toEqual([]);

          releaseFirst();
          await heartbeat.drainActiveRunExecutions();
        } finally {
          releaseFirst();
          await heartbeat.drainActiveRunExecutions();
        }
      }, async ({ runId, issueId, stage }) => {
        if (stage !== "dispatch") return;
        const entryIndex = entries.findIndex(entry => entry.task.id === issueId);
        if (entryIndex < 0) return;
        const [row] = await db.select().from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
        expect(row).toBeDefined();
        expect(row).toMatchObject({ invocationSource: "automation", runtimeMode: "native", driverKind: "aw_text_messages" });
        expect(readChatControlRecoveryAdmission(row!)).toBe("required");
        if (entryIndex === 1) {
          secondDispatchMarkerObserved = true;
          if (mode === "lost") {
            const profile = { ...(row!.runnerProfileJson ?? {}) };
            delete profile[CHAT_CONTROL_RECOVERY_ADMISSION_KEY];
            await db.update(heartbeatRuns).set({ runnerProfileJson: profile })
              .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
          } else if (mode === "copied") {
            await db.update(heartbeatRuns).set({ runnerProfileJson: {
              ...(row!.runnerProfileJson ?? {}),
              [CHAT_CONTROL_RECOVERY_ADMISSION_KEY]: {
                ...chatControlRecoveryAdmission(row!, "required"),
                runId: wakeIds[0]!,
              },
            } }).where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
          }
        }
      });
      const firstId = wakeIds[0]!, secondId = wakeIds[1]!;
      expect(secondDispatchMarkerObserved).toBe(true);
      await assertCompletedDraft(fixture, entries[0]!, firstId, "Marker 1 internal draft retained for Human review.");
      const [firstRun] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, firstId)));
      expect(readChatControlRecoveryAdmission(firstRun!)).toBe("admitted");
      const [secondRun] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, secondId)));
      expect(secondRun).toBeDefined();
      if (mode === "intact") {
        expect(calls).toBe(2);
        expect(dispatchedPlanIds).toEqual(entries.map(({ plan }) => plan.id));
        expect(readChatControlRecoveryAdmission(secondRun!)).toBe("admitted");
        await assertCompletedDraft(fixture, entries[1]!, secondId, "Marker 2 internal draft retained for Human review.");
      } else {
        expect(calls).toBe(1);
        expect(dispatchedPlanIds).toEqual([entries[0]!.plan.id]);
        expect(secondRun).toMatchObject({ nativeIssueId: entries[1]!.task.id, invocationSource: "automation",
          runtimeMode: "native", driverKind: "aw_text_messages", status: "failed",
          errorCode: CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE,
          resultJson: expect.objectContaining({ automaticRecovery: { code: CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE, providerDispatched: false } }) });
        const [secondWake] = await db.select().from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, secondRun!.wakeupRequestId!));
        expect(secondWake).toMatchObject({ status: "failed", runId: secondId });
        expect(readChatControlRecoveryAdmission(secondRun!)).toBe(mode === "lost" ? "historical" : "invalid");
        // Runtime Fabric admits the actual run before the later dispatch gate. The
        // gate terminalizes the Run but does not synchronously reconcile its
        // orchestration attempt; supervision/admission owns that later transition.
        const secondManifests = await db.select().from(agentExecutionManifests)
          .where(and(eq(agentExecutionManifests.companyId, f.home), eq(agentExecutionManifests.runId, secondId)));
        expect(secondManifests).toHaveLength(1);
        const secondAttempts = await db.select().from(orchestrationWorkerAttempts)
          .where(and(eq(orchestrationWorkerAttempts.companyId, f.home), eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id)));
        expect(secondAttempts).toHaveLength(1);
        expect(secondAttempts[0]).toMatchObject({ runId: secondId, executionManifestId: secondManifests[0]!.id, status: "running", attempt: 1 });
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, secondId))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(entries[1]!.task.id, "result")).toBeNull();
      }
    },
  );

  it("pauses an installed Native Text Run through the canonical Human Agent-pause owner before selection", async () => {
    const previousFlags = await instanceSettingsService(db).getExperimental();
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, progressive_shell_v9: true });
    try {
    const fixture = await seedInstalledDraft(), { f, human } = fixture;
    let heartbeatOwner: ReturnType<typeof heartbeatService> | undefined;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let pausePromise: Promise<void> | undefined;
    let pauseError: unknown, selectedRunId = "", selectionReached = false, calls = 0;
    const pauseRequestId = randomUUID();
    const fetch: typeof guardedRemoteHttpFetch = async () => { calls++; throw new Error("Pause must precede controlled model HTTP"); };
    const beforeSelection = async (runId: string) => {
      if (!heartbeatOwner || !entry) throw new Error("canonical_pause_fixture_owner_missing");
      selectionReached = true; selectedRunId = runId;
      expect(await heartbeatOwner.getRun(runId)).toMatchObject({ companyId: f.home, agentId: f.presence.id,
        responsibleUserId: human.userId, status: "running", runtimeMode: "legacy", runtimeModeResolvedAt: null,
        nativeSessionId: null });
      expect(calls).toBe(0);
      const pauseOwner = agentPauseService(db);
      const review = await pauseOwner.review(human, f.home, f.presence.id);
      expect(review).toMatchObject({ companyId: f.home, agentId: f.presence.id, canPause: true });
      // Start canonical pause while selection is held, but let the hook unwind
      // before awaiting its stop owner to avoid coupling cancellation to the gate.
      pausePromise = pauseOwner.pause(human, f.home, f.presence.id, { requestId: pauseRequestId,
        expectedSourceToken: review.sourceToken, pendingWork: "cancel", confirmPause: true })
        .then(() => undefined, error => { pauseError = error; });
      await vi.waitFor(async () => {
        expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]?.status).toBe("paused");
        const current = await heartbeatOwner!.getRun(runId);
        const result = current?.resultJson as Record<string, unknown> | null;
        expect(current?.status === "cancelled" ||
          typeof (result?.startupCancellation as Record<string, unknown> | undefined)?.requestedAt === "string" ||
          (result?.executionCancellation as Record<string, unknown> | undefined)?.state === "requested").toBe(true);
      }, { timeout: 5_000, interval: 25 });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      heartbeatOwner = heartbeat;
      entry = await createDraftPlan(fixture, "Canonical Agent pause before Native selection");
      const wake = await heartbeat.wakeup(f.presence.id, { source: "automation", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: human.userId!, payload: { issueId: entry.task.id },
        contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" } });
      expect(wake).not.toBeNull();
      if (!wake) throw new Error("canonical_pause_run_missing");
      await heartbeat.drainActiveRunExecutions();
      expect(pausePromise).toBeDefined();
      await pausePromise;
      expect(pauseError).toBeUndefined();
      expect(selectionReached).toBe(true); expect(selectedRunId).toBe(wake.id);
      const receipt = await agentPauseService(db).receipt(human, f.home, f.presence.id, pauseRequestId);
      expect(receipt).toMatchObject({ companyId: f.home, agentId: f.presence.id, requestId: pauseRequestId,
        pendingWork: "cancel", admissionClosedAtAcceptance: true, workSettled: false });
      expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]).toMatchObject({ status: "paused", pauseReason: "manual" });
      const [audit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home),
        eq(activityLog.action, "agent.paused"), eq(activityLog.entityId, f.presence.id)));
      expect(audit).toMatchObject({ actorType: "user", actorId: human.userId, details: { pauseRequestId, pendingWork: "cancel" } });
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
      expect(run).toMatchObject({ status: "cancelled", runtimeMode: "legacy", runtimeModeResolvedAt: null, nativeSessionId: null });
      expect(await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake.id))).toEqual([]);
      const [task] = await db.select().from(issues).where(eq(issues.id, entry!.task.id));
      expect(task).toMatchObject({ executionRunId: null, executionAgentNameKey: null, executionLockedAt: null });
      expect(task?.status).not.toBe("done");
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id))).toEqual([]);
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, wake.id))).toEqual([]);
      expect(await documentService(db).getIssueDocumentByKey(entry.task.id, "result")).toBeNull();
      expect(calls).toBe(0);
    }, undefined, beforeSelection);
    } finally {
      await instanceSettingsService(db).updateExperimental({ experience_projection_v9: previousFlags.experience_projection_v9,
        progressive_shell_v9: previousFlags.progressive_shell_v9 });
    }
  }, 60_000);

  // These are genuine scheduler/Plan/current-Human cancellation fences, not a
  // provider backend mock. Both intentionally stop before the HTTP controller.
  it.each(["before_selection", "after_selection", "before_selection_row_lock"] as const)(
    "cancels a real installed-controller Run at %s without dispatching its model",
    async phase => {
      const fixture = await seedInstalledDraft(), {f} = fixture;
      let heartbeatOwner: ReturnType<typeof heartbeatService> | undefined;
      let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
      let selectedRunId: string | null = null;
      let selectionReached = false, dispatchReached = false, calls = 0;
      let cancellation: Promise<unknown> | undefined, cancellationError: unknown;
      let blockerPid: number | undefined;
      let rowLockRelease: (() => void) | undefined;
      let rowLockTransaction: Promise<void> | undefined;
      let readRowLockWaiters: (() => Promise<{stopBlocked:number;selectionBlocked:number;runStatus:string;runtimeMode:string;coordinatorCount:number;waiterFacts:unknown}>) | undefined;
      let rowLockError: unknown;
      let blockedUpdateObserved = false;
      const fetch: typeof guardedRemoteHttpFetch = async () => {
        calls++;
        throw new Error("Cancellation fence must precede actual controlled model HTTP");
      };
      const beforeSelection = async (runId: string) => {
        if (!heartbeatOwner || !entry) throw new Error("cancellation_fence_owner_missing");
        selectionReached = true; selectedRunId = runId;
        const current = await heartbeatOwner.getRun(runId);
        expect(current).toMatchObject({companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,
          runtimeMode:"legacy",runtimeModeResolvedAt:null,nativeSessionId:null});
        expect(calls).toBe(0);
        if (phase === "before_selection") await heartbeatOwner.cancelRun(runId,"Cancel before Native selection");
        if (phase === "before_selection_row_lock") {
          let releaseLock!: () => void;
          const lockGate = new Promise<void>(resolve => { releaseLock=resolve; });
          rowLockRelease = releaseLock;
          rowLockTransaction = db.transaction(async tx => {
            await tx.select({id:heartbeatRuns.id}).from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)).for("update");
            const [identity] = await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
            blockerPid=identity!.pid;
            readRowLockWaiters = async () => {
              // Activity text can truncate the selected table and FOR UPDATE.
              // A top-level SELECT blocked by this Run's Stop identifies selection.
              await tx.execute(sql`select pg_stat_clear_snapshot()`);
              const [blocked] = await tx.execute<{stop_blocked:number;selection_blocked:number;waiter_facts:unknown}>(sql`
                with waiters as (
                  select pid,query,state,wait_event_type,pg_blocking_pids(pid) as blockers
                  from pg_stat_activity where datname=current_database()
                ), stops as (
                  select pid from waiters
                  where ${blockerPid}=any(blockers) and query ilike '%update%heartbeat_runs%'
                )
                select jsonb_agg(jsonb_build_object('holder',pid=${blockerPid},'state',state,'waitType',wait_event_type,
                    'blockerCount',cardinality(blockers),'runRow',query ilike '%heartbeat_runs%',
                    'issueRow',query ilike '%issues%','rowSelection',query ilike '%for update%',
                    'stopUpdate',query ilike '%update%heartbeat_runs%')) as waiter_facts,
                  (select count(*)::int from stops) as stop_blocked,
                  count(*) filter (where query ilike 'select %'
                    and (${blockerPid}=any(blockers) or exists (
                      select 1 from stops where stops.pid=any(waiters.blockers)
                    )))::int as selection_blocked
                from waiters
              `);
              const [current] = await tx.select({status:heartbeatRuns.status,runtimeMode:heartbeatRuns.runtimeMode})
                .from(heartbeatRuns).where(eq(heartbeatRuns.id,runId));
              const coordinators = await tx.select({runId:nativeRunFinalizations.runId})
                .from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId,runId));
              return {stopBlocked:blocked!.stop_blocked,selectionBlocked:blocked!.selection_blocked,
                runStatus:current!.status,runtimeMode:current!.runtimeMode,coordinatorCount:coordinators.length,waiterFacts:blocked!.waiter_facts};
            };
            await lockGate;
          }).catch(error => { rowLockError=error; });
          await vi.waitFor(() => expect(blockerPid).toEqual(expect.any(Number)),{timeout:5_000,interval:25});
          cancellation = heartbeatOwner.cancelRun(runId,"Cancel while Native selection row is locked")
            .catch(error=>{cancellationError=error;});
          await vi.waitFor(async () => {
            const snapshot=await readRowLockWaiters!();
            expect(snapshot.stopBlocked).toBeGreaterThan(0);
          },{timeout:5_000,interval:25});
          blockedUpdateObserved=true;
        }
      };
      const beforeDispatch = async ({runId,issueId,stage}: {runId:string;issueId:string;stage:"claim"|"dispatch"}) => {
        if (stage !== "dispatch" || phase !== "after_selection") return;
        if (!heartbeatOwner || !entry) throw new Error("cancellation_fence_owner_missing");
        dispatchReached = true;
        expect(issueId).toBe(entry.task.id);expect(runId).toBe(selectedRunId);
        expect(await heartbeatOwner.getRun(runId)).toMatchObject({runtimeMode:"native",nativeIssueId:entry.task.id});
        expect(calls).toBe(0);
        // Cancellation can await this executor. Start it, observe its actual
        // durable fence with a bounded wait, then let the hook unwind.
        cancellation = heartbeatOwner.cancelRun(runId,"Cancel after Native selection")
          .catch(error=>{cancellationError=error;});
        await vi.waitFor(async () => {
          const current=await heartbeatOwner!.getRun(runId);
          expect(current?.resultJson).toMatchObject({startupCancellation:{requestedAt:expect.any(String)}});
        },{timeout:5_000,interval:25});
      };
      await withInstalledDraftTransport(fixture,fetch,async heartbeat => {
        heartbeatOwner=heartbeat;
        try {
        // The helper installed this exact profile/gateway before Plan admission.
        entry=await createDraftPlan(fixture,`Cancellation fence ${phase}`);
        const wake=await heartbeat.wakeup(f.presence.id,{source:"automation",triggerDetail:"system",reason:"issue_assigned",
          requestedByActorType:"user",requestedByActorId:f.userId,payload:{issueId:entry.task.id},
          contextSnapshot:{issueId:entry.task.id,wakeReason:"issue_assigned"}});
        expect(wake).not.toBeNull();
        if (!wake) throw new Error("cancellation_fence_run_missing");
        if (phase === "before_selection_row_lock") {
          const drain = heartbeat.drainActiveRunExecutions();
          try {
            await vi.waitFor(()=>expect(blockedUpdateObserved).toBe(true),{timeout:5_000,interval:25});
            await vi.waitFor(async () => {
              const snapshot=await readRowLockWaiters!();
              expect(snapshot.selectionBlocked,JSON.stringify(snapshot)).toBeGreaterThan(0);
              expect(snapshot.stopBlocked).toBeGreaterThan(0);
              expect(snapshot.runStatus).toBe("running");
              expect(snapshot.runtimeMode).toBe("legacy");
              expect(snapshot.coordinatorCount).toBe(0);
            },{timeout:5_000,interval:25});
            expect(calls).toBe(0);
          } finally {
            rowLockRelease?.();
            await rowLockTransaction;
          }
          if (rowLockError) throw rowLockError;
          await drain;
          expect(blockedUpdateObserved).toBe(true);
        } else {
          await heartbeat.drainActiveRunExecutions();
        }
        await cancellation;
        expect(cancellationError).toBeUndefined();
        expect(selectionReached).toBe(true);expect(selectedRunId).toBe(wake.id);
        expect(dispatchReached).toBe(phase==="after_selection");
        const runs=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), notInArray(heartbeatRuns.id, fixture.conformanceRunIds)));
        expect(runs).toHaveLength(1);
        const run=runs[0]!;
        expect(run).toMatchObject({id:wake.id,companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,
          status:"cancelled",runtimeMode:phase==="after_selection"?"native":"legacy",
          resultJson:{startupPreparationSettledAt:expect.any(String)}});
        const coordinators=await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId,wake.id));
        if (phase!=="after_selection") {
          expect(run).toMatchObject({runtimeModeResolvedAt:null,nativeSessionId:null,
            resultJson:{startupCancellation:{beforeNativeSelection:true}}});
          expect(coordinators).toEqual([]);
        } else {
          expect(run.runtimeModeResolvedAt).toBeInstanceOf(Date);expect(run.nativeSessionId).toEqual(expect.any(String));
          expect(coordinators).toEqual([expect.objectContaining({runId:wake.id,issueId:entry.task.id,attempt:0,leaseOwner:null})]);
        }
        const [task]=await db.select().from(issues).where(eq(issues.id,entry.task.id));
        expect(task).toMatchObject({executionRunId:null,executionAgentNameKey:null,executionLockedAt:null});
        expect(task?.status).not.toBe("done");
        const [request]=await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id,run.wakeupRequestId!));
        expect(request).toMatchObject({runId:wake.id,status:"cancelled"});
        const attempts=await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId,entry.plan.id));
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({companyId:f.home,planId:entry.plan.id,runId:wake.id,agentId:f.presence.id});
        const manifests=await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,wake.id));
        expect(manifests).toHaveLength(1);expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId,entry.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId,wake.id))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(entry.task.id,"result")).toBeNull();
        expect(calls).toBe(0);
        } finally {
          rowLockRelease?.();
          await rowLockTransaction;
        }
      },beforeDispatch,beforeSelection);
    },60_000,
  );

  it("aborts the dispatched Native text HTTP call on canonical Run cancellation and retains its unknown charge", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let calls = 0;
    const observed: { signal?: AbortSignal; dispatched: boolean; aborted: boolean; rejectConsumer?: (error: Error) => void } = { dispatched: false, aborted: false };
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const signal = init.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("native_text_http_abort_signal_missing");
      observed.signal = signal;
      if (!entry) throw new Error("native_text_http_plan_missing");
      const [reservation] = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservation).toMatchObject({ status: "dispatched", maximumMinor: 3, workerAttemptId: expect.any(String) });
      if (!reservation?.providerWireReceipt) throw new Error("native_text_wire_receipt_missing");
      observed.dispatched = true;
      await new Promise<never>((_resolve, reject) => {
        observed.rejectConsumer = reject;
        const onAbort = () => {
          observed.aborted = true;
          const error = new Error("Controlled HTTP consumer observed cancellation");
          error.name = "AbortError";
          reject(error);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    };

    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      entry = await createDraftPlan(fixture, "Cancel the in-flight installed Native text request");
      try {
      const wake = await heartbeat.wakeup(f.presence.id, {
        source: "automation", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id },
        contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" },
      });
      if (!wake) throw new Error("native_text_abort_run_missing");
      await vi.waitFor(() => expect(observed.dispatched).toBe(true), { timeout: 20_000, interval: 25 });
      const [running] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, wake.id)));
      expect(running).toMatchObject({ runtimeMode: "native", driverKind: "aw_text_messages", status: "running",
        nativeIssueId: entry.task.id, responsibleUserId: f.userId });
      expect(observed.signal?.aborted).toBe(false);

      const cancellation = heartbeat.cancelRun(wake.id, "Cancel while controlled Native text HTTP is in flight");
      await vi.waitFor(() => expect(observed.aborted).toBe(true), { timeout: 10_000, interval: 25 });
      expect(observed.signal?.aborted).toBe(true);
      const cancelled = await cancellation;
      expect(cancelled).toMatchObject({ id: wake.id, status: "cancelled", runtimeMode: "native" });
      await heartbeat.drainActiveRunExecutions();

      const [run] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, wake.id)));
      expect(run).toMatchObject({ id: wake.id, status: "cancelled", runtimeMode: "native",
        driverKind: "aw_text_messages", nativeIssueId: entry.task.id, responsibleUserId: f.userId });
      const coordinators = await db.select().from(nativeRunFinalizations)
        .where(eq(nativeRunFinalizations.runId, wake.id));
      expect(coordinators).toHaveLength(1);
      expect(coordinators[0]).toMatchObject({ runId: wake.id, issueId: entry.task.id,
        leaseOwner: null, leaseExpiresAt: null });
      const attempts = await db.select().from(orchestrationWorkerAttempts)
        .where(eq(orchestrationWorkerAttempts.planId, entry.plan.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ runId: wake.id, agentId: f.presence.id });
      const [reservation] = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservation).toMatchObject({ status: "unknown", maximumMinor: 3,
        workerAttemptId: attempts[0]!.id, providerResponseHash: null, usage: null,
        dispatchedAt: expect.any(Date), providerWireReceipt: expect.any(Object) });
      const [plan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, entry.plan.id));
      expect(plan?.modelCostReserved).toBe(3);
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, wake.id))).toEqual([]);
      expect(await documentService(db).getIssueDocumentByKey(entry.task.id, "result")).toBeNull();
      const [task] = await db.select().from(issues).where(eq(issues.id, entry.task.id));
      expect(task?.status).not.toBe("done");
      expect(task).toMatchObject({ executionRunId: null,
        executionAgentNameKey: null, executionLockedAt: null });
      expect(nativePayloadSourceSnapshotSchema.parse(task?.payloadSourceSnapshot))
        .toEqual(nativePayloadSourceSnapshotSchema.parse(entry.task.payloadSourceSnapshot));
      expect(calls).toBe(1);
      } finally {
        // Failure cleanup only: never turn a missing abort into successful HTTP or passing evidence.
        if (!observed.aborted) observed.rejectConsumer?.(new Error("Owned HTTP fixture cleanup after an abort assertion failure"));
      }
    });
  }, 60_000);


  it("joins concurrent Stops through the installed Native text owner without duplicating the dispatch", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let calls = 0;
    let observedAbort = false;
    let activeSignal: AbortSignal | undefined;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      const signal = init.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("native_text_duplicate_stop_signal_missing");
      activeSignal = signal;
      await new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          observedAbort = true;
          const error = new Error("Concurrent Stop reached installed Native text request");
          error.name = "AbortError";
          reject(error);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    };

    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      entry = await createDraftPlan(fixture, "Join concurrent Stops for one installed Native text request");
      const wake = await heartbeat.wakeup(f.presence.id, {
        source: "automation", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id },
        contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" },
      });
      if (!wake) throw new Error("native_text_duplicate_stop_run_missing");
      await vi.waitFor(() => expect(calls).toBe(1), { timeout: 20_000, interval: 25 });
      const stops = await Promise.all([
        heartbeat.cancelRun(wake.id, "First concurrent Native text Stop"),
        heartbeat.cancelRun(wake.id, "Second concurrent Native text Stop"),
      ]);
      await vi.waitFor(() => expect(observedAbort).toBe(true), { timeout: 10_000, interval: 25 });
      expect(activeSignal?.aborted).toBe(true);
      expect(stops).toHaveLength(2);
      for (const stop of stops)
        expect(stop).toMatchObject({ id: wake.id, status: "cancelled", runtimeMode: "native" });
      await heartbeat.drainActiveRunExecutions();

      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
      expect(run).toMatchObject({ status: "cancelled", runtimeMode: "native", driverKind: "aw_text_messages" });
      expect(await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake.id))).toHaveLength(1);
      expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entry.plan.id))).toHaveLength(1);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id)))
        .toEqual([expect.objectContaining({ status: "unknown", providerResponseHash: null, usage: null })]);
      expect(calls).toBe(1);
    });
  }, 60_000);

  it("keeps an installed Native text request live when durable Stop intent cannot be written, then retries once", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    let calls = 0;
    let observedAbort = false;
    let activeSignal: AbortSignal | undefined;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      const signal = init.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("native_text_stop_intent_signal_missing");
      activeSignal = signal;
      await new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          observedAbort = true;
          const error = new Error("Retry reached installed Native text request");
          error.name = "AbortError";
          reject(error);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    };

    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const entry = await createDraftPlan(fixture, "Retry Stop after durable intent write failure");
      const wake = await heartbeat.wakeup(f.presence.id, {
        source: "automation", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId: entry.task.id },
        contextSnapshot: { issueId: entry.task.id, wakeReason: "issue_assigned" },
      });
      if (!wake) throw new Error("native_text_stop_intent_run_missing");
      await vi.waitFor(() => expect(calls).toBe(1), { timeout: 20_000, interval: 25 });

      const suffix = randomUUID().replaceAll("-", "");
      const trigger = `aw_test_native_stop_intent_${suffix}`;
      const procedure = `aw_test_native_stop_intent_fn_${suffix}`;
      let triggerInstalled = false;
      try {
        await db.execute(sql.raw(`CREATE FUNCTION ${procedure}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.id = '${wake.id}'::uuid AND NEW.result_json->'nativeCancellation'->>'dispatchState' = 'pending' THEN
              RAISE EXCEPTION 'injected_native_cancel_intent_write_failure';
            END IF;
            RETURN NEW;
          END
        $$`));
        await db.execute(sql.raw(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF result_json ON heartbeat_runs
          FOR EACH ROW EXECUTE FUNCTION ${procedure}()`));
        triggerInstalled = true;

        const writeFailure = await heartbeat.cancelRun(wake.id, "Stop intent write fault").then(
          () => null,
          (error: unknown) => error,
        );
        const failureCauses: string[] = [];
        for (let cause = writeFailure; cause instanceof Error; cause = cause.cause)
          failureCauses.push(cause.message);
        expect(failureCauses.join("\n")).toContain("injected_native_cancel_intent_write_failure");
        expect(observedAbort).toBe(false);
        expect(activeSignal?.aborted).toBe(false);
        expect(calls).toBe(1);
        const [stillRunning] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
        expect(stillRunning).toMatchObject({ status: "running", runtimeMode: "native" });
        expect(stillRunning?.resultJson).not.toHaveProperty("nativeCancellation");
        const [reservationBeforeRetry] = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, entry.plan.id));
        expect(reservationBeforeRetry).toMatchObject({ status: "dispatched", maximumMinor: 3 });

        await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON heartbeat_runs`));
        triggerInstalled = false;
        await db.execute(sql.raw(`DROP FUNCTION ${procedure}()`));
        const cancelled = await heartbeat.cancelRun(wake.id, "Retry Stop after intent write recovery");
        await vi.waitFor(() => expect(observedAbort).toBe(true), { timeout: 10_000, interval: 25 });
        expect(activeSignal?.aborted).toBe(true);
        expect(cancelled).toMatchObject({ id: wake.id, status: "cancelled", runtimeMode: "native" });
        await heartbeat.drainActiveRunExecutions();

        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
        expect(run).toMatchObject({ status: "cancelled", runtimeMode: "native", driverKind: "aw_text_messages" });
        expect(run?.resultJson).toMatchObject({ nativeCancellation: { dispatchState: "acknowledged", dispatched: true } });
        expect(await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake.id))).toHaveLength(1);
        expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entry.plan.id))).toHaveLength(1);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id)))
          .toEqual([expect.objectContaining({ status: "unknown", providerResponseHash: null, usage: null })]);
        expect(calls).toBe(1);
      } finally {
        if (triggerInstalled) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON heartbeat_runs`));
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${procedure}()`));
        if (!observedAbort) await heartbeat.cancelRun(wake.id, "Cleanup after Stop intent write test").catch(() => undefined);
        await heartbeat.drainActiveRunExecutions();
      }
    });
  }, 60_000);

});
