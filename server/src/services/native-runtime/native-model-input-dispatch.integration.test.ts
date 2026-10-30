import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, gte, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assets,
  agents,
  authUsers,
  authSessions,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatMessageLinks,
  companyMemberships,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRunEvents,
  heartbeatRuns,
  activityLog,
  issueComments,
  issues,
  issueThreadInteractions,
  nativeRunFinalizations,
  toolApplications,
  toolConnections,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import type { ContextAuthorityDecision, NativePayloadSourceInput, NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { PROCESS_START_REQUESTED } from "../native-local-process-stop.js";
import { recordNativeModelInputDispatchIntent, recordNativeModelInputDispatchAcknowledgement, recordNativeToolCallDispatchAssociation,
  recordNativeDocumentToolResultIntent, recordNativeProjectToolResultIntent, recordNativeInputToolResultIntent,
  assertNativeRunReadSourceHistoryQualified } from "./native-session-executor.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";
import { NativeChatAttachmentReadScope } from "./chat-attachment-read.js";
import { captureNativeProjectToolResult } from "./paperclip-runner-tool-authority.js";
import { documentService, type DocumentRevisionSourceCapture } from "../documents.js";
import { nativeCommentProjectionHash, nativeSha256 } from "./canonical.js";
import { currentNativeControllerIdentity } from "./native-restart-recovery.js";
import { buildNativeModelEnvelope, NATIVE_EXECUTION_INPUT_SCHEMA_V2, parseNativeExecutionInput } from "@paperclipai/paperclip-runner";
import { buildNativeExecutionInput, buildNativeBootstrapSourceSet, prepareNativeTurnWithContext,
  type NativePreparedSourceCandidate } from "./native-execution-input.js";
import { buildRetainedNativeRuntimeContext, type NativeRuntimeAuthoredSourceCapture } from "./runtime-context.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";
import { issueService } from "../issues.js";
import type { NativeTaskSourceCapture } from "../issues.js";
import { canActorReadIssuePrivacy } from "../authorization.js";
import { initializeRunIdentity } from "../run-identity.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown } from "../heartbeat.js";
import { createLocalAgentJwt } from "../../agent-auth-jwt.js";
import { actorMiddleware } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { issueRoutes } from "../../routes/issues.js";
import { ensureNativeCompletionContract } from "./completion-contracts.js";
import { contextEngineService } from "../context/context-engine.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { resolveDefaultAgentWorkspaceDir } from "../../home-paths.js";
import { materializeNativeInteractionResponses } from "./native-interaction-bridge.js";
import { assertNativePayloadSourceSetCurrent, assertNativeReadResultSourceSetOwnersCurrent,
  assertNativeProjectSourceCurrent } from "../native-direct-input.js";
import { ensureProjectAccessMember, projectService } from "../projects.js";
import { publicNativePayloadRow } from "../native-payload-public.js";
import { configureSaasStorageService } from "../../storage/index.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import type { StorageService } from "../../storage/types.js";
import { executePaperclipNativeSession } from "./native-session-executor.js";
import type { NativeSessionBackend } from "../../vendor/paperclip-runner/index.js";
import { CONTROL_PLANE_CONFORMANCE_RESULT, CONTROL_PLANE_CONFORMANCE_TERMINAL } from "../../vendor/paperclip-runner/testing.js";
import { renderNativeRunnerStagedAttachmentPrompt } from "./native-runner-file-handoff.js";
import { createManagedNativeProjectOutput } from "../native-project-output.js";
import type { NativeModelOutputCapture } from "./native-execution-input.js";

describe("native model input dispatch intent", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let controller: Awaited<ReturnType<typeof currentNativeControllerIdentity>>;
  let storageRoot: string;
  let storage: StorageService;
  const originalJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const originalPaperclipHome = process.env.PAPERCLIP_HOME;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const responsibleUserId = randomUUID();

  beforeAll(async () => {
    process.env.PAPERCLIP_AGENT_JWT_SECRET ??= "native-dispatch-integration-secret";
    database = await startEmbeddedPostgresTestDatabase("native-model-input-dispatch-");
    db = createDb(database.connectionString);
    storageRoot = await mkdtemp(join(tmpdir(), "native-attachment-dispatch-storage-"));
    await mkdir(storageRoot, { recursive: true });
    process.env.PAPERCLIP_HOME = storageRoot;
    storage = createStorageService(createLocalDiskStorageProvider(storageRoot));
    configureSaasStorageService(storage);
    controller = await currentNativeControllerIdentity();
    await db.insert(companies).values({ id: companyId, name: "Dispatch intent fixture", issuePrefix: "NMI" });
    await db.insert(authUsers).values({ id: responsibleUserId, name: "Dispatch Human", email: `${responsibleUserId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(agents).values({ id: agentId, companyId, name: "Dispatch agent", adapterType: "paperclip_runner" });
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: responsibleUserId, status: "active", membershipRole: "admin" },
      { companyId, principalType: "agent", principalId: agentId, status: "active" },
    ]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database?.cleanup();
    if (storageRoot) {
      const restoreDirectoryPermissions = async (path: string) => {
        await chmod(path, 0o700).catch(() => undefined);
        for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
          if (entry.isDirectory()) await restoreDirectoryPermissions(join(path, entry.name));
        }
      };
      await restoreDirectoryPermissions(storageRoot);
      await rm(storageRoot, { recursive: true, force: true });
    }
    if (originalPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = originalPaperclipHome;
    if (originalJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = originalJwtSecret;
  }, 30_000);

  async function seed(options: {
    responsibleUserId?: string | null;
    runnerProfileJson?: Record<string, unknown>;
    leaseTtlSql?: boolean;
    existingIssueId?: string;
    attempt?: number;
  } = {}) {
    const issueId = randomUUID();
    const runId = randomUUID();
    const leaseOwner = `native-input-owner-${randomUUID()}`;
    const attempt = options.attempt ?? 3;
    const eventSeq = 7;
    if (!options.existingIssueId) await db.insert(issues).values({ id: issueId, companyId, title: "Dispatch intent Task", assigneeAgentId: agentId });
    const boundIssueId = options.existingIssueId ?? issueId;
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      nativeIssueId: boundIssueId,
      nativeSessionId: randomUUID(),
      runtimeMode: "native",
      status: "running",
      responsibleUserId: options.responsibleUserId === undefined ? responsibleUserId : options.responsibleUserId,
      runnerProfileJson: options.runnerProfileJson ?? { retainedProfileField: "preserve-me" },
    });
    await db.insert(nativeRunFinalizations).values({
      runId,
      companyId,
      issueId: boundIssueId,
      phase: "running",
      attempt,
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      controllerBootId: controller.bootId,
      controllerPid: controller.pid,
      controllerProcessStartedAt: controller.processStartedAt,
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: eventSeq,
      eventType: PROCESS_START_REQUESTED,
      payload: { fixture: "actual launch event" },
    });
    if (options.leaseTtlSql) {
      await db.execute(sql`update native_run_finalizations set lease_expires_at = clock_timestamp() + interval '1200 milliseconds' where run_id = ${runId}::uuid`);
    }
    return { issueId: boundIssueId, runId, leaseOwner, attempt, eventSeq };
  }

  function dispatchArgs(
    seeded: Awaited<ReturnType<typeof seed>>,
    turnInput: { message: { role: "user"; text: string }; continuation?: true; requestedCollaborationMode?: "default" | "plan" },
  ) {
    return {
      db,
      runId: seeded.runId,
      companyId,
      issueId: seeded.issueId,
      agentId,
      leaseOwner: seeded.leaseOwner,
      attempt: seeded.attempt,
      controller,
      eventSeq: seeded.eventSeq,
      turnInput,
    };
  }

  function documentArgs(seeded: Awaited<ReturnType<typeof seed>>, source: DocumentRevisionSourceCapture | null = null) {
    const { turnInput: _turnInput, ...binding } = dispatchArgs(seeded, { message: { role: "user", text: "unused" } });
    return { ...binding, capture: { turnId: null as string | null, callId: "actual-document-read", tool: "read_document" as const,
      resultDigest: nativeSha256({ document: null }), source } };
  }

  function acknowledgementArgs(
    seeded: Awaited<ReturnType<typeof seed>>,
    dispatchId: string,
    turnInput: { message: { role: "user"; text: string }; continuation?: true; requestedCollaborationMode?: "default" | "plan" },
    turnId = "provider-turn-ack-1",
  ) {
    const { turnInput: _turnInput, ...binding } = dispatchArgs(seeded, turnInput);
    return { ...binding, dispatchId, turnInput, turnId };
  }

  function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object" && value !== null) {
      const row = value as Record<string, unknown>;
      return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  }

  async function executeVerifiedAttachmentCase(mode: "positive" | "byte_mismatch" | "withdrawn" | "historical") {
    const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Attachment source Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000) });
    const actor = { type: "board" as const, source: "session" as const, userId, sessionId, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "member", status: "active" as const }] };
    const createdIssue = await issueService(db).create(companyId, { title: `Verified attachment ${mode}`,
      description: "Inspect the exact attachment from this Task.", createdByUserId: userId }, db, undefined, { manualInputActor: actor });
    const seeded = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId, attempt: 1 });
    const runnerInstanceId = randomUUID();
    const normalizedSessionId = randomUUID();
    await db.update(heartbeatRuns).set({ runnerInstanceId, nativeSessionId: normalizedSessionId })
      .where(eq(heartbeatRuns.id, seeded.runId));
    await db.update(issues).set({ status: "in_progress", assigneeAgentId: agentId, executionRunId: seeded.runId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdIssue.id)));
    const comment = await issueService(db).addComment(createdIssue.id, "Inspect the attached source.", { userId }, { manualInputActor: actor });
    const [commentSourceRow] = await db.select({ issueId: issueComments.issueId, id: issueComments.id,
      sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text`, body: issueComments.body,
      presentation: issueComments.presentation, metadata: issueComments.metadata,
      payloadSourceSnapshot: issueComments.payloadSourceSnapshot }).from(issueComments)
      .where(eq(issueComments.id, comment.id));
    if (!commentSourceRow?.payloadSourceSnapshot) throw new Error("The wake Comment owner snapshot is unavailable");
    const commentSource = { kind: "comment" as const, issueId: commentSourceRow.issueId, commentId: commentSourceRow.id,
      sourceVersion: commentSourceRow.sourceVersion,
      contentHash: createHash("sha256").update(JSON.stringify({ body: commentSourceRow.body,
        presentation: commentSourceRow.presentation, metadata: commentSourceRow.metadata }), "utf8").digest("hex") };
    const bytes = Buffer.from("Verified attachment bytes.\n", "utf8");
    const stored = await storage.putFile({ companyId, namespace: `issues/${createdIssue.id}`, originalFilename: "brief.txt",
      contentType: "text/plain", body: bytes });
    const attachment = await issueService(db).createAttachment({ issueId: createdIssue.id, issueCommentId: comment.id,
      provider: stored.provider, objectKey: stored.objectKey, contentType: stored.contentType, byteSize: stored.byteSize,
      sha256: stored.sha256, originalFilename: stored.originalFilename, createdByUserId: userId }, { actor, bytes });
    const wakeComment = { id: comment.id, body: comment.body, attachments: [{ id: attachment.id, filename: "brief.txt",
      contentType: "text/plain", byteSize: bytes.length, contentPath: `/api/attachments/${attachment.id}/content` }] };
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: createdIssue.id,
      paperclipWake: { comments: [wakeComment] } } }).where(eq(heartbeatRuns.id, seeded.runId));
    const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
    const selectedTask = await getIssueExecutionContext(db, companyId, createdIssue.id, capture => { taskCaptureHolder.value = capture; });
    const taskCapture = taskCaptureHolder.value;
    if (!selectedTask || !taskCapture?.payloadSourceSnapshot) throw new Error("The Task owner snapshot is unavailable");
    const renderedReferences: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string;
      commentId?: string; filename?: string; contentType?: string; byteSize?: number }> = [];
    const renderedMarkdown = buildPaperclipTaskMarkdown({
      issue: { id: createdIssue.id, identifier: selectedTask.identifier, title: selectedTask.title,
        description: selectedTask.description, workMode: "standard" },
      wakeComments: [{ id: comment.id, body: comment.body, attachments: wakeComment.attachments }],
    }, { onRenderedSource: source => renderedReferences.push(source) });
    const workspace = { id: seeded.runId, cwd: join(storageRoot, `workspace-${seeded.runId}`), repoUrl: null, repoRef: null, branchName: null };
    await mkdir(workspace.cwd, { recursive: true });
    const completion = await ensureNativeCompletionContract({ db, companyId,
      issue: { id: createdIssue.id, title: selectedTask.title, description: selectedTask.description }, actorId: agentId });
    await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
      completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));
    const builtExecution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
      issue: { id: createdIssue.id, identifier: selectedTask.identifier, title: selectedTask.title,
        description: selectedTask.description, workMode: "standard" }, taskPrompt: renderedMarkdown!, workspace,
      normalizedSessionId, provider: "codex", model: "codex-test",
      completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
        schemaVersion: completion.row.schemaVersion, contract: completion.contract }, runtimeContext: nativeRuntimeContextFixture() });
    const execution = parseNativeExecutionInput({
      schema: NATIVE_EXECUTION_INPUT_SCHEMA_V2,
      binding: builtExecution.binding,
      task: builtExecution.task,
      workspace: builtExecution.workspace,
      session: builtExecution.session,
      provider: builtExecution.provider.kind === "codex"
        ? { kind: "codex", model: builtExecution.provider.model }
        : builtExecution.provider,
      completionContract: builtExecution.completionContract,
      interactionResponses: builtExecution.interactionResponses,
      credentialBindings: builtExecution.credentialBindings,
      executionMode: builtExecution.executionMode,
      planningContext: builtExecution.planningContext,
    });
    const priorStage = { eventSeq: 3, attempt: 1, responsibleUserId: userId, sourceCaptures: [{ input: {
      kind: "attachment", issueId: createdIssue.id, attachmentId: randomUUID(), commentId: comment.id,
      assetId: randomUUID(), sha256: "e".repeat(64), byteSize: bytes.length, disposition: "delivered",
    }, payloadSourceSnapshot: null }] };
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution,
      ...(mode === "historical" ? { nativeAttachmentStageSources: [priorStage] } : {}) } }).where(eq(heartbeatRuns.id, seeded.runId));
    const baseInputs: NativePreparedSourceCandidate[] = [
      { kind: "task", id: createdIssue.id, input: taskCapture.input, payloadSourceSnapshot: taskCapture.payloadSourceSnapshot },
      { kind: "comment", id: comment.id, input: commentSource, payloadSourceSnapshot: commentSourceRow.payloadSourceSnapshot },
    ];
    const workspaceInput = { kind: "workspace_metadata" as const, runId: seeded.runId, executionWorkspaceId: seeded.runId,
      origin: "task_session" as const, sourceVersion: `task-session:${seeded.runId}`,
      contentHash: createHash("sha256").update(JSON.stringify({ cwd: execution.workspace.cwd, repoUrl: execution.workspace.repoUrl,
        repoRef: execution.workspace.repoRef, branchName: execution.workspace.branchName }), "utf8").digest("hex") };
    const buildSet = (attachmentCandidates: NativePreparedSourceCandidate[] = []) => buildNativeBootstrapSourceSet({ companyId, runId: seeded.runId, agentId,
      issueId: createdIssue.id, renderedMarkdown: renderedMarkdown!,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown!, "utf8").digest("hex"), references: renderedReferences,
      candidates: [...baseInputs, ...attachmentCandidates], runtimeInputs: [], contextManifestIds: [],
      governedContextMarkdown: "", contextWitnessMarkdown: "", contextWitness: null, rolePackInputs: [],
      additionalInputs: [{ kind: "completion_contract", issueId: createdIssue.id, contractId: completion.row.id,
        revision: String(completion.row.revision), contentHash: completion.row.canonicalSha256 }, workspaceInput], unsupportedInputPresent: false });
    let withdrawn = false;
    if (mode === "byte_mismatch" || mode === "withdrawn") {
      const original = storage;
      const hooked: StorageService = { ...original, async getObject(company, key, options) {
        const result = await original.getObject(company, key, options);
        if (mode === "byte_mismatch") {
          const wrong = Buffer.from(bytes);
          wrong[0] = wrong[0] === 0x56 ? 0x57 : 0x56;
          return { ...result, stream: Readable.from([wrong]) };
        }
        if (!withdrawn) {
          withdrawn = true;
          await db.update(assets).set({ sha256: "f".repeat(64) }).where(eq(assets.id, attachment.assetId));
        }
        return result;
      } };
      configureSaasStorageService(hooked);
    } else configureSaasStorageService(storage);
    const turnId = `attachment-provider-turn-${seeded.runId}`;
    let providerFrame = "";
    let releaseTerminal!: () => void;
    let signalStart!: () => void;
    const terminal = new Promise<void>(resolve => { releaseTerminal = resolve; });
    const started = new Promise<void>(resolve => { signalStart = resolve; });
    const backend: NativeSessionBackend = {
      async descriptor() { return { kind: "mock", name: "verified-attachment-pg", version: "1",
        capabilities: { resume: false, typedEvents: true, steering: false, interruption: true, structuredResult: true } }; },
      async openSession(openInput) {
        return { identity: () => openInput.identity,
          async capabilities() { return { resume: false, typedEvents: true, steering: false, interruption: true, structuredResult: true }; },
          async *events() { await started; yield { schema: "paperclip.prp.event.v1" as const,
            sourceEventId: `${runnerInstanceId}:${seeded.runId}:1`, sourceSeq: 1,
            sourceInstanceId: runnerInstanceId, sourceKind: "runner" as const,
            runId: seeded.runId, normalizedSessionId: openInput.identity.sessionId, turnId, eventType: "turn.completed" as const,
            schemaVersion: 1 as const, priority: 0 as const, emittedAt: new Date().toISOString(), payload: {} }; },
          async startTurn(input) { providerFrame = input.message.text; signalStart(); return { turnId }; },
          async result() { const result = structuredClone(CONTROL_PLANE_CONFORMANCE_RESULT);
            return { result, terminal: { ...CONTROL_PLANE_CONFORMANCE_TERMINAL, reportedWorkDisposition: result.reportedWorkDisposition }, turnId }; },
          async snapshot() { return { backendKind: "mock", sessionId: openInput.identity.sessionId, identity: openInput.identity,
            providerSessionId: turnId } as never; },
          async close() { signalStart(); releaseTerminal(); },
        };
      },
    };
    try {
      await executePaperclipNativeSession({ db, execution, nativeBootstrapExecutionInputHash: nativeSha256(execution),
        bootstrapSourceClosure: null, prepareBootstrapSourceClosure: ({ execution: stagedExecution, attachmentStage }) => {
          const references = renderedReferences.filter(reference => reference.kind === "attachment");
          if (attachmentStage.sourceCaptures.length !== references.length || attachmentStage.attachments.length !== references.length) return null;
          const candidates: NativePreparedSourceCandidate[] = [];
          for (const reference of references) {
            const capture = attachmentStage.sourceCaptures.find(item => item.input.attachmentId === reference.id && item.input.commentId === reference.commentId);
            const descriptor = attachmentStage.attachments.find(item => item.id === reference.id);
            if (!capture || !descriptor || capture.input.kind !== "attachment" || capture.input.disposition !== "delivered" ||
              descriptor.unavailableReason || !descriptor.workspaceRelativePath || capture.input.byteSize !== reference.byteSize ||
              descriptor.filename !== reference.filename || descriptor.contentType !== reference.contentType || descriptor.byteSize !== reference.byteSize ||
              !capture.payloadSourceSnapshot) return null;
            candidates.push({ kind: "attachment", id: capture.input.attachmentId, input: capture.input,
              payloadSourceSnapshot: capture.payloadSourceSnapshot });
          }
          const prompt = renderNativeRunnerStagedAttachmentPrompt(attachmentStage.attachments);
          if (!prompt || !stagedExecution.task.prompt.endsWith(`\n\n${prompt}`)) return null;
          const sourceSet = buildSet(candidates);
          return sourceSet ? { sourceSet, taskEnvelopeDigest: nativeSha256(stagedExecution.task) } : null;
        }, backend, runnerInstanceId, useRunnerd: true,
        leaseOwner: seeded.leaseOwner });
    } finally {
      releaseTerminal();
      configureSaasStorageService(storage);
    }
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    return { seeded, attachment, run: run!, withdrawn, providerFrame };
  }

  it("retains the exact document read before later revision edits without inventing source history", async () => {
    const seeded = await seed();
    const service = documentService(db), body = "ACTUAL_TOOL_DOCUMENT /private/document/path";
    const { document } = await service.upsertIssueDocument({ issueId: seeded.issueId, key: "notes", title: "Read version", format: "markdown", body });
    let source: DocumentRevisionSourceCapture | null = null;
    const selected = await service.getIssueDocumentByKey(seeded.issueId, "notes", { onSourceCapture: capture => { source = capture; } });
    expect(source).not.toBeNull();
    await service.upsertIssueDocument({ issueId: seeded.issueId, key: "notes", title: "Later version", format: "markdown",
      body: "Never substitute this later document", baseRevisionId: document.latestRevisionId! });
    const args = documentArgs(seeded, source);
    args.capture.resultDigest = createHash("sha256").update(JSON.stringify({ document: selected })).digest("hex");
    await recordNativeDocumentToolResultIntent(args);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson).toMatchObject({ retainedProfileField: "preserve-me", nativeToolResultSourceCaptures: [{
      eventSeq: seeded.eventSeq, attempt: seeded.attempt, responsibleUserId,
      callId: "actual-document-read", tool: "read_document", resultDigest: args.capture.resultDigest,
      source: { input: { kind: "document_revision", issueId: seeded.issueId, documentId: document.id,
        revisionId: document.latestRevisionId, contentHash: createHash("sha256").update(body).digest("hex") }, payloadSourceSnapshot: null },
    }] });
    expect(JSON.stringify(run!.runnerProfileJson)).not.toContain(body);
    expect(run!.nativeInputSourceProtocolVersion).toBe(0);
    expect(run!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
  });

  it("authenticates a single-use native HTTP effect claim against the current dispatch, lease and exact request", async () => {
    const seeded = await seed(), turnId = "actual-effect-provider-turn", callId = "actual-effect-call";
    const turnInput = { message: { role: "user" as const, text: "Create the requested task" } };
    const args = dispatchArgs(seeded, turnInput);
    const dispatchId = await recordNativeModelInputDispatchIntent(args);
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, turnId));
    expect(await recordNativeToolCallDispatchAssociation({ ...args, turnId, callId, tool: "call_api" })).toBe(true);

    const body = { title: "Exact server-bound request" };
    const apiInput = { operationId: "POST /api/native-effect", body };
    const apiReceiptDigest = createHash("sha256").update(canonicalJson(apiInput)).digest("hex");
    const receiptKey = createHash("sha256").update(callId).digest("hex");
    await db.update(heartbeatRuns).set({ resultJson: { apiToolReceipts: {
      [receiptKey]: { digest: apiReceiptDigest, operationId: "POST /api/native-effect", state: "pending" },
    } } }).where(eq(heartbeatRuns.id, seeded.runId));
    const [lease] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, seeded.runId));
    const pathAndQuery = "/api/native-effect?source=runner";
    const bodyHash = createHash("sha256").update(canonicalJson(body)).digest("hex");
    const claim = {
      dispatchId, eventSeq: seeded.eventSeq, attempt: seeded.attempt, turnId, callId, tool: "call_api" as const,
      operationId: "POST /api/native-effect", method: "POST", pathAndQuery, bodyPresent: true,
      bodyHash, apiReceiptDigest, leaseOwner: seeded.leaseOwner, leaseExpiresAt: lease!.leaseExpiresAt!.toISOString(),
      controllerBootId: controller.bootId, controllerPid: controller.pid,
      controllerProcessStartedAt: controller.processStartedAt.toISOString(),
    };
    const token = createLocalAgentJwt(agentId, companyId, "paperclip_runner", seeded.runId, responsibleUserId,
      { kind: "standard" }, claim);
    expect(token).not.toBeNull();
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
    app.post("/api/native-effect", (req, res) => res.json({ accepted: true, effect: req.actor.nativeToolEffect ?? null }));
    app.use(errorHandler);

    const wrongBody = await request(app).post(pathAndQuery).set("Authorization", `Bearer ${token}`).send({ title: "forged body" });
    expect(wrongBody.status, JSON.stringify(wrongBody.body)).toBe(403);
    const wrongPath = await request(app).post("/api/other?source=runner").set("Authorization", `Bearer ${token}`).send(body);
    expect(wrongPath.status).toBe(403);
    const rotated = createLocalAgentJwt(agentId, companyId, "paperclip_runner", seeded.runId, responsibleUserId,
      { kind: "standard" }, { ...claim, leaseOwner: "rotated-owner" });
    expect((await request(app).post(pathAndQuery).set("Authorization", `Bearer ${rotated}`).send(body)).status).toBe(403);
    await db.execute(sql`update native_run_finalizations set lease_expires_at=clock_timestamp()+interval '30 minutes' where run_id=${seeded.runId}::uuid`);
    const [renewedLease] = await db.select().from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.runId, seeded.runId), eq(nativeRunFinalizations.companyId, companyId),
      eq(nativeRunFinalizations.issueId, seeded.issueId), eq(nativeRunFinalizations.attempt, claim.attempt),
      eq(nativeRunFinalizations.leaseOwner, claim.leaseOwner), eq(nativeRunFinalizations.controllerBootId, claim.controllerBootId),
      eq(nativeRunFinalizations.controllerPid, claim.controllerPid),
      eq(nativeRunFinalizations.controllerProcessStartedAt, new Date(claim.controllerProcessStartedAt)),
      gte(nativeRunFinalizations.leaseExpiresAt, new Date(claim.leaseExpiresAt)),
      sql`${nativeRunFinalizations.leaseExpiresAt} > clock_timestamp()`,
    ));
    expect(renewedLease).toBeDefined();
    const accepted = await request(app).post(pathAndQuery).set("Authorization", `Bearer ${token}`).send(body);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.effect).toMatchObject({ dispatchId, turnId, callId, operationId: "POST /api/native-effect" });
    const replay = await request(app).post(pathAndQuery).set("Authorization", `Bearer ${token}`).send(body);
    expect(replay.status).toBe(403);
  });

  it("denies native Task output until the provider input boundary is attested", async () => {
    const sessionId = randomUUID(), now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: responsibleUserId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    const humanActor = { type: "board" as const, source: "session" as const, userId: responsibleUserId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "admin", status: "active" as const }] };
    const sourceTask = await issueService(db).create(companyId, { title: "Native source Task", description: "Public task input",
      createdByUserId: responsibleUserId }, db, undefined, { manualInputActor: humanActor });
    const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
    const selectedTask = await getIssueExecutionContext(db, companyId, sourceTask.id, capture => { taskCaptureHolder.value = capture; });
    expect(selectedTask).not.toBeNull();
    expect(taskCaptureHolder.value?.input.kind).toBe("task");
    const renderedReferences: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const renderedMarkdown = buildPaperclipTaskMarkdown({ issue: { id: sourceTask.id, identifier: selectedTask!.identifier,
      title: selectedTask!.title, description: selectedTask!.description, workMode: selectedTask!.workMode } },
      { onRenderedSource: source => renderedReferences.push(source) });
    expect(renderedMarkdown).toBeTruthy();
    const parsedTaskCapture = taskCaptureHolder.value!;
    const seeded = await seed({ existingIssueId: sourceTask.id, responsibleUserId });
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, renderedMarkdown: renderedMarkdown!,
      runId: seeded.runId, agentId, issueId: sourceTask.id,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown!, "utf8").digest("hex"), references: renderedReferences,
      candidates: [{ kind: "task", id: sourceTask.id, input: parsedTaskCapture.input,
        payloadSourceSnapshot: parsedTaskCapture.payloadSourceSnapshot }], runtimeInputs: [], contextManifestIds: [], rolePackInputs: [],
      unsupportedInputPresent: false });
    expect(sourceSet?.inputs).toEqual([expect.objectContaining({ kind: "task", issueId: sourceTask.id })]);

    const completion = await ensureNativeCompletionContract({ db, companyId,
      issue: { id: sourceTask.id, title: selectedTask!.title, description: selectedTask!.description }, actorId: agentId });
    await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
      completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));

    await initializeRunIdentity(db, { companyId, runId: seeded.runId, issueId: sourceTask.id, responsibleUserId, cause: "dispatch" });
    const execution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
      issue: { id: sourceTask.id, identifier: selectedTask!.identifier, title: selectedTask!.title,
        description: selectedTask!.description, workMode: "standard" }, taskPrompt: renderedMarkdown!,
      workspace: { id: seeded.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null }, normalizedSessionId: null,
      executionMode: "default", provider: "claude_managed", model: "claude-sonnet-5",
      managedProfile: { profileId: "profile", anthropicAgentId: "agent_01", agentVersion: "1", environmentId: "environment",
        betaVersion: "managed-agents-2026-04-01" }, maxSessionListCostUsd: 1,
      completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
        schemaVersion: completion.row.schemaVersion, contract: completion.contract },
      runtimeContext: nativeRuntimeContextFixture() });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, seeded.runId));
    const envelope = buildNativeModelEnvelope(execution);
    const turnInput = { message: { role: "user" as const, text: JSON.stringify(envelope) }, requestedCollaborationMode: "default" as const };
    const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: nativeSha256(execution.task) };
    const args = dispatchArgs(seeded, turnInput);
    const dispatchId = await recordNativeModelInputDispatchIntent({ ...args, bootstrapSourceClosure: closure });
    const turnId = "native-task-effect-turn", callId = "native-task-effect-call";
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, dispatchId, turnInput, turnId), sourceClosure: closure });
    await recordNativeToolCallDispatchAssociation({ ...args, turnId, callId, tool: "call_api" });

    const body = { title: "Effect-bound native task", description: "Created from one current task-only input." };
    const operationId = "POST /api/companies/{companyId}/issues";
    const apiInput = { operationId, body };
    const apiReceiptDigest = createHash("sha256").update(canonicalJson(apiInput)).digest("hex");
    const receiptKey = createHash("sha256").update(callId).digest("hex");
    await db.update(heartbeatRuns).set({ resultJson: { apiToolReceipts: {
      [receiptKey]: { digest: apiReceiptDigest, operationId, state: "pending" },
    } } }).where(eq(heartbeatRuns.id, seeded.runId));
    const [lease] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, seeded.runId));
    const pathAndQuery = `/api/companies/${companyId}/issues`;
    const claim = { dispatchId, eventSeq: seeded.eventSeq, attempt: seeded.attempt, turnId, callId, tool: "call_api" as const,
      operationId, method: "POST", pathAndQuery, bodyPresent: true,
      bodyHash: createHash("sha256").update(canonicalJson(body)).digest("hex"), apiReceiptDigest,
      leaseOwner: seeded.leaseOwner, leaseExpiresAt: lease!.leaseExpiresAt!.toISOString(), controllerBootId: controller.bootId,
      controllerPid: controller.pid, controllerProcessStartedAt: controller.processStartedAt.toISOString() };
    const token = createLocalAgentJwt(agentId, companyId, "paperclip_runner", seeded.runId, responsibleUserId, { kind: "standard" }, claim);
    expect(token).not.toBeNull();

    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    const response = await request(app).post(pathAndQuery).set("Authorization", `Bearer ${token}`).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.error).toBe("Native provider input boundary is unavailable");
    const [created] = await db.select({ id: issues.id }).from(issues).where(and(
      eq(issues.companyId, companyId), eq(issues.title, body.title)));
    expect(created).toBeUndefined();
  });

  it("creates no Project effects for malformed or foreign managed Project captures", async () => {
    const seeded = await seed();
    const callId = `project-capture-${randomUUID()}`;
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId,
      runId: seeded.runId, onBehalfOfUserId: responsibleUserId };
    const args = { name: "Should not exist", workspace: { name: "Local workspace" }, idempotencyKey: randomUUID() };
    const sourceSet = { policy: { issueIds: [seeded.issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] };
    const countEffects = async () => ({
      projects: await db.select({ id: projects.id }).from(projects).where(eq(projects.companyId, companyId)),
      workspaces: await db.select({ id: projectWorkspaces.id }).from(projectWorkspaces).where(eq(projectWorkspaces.companyId, companyId)),
      activities: await db.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.companyId, companyId)),
      runs: await db.select({ id: heartbeatRuns.id, resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, seeded.runId)),
    });
    const before = await countEffects();
    const malformed = {
      runId: seeded.runId,
      sourceSet,
      dispatch: { kind: "worker_model_dispatch", runId: seeded.runId },
      managedOpenCodeToolUse: { callId, toolName: "write_document", argumentsHash: nativeSha256(args),
        responseContentHash: nativeSha256("settled") },
    } as unknown as NativeModelOutputCapture;
    const foreign = {
      ...malformed,
      managedOpenCodeToolUse: { ...malformed.managedOpenCodeToolUse!, callId: `foreign-${callId}`, toolName: "create_project" },
    } as NativeModelOutputCapture;

    for (const capture of [malformed, foreign]) {
      await expect(createManagedNativeProjectOutput({ db, actor, companyId, issueId: seeded.issueId, callId,
        arguments: args, capture })).rejects.toThrow();
    }
    await expect(createManagedNativeProjectOutput({ db, actor, companyId, issueId: seeded.issueId, callId,
      arguments: { ...args, repoUrl: "https://example.invalid/unmanaged.git" } as never,
      capture: malformed })).rejects.toThrow();
    expect(await countEffects()).toEqual(before);
  });

  it("revalidates retained foreign Project workspace roots through their exact current parent", async () => {
    const sessionId = randomUUID(), now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: responsibleUserId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    const humanActor = { type: "board" as const, source: "session" as const, userId: responsibleUserId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "admin", status: "active" as const }] };
    const sourceRun = await seed();
    const nativeActor = { type: "agent" as const, source: "none" as const, companyId, agentId,
      runId: sourceRun.runId, onBehalfOfUserId: responsibleUserId };

    async function createProject(name: string, sourceProjectIds: string[] = [], withWorkspace = false) {
      const project = await projectService(db).create(companyId, { name, status: "in_progress", visibility: "private",
        privacyOwnerUserId: responsibleUserId, sourceProvenanceQualified: true, sourceIssueIds: [], sourceProjectIds,
        payloadSourceProtocolVersion: 1, payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: false }, undefined, humanActor);
      await ensureProjectAccessMember(db, { companyId, projectId: project.id, subjectType: "agent", subjectId: agentId });
      if (withWorkspace) await projectService(db).createWorkspace(project.id, { name: `${name} local workspace`,
        sourceType: "local_path", cwd: `/tmp/native-source-project-${project.id}`, isPrimary: true });
      return project.id;
    }
    async function workspacePin(projectId: string) {
      const [pin] = await db.select({ workspaceId: projectWorkspaces.id,
        sourceVersion: sql<string>`${projectWorkspaces.updatedAt}::text`,
        contentHash: sql<string>`encode(sha256(convert_to(to_jsonb(${projectWorkspaces})::text,'UTF8')),'hex')` })
        .from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, projectId)));
      if (!pin) throw new Error("workspace fixture row missing");
      return { kind: "project_workspace" as const, projectId, ...pin };
    }
    async function projectSource(projectId: string) {
      const project = await projectService(db).getById(projectId);
      if (!project) throw new Error("project fixture row missing");
      const dto = publicNativePayloadRow(project);
      return { kind: "project" as const, projectId, sourceVersion: project.updatedAt.toISOString(),
        contentHash: createHash("sha256").update(JSON.stringify(dto), "utf8").digest("hex") };
    }
    async function sealProject(projectId: string, policyProjectIds: string[], inputs: NativePayloadSourceInput[]) {
      const content = JSON.stringify({ policy: { issueIds: [], projectIds: policyProjectIds, runIds: [], memoryIds: [],
        foundationRevisionIds: [] }, inputs });
      const [sealed] = await db.execute<{ snapshot: NativePayloadSourceSnapshot }>(sql`select
        payload.value || jsonb_build_object('digest',encode(sha256(convert_to(payload.value::text,'UTF8')),'hex')) as snapshot
        from (select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','project',
          'companyId',p.company_id::text,'id',p.id::text,
          'contentHash',public.aw_native_payload_body_hash('project',to_jsonb(p))),
          'policy',(${content}::jsonb)->'policy','inputs',(${content}::jsonb)->'inputs') as value
          from projects p where p.company_id=${companyId}::uuid and p.id=${projectId}::uuid) payload`);
      if (!sealed) throw new Error("project snapshot fixture could not be sealed");
      await db.update(projects).set({ payloadSourceSnapshot: sealed.snapshot, payloadSourceSnapshotInvalidated: false })
        .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)));
    }

    const parentId = await createProject("Foreign source parent", [], true);
    const parentWorkspace = await workspacePin(parentId);
    await sealProject(parentId, [], [parentWorkspace]);
    const parentSource = await projectSource(parentId);

    const makeOutput = async (name: string, inputs: NativePayloadSourceInput[]) => {
      const outputId = await createProject(name, [parentId]);
      await sealProject(outputId, [parentId], inputs);
      return { id: outputId, source: await projectSource(outputId) };
    };
    const valid = await makeOutput("Qualified output Project", [parentSource, parentWorkspace]);
    await expect(assertNativeProjectSourceCurrent(db, { companyId, actor: nativeActor, source: valid.source })).resolves.toBeUndefined();

    const missingParent = await makeOutput("Missing foreign Project source", [parentWorkspace]);
    await expect(assertNativeProjectSourceCurrent(db, { companyId, actor: nativeActor, source: missingParent.source })).rejects.toThrow();
    const forgedWorkspace = { ...parentWorkspace, contentHash: "a".repeat(64) };
    const forged = await makeOutput("Forged foreign workspace pin", [parentSource, forgedWorkspace]);
    await expect(assertNativeProjectSourceCurrent(db, { companyId, actor: nativeActor, source: forged.source })).rejects.toThrow();

    const waiting = await makeOutput("Parent mutation while reader waits", [parentSource, parentWorkspace]);
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const hasParentLock = new Promise<void>(resolve => { locked = resolve; });
    const parentLock = db.transaction(async tx => {
      await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId),
        eq(projects.id, waiting.id))).for("update");
      locked();
      await release;
    });
    await hasParentLock;
    const sourceCheck = assertNativeProjectSourceCurrent(db, { companyId, actor: nativeActor, source: waiting.source })
      .then(() => false, () => true);
    try {
      let observedLockWait = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [activity] = await db.execute<{ waiting: number }>(sql`select count(*)::int as waiting from pg_stat_activity
          where datname=current_database() and state='active' and wait_event_type='Lock' and query ilike '%projects%'`);
        if ((activity?.waiting ?? 0) > 0) { observedLockWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observedLockWait, "the source reader must be waiting on the locked output Project row").toBe(true);
      await projectService(db).updateWorkspace(parentId, parentWorkspace.workspaceId,
        { name: "Parent workspace changed during output-owner wait" });
    } finally {
      unlock();
      await parentLock;
    }
    expect(await sourceCheck, "the post-wait current-parent check must reject the withdrawn source").toBe(true);
  });

  it("binds an unknown Project tool result to its actual acknowledged dispatch without qualifying inputs", async () => {
    const seeded = await seed(), turnId = "actual-project-tool-turn", callId = "actual-project-tool-call";
    const turnInput = { message: { role: "user" as const, text: "Read the current Project" } };
    const args = dispatchArgs(seeded, turnInput), dispatchId = await recordNativeModelInputDispatchIntent(args);
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, turnId));
    await recordNativeToolCallDispatchAssociation({ ...args, turnId, callId, tool: "call_api" });
    const projectId = randomUUID();
    const capture = captureNativeProjectToolResult({ companyId, turnId, callId,
      requestedProjectId: projectId, requestHash: "a".repeat(64),
      pathAndQuery: `/api/projects/${projectId}`,
      result: { status: 200, unknown: true } });
    const { turnInput: _turnInput, ...binding } = args;
    await recordNativeProjectToolResultIntent({ ...binding, capture });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeToolResultSourceCaptures).toEqual([expect.objectContaining({
      eventSeq: seeded.eventSeq, attempt: seeded.attempt, turnId, callId, tool: "call_api",
      operationId: "GET /api/projects/{id}", projectId, responsibleUserId,
      nativeInputDispatch: { dispatchId, eventSeq: seeded.eventSeq, attempt: seeded.attempt, turnId, callId },
      source: null,
    })]);
    expect(run!.nativeInputSourceProtocolVersion).toBe(0);
    expect(run!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
    await expect(recordNativeProjectToolResultIntent({ ...binding, capture: {
      ...capture, source: { kind: "project", projectId: randomUUID(), sourceVersion: new Date().toISOString(), contentHash: "a".repeat(64) },
    } })).rejects.toThrow("native_project_tool_capture_binding_invalid");
  });

  it.each(["missing_ack", "missing_call", "other_tool", "ambiguous_turn", "prior_attempt", "prior_launch"] as const)(
    "keeps the document dispatch unknown for %s without retroactive rebinding", async kind => {
      const seeded = await seed(), args = documentArgs(seeded);
      args.capture.turnId = "actual-document-turn";
      const turnInput = { message: { role: "user" as const, text: "Actual document selection" } };
      const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
      if (kind !== "missing_ack") {
        await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, args.capture.turnId));
        if (kind !== "missing_call") await recordNativeToolCallDispatchAssociation({ ...dispatchArgs(seeded, turnInput),
          turnId: args.capture.turnId, callId: args.capture.callId, tool: kind === "other_tool" ? "create_task" : "read_document" });
      }
      if (kind === "ambiguous_turn") {
        const duplicate = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
        await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, duplicate, turnInput, args.capture.turnId));
      }
      if (kind === "prior_attempt" || kind === "prior_launch") {
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
        const profile = run!.runnerProfileJson!;
        for (const field of ["nativeModelInputDispatchIntents", "nativeToolCallDispatchAssociations"]) {
          profile[field] = (profile[field] as Record<string, unknown>[]).map(value => ({ ...value,
            ...(kind === "prior_attempt" ? { attempt: seeded.attempt - 1 } : { eventSeq: seeded.eventSeq - 1 }) }));
        }
        await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, seeded.runId));
      }
      await recordNativeDocumentToolResultIntent(args);
      if (kind === "missing_ack") {
        await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, args.capture.turnId));
        await recordNativeToolCallDispatchAssociation({ ...dispatchArgs(seeded, turnInput),
          turnId: args.capture.turnId, callId: args.capture.callId, tool: "read_document" });
      }
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(run!.runnerProfileJson!.nativeToolResultSourceCaptures).toEqual([
        expect.objectContaining({ turnId: args.capture.turnId, nativeInputDispatch: null }),
      ]);
      expect(run!.nativeInputSourceProtocolVersion).toBe(0);
    });

  it("retains an actual direct Human revision snapshot and rejects a substituted owner", async () => {
    const seeded = await seed(), userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Literal document Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3600000) });
    await db.update(heartbeatRuns).set({ responsibleUserId: userId }).where(eq(heartbeatRuns.id, seeded.runId));
    const service = documentService(db);
    await service.upsertIssueDocument({ issueId: seeded.issueId, key: "literal", title: "Actual literal document",
      format: "markdown", body: "Independent literal Human input", createdByUserId: userId,
      manualInputActor: { type: "board", source: "session", userId, sessionId, companyIds: [companyId] } });
    let source: DocumentRevisionSourceCapture | null = null;
    const selected = await service.getIssueDocumentByKey(seeded.issueId, "literal", { onSourceCapture: capture => { source = capture; } });
    expect(source).toMatchObject({ payloadSourceSnapshot: { version: 1, owner: { kind: "document_revision", companyId } } });
    const args = documentArgs(seeded, source);
    args.capture.resultDigest = createHash("sha256").update(JSON.stringify({ document: selected })).digest("hex");
    await recordNativeDocumentToolResultIntent(args);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeToolResultSourceCaptures).toEqual([expect.objectContaining({ responsibleUserId: userId, source })]);
    const substituted = structuredClone(args.capture);
    substituted.source!.payloadSourceSnapshot!.owner.companyId = randomUUID();
    await expect(recordNativeDocumentToolResultIntent({ ...args, capture: substituted })).rejects.toThrow("native_document_tool_capture_binding_invalid");
    const mismatchedResult = { ...structuredClone(args.capture), source: { ...structuredClone(args.capture.source!), returnedResultDigest: "f".repeat(64) } };
    await expect(recordNativeDocumentToolResultIntent({ ...args, capture: mismatchedResult })).rejects.toThrow("native_document_tool_capture_binding_invalid");
    const [unchanged] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(unchanged!.runnerProfileJson).toEqual(run!.runnerProfileJson);
  });

  it("binds actual rendered task/document sources to the canonical model envelope and acknowledged PG dispatch", async () => {
    const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Native bootstrap Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    const actor = { type: "board" as const, source: "session" as const, userId, sessionId, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "member", status: "active" as const }] };
    const createdIssue = await issueService(db).create(companyId, {
      title: "Rendered native task", description: "A canonical Human request",
      createdByUserId: userId,
    }, db, undefined, { manualInputActor: actor });
    const seeded = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
    await db.update(issues).set({ status: "in_progress", assigneeAgentId: agentId, executionRunId: seeded.runId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdIssue.id)));
    await initializeRunIdentity(db, { companyId, runId: seeded.runId, issueId: createdIssue.id,
      responsibleUserId: userId, cause: "dispatch" });
    let selectedTask: NonNullable<Awaited<ReturnType<typeof getIssueExecutionContext>>> | null = null;
    const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
    selectedTask = await getIssueExecutionContext(db, companyId, createdIssue.id, capture => { taskCaptureHolder.value = capture; });
    expect(selectedTask).not.toBeNull();
    const document = await documentService(db).upsertIssueDocument({ issueId: createdIssue.id, key: "native-bootstrap", title: "Pinned native plan",
      format: "markdown", body: "The selected Human approved plan.", createdByUserId: userId, manualInputActor: actor });
    let revisionCapture: DocumentRevisionSourceCapture | null = null;
    const selectedRevision = await documentService(db).getIssueDocumentByKey(createdIssue.id, "native-bootstrap", { onSourceCapture: capture => { revisionCapture = capture; } });
    expect(selectedRevision).not.toBeNull();
    expect(revisionCapture).not.toBeNull();
    if (!selectedRevision || typeof selectedRevision.body !== "string") throw new Error("The selected document body is unavailable");
    const governedContext = await contextEngineService(db).assembleNativeBootstrap({ companyId, agentId,
      authorizationActor: { type: "agent", source: "none", companyId, agentId, runId: seeded.runId, onBehalfOfUserId: userId },
      responsibleUserId: userId, runId: seeded.runId, issueId: createdIssue.id, projectId: null,
      query: "Rendered native task", intent: "native_task_execution", includeFoundation: false,
      sensitivityCeiling: "internal" });
    expect(governedContext.nativeBootstrapWitness).toBeDefined();
    const [runtimeAgent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    expect(runtimeAgent).toBeDefined();
    const runtimeSourceCapture: { value: NativeRuntimeAuthoredSourceCapture | null } = { value: null };
    const runtimeContext = await buildRetainedNativeRuntimeContext({ db, agent: runtimeAgent!, runId: seeded.runId,
      runtimeConfig: {}, runtimeSkillEntries: [], onAuthoredSourceCapture: capture => { runtimeSourceCapture.value = capture; } });
    const runtimeInputs = runtimeSourceCapture.value?.inputs ?? [];
    const renderedReferences: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const renderedMarkdown = buildPaperclipTaskMarkdown({
      issue: { id: createdIssue.id, identifier: selectedTask!.identifier, title: selectedTask!.title, description: selectedTask!.description, workMode: "standard" },
      taskPlan: { documentId: document.document.id, revisionId: revisionCapture!.input.revisionId,
        revisionNumber: selectedRevision.latestRevisionNumber, body: selectedRevision.body },
    }, { onRenderedSource: source => renderedReferences.push(source) });
    expect(renderedMarkdown).toBeTruthy();
    const taskCapture = taskCaptureHolder.value;
    expect(taskCapture?.payloadSourceSnapshot).not.toBeNull();
    expect(taskCapture!.payloadSourceSnapshot).toMatchObject({ owner: { kind: "issue", companyId, id: createdIssue.id } });
    expect(revisionCapture!.payloadSourceSnapshot).toMatchObject({ owner: { kind: "document_revision", companyId, id: revisionCapture!.input.revisionId } });
    const renderedDigest = createHash("sha256").update(renderedMarkdown!, "utf8").digest("hex");
    const nativeWorkspace = { cwd: resolveDefaultAgentWorkspaceDir(agentId), repoUrl: null, repoRef: null, branchName: null };
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, renderedMarkdown: renderedMarkdown!, runId: seeded.runId,
      agentId, issueId: createdIssue.id, renderedMarkdownDigest: renderedDigest,
      references: renderedReferences,
      candidates: [
        { kind: "task", id: createdIssue.id, input: taskCapture!.input, payloadSourceSnapshot: taskCapture!.payloadSourceSnapshot },
        { kind: "document_revision", id: revisionCapture!.input.revisionId, input: revisionCapture!.input, payloadSourceSnapshot: revisionCapture!.payloadSourceSnapshot },
      ], runtimeInputs, contextManifestIds: [{ companyId, contextManifestId: governedContext.packet.manifest!.id }],
      governedContextMarkdown: governedContext.markdown, contextWitness: governedContext.nativeBootstrapWitness,
      additionalInputs: [{ kind: "workspace_metadata", runId: seeded.runId, executionWorkspaceId: seeded.runId,
        origin: "agent_home", sourceVersion: `agent-home:${agentId}:v1`,
        contentHash: createHash("sha256").update(JSON.stringify(nativeWorkspace), "utf8").digest("hex") }],
      rolePackInputs: [], unsupportedInputPresent: false });
    expect(sourceSet?.inputs.map(value => value.kind)).toEqual(expect.arrayContaining([
      "task", "document_revision", "workspace_metadata", "context", "runtime_instructions",
    ]));
    const completion = await ensureNativeCompletionContract({ db, companyId,
      issue: { id: createdIssue.id, title: selectedTask!.title, description: selectedTask!.description }, actorId: agentId });
    await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
      completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));
    const execution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
      issue: { id: createdIssue.id, identifier: selectedTask!.identifier, title: selectedTask!.title, description: selectedTask!.description, workMode: "standard" },
      taskPrompt: renderedMarkdown!, governedContextMarkdown: governedContext.markdown,
      workspace: { id: seeded.runId, ...nativeWorkspace },
      normalizedSessionId: null, provider: "claude_managed", model: "claude-sonnet-5",
      managedProfile: { profileId: "profile", anthropicAgentId: "agent_01", agentVersion: "1", environmentId: "environment", betaVersion: "managed-agents-2026-04-01" },
      maxSessionListCostUsd: 1, completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
        schemaVersion: completion.row.schemaVersion, contract: completion.contract },
      runtimeContext });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, seeded.runId));
    const envelope = buildNativeModelEnvelope(execution);
    const turnInput = { message: { role: "user" as const, text: JSON.stringify(envelope) }, requestedCollaborationMode: "default" as const };
    const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: nativeSha256(execution.task) };
    const dispatchId = await recordNativeModelInputDispatchIntent({ ...dispatchArgs(seeded, turnInput), bootstrapSourceClosure: closure });
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, dispatchId, turnInput), sourceClosure: closure });
    const [runAfterBootstrap] = await db.select({ nativeInputSourceProtocolVersion: heartbeatRuns.nativeInputSourceProtocolVersion })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(runAfterBootstrap!.nativeInputSourceProtocolVersion).toBe(1);
    const refreshedContext = await contextEngineService(db).assembleNativeBootstrap({ companyId, agentId,
      authorizationActor: { type: "agent", source: "none", companyId, agentId, runId: seeded.runId, onBehalfOfUserId: userId },
      responsibleUserId: userId, runId: seeded.runId, issueId: createdIssue.id, projectId: null,
      query: "Fresh canonical Context for a later Native turn", intent: "native_task_execution", includeFoundation: false,
      sensitivityCeiling: "internal" });
    const refreshedTurn = prepareNativeTurnWithContext({ turnInput, baseClosure: closure, companyId,
      runId: seeded.runId, agentId, issueId: createdIssue.id, contextMarkdown: refreshedContext.markdown,
      contextWitness: refreshedContext.nativeBootstrapWitness ?? null,
      manifestIds: [{ companyId, contextManifestId: refreshedContext.packet.manifest!.id }] });
    expect(refreshedTurn).not.toBeNull();
    const refreshedDispatchId = await recordNativeModelInputDispatchIntent({
      ...dispatchArgs(seeded, refreshedTurn!.turnInput), bootstrapSourceClosure: refreshedTurn!.sourceClosure });
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, refreshedDispatchId, refreshedTurn!.turnInput),
      sourceClosure: refreshedTurn!.sourceClosure });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.nativeInputSourceProtocolVersion).toBe(1);
    expect(run!.sourceContextProvenanceQualified).toBe(false);
    expect(run!.runnerProfileJson).toMatchObject({ nativeInputSourceReceipt: {
      bootstrap: { inputs: expect.arrayContaining([expect.objectContaining({ kind: "task", issueId: createdIssue.id }),
        expect.objectContaining({ kind: "document_revision", revisionId: revisionCapture!.input.revisionId }),
        expect.objectContaining({ kind: "context", manifestId: governedContext.packet.manifest!.id })]) },
      dispatches: [expect.objectContaining({ responsibleUserId: userId }), expect.objectContaining({
        responsibleUserId: userId, inputs: expect.arrayContaining([
          expect.objectContaining({ kind: "context", manifestId: refreshedContext.packet.manifest!.id }),
        ]),
      })],
    } });

    const alteredSeed = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution },
      completionContractId: completion.row.id, completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, alteredSeed.runId));
    const alteredEnvelope = structuredClone(envelope);
    alteredEnvelope.task.title = `${alteredEnvelope.task.title} substituted`;
    const alteredTurn = { message: { role: "user" as const, text: JSON.stringify(alteredEnvelope) }, requestedCollaborationMode: "default" as const };
    await recordNativeModelInputDispatchIntent({ ...dispatchArgs(alteredSeed, alteredTurn), bootstrapSourceClosure: closure });
    const [alteredRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, alteredSeed.runId));
    expect(alteredRun!.nativeInputSourceProtocolVersion).toBe(0);
    expect(alteredRun!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");

    const alteredContractSeed = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution },
      completionContractId: completion.row.id, completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, alteredContractSeed.runId));
    const alteredContractEnvelope = structuredClone(envelope);
    alteredContractEnvelope.completionContract.criteria[0]!.requirement += " Added after source collection.";
    const alteredContractTurn = { message: { role: "user" as const, text: JSON.stringify(alteredContractEnvelope) }, requestedCollaborationMode: "default" as const };
    await recordNativeModelInputDispatchIntent({ ...dispatchArgs(alteredContractSeed, alteredContractTurn), bootstrapSourceClosure: closure });
    const [alteredContractRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, alteredContractSeed.runId));
    expect(alteredContractRun!.nativeInputSourceProtocolVersion).toBe(0);
    expect(alteredContractRun!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");

    const extraKeySeed = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution },
      completionContractId: completion.row.id, completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, extraKeySeed.runId));
    const extraKeyEnvelope = { ...structuredClone(envelope), untrackedSource: "unclassified prompt input" };
    const extraKeyTurn = { message: { role: "user" as const, text: JSON.stringify(extraKeyEnvelope) }, requestedCollaborationMode: "default" as const };
    await recordNativeModelInputDispatchIntent({ ...dispatchArgs(extraKeySeed, extraKeyTurn), bootstrapSourceClosure: closure });
    const [extraKeyRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, extraKeySeed.runId));
    expect(extraKeyRun!.nativeInputSourceProtocolVersion).toBe(0);
    expect(extraKeyRun!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");

    const unknownSeed = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
    const workspaceExecution = buildNativeExecutionInput({ companyId, runId: unknownSeed.runId, agentId,
      issue: { id: createdIssue.id, identifier: selectedTask!.identifier, title: selectedTask!.title, description: selectedTask!.description, workMode: "standard" },
      taskPrompt: renderedMarkdown!, workspace: { id: unknownSeed.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null },
      normalizedSessionId: null, completionContract: { id: randomUUID(), sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1",
        contract: { revision: "1", objective: "Complete the task", criteria: [{ id: "output", requirement: "Return the result" }] } },
      runtimeContext: nativeRuntimeContextFixture() });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: workspaceExecution },
      completionContractId: completion.row.id, completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, unknownSeed.runId));
    const workspaceEnvelope = buildNativeModelEnvelope(workspaceExecution);
    const workspaceTurn = { message: { role: "user" as const, text: JSON.stringify(workspaceEnvelope) }, requestedCollaborationMode: "default" as const };
    const workspaceClosure = { sourceSet: sourceSet!, taskEnvelopeDigest: nativeSha256(workspaceExecution.task) };
    await recordNativeModelInputDispatchIntent({ ...dispatchArgs(unknownSeed, workspaceTurn), bootstrapSourceClosure: workspaceClosure });
    const [unknownRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, unknownSeed.runId));
    expect(unknownRun!.nativeInputSourceProtocolVersion).toBe(0);
    expect(unknownRun!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
  });

  it("rechecks a captured interaction against current item verdicts after an acknowledged PG dispatch", async () => {
    const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Interaction source Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000) });
    const boardActor = { type: "board" as const, source: "session" as const, userId, sessionId, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "member", status: "active" as const }] };
    const createdIssue = await issueService(db).create(companyId, { title: "Interaction source task", description: "Keep the current answer bound",
      createdByUserId: userId }, db, undefined, { manualInputActor: boardActor });
    const seeded = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
    await db.update(issues).set({ status: "in_progress", assigneeAgentId: agentId, executionRunId: seeded.runId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdIssue.id)));
    let taskCapture: NativeTaskSourceCapture | null = null;
    const task = await getIssueExecutionContext(db, companyId, createdIssue.id, capture => { taskCapture = capture; });
    expect(task).not.toBeNull();
    const references: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const markdown = buildPaperclipTaskMarkdown({ issue: { id: createdIssue.id, identifier: task!.identifier,
      title: task!.title, description: task!.description, workMode: task!.workMode } },
      { onRenderedSource: source => references.push(source) })!;
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({ id: interactionId, companyId, issueId: createdIssue.id,
      kind: "request_item_verdicts", status: "pending", createdByAgentId: agentId, sourceRunId: seeded.runId,
      payload: { version: 1, prompt: "Review the requested items", items: [
        { id: "one", label: "First item" }, { id: "two", label: "Second item" },
      ] } });
    const interactionService = issueThreadInteractionService(db);
    await interactionService.submitItemVerdicts({ id: createdIssue.id, companyId, status: "in_progress" }, interactionId,
      { verdicts: [{ id: "one", verdict: "approve" }] }, { userId });
    const interactionSources: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
    const interactionResponses = await materializeNativeInteractionResponses({ db, companyId, issueId: createdIssue.id,
      runId: seeded.runId, agentId, interactionIds: [interactionId], onSourceCapture: source => interactionSources.push(source) });
    const completion = await ensureNativeCompletionContract({ db, companyId,
      issue: { id: createdIssue.id, title: task!.title, description: task!.description }, actorId: agentId });
    await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
      completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));
    const workspace = { id: seeded.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null };
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId: seeded.runId, agentId, issueId: createdIssue.id,
      renderedMarkdown: markdown, renderedMarkdownDigest: createHash("sha256").update(markdown, "utf8").digest("hex"), references,
      candidates: [{ kind: "task", id: createdIssue.id, input: taskCapture!.input,
        payloadSourceSnapshot: taskCapture!.payloadSourceSnapshot }], runtimeInputs: [],
      additionalInputs: [{ kind: "completion_contract", issueId: createdIssue.id, contractId: completion.row.id,
        revision: String(completion.row.revision), contentHash: completion.row.canonicalSha256 },
        { kind: "workspace_metadata", runId: seeded.runId, executionWorkspaceId: seeded.runId, origin: "task_session",
          sourceVersion: `task-session:${seeded.runId}`, contentHash: createHash("sha256").update(JSON.stringify({
            cwd: workspace.cwd, repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName,
          }), "utf8").digest("hex") }],
      interactionResponses, interactionSources, contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: false });
    expect(sourceSet?.inputs).toContainEqual(interactionSources[0]);
    const execution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
      issue: { id: createdIssue.id, identifier: task!.identifier, title: task!.title, description: task!.description, workMode: "standard" },
      taskPrompt: markdown, workspace, normalizedSessionId: null, provider: "claude_managed", model: "claude-sonnet-5",
      interactionResponses, managedProfile: { profileId: "profile", anthropicAgentId: "agent_01", agentVersion: "1",
        environmentId: "environment", betaVersion: "managed-agents-2026-04-01" }, maxSessionListCostUsd: 1,
      completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
        schemaVersion: completion.row.schemaVersion, contract: completion.contract }, runtimeContext: nativeRuntimeContextFixture() });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, seeded.runId));
    const turnInput = { message: { role: "user" as const, text: JSON.stringify(buildNativeModelEnvelope(execution)) }, requestedCollaborationMode: "default" as const };
    const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: nativeSha256(execution.task) };
    const dispatchId = await recordNativeModelInputDispatchIntent({ ...dispatchArgs(seeded, turnInput), bootstrapSourceClosure: closure });
    const [runAfterIntent] = await db.select({ nativeInputSourceProtocolVersion: heartbeatRuns.nativeInputSourceProtocolVersion,
      runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(runAfterIntent!.nativeInputSourceProtocolVersion).toBe(1);
    expect(runAfterIntent!.runnerProfileJson).toHaveProperty("nativeInputSourceReceipt");
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, dispatchId, turnInput), sourceClosure: closure });
    const nativeActor = { type: "agent" as const, source: "none" as const, companyId, agentId, runId: seeded.runId,
      onBehalfOfUserId: userId };
    const checkCurrent = () => assertNativePayloadSourceSetCurrent(db, { companyId, issueId: createdIssue.id, runId: seeded.runId,
      actor: nativeActor, policy: sourceSet!.policy, inputs: sourceSet!.inputs });
    await expect(checkCurrent()).resolves.toBeUndefined();
    await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId: createdIssue.id, runId: seeded.runId,
      actor: nativeActor, policy: sourceSet!.policy,
      inputs: sourceSet!.inputs.filter(source => source.kind !== "interaction") }))
      .rejects.toThrow("The Native source prefix is not in its original receipt");
    await interactionService.submitItemVerdicts({ id: createdIssue.id, companyId, status: "in_progress" }, interactionId,
      { verdicts: [{ id: "two", verdict: "reject", reason: "Needs revision" }] }, { userId });
    await expect(checkCurrent()).rejects.toThrow("A Native source Interaction changed or was erased");
  });

  it("appends only an actual acknowledged Native history read with current source owners", async () => {
    const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "History source Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000) });
    const boardActor = { type: "board" as const, source: "session" as const, userId, sessionId, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "member", status: "active" as const }] };

    const runRead = async (association: "exact" | "missing" | "forged") => {
      const createdIssue = await issueService(db).create(companyId, { title: "Read exact Task history", description: "A current Human source",
        createdByUserId: userId }, db, undefined, { manualInputActor: boardActor });
      const seeded = await seed({ existingIssueId: createdIssue.id, responsibleUserId: userId });
      await db.update(issues).set({ status: "in_progress", assigneeAgentId: agentId, executionRunId: seeded.runId })
        .where(and(eq(issues.companyId, companyId), eq(issues.id, createdIssue.id)));
      const comment = await issueService(db).addComment(createdIssue.id, "Current authored history result.", { userId },
        { manualInputActor: boardActor });
      const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
      const task = await getIssueExecutionContext(db, companyId, createdIssue.id, capture => { taskCaptureHolder.value = capture; });
      expect(task).not.toBeNull();
      const references: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
      const markdown = buildPaperclipTaskMarkdown({ issue: { id: createdIssue.id, identifier: task!.identifier,
        title: task!.title, description: task!.description, workMode: task!.workMode } },
        { onRenderedSource: source => references.push(source) })!;
      const workspace = { id: seeded.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null };
      const completion = await ensureNativeCompletionContract({ db, companyId,
        issue: { id: createdIssue.id, title: task!.title, description: task!.description }, actorId: agentId });
      await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
        completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));
      const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId: seeded.runId, agentId, issueId: createdIssue.id,
        renderedMarkdown: markdown, renderedMarkdownDigest: createHash("sha256").update(markdown, "utf8").digest("hex"), references,
        candidates: [{ kind: "task", id: createdIssue.id, input: taskCaptureHolder.value!.input,
          payloadSourceSnapshot: taskCaptureHolder.value!.payloadSourceSnapshot }], runtimeInputs: [], contextManifestIds: [],
        additionalInputs: [{ kind: "completion_contract", issueId: createdIssue.id, contractId: completion?.row.id ?? "",
          revision: String(completion?.row.revision ?? ""), contentHash: completion?.row.canonicalSha256 ?? "" },
          { kind: "workspace_metadata", runId: seeded.runId, executionWorkspaceId: seeded.runId, origin: "task_session",
            sourceVersion: `task-session:${seeded.runId}`, contentHash: createHash("sha256").update(JSON.stringify({ cwd: workspace.cwd,
              repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName }), "utf8").digest("hex") }],
        rolePackInputs: [], unsupportedInputPresent: false });
      expect(sourceSet).not.toBeNull();
      await initializeRunIdentity(db, { companyId, runId: seeded.runId, issueId: createdIssue.id,
        responsibleUserId: userId, cause: "dispatch" });
      const execution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
        issue: { id: createdIssue.id, identifier: task!.identifier, title: task!.title, description: task!.description, workMode: "standard" },
        taskPrompt: markdown, workspace: { id: seeded.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null },
        normalizedSessionId: null, completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
          schemaVersion: completion.row.schemaVersion, contract: completion.contract }, runtimeContext: nativeRuntimeContextFixture() });
      await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, seeded.runId));
      const turnInput = { message: { role: "user" as const, text: JSON.stringify(buildNativeModelEnvelope(execution)) }, requestedCollaborationMode: "default" as const };
      const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: nativeSha256(execution.task) };
      const dispatchArgsForRead = dispatchArgs(seeded, turnInput);
      const dispatchId = await recordNativeModelInputDispatchIntent({ ...dispatchArgsForRead, bootstrapSourceClosure: closure });
      const turnId = `native-history-turn-${seeded.runId}`;
      const callId = `native-history-call-${seeded.runId}`;
      await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, dispatchId, turnInput, turnId), sourceClosure: closure });
      const argsHash = nativeSha256({});
      if (association !== "missing") expect(await recordNativeToolCallDispatchAssociation({ ...dispatchArgsForRead,
        turnId, callId, tool: "get_task_history", argumentsHash: association === "forged" ? nativeSha256({ other: true }) : argsHash })).toBe(true);
      const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId: createdIssue.id, runId: seeded.runId });
      const binding = { ...dispatchArgs(seeded, turnInput), agentId };
      const callback = async (capture: Parameters<typeof recordNativeInputToolResultIntent>[0]["capture"]) => {
        if (capture.sourceSet) {
          for (const commentSource of capture.sourceSet.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "comment" }> =>
            source.kind === "comment")) {
            const [row] = await db.select({ sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text`,
              payloadSourceSnapshot: issueComments.payloadSourceSnapshot,
              payloadSourceSnapshotInvalidated: issueComments.payloadSourceSnapshotInvalidated }).from(issueComments)
              .where(eq(issueComments.id, commentSource.commentId));
            const view = await issueService(db).getComment(commentSource.commentId);
            const snapshot = row?.payloadSourceSnapshot as { owner?: Record<string, unknown>; policy?: Record<string, string[]>; inputs?: unknown[] } | null;
            expect(row?.sourceVersion).toBe(commentSource.sourceVersion);
            expect(row?.payloadSourceSnapshotInvalidated).toBe(false);
            expect(view).not.toBeNull();
            expect(snapshot?.owner?.contentHash).toMatch(/^[0-9a-f]{64}$/);
            expect(nativeCommentProjectionHash({ body: view?.body, presentation: view?.presentation, metadata: view?.metadata }))
              .toBe(commentSource.contentHash);
            expect((snapshot?.inputs ?? []).every(root => capture.sourceSet!.inputs.some(value => nativeSha256(value) === nativeSha256(root))))
              .toBe(true);
            expect(Object.entries(snapshot?.policy ?? {}).every(([key, values]) => values.every(sourceId =>
              (capture.sourceSet!.policy as unknown as Record<string, string[]>)[key]?.includes(sourceId)))).toBe(true);
          }
          await assertNativeReadResultSourceSetOwnersCurrent(db, { companyId, issueId: createdIssue.id,
            runId: seeded.runId, tool: "get_task_history", actor: { type: "agent", source: "none", companyId, agentId,
              runId: seeded.runId, onBehalfOfUserId: userId }, sourceSet: capture.sourceSet });
        }
        await recordNativeInputToolResultIntent({ ...binding, capture });
      };
      const result = await authority.execute({ tool: "get_task_history", callId, arguments: {} }, {
        nativeToolCallIdentity: { tool: "get_task_history", callId, turnId }, onNativeInputToolResult: callback,
      });
      expect(result).toMatchObject({ comments: expect.arrayContaining([expect.objectContaining({ id: comment.id, body: comment.body })]) });
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      return { seeded, run: run!, result };
    };

    const positive = await runRead("exact");
    expect(positive.run.nativeInputSourceProtocolVersion).toBe(1);
    const positiveProfile = positive.run.runnerProfileJson!;
    const captures = positiveProfile.nativeToolResultSourceCaptures as Array<Record<string, unknown>>;
    expect(captures).toHaveLength(1);
    const capture = captures[0]!;
    expect(capture).toMatchObject({ nativeReadResult: true, tool: "get_task_history", turnId: expect.any(String),
      callId: expect.any(String), argumentsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      resultDigest: nativeSha256(positive.result), source: { kind: "tool_result", invocationId: null } });
    const receipt = positiveProfile.nativeInputSourceReceipt as { additionalInputs: Array<{ policy: unknown; inputs: NativePayloadSourceInput[] }> };
    const readInput = receipt.additionalInputs.find(entry => entry.inputs.some(source => source.kind === "tool_result" &&
      source.callId === capture.callId));
    expect(readInput).toBeDefined();
    expect(readInput!.inputs[0]).toMatchObject({ kind: "tool_result", callId: capture.callId, contentHash: capture.resultDigest });
    const nativeActor = { type: "agent" as const, source: "none" as const, companyId, agentId, runId: positive.seeded.runId,
      onBehalfOfUserId: userId };
    await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId: positive.seeded.issueId, runId: positive.seeded.runId,
      actor: nativeActor, policy: readInput!.policy as never, inputs: readInput!.inputs })).resolves.toBeUndefined();
    expect(() => assertNativeRunReadSourceHistoryQualified(positiveProfile, { runId: positive.seeded.runId, responsibleUserId: userId })).not.toThrow();
    await db.update(issueComments).set({ payloadSourceSnapshot: null }).where(eq(issueComments.id,
      (readInput!.inputs.find(source => source.kind === "comment") as Extract<NativePayloadSourceInput, { kind: "comment" }>).commentId));
    await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId: positive.seeded.issueId, runId: positive.seeded.runId,
      actor: nativeActor, policy: readInput!.policy as never, inputs: readInput!.inputs })).rejects.toThrow();

    const missingAssociation = await runRead("missing");
    expect(missingAssociation.run.nativeInputSourceProtocolVersion).toBe(1);
    const missingProfile = missingAssociation.run.runnerProfileJson!;
    expect(missingProfile.nativeToolResultSourceCaptures).toEqual([expect.objectContaining({ nativeReadResult: true, source: null })]);
    expect((missingProfile.nativeInputSourceReceipt as { additionalInputs: unknown[] }).additionalInputs).toEqual([]);
    expect(() => assertNativeRunReadSourceHistoryQualified(missingProfile, { runId: missingAssociation.seeded.runId,
      responsibleUserId: userId })).toThrow("native_read_result_source_history_unavailable");

    const forgedAssociation = await runRead("forged");
    const forgedProfile = forgedAssociation.run.runnerProfileJson!;
    expect(forgedProfile.nativeToolCallDispatchAssociations).toEqual([expect.objectContaining({
      callId: expect.stringContaining(forgedAssociation.seeded.runId), argumentsHash: nativeSha256({ other: true }),
    })]);
    expect(forgedProfile.nativeToolResultSourceCaptures).toEqual([expect.objectContaining({ nativeReadResult: true, source: null })]);
    expect((forgedProfile.nativeInputSourceReceipt as { additionalInputs: unknown[] }).additionalInputs).toEqual([]);
    expect(() => assertNativeRunReadSourceHistoryQualified(forgedProfile, { runId: forgedAssociation.seeded.runId,
      responsibleUserId: userId })).toThrow("native_read_result_source_history_unavailable");
  });

  it("appends a real same-conversation attachment read only under its acknowledged Native call", async () => {
    const now = new Date(), sessionId = randomUUID();
    await db.insert(authSessions).values({ id: sessionId, userId: responsibleUserId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    const boardActor = { type: "board" as const, source: "session" as const, userId: responsibleUserId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "admin", status: "active" as const }] };
    const createdIssue = await issueService(db).create(companyId, { title: "Read same-conversation attachment",
      description: "Open the earlier file from this conversation.", createdByUserId: responsibleUserId }, db, undefined,
      { manualInputActor: boardActor });
    const seeded = await seed({ existingIssueId: createdIssue.id, responsibleUserId });
    await db.update(issues).set({ status: "in_progress", assigneeAgentId: agentId, executionRunId: seeded.runId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdIssue.id)));

    const endpointId = randomUUID(), connectionId = randomUUID(), applicationId = randomUUID(), resourceId = randomUUID();
    const conversationId = randomUUID(), principalId = randomUUID();
    await db.insert(toolApplications).values({ id: applicationId, companyId, applicationKey: `chat:discord:${endpointId}`,
      name: "Native attachment read fixture", type: "chat", status: "active" });
    await db.insert(toolConnections).values({ id: connectionId, companyId, applicationId, name: "Native attachment read fixture",
      uid: `chat-discord-${endpointId}`, connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true });
    await db.insert(chatEndpoints).values({ id: endpointId, companyId, connectionId, provider: "discord", publicId: randomUUID(),
      assignedAgentId: agentId, status: "active", providerAccountId: `guild-${endpointId}`, allowUnlinkedPeople: false });
    await db.insert(chatEndpointResources).values({ id: resourceId, companyId, endpointId, type: "channel",
      providerResourceId: `channel-${endpointId}`, label: "#files", availability: "available", enabled: true });
    await db.insert(chatConversations).values({ id: conversationId, companyId, endpointId, resourceId, issueId: createdIssue.id,
      externalConversationId: `channel-${endpointId}`, externalThreadId: `thread-${endpointId}`, externalLabel: "#files thread", state: "active" });
    await db.insert(chatExternalPrincipals).values({ id: principalId, companyId, provider: "discord",
      providerAccountId: `guild-${endpointId}`, externalId: `discord-user-${endpointId}`, kind: "user" });
    await db.insert(chatIdentityLinks).values({ companyId, endpointId, principalId, paperclipUserId: responsibleUserId, status: "linked" });

    const sourceComment = await issueService(db).addComment(createdIssue.id, "Earlier file in this conversation.",
      { userId: responsibleUserId }, { manualInputActor: boardActor });
    const bytes = Buffer.from("Actual same-conversation attachment bytes.\n", "utf8");
    const stored = await storage.putFile({ companyId, namespace: `issues/${createdIssue.id}`, originalFilename: "earlier.txt",
      contentType: "text/plain", body: bytes });
    const attachment = await issueService(db).createAttachment({ issueId: createdIssue.id, issueCommentId: sourceComment.id,
      provider: stored.provider, objectKey: stored.objectKey, contentType: stored.contentType, byteSize: stored.byteSize,
      sha256: stored.sha256, originalFilename: stored.originalFilename, createdByUserId: responsibleUserId },
      { actor: boardActor, bytes });
    const currentComment = await issueService(db).addComment(createdIssue.id, "Please inspect that earlier file.",
      { userId: responsibleUserId }, { manualInputActor: boardActor });
    for (const [commentId, suffix] of [[sourceComment.id, "source"], [currentComment.id, "current"]] as const) {
      const deliveryId = randomUUID();
      await db.insert(chatDeliveries).values({ id: deliveryId, companyId, endpointId, conversationId, principalId,
        providerEventId: `attachment-${suffix}-${deliveryId}`, deduplicationKey: `attachment-${suffix}-${deliveryId}`,
        eventKind: "message", normalizedEvent: {}, state: "processed", attempts: 1, processedAt: new Date() });
      await db.insert(chatMessageLinks).values({ companyId, endpointId, conversationId, deliveryId, commentId,
        providerMessageId: `attachment-${suffix}-${deliveryId}`, direction: "inbound" });
    }
    await db.update(heartbeatRuns).set({ contextSnapshot: { source: "chat:discord", paperclipHarnessCheckedOut: true,
      wakeCommentIds: [currentComment.id], commentId: currentComment.id, paperclipWake: { reason: "External chat message received",
        externalChatProvider: "discord", checkedOutByHarness: true,
        issue: { id: createdIssue.id, workMode: "standard" }, commentIds: [currentComment.id] } } })
      .where(eq(heartbeatRuns.id, seeded.runId));

    const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
    const task = await getIssueExecutionContext(db, companyId, createdIssue.id, capture => { taskCaptureHolder.value = capture; });
    expect(task).not.toBeNull();
    const references: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const markdown = buildPaperclipTaskMarkdown({ issue: { id: createdIssue.id, identifier: task!.identifier,
      title: task!.title, description: task!.description, workMode: task!.workMode } },
      { onRenderedSource: source => references.push(source) })!;
    const workspace = { id: seeded.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null };
    const completion = await ensureNativeCompletionContract({ db, companyId,
      issue: { id: createdIssue.id, title: task!.title, description: task!.description }, actorId: agentId });
    await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
      completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId: seeded.runId, agentId, issueId: createdIssue.id,
      renderedMarkdown: markdown, renderedMarkdownDigest: createHash("sha256").update(markdown, "utf8").digest("hex"), references,
      candidates: [{ kind: "task", id: createdIssue.id, input: taskCaptureHolder.value!.input,
        payloadSourceSnapshot: taskCaptureHolder.value!.payloadSourceSnapshot }], runtimeInputs: [], contextManifestIds: [],
      additionalInputs: [{ kind: "completion_contract", issueId: createdIssue.id, contractId: completion.row.id,
        revision: String(completion.row.revision), contentHash: completion.row.canonicalSha256 },
        { kind: "workspace_metadata", runId: seeded.runId, executionWorkspaceId: seeded.runId, origin: "task_session",
          sourceVersion: `task-session:${seeded.runId}`, contentHash: createHash("sha256").update(JSON.stringify({ cwd: workspace.cwd,
            repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName }), "utf8").digest("hex") }],
      rolePackInputs: [], unsupportedInputPresent: false });
    expect(sourceSet).not.toBeNull();
    await initializeRunIdentity(db, { companyId, runId: seeded.runId, issueId: createdIssue.id,
      responsibleUserId, cause: "dispatch" });
    const execution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
      issue: { id: createdIssue.id, identifier: task!.identifier, title: task!.title, description: task!.description, workMode: "standard" },
      taskPrompt: markdown, workspace, normalizedSessionId: null,
      completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
        schemaVersion: completion.row.schemaVersion, contract: completion.contract }, runtimeContext: nativeRuntimeContextFixture() });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, seeded.runId));
    const turnInput = { message: { role: "user" as const, text: JSON.stringify(buildNativeModelEnvelope(execution)) }, requestedCollaborationMode: "default" as const };
    const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: nativeSha256(execution.task) };
    const dispatchArgsForRead = dispatchArgs(seeded, turnInput);
    const dispatchId = await recordNativeModelInputDispatchIntent({ ...dispatchArgsForRead, bootstrapSourceClosure: closure });
    const turnId = `native-attachment-turn-${seeded.runId}`, callId = `native-attachment-call-${seeded.runId}`;
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, dispatchId, turnInput, turnId), sourceClosure: closure });
    const readArguments = { sourceCommentId: sourceComment.id, attachmentId: attachment.id };
    expect(await recordNativeToolCallDispatchAssociation({ ...dispatchArgsForRead, turnId, callId,
      tool: "read_chat_attachment", argumentsHash: nativeSha256(readArguments) })).toBe(true);

    const workspaceRoot = join(storageRoot, `chat-read-${seeded.runId}`);
    await mkdir(workspaceRoot, { recursive: true });
    const reader = new NativeChatAttachmentReadScope({ db, binding: { companyId, agentId, issueId: createdIssue.id, runId: seeded.runId },
      workspaceRoot, executionTargetKind: "local", storage });
    const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId: createdIssue.id, runId: seeded.runId,
      workspaceRoot, executionTargetKind: "local", storage, chatAttachmentReadScope: reader });
    const binding = { ...dispatchArgs(seeded, turnInput), agentId };
    const captureHolder: { value: Parameters<typeof recordNativeInputToolResultIntent>[0]["capture"] | null } = { value: null };
    try {
      const result = await authority.execute({ tool: "read_chat_attachment", callId, arguments: readArguments }, {
        nativeToolCallIdentity: { tool: "read_chat_attachment", callId, turnId },
        onNativeInputToolResult: async capture => {
          captureHolder.value = capture;
          await recordNativeInputToolResultIntent({ ...binding, capture });
        },
      });
      expect(captureHolder.value).not.toBeNull();
      if (!captureHolder.value) throw new Error("The Native attachment read result capture is unavailable");
      expect(captureHolder.value.resultDigest).toBe(nativeSha256(result));
      expect(captureHolder.value.sourceSet?.inputs).toContainEqual(expect.objectContaining({ kind: "attachment",
        issueId: createdIssue.id, attachmentId: attachment.id, commentId: sourceComment.id, assetId: attachment.assetId,
        sha256: stored.sha256, byteSize: bytes.length, disposition: "delivered" }));
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(run!.nativeInputSourceProtocolVersion).toBe(1);
      const profile = run!.runnerProfileJson!;
      expect(profile.nativeToolResultSourceCaptures).toEqual([expect.objectContaining({ nativeReadResult: true,
        tool: "read_chat_attachment", source: { kind: "tool_result", runId: seeded.runId, callId, toolName: "read_chat_attachment",
          invocationId: null, contentHash: nativeSha256(result) } })]);
      const receipt = profile.nativeInputSourceReceipt as { additionalInputs: Array<{ policy: unknown; inputs: NativePayloadSourceInput[] }> };
      const readInput = receipt.additionalInputs.find(entry => entry.inputs.some(source => source.kind === "tool_result" && source.callId === callId));
      expect(readInput?.inputs[0]).toMatchObject({ kind: "tool_result", runId: seeded.runId, callId,
        toolName: "read_chat_attachment", contentHash: nativeSha256(result) });
      const nativeActor = { type: "agent" as const, source: "none" as const, companyId, agentId, runId: seeded.runId,
        onBehalfOfUserId: responsibleUserId };
      await expect(assertNativePayloadSourceSetCurrent(db, { companyId, issueId: createdIssue.id, runId: seeded.runId,
        actor: nativeActor, policy: readInput!.policy as never, inputs: readInput!.inputs })).resolves.toBeUndefined();
    } finally {
      await reader.close();
    }
  });

  it("qualifies only the current PG attachment bytes staged by executor admission", async () => {
    const positive = await executeVerifiedAttachmentCase("positive");
    expect(positive.run.nativeInputSourceProtocolVersion).toBe(1);
    expect(positive.run.runnerProfileJson).toMatchObject({
      nativeAttachmentStageSources: [{ sourceCaptures: [{ input: {
        kind: "attachment", attachmentId: positive.attachment.id, disposition: "delivered",
      } }], eventSeq: expect.any(Number), attempt: expect.any(Number),
        stageHash: expect.stringMatching(/^[0-9a-f]{64}$/) }],
      nativeInputSourceReceipt: { bootstrap: { inputs: expect.arrayContaining([
        expect.objectContaining({ kind: "attachment", attachmentId: positive.attachment.id,
          disposition: "delivered", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      ]) }, dispatches: [expect.objectContaining({ inputs: expect.arrayContaining([
        expect.objectContaining({ kind: "attachment", attachmentId: positive.attachment.id, disposition: "delivered" }),
      ]) })] },
    });
    expect(positive.providerFrame).toContain("brief.txt");
    expect(positive.providerFrame).toContain(".paperclip-inbound");
    const positiveProfile = positive.run.runnerProfileJson as Record<string, unknown>;
    const positiveStage = (positiveProfile.nativeAttachmentStageSources as Array<Record<string, unknown>>)[0]!;
    const acknowledged = (positiveProfile.nativeModelInputDispatchIntents as Array<Record<string, unknown>>)
      .filter(dispatch => dispatch.turnId === `attachment-provider-turn-${positive.seeded.runId}`);
    expect(acknowledged).toHaveLength(1);
    expect(positiveStage.eventSeq).toBe(acknowledged[0]!.eventSeq);
    expect(positiveStage.attempt).toBe(acknowledged[0]!.attempt);
    expect(JSON.stringify(positiveStage)).not.toContain(storageRoot);
    expect(JSON.stringify(positive.run.runnerProfileJson)).not.toContain(".paperclip-inbound");

    const mismatch = await executeVerifiedAttachmentCase("byte_mismatch");
    expect(mismatch.run.nativeInputSourceProtocolVersion).toBe(0);
    expect(mismatch.run.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
    expect(mismatch.run.runnerProfileJson).toMatchObject({ nativeAttachmentStageSources: [{ sourceCaptures: [{ input: {
      attachmentId: mismatch.attachment.id, disposition: "attachment_staging_failed",
    } }] }] });
    expect(mismatch.providerFrame).toContain("brief.txt");
    expect((mismatch.run.runnerProfileJson!.nativeModelInputDispatchIntents as Array<Record<string, unknown>>)
      .some(dispatch => dispatch.turnId === `attachment-provider-turn-${mismatch.seeded.runId}`)).toBe(true);

    const withdrawn = await executeVerifiedAttachmentCase("withdrawn");
    expect(withdrawn.withdrawn).toBe(true);
    expect(withdrawn.run.nativeInputSourceProtocolVersion).toBe(0);
    expect(withdrawn.run.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
    expect(withdrawn.run.runnerProfileJson).toMatchObject({ nativeAttachmentStageSources: [{ sourceCaptures: [{ input: {
      attachmentId: withdrawn.attachment.id, disposition: "delivered",
    } }] }] });
    expect(withdrawn.providerFrame).toContain("brief.txt");
    expect((withdrawn.run.runnerProfileJson!.nativeModelInputDispatchIntents as Array<Record<string, unknown>>)
      .some(dispatch => dispatch.turnId === `attachment-provider-turn-${withdrawn.seeded.runId}`)).toBe(true);

    const historical = await executeVerifiedAttachmentCase("historical");
    expect(historical.run.nativeInputSourceProtocolVersion).toBe(0);
    expect(historical.run.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
    const historicalStages = historical.run.runnerProfileJson!.nativeAttachmentStageSources as Array<Record<string, unknown>>;
    expect(historicalStages).toHaveLength(2);
    expect(historicalStages[0]).toMatchObject({ eventSeq: 3, attempt: 1 });
    expect(historicalStages[1]).toMatchObject({ eventSeq: expect.any(Number), stageHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(historical.providerFrame).toContain("brief.txt");
    expect((historical.run.runnerProfileJson!.nativeModelInputDispatchIntents as Array<Record<string, unknown>>)
      .some(dispatch => dispatch.turnId === `attachment-provider-turn-${historical.seeded.runId}`)).toBe(true);
  });

  it("merges legacy and current result histories, deduplicating only exact facts", async () => {
    const legacyOnly = { callId: "legacy-read", source: null, responsibleUserId: "legacy-human" };
    const duplicate = { callId: "same-read", source: null, responsibleUserId: "same-human" };
    const currentOnly = { callId: "current-read", source: null, responsibleUserId: "current-human" };
    const seeded = await seed({ responsibleUserId: null, runnerProfileJson: {
      nativeDocumentToolResultSources: [legacyOnly, duplicate],
      nativeToolResultSourceCaptures: [duplicate, currentOnly],
    } });
    await recordNativeDocumentToolResultIntent(documentArgs(seeded));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeToolResultSourceCaptures).toEqual([
      legacyOnly, duplicate, currentOnly, expect.objectContaining({ source: null, responsibleUserId: null }),
    ]);
    expect(run!.runnerProfileJson).not.toHaveProperty("nativeDocumentToolResultSources");
  });

  it.each(["launch", "lease", "attempt", "foreign_task"] as const)("refuses document capture with a changed %s binding", async kind => {
    const seeded = await seed(), args = documentArgs(seeded);
    if (kind === "launch") args.eventSeq++;
    else if (kind === "lease") args.leaseOwner = "stale-document-lease";
    else if (kind === "attempt") args.attempt++;
    else args.capture.source = { input: { kind: "document_revision", documentId: randomUUID(), revisionId: randomUUID(),
      issueId: randomUUID(), contentHash: "a".repeat(64) }, payloadSourceSnapshot: null };
    await expect(recordNativeDocumentToolResultIntent(args)).rejects.toThrow(kind === "launch" || kind === "foreign_task"
      ? "native_document_tool_capture_binding_invalid" : "native_session_lease_lost");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson).toEqual({ retainedProfileField: "preserve-me" });
  });

  it("refuses exhausted document result history without replacing the retained facts", async () => {
    const prior = Array.from({ length: 256 }, (_, index) => ({ index }));
    const seeded = await seed({ runnerProfileJson: { nativeDocumentToolResultSources: prior } });
    await expect(recordNativeDocumentToolResultIntent(documentArgs(seeded))).rejects.toThrow("native_document_tool_capture_budget_exceeded");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeDocumentToolResultSources).toEqual(prior);
    expect(run!.runnerProfileJson).not.toHaveProperty("nativeToolResultSourceCaptures");
  });

  it("refuses a silently suppressed document fact and hides private database diagnostics", async () => {
    const seeded = await seed(), suffix = seeded.runId.replaceAll("-", ""), name = `suppress_document_${suffix}`;
    await db.execute(sql`create function public.${sql.identifier(name)}() returns trigger language plpgsql as $function$
      begin if new.id=${sql.raw(`'${seeded.runId}'::uuid`)} then
        new.runner_profile_json=new.runner_profile_json-'nativeToolResultSourceCaptures'; end if; return new; end $function$`);
    await db.execute(sql`create trigger ${sql.identifier(name)} before update on heartbeat_runs for each row execute function public.${sql.identifier(name)}()`);
    try {
      await expect(recordNativeDocumentToolResultIntent(documentArgs(seeded))).rejects.toThrow("native_document_tool_capture_persistence_failed");
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(run!.runnerProfileJson).toEqual({ retainedProfileField: "preserve-me" });
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(name)} on heartbeat_runs`);
      await db.execute(sql`drop function if exists public.${sql.identifier(name)}()`);
    }
  });

  it.each([
    { responsibleUserId, continuation: true as const },
    { responsibleUserId: null, continuation: undefined },
  ])("stores bounded factual input metadata without message bytes (responsible user: $responsibleUserId)", async ({ responsibleUserId: userId, continuation }) => {
    const priorIntent = { eventSeq: 2, attempt: 1, responsibleUserId: null, turnInputDigest: "a".repeat(64), byteSize: 11, continuation: false };
    const seeded = await seed({ responsibleUserId: userId, runnerProfileJson: { retainedProfileField: "preserve-me", nativeModelInputDispatchIntents: [priorIntent] } });
    const turnInput = {
      message: { role: "user" as const, text: "private-canary /private/path password=never-store-this" },
      ...(continuation ? { continuation } : {}),
      requestedCollaborationMode: "plan" as const,
    };
    const encoded = JSON.stringify(turnInput);

    await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));

    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    const profile = run!.runnerProfileJson!;
    expect(profile.retainedProfileField).toBe("preserve-me");
    expect(profile).not.toHaveProperty("nativeInputSourceProtocolVersion");
    expect(profile).not.toHaveProperty("nativeInputSourceReceipt");
    expect(JSON.stringify(profile)).not.toContain("private-canary");
    expect(JSON.stringify(profile)).not.toContain("/private/path");
    expect(JSON.stringify(profile)).not.toContain("never-store-this");
    expect(profile.nativeModelInputDispatchIntents).toEqual([
      priorIntent,
      expect.objectContaining({
        dispatchId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        eventSeq: seeded.eventSeq,
        attempt: seeded.attempt,
        responsibleUserId: userId,
        turnInputDigest: createHash("sha256").update(encoded).digest("hex"),
        byteSize: Buffer.byteLength(encoded),
        continuation: continuation === true,
      }),
    ]);
    const [finalization] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, seeded.runId));
    expect(finalization!.attempt).toBe(seeded.attempt);
    const [storedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(storedRun!.nativeInputSourceProtocolVersion).toBe(0);
  });

  it("binds backend turn acknowledgements to exact same-input dispatch UUIDs", async () => {
    const seeded = await seed();
    const turnInput = { message: { role: "user" as const, text: "identical private provider input" }, continuation: true as const };
    const firstDispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    const secondDispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    expect(firstDispatchId).not.toBe(secondDispatchId);

    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, secondDispatchId, turnInput, "provider-turn-second"));
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, firstDispatchId, turnInput, "provider-turn-first"));

    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    const intents = run!.runnerProfileJson!.nativeModelInputDispatchIntents as Array<Record<string, unknown>>;
    expect(intents).toHaveLength(2);
    expect(intents).toEqual(expect.arrayContaining([
      expect.objectContaining({ dispatchId: firstDispatchId, turnId: "provider-turn-first", eventSeq: seeded.eventSeq, attempt: seeded.attempt }),
      expect.objectContaining({ dispatchId: secondDispatchId, turnId: "provider-turn-second", eventSeq: seeded.eventSeq, attempt: seeded.attempt }),
    ]));
    expect(run!.nativeInputSourceProtocolVersion).toBe(0);
    expect(run!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
    expect(JSON.stringify(intents)).not.toContain(turnInput.message.text);
  });

  it.each([
    { name: "wrong dispatch", update: (_seeded: Awaited<ReturnType<typeof seed>>, dispatchId: string) => ({ dispatchId: randomUUID() }) },
    { name: "wrong event", update: (seeded: Awaited<ReturnType<typeof seed>>, dispatchId: string) => ({ eventSeq: seeded.eventSeq + 1, dispatchId }) },
    { name: "wrong attempt", update: (seeded: Awaited<ReturnType<typeof seed>>, dispatchId: string) => ({ attempt: seeded.attempt + 1, dispatchId }), error: "native_session_lease_lost" },
    { name: "different input", update: (_seeded: Awaited<ReturnType<typeof seed>>, dispatchId: string) => ({ dispatchId, turnInput: { message: { role: "user" as const, text: "substituted input" } } }), error: "native_model_input_ack_binding_invalid" },
  ])("refuses acknowledgement with $name mismatch without changing the intent", async ({ update, error = "native_model_input_ack_binding_invalid" }) => {
    const seeded = await seed();
    const turnInput = { message: { role: "user" as const, text: "selected exact input" } };
    const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    const before = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId)))[0]!.runnerProfileJson;
    await expect(recordNativeModelInputDispatchAcknowledgement({
      ...acknowledgementArgs(seeded, dispatchId, turnInput),
      ...update(seeded, dispatchId),
    })).rejects.toThrow(error);
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(after!.runnerProfileJson).toEqual(before);
  });

  it("refuses duplicate and invalid backend turn acknowledgements", async () => {
    const seeded = await seed();
    const turnInput = { message: { role: "user" as const, text: "ack once" } };
    const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    const args = acknowledgementArgs(seeded, dispatchId, turnInput);
    await expect(recordNativeModelInputDispatchAcknowledgement({ ...args, turnId: "bad\nturn" }))
      .rejects.toThrow("native_model_input_ack_binding_invalid");
    await recordNativeModelInputDispatchAcknowledgement(args);
    const [afterAck] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    await expect(recordNativeModelInputDispatchAcknowledgement(args)).rejects.toThrow("native_model_input_ack_binding_invalid");
    const [afterDuplicate] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(afterDuplicate!.runnerProfileJson).toEqual(afterAck!.runnerProfileJson);
  });

  it("associates an actual backend tool call only with its unique acknowledged turn", async () => {
    const seeded = await seed();
    const turnInput = { message: { role: "user" as const, text: "identity only" } };
    const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, "backend-turn-exact"));
    const call = { ...dispatchArgs(seeded, turnInput), turnId: "backend-turn-exact", callId: "provider-call-1", tool: "create_task" };

    expect(await recordNativeToolCallDispatchAssociation(call)).toBe(true);
    expect(await recordNativeToolCallDispatchAssociation({ ...call, callId: "provider-call-unknown", turnId: "unsupported-turn" })).toBe(false);
    expect(await recordNativeToolCallDispatchAssociation(call)).toBe(true);
    expect(await recordNativeToolCallDispatchAssociation({ ...call, tool: "update_task" })).toBe(false);
    const secondTurnInput = { message: { role: "user" as const, text: "next turn" } };
    const secondDispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, secondTurnInput));
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, secondDispatchId, secondTurnInput, "backend-turn-next"));
    expect(await recordNativeToolCallDispatchAssociation({ ...call, turnId: "backend-turn-next" })).toBe(true);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeToolCallDispatchAssociations).toEqual([
      { dispatchId, eventSeq: seeded.eventSeq, attempt: seeded.attempt,
        turnId: "backend-turn-exact", callId: "provider-call-1", tool: "create_task" },
      { dispatchId: secondDispatchId, eventSeq: seeded.eventSeq, attempt: seeded.attempt,
        turnId: "backend-turn-next", callId: "provider-call-1", tool: "create_task" },
    ]);

    const ambiguousDispatch = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, ambiguousDispatch, turnInput, "backend-turn-exact"));
    expect(await recordNativeToolCallDispatchAssociation({ ...call, callId: "provider-call-ambiguous" })).toBe(false);
    const [afterAmbiguity] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(afterAmbiguity!.runnerProfileJson!.nativeToolCallDispatchAssociations).toEqual(run!.runnerProfileJson!.nativeToolCallDispatchAssociations);
  });

  it("refuses malformed association history without replacing it", async () => {
    const seeded = await seed({ runnerProfileJson: { nativeToolCallDispatchAssociations: "malformed" } });
    const turnInput = { message: { role: "user" as const, text: "preserve malformed fact" } };
    const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, "backend-turn-invalid-history"));
    const [before] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    await expect(recordNativeToolCallDispatchAssociation({ ...dispatchArgs(seeded, turnInput),
      turnId: "backend-turn-invalid-history", callId: "call-invalid-history", tool: "create_task" }))
      .rejects.toThrow("native_tool_call_dispatch_binding_invalid");
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(after!.runnerProfileJson).toEqual(before!.runnerProfileJson);
  });

  it("refuses duplicate or misbound prior call associations without changing history", async () => {
    for (const kind of ["duplicate", "wrong_event", "wrong_attempt"] as const) {
      const seeded = await seed();
      const turnInput = { message: { role: "user" as const, text: `association history ${kind}` } };
      const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
      const turnId = `backend-turn-${kind}`;
      await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, turnId));
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      const exact = { dispatchId, eventSeq: seeded.eventSeq, attempt: seeded.attempt, turnId,
        callId: "provider-call-history", tool: "create_task" };
      const history = kind === "duplicate" ? [exact, exact]
        : [{ ...exact, ...(kind === "wrong_event" ? { eventSeq: seeded.eventSeq + 1 } : { attempt: seeded.attempt + 1 }) }];
      await db.update(heartbeatRuns).set({ runnerProfileJson: {
        ...run!.runnerProfileJson!, nativeToolCallDispatchAssociations: history,
      } }).where(eq(heartbeatRuns.id, seeded.runId));
      const [before] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      const call = { ...dispatchArgs(seeded, turnInput), turnId, callId: "provider-call-history", tool: "create_task" };
      if (kind === "duplicate") {
        await expect(recordNativeToolCallDispatchAssociation(call)).rejects.toThrow("native_tool_call_dispatch_binding_invalid");
      } else {
        expect(await recordNativeToolCallDispatchAssociation(call)).toBe(false);
      }
      const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(after!.runnerProfileJson).toEqual(before!.runnerProfileJson);
    }
  });

  it("does not acknowledge after lease expiry", async () => {
    const seeded = await seed();
    const turnInput = { message: { role: "user" as const, text: "lease bounded acknowledgement" } };
    const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    await db.execute(sql`update native_run_finalizations set lease_expires_at = clock_timestamp() + interval '1200 milliseconds' where run_id = ${seeded.runId}::uuid`);
    await expect(db.transaction(async tx => {
      const [leaseAtStart] = await tx.execute<{ live: boolean }>(sql`select lease_expires_at > clock_timestamp() as live
        from native_run_finalizations where run_id = ${seeded.runId}::uuid`);
      expect(leaseAtStart!.live).toBe(true);
      await tx.execute(sql`select pg_sleep(1.4)`);
      await recordNativeModelInputDispatchAcknowledgement({
        ...acknowledgementArgs(seeded, dispatchId, turnInput), db: tx as unknown as typeof db,
      });
    })).rejects.toThrow("native_session_lease_lost");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeModelInputDispatchIntents).toEqual([
      expect.objectContaining({ dispatchId, turnInputDigest: createHash("sha256").update(JSON.stringify(turnInput)).digest("hex") }),
    ]);
    expect((run!.runnerProfileJson!.nativeModelInputDispatchIntents as Array<Record<string, unknown>>)[0]).not.toHaveProperty("turnId");
  });

  it("keeps an intent unacknowledged when adding the backend id would exceed the profile budget", async () => {
    const prior = { dispatchId: randomUUID(), eventSeq: 2, attempt: 1, responsibleUserId: null,
      turnInputDigest: "a".repeat(64), byteSize: 1, continuation: false,
      padding: "x".repeat(2 * 1024 * 1024 - 600) };
    const seeded = await seed({ runnerProfileJson: { nativeModelInputDispatchIntents: [prior] } });
    const turnInput = { message: { role: "user" as const, text: "budget" } };
    const dispatchId = await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
    const largeTurnId = "t".repeat(240);
    await expect(recordNativeModelInputDispatchAcknowledgement(
      acknowledgementArgs(seeded, dispatchId, turnInput, largeTurnId),
    )).rejects.toThrow("native_model_input_ack_budget_exceeded");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    const intents = run!.runnerProfileJson!.nativeModelInputDispatchIntents as Array<Record<string, unknown>>;
    expect(intents.find(intent => intent.dispatchId === dispatchId)).not.toHaveProperty("turnId");
  });

  it.each([
    { name: "wrong launch sequence", change: async (seeded: Awaited<ReturnType<typeof seed>>) => ({ eventSeq: seeded.eventSeq + 1 }), error: "native_model_input_launch_binding_changed" },
    { name: "wrong run", change: async () => ({ runId: randomUUID() }), error: "native_session_lease_lost" },
    { name: "wrong lease owner", change: async () => ({ leaseOwner: "stale-owner" }), error: "native_session_lease_lost" },
    { name: "wrong attempt", change: async (seeded: Awaited<ReturnType<typeof seed>>) => ({ attempt: seeded.attempt + 1 }), error: "native_session_lease_lost" },
  ])("rejects a dispatch without its $name binding", async ({ change, error }) => {
    const seeded = await seed();
    const turnInput = { message: { role: "user" as const, text: "do not record" } };
    await expect(recordNativeModelInputDispatchIntent({ ...dispatchArgs(seeded, turnInput), ...await change(seeded) }))
      .rejects.toThrow(error);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson).toEqual({ retainedProfileField: "preserve-me" });
  });

  it("rejects exhausted and oversized histories atomically", async () => {
    const turnInput = { message: { role: "user" as const, text: "bounded" } };
    const full = await seed({ runnerProfileJson: { nativeModelInputDispatchIntents: Array.from({ length: 64 }, (_, index) => ({ index })) } });
    await expect(recordNativeModelInputDispatchIntent(dispatchArgs(full, turnInput))).rejects.toThrow("native_model_input_dispatch_budget_exceeded");
    const oversized = await seed({ runnerProfileJson: { nativeModelInputDispatchIntents: Array.from({ length: 63 }, () => ({ padding: "x".repeat(34_000) })) } });
    await expect(recordNativeModelInputDispatchIntent(dispatchArgs(oversized, turnInput))).rejects.toThrow("native_model_input_dispatch_budget_exceeded");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, oversized.runId));
    expect(run!.runnerProfileJson!.nativeModelInputDispatchIntents).toHaveLength(63);
  });

  it("rechecks lease expiry with database wall time after a transaction wait", async () => {
    const seeded = await seed({ leaseTtlSql: true });
    const turnInput = { message: { role: "user" as const, text: "must not record after lease expiry" } };
    await expect(db.transaction(async tx => {
      const [leaseAtStart] = await tx.execute<{ live: boolean }>(sql`select lease_expires_at > clock_timestamp() as live
        from native_run_finalizations where run_id = ${seeded.runId}::uuid`);
      expect(leaseAtStart!.live).toBe(true);
      await tx.execute(sql`select pg_sleep(1.4)`);
      await recordNativeModelInputDispatchIntent({ ...dispatchArgs(seeded, turnInput), db: tx as unknown as typeof db });
    })).rejects.toThrow("native_session_lease_lost");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson).toEqual({ retainedProfileField: "preserve-me" });
  });

  it("returns a private stable error when the dispatch profile write is rejected", async () => {
    const canary = "synthetic-profile-canary-not-for-errors";
    const seeded = await seed({ runnerProfileJson: { retainedProfileField: canary } });
    const constraintName = `dispatch_intent_reject_${seeded.runId.replaceAll("-", "")}`;
    const turnInput = { message: { role: "user" as const, text: "synthetic provider input" } };
    await db.execute(sql`alter table heartbeat_runs add constraint ${sql.identifier(constraintName)}
      check (id <> ${sql.raw(`'${seeded.runId}'::uuid`)} or not (runner_profile_json ? 'nativeModelInputDispatchIntents'))`);
    try {
      let failure: unknown;
      try {
        await recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const error = failure as Error & { cause?: unknown };
      expect(error.message).toBe("native_model_input_dispatch_persistence_failed");
      const serializedCause = JSON.stringify({ cause: error.cause }, (_key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack, cause: (value as Error & { cause?: unknown }).cause }
          : value,
      );
      expect(error.message).not.toContain(canary);
      expect(error.stack).not.toContain(canary);
      expect(serializedCause).not.toContain(canary);
      expect(error.message).not.toContain("params:");
      expect(error.stack).not.toContain("params:");
      expect(serializedCause).not.toContain("params:");
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(run!.runnerProfileJson).toEqual({ retainedProfileField: canary });
      expect(run!.runnerProfileJson).not.toHaveProperty("nativeModelInputDispatchIntents");
    } finally {
      await db.execute(sql`alter table heartbeat_runs drop constraint if exists ${sql.identifier(constraintName)}`);
    }
  });

  it("rejects a database update that silently suppresses the dispatch intent", async () => {
    const canary = "suppressed-profile-canary";
    const seeded = await seed({ runnerProfileJson: { retainedProfileField: canary } });
    const suffix = seeded.runId.replaceAll("-", "");
    const triggerName = `suppress_dispatch_${suffix}`;
    const functionName = `suppress_dispatch_${suffix}`;
    const turnInput = { message: { role: "user" as const, text: "synthetic provider input" } };
    await db.execute(sql`create function public.${sql.identifier(functionName)}() returns trigger language plpgsql as $function$
      begin
        if new.id = ${sql.raw(`'${seeded.runId}'::uuid`)} and new.runner_profile_json ? 'nativeModelInputDispatchIntents' then
          new.runner_profile_json := old.runner_profile_json;
        end if;
        return new;
      end
    $function$`);
    await db.execute(sql`create trigger ${sql.identifier(triggerName)} before update on heartbeat_runs
      for each row execute function public.${sql.identifier(functionName)}()`);
    try {
      await expect(recordNativeModelInputDispatchIntent(dispatchArgs(seeded, turnInput)))
        .rejects.toThrow("native_model_input_dispatch_intents_not_returned");
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(run!.runnerProfileJson).toEqual({ retainedProfileField: canary });
      expect(run!.runnerProfileJson).not.toHaveProperty("nativeModelInputDispatchIntents");
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(triggerName)} on heartbeat_runs`);
      await db.execute(sql`drop function if exists public.${sql.identifier(functionName)}()`);
    }
  });
});
