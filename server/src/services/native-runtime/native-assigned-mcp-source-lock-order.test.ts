import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, heartbeatRunEvents, heartbeatRuns, issues,
  runIdentityContexts, type Db } from "@paperclipai/db";
import { captureRunIdentity, captureRunIdentityUnderHeldRunShare } from "../run-identity.js";
import { getNativeAssignedMcpDescriptorCurrent, getNativeAssignedMcpDescriptorsCurrent } from "../tool-gateway.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";

/*
 * APR-E2E-29. An assigned MCP source check holds the producer Run FOR SHARE
 * from its source review and then reads the running Run's current identity.
 * It used captureRunIdentity (run FOR UPDATE), so two checks on one Run each
 * held the shared lock and waited for the other's: PostgreSQL aborted one
 * with deadlock_detected (40P01). Under the caller's held shared lock the
 * identity is now read with captureRunIdentityUnderHeldRunShare.
 *
 * The barrier: both checks take the Run FOR SHARE (as the review does) before
 * either reads the identity through the real assigned MCP owner.
 */
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Assigned MCP source check lock order (APR-E2E-29)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-assigned-mcp-lock-order-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => { await database?.cleanup(); }, 60_000);

  async function seed(options: { status?: string; identity?: boolean } = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const userId = `mcp-lock-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Assigned MCP lock order", issuePrefix: `M${companyId.slice(0, 7)}` });
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", role: "engineer", adapterType: "codex_local",
      status: "running" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Task", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: userId,
      status: options.status ?? "running", startedAt: now, runtimeMode: "native", nativeIssueId: issueId,
      contextSnapshot: { issueId } });
    let contextId: string | null = null;
    if (options.identity !== false) {
      const [context] = await db.insert(runIdentityContexts).values({ companyId, runId, revision: 1,
        responsibleUserId: userId, cause: "assignment", correlationId: `initial:${runId}`, status: "accepted",
        acceptedAt: now }).returning();
      contextId = context!.id;
      await db.update(heartbeatRuns).set({ activeIdentityContextId: contextId }).where(eq(heartbeatRuns.id, runId));
    }
    return { companyId, agentId, issueId, runId, userId, contextId };
  }

  const codeOf = (error: any): string | undefined => error?.code ?? error?.cause?.code;
  const settle = <T>(promise: Promise<T>) => promise.then(
    value => ({ ok: true as const, value, code: undefined }), (error: unknown) => ({ ok: false as const, error, code: codeOf(error) }));
  const outcome = async <T>(promise: Promise<T>) => {
    const settled = await settle(promise);
    if (settled.ok) return { ok: true, value: settled.value };
    const error = settled.error as { status?: number; message?: string };
    return { ok: false, status: error.status, message: error.message };
  };

  /** Two transactions each hold the Run FOR SHARE, then both run `check`. */
  async function concurrentChecksUnderSharedRun<T>(runId: string, check: (tx: Db) => Promise<T>) {
    let arrived = 0;
    let releaseBoth!: () => void;
    const bothHeld = new Promise<void>(resolve => { releaseBoth = resolve; });
    const one = () => settle(db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).for("share");
      arrived += 1;
      if (arrived === 2) releaseBoth();
      await bothHeld;
      return check(tx);
    }));
    return Promise.all([one(), one()]);
  }

  function scope(run: Awaited<ReturnType<typeof seed>>) {
    // No Gateway exists: the owner reads the identity, then refuses at the
    // Gateway. The identity read is what both checks race on.
    return { companyId: run.companyId, issueId: run.issueId, runId: run.runId, agentId: run.agentId,
      responsibleUserId: run.userId, gatewayId: randomUUID(), gatewayPublicId: `gw_${randomUUID()}`,
      gatewayProfileId: randomUUID(), workMode: "standard" as const, arguments: {} };
  }

  it("completes two executed-result source checks on one running Run", async () => {
    const run = await seed();
    const results = await concurrentChecksUnderSharedRun(run.runId, tx => getNativeAssignedMcpDescriptorCurrent(tx,
      { ...scope(run), catalogSchemaHash: null }, undefined, { producerRunHeldForShare: true }));
    expect(results.map(result => result.code ?? null), "neither check may be aborted as a deadlock").not.toContain("40P01");
    for (const result of results) {
      expect(result.ok, String(result.ok ? "" : result.error)).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    }
  }, 30_000);

  it("completes two search-result source checks on one running Run", async () => {
    const run = await seed();
    const results = await concurrentChecksUnderSharedRun(run.runId, tx => getNativeAssignedMcpDescriptorsCurrent(tx,
      scope(run), { producerRunHeldForShare: true }));
    expect(results.map(result => result.code ?? null), "neither check may be aborted as a deadlock").not.toContain("40P01");
    for (const result of results) {
      expect(result.ok, String(result.ok ? "" : result.error)).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    }
  }, 30_000);

  it("reads the same identity, checks and errors as captureRunIdentity under the held shared lock", async () => {
    const underShare = (input: { companyId: string; runId: string; agentId: string }) =>
      db.transaction(async (tx) => {
        await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId)).for("share");
        return captureRunIdentityUnderHeldRunShare(tx, input);
      });
    const key = (run: Awaited<ReturnType<typeof seed>>) => ({ companyId: run.companyId, runId: run.runId, agentId: run.agentId });

    // Current accepted identity, and a Run without one.
    for (const run of [await seed(), await seed({ identity: false })]) {
      const shared = await underShare(key(run));
      const updated = await captureRunIdentity(db, key(run));
      expect(shared).toEqual(updated);
      expect(shared.context?.id ?? null).toBe(run.contextId);
    }
    // Not running, another agent, another company: the same 403.
    const stopped = await seed({ status: "succeeded" });
    const live = await seed();
    for (const input of [key(stopped), { ...key(live), agentId: randomUUID() }, { ...key(live), companyId: stopped.companyId }]) {
      const shared = await outcome(underShare(input));
      expect(shared).toEqual(await outcome(captureRunIdentity(db, input)));
      expect(shared).toMatchObject({ ok: false, status: 403 });
    }
    // A pending identity without a stored acknowledgement: the same 409.
    const pendingRun = await seed();
    const messageId = randomUUID();
    const [pending] = await db.insert(runIdentityContexts).values({ companyId: pendingRun.companyId, runId: pendingRun.runId,
      revision: 2, responsibleUserId: pendingRun.userId, messageId, cause: "steering", correlationId: `steer:${messageId}`,
      status: "pending" }).returning();
    const sharedPending = await outcome(underShare(key(pendingRun)));
    expect(sharedPending).toEqual(await outcome(captureRunIdentity(db, key(pendingRun))));
    expect(sharedPending).toMatchObject({ ok: false, status: 409 });
    // With a stored acknowledgement captureRunIdentity accepts it (a Task and
    // run write); under the held shared lock the same 409 refuses it instead
    // and writes nothing.
    await db.insert(heartbeatRunEvents).values({ companyId: pendingRun.companyId, runId: pendingRun.runId,
      agentId: pendingRun.agentId, seq: 1, eventType: "item.completed", sourceEventId: `ack-${messageId}`,
      payload: { prpEvent: { itemId: `turn-1:steer:${messageId}`, turnId: "turn-1",
        payload: { kind: "steering_acknowledgement" } } } });
    expect(await outcome(underShare(key(pendingRun)))).toEqual(sharedPending);
    const [stillPending] = await db.select().from(runIdentityContexts).where(eq(runIdentityContexts.id, pending!.id));
    expect(stillPending?.status).toBe("pending");
    const accepted = await captureRunIdentity(db, key(pendingRun));
    expect(accepted.context?.id).toBe(pending!.id);
    expect(await underShare(key(pendingRun))).toEqual(await captureRunIdentity(db, key(pendingRun)));
  }, 30_000);
});
