import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, heartbeatRunEvents, heartbeatRuns, issues,
  runIdentityContexts, type Db } from "@paperclipai/db";
import { assertNativeAnalyticalRunPayloadAccess } from "../analytical-context-authority.js";
import { getNativeAssignedMcpDescriptorCurrent } from "../tool-gateway.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { appendSourceReviewedNativeRunEvent } from "./paperclip-control-plane-port.js";

/*
 * APR-E2E-29. A managed Run's provider event append reviews the run payload
 * sources (run FOR SHARE) and then appends (run FOR UPDATE). An assigned MCP
 * source check on the same Run also holds the run FOR SHARE from its source
 * review and then read the run identity with captureRunIdentity (run FOR
 * UPDATE). Both upgraded, and PostgreSQL aborted one with deadlock_detected
 * (40P01); in the e2e Always case it was the append, and the Run failed
 * native_session_interrupted.
 *
 * The fix is on the source check: it reads the identity under the shared lock
 * it already holds (captureRunIdentityUnderHeldRunShare), so it never
 * upgrades. The append keeps its order: the review under FOR SHARE, then FOR
 * UPDATE only for the insert. (9be027a8 had instead locked the run FOR UPDATE
 * before the multi-second review; that blocked every FOR SHARE reader of the
 * run, such as a sync-out exec claim with a short lock_timeout, for the whole
 * review. Reverted.)
 */
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Native run event append lock order (APR-E2E-29)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-native-event-lock-order-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => { await database?.cleanup(); }, 60_000);

  async function seed() {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const userId = `event-lock-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Event lock order", issuePrefix: `E${companyId.slice(0, 7)}` });
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", role: "engineer", adapterType: "codex_local",
      status: "running" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Task", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: userId, status: "running",
      startedAt: now, runtimeMode: "native", nativeIssueId: issueId, contextSnapshot: { issueId } });
    // An accepted identity, so the assigned MCP owner reads the running Run's
    // current identity (the Always standing-grant path: no signed origin).
    const [context] = await db.insert(runIdentityContexts).values({ companyId, runId, revision: 1, responsibleUserId: userId,
      cause: "assignment", correlationId: `initial:${runId}`, status: "accepted", acceptedAt: now }).returning();
    await db.update(heartbeatRuns).set({ activeIdentityContextId: context!.id }).where(eq(heartbeatRuns.id, runId));
    await db.update(issues).set({ executionRunId: runId, executionLockedAt: now }).where(eq(issues.id, issueId));
    return { companyId, agentId, issueId, runId, userId };
  }

  const codeOf = (error: any): string | undefined => error?.code ?? error?.cause?.code;
  const settle = <T>(promise: Promise<T>) => promise.then(
    value => ({ ok: true as const, value, code: undefined }), (error: unknown) => ({ ok: false as const, error, code: codeOf(error) }));
  const event = (run: Awaited<ReturnType<typeof seed>>) => ({ companyId: run.companyId, runId: run.runId, agentId: run.agentId,
    eventType: "lifecycle", stream: "system" as const, level: "info" as const, message: "provider event" });

  async function untilLockWaiters(n: number) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const [row] = await db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`) as unknown as Array<{ n: number }>;
      if (Number(row.n) >= n) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`fewer than ${n} backends waited on a lock`);
  }

  it("appends while an assigned MCP source check reviews the run and reads its identity", async () => {
    const run = await seed();
    // Both sides pass the real review on this run before the race.
    await assertNativeAnalyticalRunPayloadAccess(db, run.companyId, run.runId);

    let markReviewed!: () => void;
    let release!: () => void;
    const reviewed = new Promise<void>(resolve => { markReviewed = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    // The source check: its review (run FOR SHARE), then the real assigned
    // MCP owner, which reads the running Run's identity. No Gateway exists,
    // so the owner then refuses (null); the identity read is the race.
    const sourceCheck = settle(db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await assertNativeAnalyticalRunPayloadAccess(tx, run.companyId, run.runId);
      markReviewed();
      await released;
      return getNativeAssignedMcpDescriptorCurrent(tx, { companyId: run.companyId, issueId: run.issueId,
        runId: run.runId, agentId: run.agentId, responsibleUserId: run.userId, gatewayId: randomUUID(),
        gatewayPublicId: `gw_${randomUUID()}`, gatewayProfileId: randomUUID(), workMode: "standard",
        catalogSchemaHash: null, arguments: {} }, undefined, { producerRunHeldForShare: true });
    }));
    await reviewed;
    // The append reviews under FOR SHARE, then waits to lock the run for its insert.
    const append = settle(db.transaction(async (rawTx) => appendSourceReviewedNativeRunEvent(rawTx as unknown as Db,
      run, event(run), true)));
    await untilLockWaiters(1);
    release();
    const [checked, appended] = await Promise.all([sourceCheck, append]);

    expect([checked.code ?? null, appended.code ?? null], "neither side may be aborted as a deadlock").not.toContain("40P01");
    expect(checked.ok, String(checked.ok ? "" : checked.error)).toBe(true);
    expect(appended.ok, String(appended.ok ? "" : appended.error)).toBe(true);
    if (checked.ok) expect(checked.value).toBeNull();
    const events = await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, run.runId));
    expect(events.map(row => row.message)).toEqual(["provider event"]);
  }, 30_000);

  it("does not block a FOR SHARE reader with a short lock_timeout during its source review", async () => {
    const run = await seed();
    let markReviewing!: () => void;
    let finish!: () => void;
    const reviewing = new Promise<void>(resolve => { markReviewing = resolve; });
    const finished = new Promise<void>(resolve => { finish = resolve; });
    // Hold the append inside its source review, after the review's own run
    // lock: its Task erasure marker check (`... as erased`) waits here.
    const append = settle(db.transaction(async (rawTx) => {
      const dialect = (rawTx as unknown as { dialect: { sqlToQuery(query: unknown): { sql: string } } }).dialect;
      let held = false;
      const tx = new Proxy(rawTx, { get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "execute" || typeof value !== "function") return value;
        return async (query: unknown) => {
          if (!held && /aw_workflow_memory_erased\(\$1::uuid,\$2::uuid,\$3::uuid\) as erased/.test(dialect.sqlToQuery(query).sql)) {
            held = true; markReviewing(); await finished;
          }
          return value.call(target, query);
        };
      } });
      return appendSourceReviewedNativeRunEvent(tx as unknown as Db, run, event(run), true);
    }));
    const early = await Promise.race([reviewing.then(() => null), append]);
    if (early) throw new Error(`the append finished before its review was held: ${early.ok ? "ok" : String(early.error)}`);
    // A sync-out exec claim's shape: Task FOR SHARE > run FOR SHARE, with its
    // remaining claim budget as lock_timeout.
    const reader = await settle(db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '300ms'`);
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, run.issueId)).for("share");
      return tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, run.runId)).for("share");
    }));
    finish();
    const appended = await append;
    expect(reader.code ?? null, "the reader must not time out behind the append's review").not.toBe("55P03");
    expect(reader.ok, String(reader.ok ? "" : reader.error)).toBe(true);
    expect(appended.ok, String(appended.ok ? "" : appended.error)).toBe(true);
  }, 30_000);
});
