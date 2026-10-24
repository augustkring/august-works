import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authSessions,
  authUsers,
  agents,
  boardApiKeys,
  companyMemberships,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issueLabels,
  issues,
  heartbeatRuns,
  labels,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { issueService } from "../services/issues.js";

/**
 * Board auth carriers model the server-owned post-authentication object. Agent
 * cases sign and verify a real local AgentJWT. These tests prove neither source
 * completeness nor provider execution facts.
 */
describe("generic Task mutation credential lifetime", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("generic-task-credential-lifetime-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seed() {
    const companyId = randomUUID();
    const userId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `GCL${companyId.slice(0, 5).toUpperCase()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Credential lifetime", issuePrefix });
    await db.insert(authUsers).values({ id: userId, name: "Authenticated Human", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "member", status: "active" });
    const [issue] = await db.insert(issues).values({ id: issueId, companyId, issueNumber: 1,
      identifier: `${issuePrefix}-1`, title: "Open public task", status: "todo", priority: "medium" }).returning();
    return { companyId, userId, issue: issue! };
  }

  function mutationActor(f: Awaited<ReturnType<typeof seed>>, actor: AuthorizationActor) {
    return issueService(db).update(f.issue.id, { priority: "high", actorUserId: f.userId, privacyActor: actor });
  }

  async function seedNativeAgentTask() {
    const f = await seed();
    const agentId = randomUUID();
    const runId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId: f.companyId, name: "Current native Agent",
      role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.update(issues).set({ assigneeAgentId: agentId }).where(eq(issues.id, f.issue.id));
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId,
      responsibleUserId: f.userId, nativeIssueId: f.issue.id, contextSnapshot: { issueId: f.issue.id },
      runtimeMode: "native", status: "running", startedAt: new Date() });
    return { ...f, agentId, runId };
  }

  function signedAgentActor(f: Awaited<ReturnType<typeof seedNativeAgentTask>>, ttlSeconds: number) {
    const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
    const previousTtl = process.env.PAPERCLIP_AGENT_JWT_TTL_SECONDS;
    process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID();
    process.env.PAPERCLIP_AGENT_JWT_TTL_SECONDS = String(ttlSeconds);
    try {
      const token = createLocalAgentJwt(f.agentId, f.companyId, "paperclip_runner", f.runId, f.userId);
      const claims = token ? verifyLocalAgentJwt(token) : null;
      if (!token || !claims) throw new Error("Could not mint and verify the actual AgentJWT fixture");
      return {
        claims,
        actor: { type: "agent", source: "agent_jwt", companyId: claims.company_id,
          agentId: claims.sub, runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id,
          authenticatedCredentialExpiresAt: claims.exp * 1000, keyScope: claims.key_scope ?? { kind: "standard" } } satisfies AuthorizationActor,
      };
    } finally {
      if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
      else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
      if (previousTtl === undefined) delete process.env.PAPERCLIP_AGENT_JWT_TTL_SECONDS;
      else process.env.PAPERCLIP_AGENT_JWT_TTL_SECONDS = previousTtl;
    }
  }

  async function waitForTaskLockWait(holderPid: number) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
        where ${holderPid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
      if ((row?.count ?? 0) > 0) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Mutation did not reach the held Task row lock");
  }

  async function waitForLabelDeleteWait(holderPid: number) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
        where ${holderPid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock' and query ilike '%issue_labels%'`);
      if ((row?.count ?? 0) > 0) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Mutation did not reach the held issue_labels DELETE");
  }

  it("commits a valid current session mutation", async () => {
    const f = await seed();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(authSessions).values({ id: sessionId, userId: f.userId, token: randomUUID(),
      createdAt: new Date(), updatedAt: new Date(), expiresAt });
    const actor: AuthorizationActor = { type: "board", source: "session", userId: f.userId,
      sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime(), companyIds: [f.companyId] };

    await expect(mutationActor(f, actor)).resolves.toMatchObject({ priority: "high" });
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("high");
  }, 90_000);

  it("returns the credential-busy response when the actual session row is already locked", async () => {
    const f = await seed();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(authSessions).values({ id: sessionId, userId: f.userId, token: randomUUID(),
      createdAt: new Date(), updatedAt: new Date(), expiresAt });

    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const holder = db.transaction(async tx => {
      await tx.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.id, sessionId)).for("update");
      acquired();
      await released;
    });
    await locked;
    const actor: AuthorizationActor = { type: "board", source: "session", userId: f.userId,
      sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime(), companyIds: [f.companyId] };
    try {
      await expect(mutationActor(f, actor)).rejects.toMatchObject({
        status: 409, details: { code: "authentication_state_busy" },
      });
    } finally {
      release();
      await holder;
    }
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("medium");
  }, 90_000);

  it("commits a valid mutation from a verified current AgentJWT and accountable run", async () => {
    const f = await seedNativeAgentTask();
    const { claims, actor } = signedAgentActor(f, 60);
    expect(claims.run_id).toBe(f.runId);
    await expect(issueService(db).update(f.issue.id, {
      priority: "high", actorAgentId: f.agentId, actorRunId: f.runId, privacyActor: actor,
    })).resolves.toMatchObject({ priority: "high" });
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("high");
  }, 90_000);

  it("denies a session whose original deadline expires during an observed Task-row wait", async () => {
    const f = await seed();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(authSessions).values({ id: sessionId, userId: f.userId, token: randomUUID(),
      createdAt: new Date(), updatedAt: new Date(), expiresAt });

    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      const [identity] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = identity!.pid;
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, f.issue.id)).for("update");
      acquired();
      await released;
    });
    await locked;
    const expiresAtDuringRequest = new Date(Date.now() + 1_500);
    await db.update(authSessions).set({ expiresAt: expiresAtDuringRequest }).where(eq(authSessions.id, sessionId));
    const actor: AuthorizationActor = { type: "board", source: "session", userId: f.userId,
      sessionId, authenticatedCredentialExpiresAt: expiresAtDuringRequest.getTime(), companyIds: [f.companyId] };
    const mutation = mutationActor(f, actor).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    );
    try {
      await waitForTaskLockWait(holderPid);
      // A concurrent session renewal cannot extend the expiry captured by the
      // original authenticated request.
      await db.update(authSessions).set({ expiresAt: new Date(Date.now() + 60_000) })
        .where(eq(authSessions.id, sessionId));
      await db.execute(sql`select pg_sleep(1.8)`);
    } finally {
      release();
      await holder;
      await mutation;
    }
    const outcome = await mutation;
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ status: 403 }) });
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("medium");
  }, 90_000);

  it("denies an AgentJWT whose original deadline expires during an observed Task-row wait", async () => {
    const f = await seedNativeAgentTask();

    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      const [identity] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = identity!.pid;
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, f.issue.id)).for("update");
      acquired();
      await released;
    });
    await locked;
    const { claims, actor } = signedAgentActor(f, 3);
    expect(claims?.run_id).toBe(f.runId);
    const mutation = issueService(db).update(f.issue.id, {
      priority: "high", actorAgentId: f.agentId, actorRunId: f.runId, privacyActor: actor,
    }).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    );
    try {
      await waitForTaskLockWait(holderPid);
      const secondsPastOriginalExpiry = Math.max(0.25, (claims!.exp * 1000 - Date.now() + 250) / 1000);
      await db.execute(sql`select pg_sleep(${secondsPastOriginalExpiry})`);
    } finally {
      release();
      await holder;
      await mutation;
    }
    const outcome = await mutation;
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ status: 403 }) });
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("medium");
  }, 90_000);

  it("denies a key revoked while the mutation waits on the Task row", async () => {
    const f = await seed();
    const tokenHash = randomUUID();
    const [key] = await db.insert(boardApiKeys).values({ userId: f.userId, name: "Current fixture key",
      keyHash: tokenHash, expiresAt: new Date(Date.now() + 60_000) }).returning();
    const actor: AuthorizationActor = { type: "board", source: "board_key", userId: f.userId,
      keyId: key!.id, authenticatedKeyHash: tokenHash, authenticatedCredentialExpiresAt: key!.expiresAt!.getTime(),
      companyIds: [f.companyId] };

    await expect(mutationActor(f, actor)).resolves.toMatchObject({ priority: "high" });
    await db.update(issues).set({ priority: "medium" }).where(eq(issues.id, f.issue.id));

    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      const [identity] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = identity!.pid;
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, f.issue.id)).for("update");
      acquired();
      await released;
    });
    await locked;
    const mutation = mutationActor(f, actor).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    );
    try {
      await waitForTaskLockWait(holderPid);
      await db.update(boardApiKeys).set({ revokedAt: new Date() }).where(eq(boardApiKeys.id, key!.id));
    } finally {
      release();
      await holder;
      await mutation;
    }
    const outcome = await mutation;
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ status: 403 }) });
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("medium");
  }, 90_000);

  it("rolls back a mutation when the session expires during a label-delete wait after the Task update", async () => {
    const f = await seed();
    const sessionId = randomUUID();
    const labelId = randomUUID();
    const now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: f.userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    await db.insert(labels).values({ id: labelId, companyId: f.companyId, name: "held-label", color: "#336699" });
    await db.insert(issueLabels).values({ issueId: f.issue.id, labelId, companyId: f.companyId });

    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      const [identity] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = identity!.pid;
      await tx.select({ issueId: issueLabels.issueId }).from(issueLabels)
        .where(eq(issueLabels.issueId, f.issue.id)).for("update");
      acquired();
      await released;
    });
    await locked;
    const expiresAt = new Date(Date.now() + 1_500);
    await db.update(authSessions).set({ expiresAt }).where(eq(authSessions.id, sessionId));
    const actor: AuthorizationActor = { type: "board", source: "session", userId: f.userId,
      sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime(), companyIds: [f.companyId] };
    const mutation = issueService(db).update(f.issue.id, {
      priority: "high", labelIds: [], actorUserId: f.userId, privacyActor: actor,
    }).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    );
    try {
      await waitForLabelDeleteWait(holderPid);
      await db.execute(sql`select pg_sleep(1.8)`);
    } finally {
      release();
      await holder;
      await mutation;
    }
    const outcome = await mutation;
    expect(outcome).toMatchObject({ ok: false, error: expect.objectContaining({ status: 403 }) });
    const [saved] = await db.select({ priority: issues.priority }).from(issues).where(eq(issues.id, f.issue.id));
    expect(saved?.priority).toBe("medium");
    expect(await db.select().from(issueLabels).where(eq(issueLabels.issueId, f.issue.id)))
      .toEqual([expect.objectContaining({ issueId: f.issue.id, labelId, companyId: f.companyId })]);
  }, 90_000);
});
