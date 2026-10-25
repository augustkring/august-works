import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { PROCESS_START_REQUESTED } from "../native-local-process-stop.js";
import { recordNativeModelInputDispatchIntent, recordNativeModelInputDispatchAcknowledgement, recordNativeDocumentToolResultIntent } from "./native-session-executor.js";
import { documentService, type DocumentRevisionSourceCapture } from "../documents.js";
import { nativeSha256 } from "./canonical.js";
import { currentNativeControllerIdentity } from "./native-restart-recovery.js";

describe("native model input dispatch intent", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let controller: Awaited<ReturnType<typeof currentNativeControllerIdentity>>;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const responsibleUserId = randomUUID();

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-model-input-dispatch-");
    db = createDb(database.connectionString);
    controller = await currentNativeControllerIdentity();
    await db.insert(companies).values({ id: companyId, name: "Dispatch intent fixture", issuePrefix: "NMI" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Dispatch agent", adapterType: "paperclip_runner" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seed(options: {
    responsibleUserId?: string | null;
    runnerProfileJson?: Record<string, unknown>;
    leaseTtlSql?: boolean;
  } = {}) {
    const issueId = randomUUID();
    const runId = randomUUID();
    const leaseOwner = `native-input-owner-${randomUUID()}`;
    const attempt = 3;
    const eventSeq = 7;
    await db.insert(issues).values({ id: issueId, companyId, title: "Dispatch intent Task", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      nativeIssueId: issueId,
      nativeSessionId: randomUUID(),
      runtimeMode: "native",
      status: "running",
      responsibleUserId: options.responsibleUserId === undefined ? responsibleUserId : options.responsibleUserId,
      runnerProfileJson: options.runnerProfileJson ?? { retainedProfileField: "preserve-me" },
    });
    await db.insert(nativeRunFinalizations).values({
      runId,
      companyId,
      issueId,
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
    return { issueId, runId, leaseOwner, attempt, eventSeq };
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
    return { ...binding, capture: { callId: "actual-document-read", tool: "read_document" as const,
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
    expect(run!.runnerProfileJson).toMatchObject({ retainedProfileField: "preserve-me", nativeDocumentToolResultSources: [{
      eventSeq: seeded.eventSeq, attempt: seeded.attempt, responsibleUserId,
      callId: "actual-document-read", tool: "read_document", resultDigest: args.capture.resultDigest,
      source: { input: { kind: "document_revision", issueId: seeded.issueId, documentId: document.id,
        revisionId: document.latestRevisionId, contentHash: createHash("sha256").update(body).digest("hex") }, payloadSourceSnapshot: null },
    }] });
    expect(JSON.stringify(run!.runnerProfileJson)).not.toContain(body);
    expect(run!.nativeInputSourceProtocolVersion).toBe(0);
    expect(run!.runnerProfileJson).not.toHaveProperty("nativeInputSourceReceipt");
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
    expect(run!.runnerProfileJson!.nativeDocumentToolResultSources).toEqual([expect.objectContaining({ responsibleUserId: userId, source })]);
    const substituted = structuredClone(args.capture);
    substituted.source!.payloadSourceSnapshot!.owner.companyId = randomUUID();
    await expect(recordNativeDocumentToolResultIntent({ ...args, capture: substituted })).rejects.toThrow("native_document_tool_capture_binding_invalid");
    const [unchanged] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(unchanged!.runnerProfileJson).toEqual(run!.runnerProfileJson);
  });

  it("preserves earlier result facts and explicit unknown source/Human markers", async () => {
    const prior = { callId: "earlier-read", source: null, responsibleUserId: "earlier-human" };
    const seeded = await seed({ responsibleUserId: null, runnerProfileJson: { nativeDocumentToolResultSources: [prior] } });
    await recordNativeDocumentToolResultIntent(documentArgs(seeded));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run!.runnerProfileJson!.nativeDocumentToolResultSources).toEqual([prior, expect.objectContaining({ source: null, responsibleUserId: null })]);
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
  });

  it("refuses a silently suppressed document fact and hides private database diagnostics", async () => {
    const seeded = await seed(), suffix = seeded.runId.replaceAll("-", ""), name = `suppress_document_${suffix}`;
    await db.execute(sql`create function public.${sql.identifier(name)}() returns trigger language plpgsql as $function$
      begin if new.id=${sql.raw(`'${seeded.runId}'::uuid`)} then
        new.runner_profile_json=new.runner_profile_json-'nativeDocumentToolResultSources'; end if; return new; end $function$`);
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
