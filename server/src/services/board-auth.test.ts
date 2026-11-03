import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { activityLog, authAccounts, authSecurityEvents, authSessions, authUsers, boardApiKeys, cliAuthChallenges, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, instanceUserRoles, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { subscribeCompanyLiveEvents } from "./live-events.js";
import type { Db } from "@paperclipai/db";
import { boardAuthService } from "./board-auth.js";
import { pruneExpiredAuthSecurityEvents } from "./saas/auth-delivery.js";
import { seedNativePasskeySession } from "../__tests__/helpers/native-authentication-fixtures.js";

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
  const importHttp = () => Promise.all([import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../middleware/error-handler.js")]);
  let http: Awaited<ReturnType<typeof importHttp>>;
  beforeAll(async () => {
    http = await importHttp();
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
    const userActor = { type: "board" as const, source: "session" as const, userId, sessionId: await seedNativePasskeySession(db, userId) };
    const otherActor = { type: "board" as const, source: "session" as const, userId: otherUserId, sessionId: await seedNativePasskeySession(db, otherUserId) };
    const service = boardAuthService(db);
    const created = await service.createCliAuthChallenge({ command: "paperclipai auth login", requestedAccess: "board", requestedCompanyId: companyId });
    return { companyId, userId, otherUserId, userActor, otherActor, service, ...created };
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

  async function waitForReplayKeyLock(blockingPid: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await db.execute<{ waiting: boolean }>(sql`
        select exists(select 1 from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
          and ${blockingPid} = any(pg_blocking_pids(pid))
          and query ilike '%board_api_keys%') as waiting
      `);
      if (rows[0]?.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("CLI replay did not block on the held Board key transaction");
  }

  it("keeps pending tokens unusable and stores only independent secret digests", async () => {
    const f = await fixture();
    expect(f.challenge.secretHash).not.toBe(f.challenge.pendingKeyHash);
    expect(f.challenge.secretHash).not.toContain(f.challengeSecret);
    expect(f.challenge.pendingKeyHash).not.toContain(f.pendingBoardToken);
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    expect(await f.service.getCliAuthChallengeBySecret(f.challenge.id, "wrong-secret")).toBeNull();
    await db.update(cliAuthChallenges).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).status).toBe("expired");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
  });

  it.each(["dated", "unlimited"] as const)("binds the %s credential label and lifetime to the reviewed challenge", async kind => {
    const f = await fixture();
    const keyExpiresAt = kind === "dated" ? new Date(Date.now() + 86_400_000) : null;
    const request = await f.service.createCliAuthChallenge({ command: "paperclipai token board create",
      requestedAccess: "board", requestedCompanyId: f.companyId, keyName: "Reviewed developer key", keyExpiresAt });
    const described = await f.service.describeCliAuthChallenge(request.challenge.id, request.challengeSecret, { viewerUserId: f.userId });
    expect(described).toMatchObject({ keyName: "Reviewed developer key", keyExpiresAt: keyExpiresAt?.toISOString() ?? null });
    const approved = await f.service.approveCliAuthChallenge(request.challenge.id, request.challengeSecret, f.userActor);
    const [key] = await db.select().from(boardApiKeys).where(eq(boardApiKeys.id, approved.challenge.boardApiKeyId!));
    expect(key).toMatchObject({ name: "Reviewed developer key", expiresAt: keyExpiresAt });
    expect(await f.service.findBoardApiKeyByToken(request.pendingBoardToken)).toMatchObject({ id: key.id, userId: f.userId });
  });

  it("refuses an expired requested lifetime without creating a key or an approval", async () => {
    const f = await fixture();
    await expect(f.service.createCliAuthChallenge({ command: "paperclipai token board create", requestedAccess: "board",
      keyExpiresAt: new Date(Date.now() - 1) })).rejects.toMatchObject({ status: 400 });
    await db.update(cliAuthChallenges).set({ pendingKeyExpiresAt: new Date(Date.now() - 1) })
      .where(eq(cliAuthChallenges.id, f.challenge.id));
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor))
      .rejects.toMatchObject({ status: 409 });
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    expect((await f.service.getCliAuthChallengeBySecret(f.challenge.id, f.challengeSecret))?.approvedAt).toBeNull();
  });

  it("requires a current recent human proof before creating or approving a Board key", async () => {
    const f = await fixture();
    const service = f.service;
    const missingSession = { ...f.userActor, sessionId: undefined };
    const boardKeyActor = { ...f.userActor, source: "board_key" as const, sessionId: undefined };
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301_000) })
      .where(eq(authSessions.id, f.userActor.sessionId!));
    const staleActor = f.userActor;

    await expect(service.createNamedBoardApiKey({ actor: missingSession, name: "missing" })).rejects.toMatchObject({ status: 403 });
    await expect(service.createNamedBoardApiKey({ actor: boardKeyActor, name: "board-key" })).rejects.toMatchObject({ status: 403 });
    await expect(service.createNamedBoardApiKey({ actor: staleActor, name: "stale" })).rejects.toMatchObject({ status: 403 });
    await expect(service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, missingSession)).rejects.toMatchObject({ status: 403 });
    await expect(service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, staleActor)).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(0);
    expect(await service.getCliAuthChallengeBySecret(f.challenge.id, f.challengeSecret)).toMatchObject({ approvedAt: null, boardApiKeyId: null });
  });

  it("requires verified email and a recent passkey for configured operators", async () => {
    const f = await fixture();
    const service = boardAuthService(db, { operatorUserIds: [f.userId] });
    await expect(service.createNamedBoardApiKey({ actor: f.userActor, name: "unverified" }))
      .rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, f.userId));
    const key = await service.createNamedBoardApiKey({ actor: f.userActor, name: "verified passkey" });
    expect(await service.findBoardApiKeyByToken(key.token)).toMatchObject({ userId: f.userId });
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301_000) })
      .where(eq(authSessions.id, f.userActor.sessionId!));
    await expect(service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor))
      .rejects.toMatchObject({ status: 403 });
    expect((await service.getCliAuthChallengeBySecret(f.challenge.id, f.challengeSecret))?.approvedAt).toBeNull();
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(1);
  });

  it("keeps local implicit authority behind its explicit local-trusted service option", async () => {
    const f = await fixture();
    const now = new Date();
    await db.insert(authUsers).values({ id: "local-board", name: "Local Board", email: "local-board@example.invalid", createdAt: now, updatedAt: now });
    await db.insert(instanceUserRoles).values({ userId: "local-board", role: "instance_admin" });
    const localActor = { type: "board" as const, source: "local_implicit" as const, userId: "local-board" };
    const legacyLocalActor = { type: "board" as const, source: "local_implicit" as const };
    await expect(boardAuthService(db).createNamedBoardApiKey({ actor: localActor, name: "disabled-local" })).rejects.toMatchObject({ status: 403 });
    const key = await boardAuthService(db, { allowLocalImplicit: true }).createNamedBoardApiKey({ actor: legacyLocalActor, name: "local key" });
    expect(await boardAuthService(db).findBoardApiKeyByToken(key.token)).toMatchObject({ userId: "local-board" });
    await expect(boardAuthService(db, { allowLocalImplicit: true, operatorUserIds: ["local-board"] })
      .createNamedBoardApiKey({ actor: localActor, name: "configured local operator" })).rejects.toMatchObject({ status: 403 });
  });

  it("accepts an actual current password-proof session for ordinary human key creation", async () => {
    const f = await fixture();
    const now = new Date();
    await db.insert(authAccounts).values({
      id: randomUUID(), issuer: "local:credential", accountId: f.userId,
      providerId: "credential", userId: f.userId,
      password: "structural-native-password-proof", createdAt: now, updatedAt: now,
    });
    const [user] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, f.userId));
    const sessionId = randomUUID();
    await db.insert(authSessions).values({
      id: sessionId, userId: f.userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000), authenticationMethod: "password",
      authenticatedAt: now, authenticatorVersion: user!.version,
    });
    const passwordActor = { ...f.userActor, sessionId };
    const key = await f.service.createNamedBoardApiKey({ actor: passwordActor, name: "password-confirmed" });
    expect(await f.service.findBoardApiKeyByToken(key.token)).toMatchObject({ userId: f.userId });
  });

  it("rejects password-only proof when the user's second factor is enabled", async () => {
    const f = await fixture();
    const now = new Date();
    await db.insert(authAccounts).values({
      id: randomUUID(), issuer: "local:credential", accountId: f.userId,
      providerId: "credential", userId: f.userId,
      password: "structural-native-password-proof", createdAt: now, updatedAt: now,
    });
    await db.update(authUsers).set({ twoFactorEnabled: true }).where(eq(authUsers.id, f.userId));
    const [user] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, f.userId));
    const sessionId = randomUUID();
    await db.insert(authSessions).values({
      id: sessionId, userId: f.userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000), authenticationMethod: "password",
      authenticatedAt: now, authenticatorVersion: user!.version,
    });
    await expect(f.service.createNamedBoardApiKey({ actor: { ...f.userActor, sessionId }, name: "password-only" }))
      .rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(0);
  });

  it("retains the first key owner and approver on same-user and competing-user replay", async () => {
    const f = await fixture();
    const first = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherActor)).rejects.toThrow("another user");
    const repeat = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
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
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherActor)).rejects.toThrow("requested organization");
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
    const approval = f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
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

  it.each(["membership", "instance_admin"] as const)("rechecks %s authority after an approved replay waits for the real key lock", async authority => {
    const f = await fixture();
    if (authority === "instance_admin") {
      await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
      await db.update(cliAuthChallenges).set({ requestedAccess: "instance_admin_required" }).where(eq(cliAuthChallenges.id, f.challenge.id));
    }
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
    const keyId = approved.challenge.boardApiKeyId!;
    let release!: () => void, locked!: (pid: number) => void;
    const held = new Promise<number>(resolve => { locked = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`select id from board_api_keys where id = ${keyId} for update`);
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked(backend.pid); await unlock;
    });
    const blockingPid = await held;
    const replay = f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)
      .then(value => ({ value }), error => ({ error }));
    try {
      await waitForReplayKeyLock(blockingPid);
      if (authority === "membership") {
        await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
      } else {
        await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
      }
    } finally { release(); await holder; }
    const result = await replay;
    expect(result).toHaveProperty("error");
    expect("error" in result ? result.error : null).toMatchObject({ status: 403 });
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(1);
    const receipts = await db.select().from(authSecurityEvents).where(eq(authSecurityEvents.userId, f.userId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ action: "board_api_key_created", boardApiKeyId: keyId });
    expect(await f.service.getCliAuthChallengeBySecret(f.challenge.id, f.challengeSecret)).toEqual(approved.challenge);
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
    const approval = boardAuthService(gated).approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
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
    const approval = service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
    try {
      await ready;
      expect(events).toEqual([]);
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
      release(); await approval;
      expect(events).toEqual([f.userId]);
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
      await service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
      expect(events).toEqual([f.userId]);
    } finally { release(); await approval; unsubscribe(); }
  });

  it("never grants a key after cancellation and keeps duplicate cancellation stable", async () => {
    const f = await fixture();
    const first = await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret);
    expect((await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret)).challenge).toEqual(first.challenge);
    expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).status).toBe("cancelled");
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
    await expect(f.service.approveCliAuthChallenge(created.challenge.id, created.challengeSecret, f.otherActor)).rejects.toThrow("Instance admin required");
    const approved = await f.service.approveCliAuthChallenge(created.challenge.id, created.challengeSecret, f.userActor);
    expect(approved.status).toBe("approved");
    expect(await f.service.findBoardApiKeyByToken(created.pendingBoardToken)).toMatchObject({ userId: f.userId });
    expect((await f.service.resolveBoardAccess(f.userId)).isInstanceAdmin).toBe(true);
  });


  it("rechecks current membership and key authority on same-owner replay", async () => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).rejects.toThrow("requested organization");
    await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.principalId, f.userId));
    await f.service.revokeBoardApiKey(approved.challenge.boardApiKeyId!, { userId: f.userId, revokedVia: "cli_auth_logout" });
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).rejects.toThrow("no longer active");
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.keyHash, f.challenge.pendingKeyHash))).toHaveLength(1);
  });

  it("rolls back first approval if its durable audit cannot be stored", async () => {
    const f = await fixture();
    await db.execute(sql.raw(`alter table activity_log add constraint board_cli_approval_failure check (action != 'board_api_key.created' or company_id != '${f.companyId}')`));
    try {
      await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).rejects.toThrow();
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
      const [pending] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
      expect(pending.approvedAt).toBeNull();
      expect(pending.boardApiKeyId).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint board_cli_approval_failure`);
    }
    await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
  });

  it("preserves committed approval when notification fails without publishing it again", async () => {
    const f = await fixture();
    const unsubscribe = subscribeCompanyLiveEvents(f.companyId, event => {
      if (event.payload.action === "board_api_key.created") throw new Error("Injected publication failure");
    });
    try {
      const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
      expect(approved.status).toBe("approved");
      expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).challenge).toEqual(approved.challenge);
      expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toMatchObject({ userId: f.userId });
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it("keeps owner-bound revocation atomic after membership loss and concurrent retries", async () => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
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
      ? { session: { id: req.header("X-Test-Session") === f.userId ? f.userActor.sessionId : f.otherActor.sessionId }, user: { id: req.header("X-Test-Session"), name: "CLI approver", email: "synthetic-session@example.invalid" } } as any
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
    for (const [header, value] of [["X-Blentera-Expected-User", f.otherUserId], ["X-Blentera-Expected-Session", f.otherActor.sessionId]]) {
      const refused = await request(app).post(`/api/cli-auth/challenges/${id}/approve`)
        .set("X-Test-Session", f.userId).set(header!, value!).send({ token });
      expect(refused.status).toBe(409);
      expect(await f.service.findBoardApiKeyByToken(boardApiToken)).toBeNull();
      expect((await f.service.getCliAuthChallengeBySecret(id, token))?.approvedAt).toBeNull();
    }
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
      await expect(f.service.createNamedBoardApiKey({ actor: f.userActor, name: "Manual developer key", requestedCompanyId: f.companyId })).rejects.toThrow();
      expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table activity_log drop constraint board_cli_manual_key_failure`);
    }
    const key = await f.service.createNamedBoardApiKey({ actor: f.userActor, name: "Manual developer key", requestedCompanyId: f.companyId });
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

  it("retains an atomic global receipt for own-key revocation without any company authority or history", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(eq(companyMemberships.principalId, f.userId));
    const key = await f.service.createNamedBoardApiKey({ actor: f.userActor, name: "private-name-canary" });
    const events = () => db.select().from(authSecurityEvents).where(eq(authSecurityEvents.userId, f.userId));
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
    const created = await events();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ action: "board_api_key_created", boardApiKeyId: key.id, userId: f.userId, companyId: null });
    expect(created[0].expiresAt.getTime() - created[0].createdAt.getTime()).toBe(90 * 86_400_000);
    expect(JSON.stringify(created)).not.toContain(key.token);
    expect(JSON.stringify(created)).not.toContain("private-name-canary");
    expect(await f.service.revokeBoardApiKey(key.id, { userId: f.otherUserId, revokedVia: "cli_auth_logout" })).toBeNull();
    await db.execute(sql.raw(`alter table auth_security_events add constraint board_global_revoke_failure check (user_id != '${f.userId}' or action != 'board_api_key_revoked')`));
    try {
      await expect(f.service.revokeBoardApiKey(key.id, { userId: f.userId, revokedVia: "cli_auth_logout" })).rejects.toThrow();
      expect(await f.service.findBoardApiKeyByToken(key.token)).not.toBeNull();
      expect(await events()).toHaveLength(1);
    } finally { await db.execute(sql`alter table auth_security_events drop constraint board_global_revoke_failure`); }
    const retries = await Promise.all([0, 1].map(() => f.service.revokeBoardApiKey(key.id, { userId: f.userId, revokedVia: "cli_auth_logout" })));
    expect(retries.filter(Boolean)).toHaveLength(1);
    expect(await f.service.findBoardApiKeyByToken(key.token)).toBeNull();
    const retained = await events();
    expect(retained.map(row => row.action).sort()).toEqual(["board_api_key_created", "board_api_key_revoked"]);
    expect(retained.every(row => row.boardApiKeyId === key.id && row.companyId === null)).toBe(true);
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
    await db.delete(authUsers).where(eq(authUsers.id, f.userId));
    expect(await events()).toEqual(retained);
  });

  it("rolls back zero-company key creation and consent when global auditing fails and records only the first approval", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(eq(companyMemberships.principalId, f.userId));
    const pending = await f.service.createCliAuthChallenge({ command: "paperclipai", requestedAccess: "board" });
    await db.execute(sql.raw(`alter table auth_security_events add constraint board_global_create_failure check (user_id != '${f.userId}' or action != 'board_api_key_created')`));
    try {
      await expect(f.service.createNamedBoardApiKey({ actor: f.userActor, name: "rolled-back" })).rejects.toThrow();
      await expect(f.service.approveCliAuthChallenge(pending.challenge.id, pending.challengeSecret, f.userActor)).rejects.toThrow();
      expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.userId))).toHaveLength(0);
      expect(await db.select().from(authSecurityEvents).where(eq(authSecurityEvents.userId, f.userId))).toHaveLength(0);
      expect(await f.service.getCliAuthChallengeBySecret(pending.challenge.id, pending.challengeSecret)).toMatchObject({ approvedAt: null, boardApiKeyId: null });
    } finally { await db.execute(sql`alter table auth_security_events drop constraint board_global_create_failure`); }
    const approved = await f.service.approveCliAuthChallenge(pending.challenge.id, pending.challengeSecret, f.userActor);
    expect(await f.service.approveCliAuthChallenge(pending.challenge.id, pending.challengeSecret, f.userActor)).toMatchObject({ created: false });
    const receipts = await db.select().from(authSecurityEvents).where(eq(authSecurityEvents.userId, f.userId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ action: "board_api_key_created", boardApiKeyId: approved.challenge.boardApiKeyId, companyId: null });
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
  });

  it("bounds native auth-event retention and preserves existing auth actions and the strict expiry boundary", async () => {
    const userId = randomUUID(), now = new Date();
    const oldActions = ["verification_requested", "email_verified", "password_reset_requested", "password_reset_completed", "sessions_revoked", "invite_accepted"];
    await db.insert(authSecurityEvents).values(Array.from({ length: 1003 }, (_, i) => ({
      userId, action: oldActions[i % oldActions.length], expiresAt: new Date(now.getTime() - 1),
    })));
    await db.insert(authSecurityEvents).values([
      { userId, action: "sessions_revoked", expiresAt: now },
      { userId, action: "board_api_key_revoked", boardApiKeyId: randomUUID(), expiresAt: new Date(now.getTime() + 1000) },
    ]);
    await expect(db.insert(authSecurityEvents).values({ userId, action: "board_api_key_created", expiresAt: now })).rejects.toThrow();
    await expect(db.insert(authSecurityEvents).values({ userId, action: "sessions_revoked", boardApiKeyId: randomUUID(), expiresAt: now })).rejects.toThrow();
    expect(await pruneExpiredAuthSecurityEvents(db, now)).toHaveLength(1000);
    expect(await pruneExpiredAuthSecurityEvents(db, now)).toHaveLength(3);
    expect(await pruneExpiredAuthSecurityEvents(db, now)).toHaveLength(0);
    const retained = await db.select().from(authSecurityEvents).where(eq(authSecurityEvents.userId, userId));
    expect(retained).toHaveLength(2);
    expect(retained.every(row => row.expiresAt >= now)).toBe(true);
  });

  it("keeps consent terminal after physical key deletion and never reassigns its pending token", async () => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor);
    await db.delete(boardApiKeys).where(eq(boardApiKeys.id, approved.challenge.boardApiKeyId!));
    const [retained] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect(retained.boardApiKeyId).toBeNull();
    expect(retained.approvedAt).not.toBeNull();
    expect(await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret)).toMatchObject({ status: "approved" });
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userActor)).rejects.toThrow("no longer active");
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherActor)).rejects.toThrow("another user");
    expect(await f.service.findBoardApiKeyByToken(f.pendingBoardToken)).toBeNull();
    expect(await db.select().from(boardApiKeys).where(eq(boardApiKeys.keyHash, f.challenge.pendingKeyHash))).toHaveLength(0);
    expect((await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret)).status).toBe("approved");
  });
});
