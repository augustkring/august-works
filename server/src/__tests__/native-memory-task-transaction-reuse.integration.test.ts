import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, memoryRecords } from "@paperclipai/db";
import { canActorReadIssuePrivacy, canActorReadIssuePrivacyBatch, withReadMemoryTemporalSources } from "../services/authorization.js";
import { assertAnalyticalContextPayloadAccess, assertAnalyticalContextPayloadAccessBatch } from "../services/analytical-context-authority.js";
import { analyticalPrivacyReadLocked, lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { memoryService } from "../services/memory/memory-service.js";
import { canActorReadMemorySources, lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { canActorReadNativeTaskSource } from "../services/native-direct-input.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "./helpers/managed-native-opencode-e2e-fixture.js";

describe("Native Memory Task source checks preserve readers when reusing one transaction", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let preserveDebugArtifacts = false;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "native-memory-task-transaction-reuse-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", `native-memory-task-reuse-${randomUUID()}`);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `native-memory-task-reuse-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("v10-native-memory-task-transaction-reuse-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root && !preserveDebugArtifacts) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("matches Alice, Bob, and revoked Alice against a sealed managed Native Memory output", async () => {
    const memoryCallId = `task-reuse-memory-${randomUUID()}`;
    const contextCallId = `task-reuse-context-${randomUUID()}`;
    const laterMemoryCallId = `task-reuse-later-memory-${randomUUID()}`;
    const documentCallId = `task-reuse-document-${randomUUID()}`;
    const finishCallId = `task-reuse-finish-${randomUUID()}`;
    const contextQuery = `task-reuse-private-context-${randomUUID()}`;
    const fixture = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString, root,
      instanceId: process.env.PAPERCLIP_INSTANCE_ID!, onPreserveDebugArtifacts: () => { preserveDebugArtifacts = true; },
      steps: [
        { tool: "self_remember", id: memoryCallId, input: { scope: "company", memoryType: "outcome",
          title: "Earlier shared Memory", content: "Create the earlier shared Memory and private Context root.",
          idempotencyKey: randomUUID() } },
        { tool: "read_context", id: contextCallId, input: { query: contextQuery } },
        { tool: "self_remember", id: laterMemoryCallId, input: { scope: "company", memoryType: "outcome",
          title: "Native Task temporal characterization", content: "A sealed managed Native output for exact Task ACL equivalence.",
          idempotencyKey: randomUUID() } },
        { tool: "write_document", id: documentCallId, input: { idempotencyKey: randomUUID(),
          key: `task-reuse-${randomUUID()}`, title: "Required fixture output",
          body: "Satisfies the managed fixture completion contract.", baseRevisionId: null } },
        { tool: "paperclip_finish", id: finishCallId },
      ],
      privateContextContent: contextQuery,
      humanActions: [
        { afterModelToolCallId: memoryCallId, action: "accept_memory_candidate" },
        { afterModelToolCallId: memoryCallId, action: "create_private_context_root" },
        { afterModelToolCallId: laterMemoryCallId, action: "accept_memory_candidate" },
      ],
    });
    const memoryId = fixture.toolResults.find(value => value.callId === laterMemoryCallId)?.memoryId;
    expect(memoryId).toMatch(/^[0-9a-f-]{36}$/i);
    const [record] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, fixture.companyId),
      eq(memoryRecords.id, memoryId!)));
    expect(record?.payloadSourceProtocolVersion).toBe(1);
    expect(record?.payloadSourceSnapshot?.inputs.some(source => source.kind === "task")).toBe(true);
    expect(record?.sourceIssueIds.length).toBeGreaterThan(0);

    const compareReader = async (actor: typeof fixture.aliceActor) => {
      const separateTransaction = await canActorReadMemorySources(db, fixture.companyId, actor, memoryId!);
      const sameTransaction = await db.transaction(tx => canActorReadMemorySources(
        tx as unknown as typeof db, fixture.companyId, actor, memoryId!));
      expect(sameTransaction).toBe(separateTransaction);
      return separateTransaction;
    };
    const comparePerTask = async (actor: typeof fixture.aliceActor, temporalOwner = actor) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const comparisons = await withReadMemoryTemporalSources(tx, temporalOwner, fixture.companyId, memoryId!, async () => {
        const nativeResults: Array<{ taskId: string; native: boolean | null; original: boolean }> = [];
        for (const taskId of record!.sourceIssueIds) {
          const native = await canActorReadNativeTaskSource(tx, { companyId: fixture.companyId, actor, issueId: taskId });
          const original = native === null ? await canActorReadIssuePrivacy(tx, actor, { companyId: fixture.companyId, id: taskId }) : native;
          nativeResults.push({ taskId, native, original });
        }
        const fallbackIds = nativeResults.flatMap(value => value.native === null ? [value.taskId] : []);
        const batched = fallbackIds.length
          ? await canActorReadIssuePrivacyBatch(tx, actor, fixture.companyId, fallbackIds) : new Map<string, boolean>();
        return nativeResults.map(value => ({ taskId: value.taskId, original: value.original,
          exactPrefixBatch: value.native === null ? batched.get(value.taskId) === true : value.native }));
      }, { sourceVersion: record!.updatedAt.toISOString(), snapshot: record!.payloadSourceSnapshot,
        issueIds: record!.sourceIssueIds, projectIds: record!.sourceProjectIds, runIds: record!.sourceRunIds,
        memoryIds: record!.sourceMemoryIds, foundationRevisionIds: record!.sourceFoundationRevisionIds });
      if (comparisons === false) return false;
      expect(comparisons.every(value => value.original === value.exactPrefixBatch)).toBe(true);
      return comparisons;
    });

    expect(await compareReader(fixture.aliceActor)).toBe(true);
    expect(await comparePerTask(fixture.aliceActor)).toHaveLength(record!.sourceIssueIds.length);
    expect(await compareReader(fixture.bobActor)).toBe(false);
    expect(await comparePerTask(fixture.bobActor, fixture.aliceActor)).toHaveLength(record!.sourceIssueIds.length);

    // The Memory reader owns shared company/Memory privacy locks before it
    // validates this frozen Native Task. Queue an exclusive canonical writer
    // first, then run the owner check through a nested savepoint wrapper on
    // the same backend/xact. That wrapper deliberately misses the WeakSet
    // marker, so its fallback must reacquire shared locks rather than upgrade
    // them behind the waiting writer.
    expect(record!.sourceIssueIds.length).toBeGreaterThan(0);
    expect(record!.sourceRunIds.length).toBeGreaterThan(0);
    let signalReaderInside!: () => void;
    const readerInside = new Promise<void>(resolve => { signalReaderInside = resolve; });
    let resumeReader!: () => void;
    const readerGate = new Promise<void>(resolve => { resumeReader = resolve; });
    let signalWriterStarted!: () => void;
    const writerStarted = new Promise<void>(resolve => { signalWriterStarted = resolve; });
    let readerResult: unknown;
    let readerFailure: unknown;
    let writerFailure: unknown;
    let nestedSavepointMarkerWasLost = false;
    let samePhysicalTransaction = false;
    const reader = db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      return withReadMemoryTemporalSources(tx, fixture.aliceActor, fixture.companyId, memoryId!, async sourceDb => {
        signalReaderInside();
        await readerGate;
        const [outerTx] = await sourceDb.execute<{ backendPid: number; transactionId: string }>(sql`
          select pg_backend_pid() as "backendPid", pg_current_xact_id()::text as "transactionId"`);
        const native = await sourceDb.transaction(async nestedRawTx => {
          const nestedTx = nestedRawTx as unknown as typeof db;
          const [nestedTxFacts] = await nestedTx.execute<{ backendPid: number; transactionId: string }>(sql`
            select pg_backend_pid() as "backendPid", pg_current_xact_id()::text as "transactionId"`);
          samePhysicalTransaction = nestedTxFacts?.backendPid === outerTx?.backendPid &&
            nestedTxFacts?.transactionId === outerTx?.transactionId;
          nestedSavepointMarkerWasLost = !analyticalPrivacyReadLocked(nestedTx as object);
          const native = await canActorReadNativeTaskSource(nestedTx, {
            companyId: fixture.companyId, actor: fixture.aliceActor, issueId: record!.sourceIssueIds[0]!,
          });
          await assertAnalyticalContextPayloadAccessBatch(nestedTx, fixture.companyId, fixture.aliceActor,
            [record!.sourceIssueIds[0]!], undefined, { privacyLockMode: "read" });
          await assertAnalyticalContextPayloadAccess(nestedTx, fixture.companyId, fixture.aliceActor,
            { runId: record!.sourceRunIds[0]! }, "task");
          return native;
        });
        return native !== false;
      }, { sourceVersion: record!.updatedAt.toISOString(), snapshot: record!.payloadSourceSnapshot,
        issueIds: record!.sourceIssueIds, projectIds: record!.sourceProjectIds, runIds: record!.sourceRunIds,
        memoryIds: record!.sourceMemoryIds, foundationRevisionIds: record!.sourceFoundationRevisionIds });
    }).then(value => { readerResult = value; }, error => { readerFailure = error; });
    const writer = db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await tx.execute(sql`set local application_name = 'native-memory-temporal-writer-test'`);
      signalWriterStarted();
      await lockAnalyticalCompany(tx as unknown as typeof db, fixture.companyId);
      await lockMemoryPrivacy(tx as unknown as typeof db, fixture.companyId);
    }).catch(error => { writerFailure = error; });
    let writerWaiting = false;
    try {
      await readerInside;
      await writerStarted;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [activity] = await db.execute<{ wait_event_type: string | null; wait_event: string | null }>(sql`
          select wait_event_type, wait_event from pg_stat_activity
          where application_name = 'native-memory-temporal-writer-test'
          order by backend_start desc limit 1`);
        if (activity?.wait_event_type === "Lock" && activity.wait_event === "advisory") {
          writerWaiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      resumeReader();
    }
    await Promise.all([reader, writer]);
    expect(writerWaiting).toBe(true);
    expect(samePhysicalTransaction).toBe(true);
    expect(readerFailure).toBeUndefined();
    expect(writerFailure).toBeUndefined();
    expect(readerResult).toBe(true);
    console.info("native-memory-task-savepoint-lock-regression", JSON.stringify({
      samePhysicalTransaction, nestedSavepointMarkerWasLost, writerWaiting,
      readerCompleted: readerFailure === undefined, writerCompleted: writerFailure === undefined,
    }));

    await db.update(companyMemberships).set({ status: "suspended" }).where(and(
      eq(companyMemberships.companyId, fixture.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, fixture.aliceUserId)));
    expect(await compareReader(fixture.aliceActor)).toBe(false);
    // The live Memory read denies the suspended current Human at its Native
    // output-reader boundary with 403 rather than returning a boolean verdict.
    await expect(comparePerTask(fixture.aliceActor)).rejects.toMatchObject({ status: 403 });
    await expect(memoryService(db).get(fixture.companyId, memoryId!,
      { principal: { type: "user", userId: fixture.aliceUserId } })).rejects.toMatchObject({ status: 403 });
  }, 180_000);
});
