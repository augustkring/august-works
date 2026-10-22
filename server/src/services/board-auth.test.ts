import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { activityLog, authUsers, boardApiKeys, cliAuthChallenges, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, instanceUserRoles, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { subscribeCompanyLiveEvents } from "./live-events.js";
import type { Db } from "@paperclipai/db";
import { boardAuthService } from "./board-auth.js";

describe("boardAuthService touchBoardApiKey", () => {
  it("retries the audit write after a transient failure", async () => {
    const writes = [Promise.reject(new Error("transient")), Promise.resolve([])];
    const update = vi.fn(() => ({
      set: () => ({
        where: () => writes.shift(),
      }),
    }));
    const service = boardAuthService({ update } as unknown as Db);

    await expect(service.touchBoardApiKey("key-1")).rejects.toThrow("transient");
    await expect(service.touchBoardApiKey("key-1")).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight audit write across concurrent touches", async () => {
    let releaseWrite: (() => void) | undefined;
    const write = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const update = vi.fn(() => ({
      set: () => ({
        where: () => write,
      }),
    }));
    const service = boardAuthService({ update } as unknown as Db);

    const first = service.touchBoardApiKey("key-1");
    const second = service.touchBoardApiKey("key-1");
    releaseWrite?.();
    await Promise.all([first, second]);

    expect(update).toHaveBeenCalledTimes(1);
  });
});

const support = await getEmbeddedPostgresTestSupport();
const databaseSuite = support.supported ? describe : describe.skip;

databaseSuite("CLI challenge authority and transitions (real PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let http: [typeof import("express"), typeof import("supertest"), typeof import("../middleware/auth.js"), typeof import("../routes/access.js"), typeof import("../middleware/error-handler.js")];
  beforeAll(async () => {
    http = await Promise.all([import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../middleware/error-handler.js")]);
    temporary = await startEmbeddedPostgresTestDatabase("board-cli-challenge-");
    db = createDb(temporary.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
  });

  async function fixture() {
    const companyId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID();
    const now = new Date();
    await db.insert(authUsers).values([userId, otherUserId].map(id => ({
      id, name: "CLI approver", email: `${id}@example.invalid`, createdAt: now, updatedAt: now,
    })));
    await db.insert(companies).values({ id: companyId, name: "Private CLI organization", issuePrefix: `C${companyId.slice(0, 7)}` });
    await db.insert(companyMemberships).values([userId, otherUserId].map(principalId => ({
      companyId, principalType: "user", principalId, status: "active", membershipRole: "owner",
    })));
    const service = boardAuthService(db);
    const created = await service.createCliAuthChallenge({ command: "paperclipai auth login", requestedAccess: "board", requestedCompanyId: companyId });
    return { companyId, userId, otherUserId, service, ...created };
  }

  async function waitForChallengeLock() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await db.execute<{ waiting: boolean }>(sql`
        select exists(select 1 from pg_stat_activity where datname = current_database()
          and pid <> pg_backend_pid() and wait_event_type = 'Lock'
          and query ilike '%cli_auth_challenges%') as waiting
      `);
      if (rows[0]?.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("CLI challenge contender did not reach the held database lock");
  }

  it("keeps pending tokens unusable and stores only independent secret digests", async () => {
    const f = await fixture();
    expect(f.challenge.secretHash).not.toBe(f.challenge.pendingKeyHash);
    expect(f.challenge.secretHash).not.toContain(f.challengeSecret);
    expect(f.challenge.pendingKeyHash).not.toContain(f.pendingBoardToken);
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    expect(await f.service.getCliAuthChallengeBySecret(f.challenge.id, "wrong-secret")).toBeNull();
    await db.update(cliAuthChallenges).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).status).toBe("expired");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
  });

  it("retains the first key owner and approver on same-user and competing-user replay", async () => {
    const f = await fixture();
    const first = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherUserId)).rejects.toThrow("another user");
    const repeat = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    expect(repeat.challenge).toEqual(first.challenge);
    const [stored] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect(stored).toEqual(first.challenge);
    const key = await f.service.findBoardApiKeyByToken(f.pendingBoardToken);
    expect(key?.userId).toBe(f.userId);
    expect(stored.approvedByUserId).toBe(key?.userId);
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.keyHash, f.challenge.pendingKeyHash))).toHaveLength(1);
  });

  it("denies an inaccessible requested company before key creation or audit fallback", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(eq(companyMemberships.principalId, f.otherUserId));
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherUserId)).rejects.toThrow("requested organization");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    expect(await f.service.resolveBoardActivityCompanyIds({ userId: f.otherUserId, requestedCompanyId: f.companyId })).toEqual([]);
  });

  it("rechecks company membership after waiting for the approval lock", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>(resolve => { locked = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`select id from cli_auth_challenges where id = ${f.challenge.id} for update`);
      locked(); await unlock;
    });
    await held;
    const approval = f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const outcome = approval.then(value => ({ value }), error => ({ error }));
    try {
      await waitForChallengeLock();
      await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
    } finally { release(); await holder; }
    const result = await outcome;
    expect(result).toHaveProperty("error");
    expect("error" in result ? String(result.error) : "").toContain("requested organization");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
  });

  it("serializes cancellation behind an actual approval transaction without cancelling its live key", async () => {
    const f = await fixture();
    let release!: () => void, prepared!: () => void;
    const ready = new Promise<void>(resolve => { prepared = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const gated = Object.create(db) as Db;
    gated.transaction = ((callback: Parameters<Db["transaction"]>[0]) => db.transaction(async tx => {
      const result = await callback(tx);
      prepared(); await unlock;
      return result;
    })) as Db["transaction"];
    const approval = boardAuthService(gated).approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    await ready;
    const cancellation = f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret);
    const outcome = cancellation.then(value => ({ value }), error => ({ error }));
    try { await waitForChallengeLock(); }
    finally { release(); await approval; }
    const result = await outcome;
    expect(result).toHaveProperty("value.status", "approved");
    const [stored] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect(stored.cancelledAt).toBeNull();
    expect(stored.approvedByUserId).toBe(f.userId);
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toMatchObject({ userId: f.userId });
  });

  it("publishes approval activity only after key, challenge and audit rows commit", async () => {
    const f = await fixture();
    const events: string[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(f.companyId, event => {
      if (event.payload.action === "board_api_key.created") events.push(event.payload.actorId as string);
    });
    let release!: () => void, prepared!: () => void;
    const ready = new Promise<void>(resolve => { prepared = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const gated = Object.create(db) as Db;
    gated.transaction = ((callback: Parameters<Db["transaction"]>[0]) => db.transaction(async tx => {
      const result = await callback(tx); prepared(); await unlock; return result;
    })) as Db["transaction"];
    const service = boardAuthService(gated);
    const approval = service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    try {
      await ready;
      expect(events).toEqual([]);
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
      release(); await approval;
      expect(events).toEqual([f.userId]);
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
      await service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
      expect(events).toEqual([f.userId]);
    } finally { release(); await approval; unsubscribe(); }
  });

  it("never grants a key after cancellation and keeps duplicate cancellation stable", async () => {
    const f = await fixture();
    const first = await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret);
    expect((await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret)).challenge).toEqual(first.challenge);
    expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).status).toBe("cancelled");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
  });

  it("shows the requested company name only to a currently authorized viewer", async () => {
    const f = await fixture();
    expect(await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret, { viewerUserId: f.userId }))
      .toMatchObject({ requestedCompanyName: "Private CLI organization", approvedByUser: null });
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.otherUserId));
    expect(await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret, { viewerUserId: f.otherUserId }))
      .toMatchObject({ requestedCompanyName: null, approvedByUser: null });
  });

  it("keeps instance-admin approval and current full-Board key authentication compatible", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(eq(companyMemberships.principalId, f.userId));
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    const created = await f.service.createCliAuthChallenge({ command: "paperclipai auth login", requestedAccess: "instance_admin_required", requestedCompanyId: f.companyId });
    await expect(f.service.approveCliAuthChallenge(created.challenge.id, created.challengeSecret, f.otherUserId)).rejects.toThrow("Instance admin required");
    const approved = await f.service.approveCliAuthChallenge(created.challenge.id, created.challengeSecret, f.userId);
    expect(approved.status).toBe("approved");
    expect(await f.service.findBoardApiKeyByToken(created.pendingBoardToken)).toMatchObject({ userId: f.userId });
    expect((await f.service.resolveBoardAccess(f.userId)).isInstanceAdmin).toBe(true);
  });


  it("rechecks current membership and key authority on same-owner replay", async () => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).rejects.toThrow("requested organization");
    await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.principalId, f.userId));
    await f.service.revokeBoardApiKey(approved.challenge.boardApiKeyId!, { userId: f.userId, revokedVia: "cli_auth_logout" });
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).rejects.toThrow("no longer active");
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.keyHash, f.challenge.pendingKeyHash))).toHaveLength(1);
  });

  it("rolls back first approval if its durable audit cannot be stored", async () => {
    const f = await fixture();
    await db.execute(sql.raw(`alter table activity_log add constraint board_cli_approval_failure check (action != 'board_api_key.created' or company_id != '${f.companyId}')`));
    try {
      await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).rejects.toThrow();
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
      const [pending] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
      expect(pending.approvedAt).toBeNull();
      expect(pending.boardApiKeyId).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint board_cli_approval_failure`);
    }
    await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
  });

  it("preserves committed approval when notification fails without publishing it again", async () => {
    const f = await fixture();
    const unsubscribe = subscribeCompanyLiveEvents(f.companyId, event => {
      if (event.payload.action === "board_api_key.created") throw new Error("Injected publication failure");
    });
    try {
      const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
      expect(approved.status).toBe("approved");
      expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).challenge).toEqual(approved.challenge);
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toMatchObject({ userId: f.userId });
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it("keeps owner-bound revocation atomic after membership loss and concurrent retries", async () => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const keyId = approved.challenge.boardApiKeyId!;
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
    expect(await f.service.revokeBoardApiKey(keyId, { userId: f.otherUserId, revokedVia: "board_api_key_lifecycle" })).toBeNull();
    await db.execute(sql.raw(`alter table activity_log add constraint board_cli_revoke_failure check (action != 'board_api_key.revoked' or company_id != '${f.companyId}')`));
    try {
      await expect(f.service.revokeBoardApiKey(keyId, { userId: f.userId, revokedVia: "cli_auth_logout" })).rejects.toThrow();
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).not.toBeNull();
      expect((await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).filter(row => row.action === "board_api_key.revoked")).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint board_cli_revoke_failure`);
    }
    const results = await Promise.all([0, 1].map(() => f.service.revokeBoardApiKey(keyId, { userId: f.userId, revokedVia: "cli_auth_logout" })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    const revoked = (await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).filter(row => row.action === "board_api_key.revoked");
    expect(revoked).toHaveLength(1);
    expect(revoked[0].companyId).toBe(f.companyId);
  });
  it("authenticates the real pending, approved and revoked HTTP handshake without synthesizing an anonymous actor", async () => {
    const f = await fixture();
    const [{ default: express }, { default: request }, { actorMiddleware }, { accessRoutes }, { errorHandler }] = http;
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => (req.header("X-Test-Session") === f.userId || req.header("X-Test-Session") === f.otherUserId)
      ? { session: { id: "isolated-cli-session" }, user: { id: req.header("X-Test-Session"), name: "CLI approver", email: "synthetic-session@example.invalid" } } as any
      : null }));
    app.use("/api", accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [] }));
    app.use(errorHandler);
    const created = await request(app).post("/api/cli-auth/challenges")
      .send({ command: "paperclipai auth login", requestedCompanyId: f.companyId });
    expect(created.status).toBe(201);
    const { id, token, boardApiToken } = created.body;
    const secondCompanyId = randomUUID();
    await db.insert(companies).values({ id: secondCompanyId, name: "Second CLI organization", issuePrefix: `S${secondCompanyId.slice(0, 7)}` });
    await db.insert(companyMemberships).values({ companyId: secondCompanyId, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    expect((await request(app).get("/api/cli-auth/me").set("Authorization", `Bearer ${boardApiToken}`)).status).toBe(401);
    const anonymous = await request(app).get(`/api/cli-auth/challenges/${id}?token=${token}`);
    expect(anonymous.body).toMatchObject({ status: "pending", canApprove: false, requestedCompanyName: null, approvedByUser: null });
    expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).send({ token })).status).toBe(401);
    await db.delete(companyMemberships).where(eq(companyMemberships.principalId, f.otherUserId));
    expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.otherUserId).send({ token })).status).toBe(403);
    expect(await f.service.findBoardApiKeyByToken(boardApiToken)).toBeNull();
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.otherUserId))).toHaveLength(0);
    const browser = await request(app).get(`/api/cli-auth/challenges/${id}?token=${token}`).set("X-Test-Session", f.userId);
    expect(browser.body).toMatchObject({ canApprove: true, requestedCompanyName: "Private CLI organization" });
    await db.execute(sql.raw(`alter table activity_log add constraint board_cli_audit_failure check (action != 'board_api_key.created' or company_id != '${secondCompanyId}')`));
    try {
      const failed = await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.userId).send({ token });
      expect(failed.status).toBe(500);
      expect(await f.service.findBoardApiKeyByToken(boardApiToken)).toBeNull();
      const [pending] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, id));
      expect(pending.approvedAt).toBeNull();
      expect(pending.boardApiKeyId).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
    } finally { await db.execute(sql`alter table activity_log drop constraint board_cli_audit_failure`); }
    const unsubscribeFailure = subscribeCompanyLiveEvents(f.companyId, event => {
      if (event.payload.action === "board_api_key.created") throw new Error("Synthetic publication failure");
    });
    const secondPublications: string[] = [];
    const unsubscribeSecond = subscribeCompanyLiveEvents(secondCompanyId, event => {
      if (event.payload.action === "board_api_key.created") secondPublications.push(event.payload.actorId as string);
    });
    try {
      expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.userId).send({ token })).status).toBe(200);
      expect(secondPublications).toEqual([f.userId]);
    } finally { unsubscribeFailure(); unsubscribeSecond(); }

    expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.userId).send({ token })).status).toBe(200);
    const audit = await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId));
    expect(audit.filter(row => row.action === "board_api_key.created")).toHaveLength(2);
    expect(new Set(audit.map(row => row.companyId))).toEqual(new Set([f.companyId, secondCompanyId]));
    expect(JSON.stringify(audit)).not.toContain(boardApiToken);
    expect(JSON.stringify(audit)).not.toContain(token);
    const identity = await request(app).get("/api/cli-auth/me").set("Authorization", `Bearer ${boardApiToken}`);
    expect(identity.body).toMatchObject({ userId: f.userId, source: "board_key" });
    expect(new Set(identity.body.companyIds)).toEqual(new Set([f.companyId, secondCompanyId]));
    expect((await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${boardApiToken}`)).status).toBe(200);
    expect((await request(app).get("/api/cli-auth/me").set("Authorization", `Bearer ${boardApiToken}`)).status).toBe(401);
  });


  it("creates a manual key and its audit atomically without exposing secrets in the audit", async () => {
    const f = await fixture();
    await db.execute(sql.raw(`alter table activity_log add constraint board_cli_manual_key_failure check (action != 'board_api_key.created' or company_id != '${f.companyId}')`));
    try {
      await expect(f.service.createNamedBoardApiKey({ userId: f.userId, name: "Manual developer key", requestedCompanyId: f.companyId })).rejects.toThrow();
      expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint board_cli_manual_key_failure`);
    }
    const key = await f.service.createNamedBoardApiKey({ userId: f.userId, name: "Manual developer key", requestedCompanyId: f.companyId });
    expect(await f.service.findBoardApiKeyByToken(key.token)).toMatchObject({ userId: f.userId });
    const audit = await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "board_api_key", entityId: key.id, responsibleUserId: f.userId });
    expect(audit[0].details?.boardApiKeyId).toBe("***REDACTED***");
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
    await f.service.revokeBoardApiKey(key.id, { userId: f.userId, revokedVia: "cli_auth_logout" });
    const revoked = (await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).filter(row => row.action === "board_api_key.revoked");
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({ entityType: "board_api_key", entityId: key.id, companyId: f.companyId });
    expect(JSON.stringify(audit)).not.toContain(key.token);
  });

  it("keeps consent terminal after physical key deletion and never reassigns its pending token", async () => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    await db.delete(boardApiKeys).where(eq(boardApiKeys.id, approved.challenge.boardApiKeyId!));
    const [retained] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect(retained.boardApiKeyId).toBeNull();
    expect(retained.approvedAt).not.toBeNull();
    expect(await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret)).toMatchObject({ status: "approved" });
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).rejects.toThrow("no longer active");
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherUserId)).rejects.toThrow("another user");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.keyHash, f.challenge.pendingKeyHash))).toHaveLength(0);
    expect((await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret)).status).toBe("approved");
  });
});
