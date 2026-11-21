import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, heartbeatRunEvents, heartbeatRuns, issues,
  type Db } from "@paperclipai/db";
import { assertNativeAnalyticalRunPayloadAccess } from "../analytical-context-authority.js";
import { captureRunIdentity } from "../run-identity.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { appendSourceReviewedNativeRunEvent } from "./paperclip-control-plane-port.js";

/*
 * APR-E2E-29. A managed Run's provider event append reviews the run payload
 * sources (run FOR SHARE) and then appends (run FOR UPDATE). An assigned MCP
 * source check on the same Run does the same: its source review holds the run
 * FOR SHARE and its current-identity capture then locks it FOR UPDATE. When
 * both held the shared lock, each waited for the other and PostgreSQL aborted
 * one with deadlock_detected (40P01); in the e2e Always case it was the
 * append, and the Run failed native_session_interrupted. The append now takes
 * company A+M shared > Task FOR SHARE > run FOR UPDATE before its review, so
 * it never upgrades a shared run lock.
 *
 * The barrier: the source check holds its review's run lock, the append is
 * started and waits on the run, then the source check captures the identity.
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
    await db.update(issues).set({ executionRunId: runId, executionLockedAt: now }).where(eq(issues.id, issueId));
    return { companyId, agentId, issueId, runId };
  }

  const codeOf = (error: any): string | undefined => error?.code ?? error?.cause?.code;
  const settle = <T>(promise: Promise<T>) => promise.then(
    value => ({ ok: true as const, value, code: undefined }), (error: unknown) => ({ ok: false as const, error, code: codeOf(error) }));

  async function untilLockWaiters(n: number) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const [row] = await db.execute(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`) as unknown as Array<{ n: number }>;
      if (Number(row.n) >= n) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`fewer than ${n} backends waited on a lock`);
  }

  it("appends while an assigned MCP source check reviews the run and captures its identity", async () => {
    const run = await seed();
    // Both sides pass the real review on this run before the race.
    await assertNativeAnalyticalRunPayloadAccess(db, run.companyId, run.runId);

    let markReviewed!: () => void;
    let release!: () => void;
    const reviewed = new Promise<void>(resolve => { markReviewed = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    // The source check: its review (run FOR SHARE), then the current-identity
    // capture (run FOR UPDATE), as the assigned MCP descriptor owner does.
    const sourceCheck = settle(db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await assertNativeAnalyticalRunPayloadAccess(tx, run.companyId, run.runId);
      markReviewed();
      await released;
      return captureRunIdentity(tx, { companyId: run.companyId, runId: run.runId, agentId: run.agentId });
    }));
    await reviewed;
    const append = settle(db.transaction(async (rawTx) => appendSourceReviewedNativeRunEvent(rawTx as unknown as Db,
      run, { companyId: run.companyId, runId: run.runId, agentId: run.agentId, eventType: "lifecycle",
        stream: "system", level: "info", message: "provider event" }, true)));
    await untilLockWaiters(1);
    release();
    const [checked, appended] = await Promise.all([sourceCheck, append]);

    expect([checked.code ?? null, appended.code ?? null], "neither side may be aborted as a deadlock").not.toContain("40P01");
    expect(checked.ok, String(checked.ok ? "" : checked.error)).toBe(true);
    expect(appended.ok, String(appended.ok ? "" : appended.error)).toBe(true);
    if (checked.ok) expect(checked.value.run.id).toBe(run.runId);
    const events = await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, run.runId));
    expect(events.map(event => event.message)).toEqual(["provider event"]);
  }, 30_000);

  it("orders the append as company shared > Task > run before its source review", async () => {
    const run = await seed();
    // A Task-first exclusive writer (steering acceptance's order) holds the
    // Task; the append must wait on the Task without holding the run.
    let release!: () => void;
    let markHeld!: () => void;
    const held = new Promise<void>(resolve => { markHeld = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const writer = settle(db.transaction(async (tx) => {
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, run.issueId)).for("update");
      markHeld();
      await released;
      await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, run.runId)).for("update");
    }));
    await held;
    const append = settle(db.transaction(async (rawTx) => appendSourceReviewedNativeRunEvent(rawTx as unknown as Db,
      run, { companyId: run.companyId, runId: run.runId, agentId: run.agentId, eventType: "lifecycle",
        stream: "system", level: "info", message: "provider event" }, true)));
    await untilLockWaiters(1);
    // The append waits on the Task and holds no lock on the run yet.
    await expect(db.transaction(async (tx) => tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run.runId)).for("update", { noWait: true }))).resolves.toHaveLength(1);
    release();
    const [written, appended] = await Promise.all([writer, append]);
    expect([written.code ?? null, appended.code ?? null]).not.toContain("40P01");
    expect(written.ok && appended.ok).toBe(true);
  }, 30_000);
});
