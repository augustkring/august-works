import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  authUsers,
  authSessions,
  companyMemberships,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  nativeRunFinalizations,
} from "@paperclipai/db";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { PROCESS_START_REQUESTED } from "../native-local-process-stop.js";
import { recordNativeModelInputDispatchIntent, recordNativeModelInputDispatchAcknowledgement, recordNativeToolCallDispatchAssociation,
  recordNativeDocumentToolResultIntent, recordNativeProjectToolResultIntent } from "./native-session-executor.js";
import type { NativeProjectToolResultSource } from "./paperclip-runner-tool-authority.js";
import { documentService, type DocumentRevisionSourceCapture } from "../documents.js";
import { nativeSha256 } from "./canonical.js";
import { currentNativeControllerIdentity } from "./native-restart-recovery.js";
import { buildNativeModelEnvelope } from "@paperclipai/paperclip-runner";
import { buildNativeExecutionInput, buildNativeBootstrapSourceSet } from "./native-execution-input.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";
import { issueService } from "../issues.js";
import type { NativeTaskSourceCapture } from "../issues.js";
import { canActorReadIssuePrivacy } from "../authorization.js";
import { contextManifestService } from "../context/context-manifest.js";
import { memoryService } from "../memory/memory-service.js";
import { initializeRunIdentity } from "../run-identity.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown } from "../heartbeat.js";
import { createLocalAgentJwt } from "../../agent-auth-jwt.js";
import { actorMiddleware } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { issueRoutes } from "../../routes/issues.js";
import { ensureNativeCompletionContract } from "./completion-contracts.js";
import { contextEngineService } from "../context/context-engine.js";

describe("native model input dispatch intent", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let controller: Awaited<ReturnType<typeof currentNativeControllerIdentity>>;
  const originalJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const responsibleUserId = randomUUID();

  beforeAll(async () => {
    process.env.PAPERCLIP_AGENT_JWT_SECRET ??= "native-dispatch-integration-secret";
    database = await startEmbeddedPostgresTestDatabase("native-model-input-dispatch-");
    db = createDb(database.connectionString);
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
    if (originalJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = originalJwtSecret;
  }, 30_000);

  async function seed(options: {
    responsibleUserId?: string | null;
    runnerProfileJson?: Record<string, unknown>;
    leaseTtlSql?: boolean;
    existingIssueId?: string;
  } = {}) {
    const issueId = randomUUID();
    const runId = randomUUID();
    const leaseOwner = `native-input-owner-${randomUUID()}`;
    const attempt = 3;
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

  it("seals a real native Task-create HTTP effect to its one current task-only bootstrap", async () => {
    const sessionId = randomUUID(), now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: responsibleUserId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    const humanActor = { type: "board" as const, source: "session" as const, userId: responsibleUserId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "admin", status: "active" as const }] };
    const sourceTask = await issueService(db).create(companyId, { title: "Native source Task", description: "Public task input",
      createdByUserId: responsibleUserId }, db, undefined, { manualInputActor: humanActor });
    let taskCapture: NativeTaskSourceCapture | null = null;
    const selectedTask = await getIssueExecutionContext(db, companyId, sourceTask.id, capture => { taskCapture = capture; });
    expect(selectedTask).not.toBeNull();
    expect(taskCapture?.input.kind).toBe("task");
    const renderedReferences: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const renderedMarkdown = buildPaperclipTaskMarkdown({ issue: { id: sourceTask.id, identifier: selectedTask!.identifier,
      title: selectedTask!.title, description: selectedTask!.description, workMode: selectedTask!.workMode } },
      { onRenderedSource: source => renderedReferences.push(source) });
    expect(renderedMarkdown).toBeTruthy();
    const parsedTaskCapture = taskCapture!;
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
    const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: createHash("sha256").update(JSON.stringify(execution.task), "utf8").digest("hex") };
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
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const createdId = response.body.id as string;
    const [created] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, createdId)));
    expect(created?.payloadSourceProtocolVersion).toBe(1);
    expect(created?.payloadSourceSnapshot).toMatchObject({
      owner: { kind: "issue", companyId, id: createdId },
      inputs: [expect.objectContaining({ kind: "task", issueId: sourceTask.id })],
    });
    expect(created?.payloadSourceSnapshot?.inputs.some(input => input.kind === "context")).toBe(false);

    const bobId = randomUUID();
    await db.insert(authUsers).values({ id: bobId, name: "Later Context reader", email: `${bobId}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: bobId, status: "active", membershipRole: "admin" });
    const human = { principal: { type: "user" as const, userId: responsibleUserId } };
    const memory = memoryService(db);
    const binding = await memory.createCompanyBinding(companyId, { key: randomUUID(), name: "Future private Context", providerKey: "local" }, human);
    await memory.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, human);
    const producer = { principal: { type: "agent" as const, agentId, responsibleUserId }, runId: seeded.runId };
    const privateMemory = await memory.createPrivateMemory(companyId, agentId, { bindingId: binding.id, memoryType: "lesson",
      title: "Later private input", content: "private context created after the Task effect", summary: null,
      sensitivity: "internal", observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
      createdByOperationId: randomUUID(), evidence: [{ sourceClass: "task", sourceProvider: "native_effect_fixture",
        sourceType: "actual_task", sourceRef: `issue://${sourceTask.id}`, sourceVersion: sourceTask.updatedAt.toISOString(),
        sourceUpdatedAt: sourceTask.updatedAt.toISOString(), observedAt: new Date().toISOString(),
        excerptHash: createHash("sha256").update("private context created after the Task effect").digest("hex"),
        citation: { label: "Native source Task" }, trustLevel: "low", relation: "supports" }] }, producer);
    const version = privateMemory.record.updatedAt.toISOString();
    const decision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority", evidence: {
      id: `memory:${privateMemory.record.id}`, companyId, sourceClass: "private_memory", sourceProvider: "august_works_memory",
      sourceType: "memory_record", sourceRef: `memory://record/${privateMemory.record.id}`, sourceVersion: version,
      sourceUpdatedAt: version, title: privateMemory.record.title, excerpt: privateMemory.record.content,
      observedAt: privateMemory.record.observedAt.toISOString(), validFrom: null, validUntil: null, authorityDomain: null,
      trustLevel: "low", sensitivity: "internal", citation: { label: "Later private source" }, metadata: {} } };
    await contextManifestService(db).create({ companyId, agentId, runId: seeded.runId, issueId: sourceTask.id,
      responsibleUserId, query: "Private Context selected after earlier Task creation", policySnapshot: {}, selected: [{ decision }] });
    const bob = { type: "board" as const, source: "session" as const, userId: bobId };
    expect(await canActorReadIssuePrivacy(db, bob, { id: createdId, companyId })).toBe(true);

    // A later unknown turn cannot inherit the earlier prefix's source closure.
    // This is an actual second dispatch/association, but it deliberately has no
    // complete source receipt because the newly selected Context is unsupported.
    const nextEventSeq = seeded.eventSeq + 1;
    await db.insert(heartbeatRunEvents).values({ companyId, runId: seeded.runId, agentId, seq: nextEventSeq,
      eventType: PROCESS_START_REQUESTED, payload: { fixture: "later dispatch with unsupported Context" } });
    const laterTurn = { message: { role: "user" as const, text: "Create a Task after selecting a new Context input" } };
    const laterArgs = { ...args, eventSeq: nextEventSeq, turnInput: laterTurn };
    const laterDispatchId = await recordNativeModelInputDispatchIntent(laterArgs);
    const laterTurnId = "native-task-effect-later-turn", laterCallId = "native-task-effect-later-call";
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, laterDispatchId, laterTurn, laterTurnId), eventSeq: nextEventSeq });
    await recordNativeToolCallDispatchAssociation({ ...laterArgs, turnId: laterTurnId, callId: laterCallId, tool: "call_api" });
    const laterBody = { title: "Must remain unknown", description: "Not admitted from the earlier prefix." };
    const laterApiInput = { operationId, body: laterBody };
    const laterApiDigest = createHash("sha256").update(canonicalJson(laterApiInput)).digest("hex");
    await db.update(heartbeatRuns).set({ resultJson: { apiToolReceipts: {
      [receiptKey]: { digest: apiReceiptDigest, operationId, state: "completed" },
      [createHash("sha256").update(laterCallId).digest("hex")]: { digest: laterApiDigest, operationId, state: "pending" },
    } } }).where(eq(heartbeatRuns.id, seeded.runId));
    const laterClaim = { ...claim, dispatchId: laterDispatchId, eventSeq: nextEventSeq, turnId: laterTurnId, callId: laterCallId,
      bodyHash: createHash("sha256").update(canonicalJson(laterBody)).digest("hex"), apiReceiptDigest: laterApiDigest };
    const laterToken = createLocalAgentJwt(agentId, companyId, "paperclip_runner", seeded.runId, responsibleUserId,
      { kind: "standard" }, laterClaim);
    const laterResponse = await request(app).post(pathAndQuery).set("Authorization", `Bearer ${laterToken}`).send(laterBody);
    expect(laterResponse.status, JSON.stringify(laterResponse.body)).toBe(403);
    expect(JSON.stringify(laterResponse.body)).not.toContain(laterBody.title);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.title, laterBody.title)))).toHaveLength(0);
  });

  it("binds an unknown Project tool result to its actual acknowledged dispatch without qualifying inputs", async () => {
    const seeded = await seed(), turnId = "actual-project-tool-turn", callId = "actual-project-tool-call";
    const turnInput = { message: { role: "user" as const, text: "Read the current Project" } };
    const args = dispatchArgs(seeded, turnInput), dispatchId = await recordNativeModelInputDispatchIntent(args);
    await recordNativeModelInputDispatchAcknowledgement(acknowledgementArgs(seeded, dispatchId, turnInput, turnId));
    await recordNativeToolCallDispatchAssociation({ ...args, turnId, callId, tool: "call_api" });
    const projectId = randomUUID();
    const capture: NativeProjectToolResultSource = { turnId, callId, tool: "call_api",
      operationId: "GET /api/projects/{id}", projectId, resultDigest: nativeSha256({ status: 200, unknown: true }), source: null };
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
      responsibleUserId: userId, runId: seeded.runId, issueId: createdIssue.id, projectId: null,
      query: "Rendered native task", intent: "native_task_execution", includeFoundation: false,
      sensitivityCeiling: "internal" });
    expect(governedContext.nativeBootstrapWitness).toBeDefined();
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
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, renderedMarkdown: renderedMarkdown!, runId: seeded.runId,
      agentId, issueId: createdIssue.id, renderedMarkdownDigest: renderedDigest,
      references: renderedReferences,
      candidates: [
        { kind: "task", id: createdIssue.id, input: taskCapture!.input, payloadSourceSnapshot: taskCapture!.payloadSourceSnapshot },
        { kind: "document_revision", id: revisionCapture!.input.revisionId, input: revisionCapture!.input, payloadSourceSnapshot: revisionCapture!.payloadSourceSnapshot },
      ], runtimeInputs: [], contextManifestIds: [{ companyId, contextManifestId: governedContext.packet.manifest!.id }],
      governedContextMarkdown: governedContext.markdown, contextWitness: governedContext.nativeBootstrapWitness,
      rolePackInputs: [], unsupportedInputPresent: false });
    expect(sourceSet?.inputs.map(value => value.kind)).toEqual(["task", "document_revision", "context"]);
    const completion = await ensureNativeCompletionContract({ db, companyId,
      issue: { id: createdIssue.id, title: selectedTask!.title, description: selectedTask!.description }, actorId: agentId });
    await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
      completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, seeded.runId));
    const execution = buildNativeExecutionInput({ companyId, runId: seeded.runId, agentId,
      issue: { id: createdIssue.id, identifier: selectedTask!.identifier, title: selectedTask!.title, description: selectedTask!.description, workMode: "standard" },
      taskPrompt: renderedMarkdown!, governedContextMarkdown: governedContext.markdown,
      workspace: { id: seeded.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null },
      normalizedSessionId: null, provider: "claude_managed", model: "claude-sonnet-5",
      managedProfile: { profileId: "profile", anthropicAgentId: "agent_01", agentVersion: "1", environmentId: "environment", betaVersion: "managed-agents-2026-04-01" },
      maxSessionListCostUsd: 1, completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
        schemaVersion: completion.row.schemaVersion, contract: completion.contract },
      runtimeContext: nativeRuntimeContextFixture() });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution } }).where(eq(heartbeatRuns.id, seeded.runId));
    const envelope = buildNativeModelEnvelope(execution);
    const turnInput = { message: { role: "user" as const, text: JSON.stringify(envelope) }, requestedCollaborationMode: "default" as const };
    const closure = { sourceSet: sourceSet!, taskEnvelopeDigest: createHash("sha256").update(JSON.stringify(execution.task), "utf8").digest("hex") };
    const dispatchId = await recordNativeModelInputDispatchIntent({ ...dispatchArgs(seeded, turnInput), bootstrapSourceClosure: closure });
    await recordNativeModelInputDispatchAcknowledgement({ ...acknowledgementArgs(seeded, dispatchId, turnInput), sourceClosure: closure });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.nativeInputSourceProtocolVersion).toBe(1);
    expect(run!.sourceContextProvenanceQualified).toBe(false);
    expect(run!.runnerProfileJson).toMatchObject({ nativeInputSourceReceipt: {
      bootstrap: { inputs: expect.arrayContaining([expect.objectContaining({ kind: "task", issueId: createdIssue.id }),
        expect.objectContaining({ kind: "document_revision", revisionId: revisionCapture!.input.revisionId }),
        expect.objectContaining({ kind: "context", manifestId: governedContext.packet.manifest!.id })]) },
      dispatches: [expect.objectContaining({ responsibleUserId: userId })],
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
    const workspaceClosure = { sourceSet: sourceSet!, taskEnvelopeDigest: createHash("sha256").update(JSON.stringify(workspaceExecution.task), "utf8").digest("hex") };
    await recordNativeModelInputDispatchIntent({ ...dispatchArgs(unknownSeed, workspaceTurn), bootstrapSourceClosure: workspaceClosure });
    const [unknownRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, unknownSeed.runId));
    expect(unknownRun!.nativeInputSourceProtocolVersion).toBe(0);
    expect(unknownRun!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
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
        .rejects.toThrow("native_model_input_dispatch_persistence_failed");
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      expect(run!.runnerProfileJson).toEqual({ retainedProfileField: canary });
      expect(run!.runnerProfileJson).not.toHaveProperty("nativeModelInputDispatchIntents");
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(triggerName)} on heartbeat_runs`);
      await db.execute(sql`drop function if exists public.${sql.identifier(functionName)}()`);
    }
  });
});
