/**
 * End-to-end coverage for the credential sign-up and sign-in that a
 * self-hosted install depends on, driven through the real Better Auth mount
 * against the real Drizzle schema and a migrated Postgres.
 *
 * The other Better Auth suites mount either a stub handler or the in-memory
 * adapter, so neither notices when Better Auth's `account` model grows a field
 * the Drizzle table does not have. The Drizzle adapter validates the model
 * against the schema on every write and throws
 * `The field "<name>" does not exist in the "account" Drizzle schema`, which
 * the mount turns into a 500 with an empty body — a fresh install cannot
 * create its first user at all. This suite is the one that fails when that
 * happens.
 */

import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { hashPassword, makeSignature } from "better-auth/crypto";
import { APIError, type Auth } from "better-auth";
import { queueAfterTransactionHook } from "@better-auth/core/context";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountDeletionOperations, authAccounts, authRateLimits, authSessions, authUsers, createDb } from "@paperclipai/db";
import { assertHumanAuthentication } from "../auth/authenticator-assurance.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { createBetterAuthHandler, createBetterAuthInstance } from "../auth/better-auth.js";
import type { Config } from "../config.js";
import { publicOriginGuard } from "../middleware/public-origin-guard.js";

const ORIGIN = "http://127.0.0.1:41999";
const EMAIL = "founder@example.com";
const PASSWORD = "correct-horse-battery-staple";

// The issuer Better Auth stamps on an email/password account:
// `createLocalAccountIssuer("credential")`. Sign-in matches on it, so a row
// written with anything else is a row nobody can sign in as.
const CREDENTIAL_ISSUER = "local:credential";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function testConfig(): Config {
  // Only the auth-relevant fields are read by `createBetterAuthInstance`; the
  // rest of `Config` describes storage, backups, and scheduling that the Better
  // Auth instance never looks at.
  return {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    authBaseUrlMode: "explicit",
    authPublicBaseUrl: ORIGIN,
    authDisableSignUp: false,
    allowedHostnames: ["127.0.0.1"],
    port: 41999,
  } as unknown as Config;
}

function sessionCookies(response: request.Response): string[] {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.filter((cookie) => cookie.includes("session_token"));
}

describeEmbeddedPostgres("Better Auth credential sign-up against the real schema", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let app!: express.Express;
  let auth!: ReturnType<typeof createBetterAuthInstance>;
  const originalEnv = {
    secret: process.env.BETTER_AUTH_SECRET,
    rateLimit: process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED,
  };

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "better-auth-secret-for-credential-signup-tests";
    // The rate limiter is on by default in `authenticated` mode and would score
    // the sign-up and sign-in this suite issues back to back.
    process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED = "false";

    database = await startEmbeddedPostgresTestDatabase("paperclip-better-auth-signup-");
    db = createDb(database.connectionString);

    auth = createBetterAuthInstance(db, testConfig(), [ORIGIN]);
    app = express();
    // Mounted exactly as `createApp` mounts it, and with no body parser in
    // front of it: Better Auth reads the raw request body itself.
    app.all("/api/auth/{*authPath}", createBetterAuthHandler(auth));
  }, 30_000);

  afterAll(async () => {
    await database?.cleanup();
    if (originalEnv.secret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalEnv.secret;
    if (originalEnv.rateLimit === undefined) delete process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED;
    else process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED = originalEnv.rateLimit;
  });

  async function signedUpFixture() {
    const email = `reauth-${randomUUID()}@example.test`;
    const response = await request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN)
      .send({ email, password: PASSWORD, name: "Reauthentication fixture" });
    expect(response.status).toBe(200);
    const userId: string = response.body.user.id;
    const [session] = await db.select().from(authSessions).where(eq(authSessions.userId, userId));
    return { email, userId, sessionId: session.id,
      cookie: sessionCookies(response).map(cookie => cookie.split(";", 1)[0]).join("; ") };
  }

  it("creates the user and its credential account, then signs that user in", async () => {
    const signUp = await request(app)
      .post("/api/auth/sign-up/email")
      .set("origin", ORIGIN)
      .send({ email: EMAIL, password: PASSWORD, name: "Founder" });

    // A missing `account` column fails here with a 500 and an empty body.
    expect(signUp.status).toBe(200);
    expect(signUp.body?.user?.email).toBe(EMAIL);
    expect(signUp.body.user).not.toHaveProperty("authenticatorVersion");
    expect(signUp.body.user).not.toHaveProperty("phishingResistantRequired");
    const [createdUser] = await db.select().from(authUsers).where(eq(authUsers.id, signUp.body.user.id));
    const [createdSession] = await db.select().from(authSessions).where(eq(authSessions.userId, createdUser.id));
    expect(createdSession).toMatchObject({ authenticationMethod: "password", authenticatorVersion: createdUser.authenticatorVersion });
    expect(createdSession.authenticatedAt).toBeInstanceOf(Date);

    // Sign-up has to leave a usable account row behind. A half-created user —
    // a `user` row with no `account` — cannot sign in, cannot sign up again,
    // and cannot reset its password.
    const accounts = await db.select().from(authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      providerId: "credential",
      issuer: CREDENTIAL_ISSUER,
    });
    expect(accounts[0]?.password).toBeTruthy();

    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .set("origin", ORIGIN)
      .send({ email: EMAIL, password: PASSWORD, authenticatorVersion: 999,
        phishingResistantRequired: true, authenticationMethod: "passkey", authenticatedAt: "2099-01-01" });

    expect(signIn.status).toBe(200);
    expect(signIn.body?.user?.email).toBe(EMAIL);
    expect(sessionCookies(signIn).length).toBeGreaterThan(0);
    expect(signIn.body.user).not.toHaveProperty("authenticatorVersion");
    expect(signIn.body.user).not.toHaveProperty("phishingResistantRequired");
    const sessions = await db.select().from(authSessions).where(eq(authSessions.userId, createdUser.id));
    expect(sessions).toHaveLength(2);
    expect(sessions.every(session => session.authenticationMethod === "password"
      && session.authenticatorVersion === createdUser.authenticatorVersion)).toBe(true);
    const current = await request(app).get("/api/auth/get-session")
      .set("Cookie", sessionCookies(signIn).map(cookie => cookie.split(";", 1)[0]).join("; "));
    expect(current.status).toBe(200);
    expect(current.body.user.id).toBe(createdUser.id);
    for (const field of ["authenticationMethod", "authenticatedAt", "authenticatorVersion"]) {
      expect(current.body.session).not.toHaveProperty(field);
    }
    expect(current.body.user).not.toHaveProperty("authenticatorVersion");
    expect(current.body.user).not.toHaveProperty("phishingResistantRequired");
    const privateUpdate = await request(app).post("/api/auth/update-user").set("Origin", ORIGIN)
      .set("Cookie", sessionCookies(signIn).map(cookie => cookie.split(";", 1)[0]).join("; "))
      .send({ authenticatorVersion: 999, phishingResistantRequired: true });
    expect(privateUpdate.status).toBe(400);
    const [unchangedUser] = await db.select().from(authUsers).where(eq(authUsers.id, createdUser.id));
    expect(unchangedUser).toMatchObject({ authenticatorVersion: createdUser.authenticatorVersion,
      phishingResistantRequired: false });
  });

  it("keeps existing credentials usable in SaaS with secure cookies while refusing public signup", async () => {
    const origin = "https://ai.augustworks.dk";
    const config: Config = {
      ...testConfig(),
      deploymentProfile: "saas",
      deploymentExposure: "public",
      authPublicBaseUrl: origin,
      publicOriginConfig: { primaryAppOrigin: origin, allowedAppOrigins: [origin], legacyOrigins: [] },
      authDisableSignUp: true,
    };
    const auth = createBetterAuthInstance(db, config, [origin]);
    const saas = express();
    saas.set("trust proxy", "loopback");
    saas.use(publicOriginGuard([origin]));
    saas.all("/api/auth/{*authPath}", createBetterAuthHandler(auth));
    const post = (path: string) => request(saas).post(`/api/auth/${path}`)
      .set("Host", "ai.augustworks.dk").set("X-Forwarded-Proto", "https").set("Origin", origin);
    const signUp = await post("sign-up/email").send({ email: "new-saas@example.invalid", password: PASSWORD, name: "New customer" });
    expect(signUp.status).toBe(400);
    expect(signUp.body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    const signIn = await post("sign-in/email").send({ email: EMAIL, password: PASSWORD });
    expect(signIn.status).toBe(200);
    const cookies = sessionCookies(signIn);
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies[0]).toMatch(/; Secure/i);
    expect(cookies[0]).toMatch(/; HttpOnly/i);
    expect(cookies[0]).toMatch(/; SameSite=Lax/i);
    expect(cookies[0]).not.toMatch(/; Domain=/i);
    const session = await request(saas).get("/api/auth/get-session")
      .set("Host", "ai.augustworks.dk").set("X-Forwarded-Proto", "https")
      .set("Cookie", cookies.map((cookie) => cookie.split(";", 1)[0]).join("; "));
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(EMAIL);
    expect(await db.select().from(authAccounts)).toHaveLength(1);
  });

  it("rejects new local passwords below fifteen codepoints and whole blocklisted values without creating accounts", async () => {
    const emails: string[] = [];
    for (const password of ["fourteen-chars", "🚀".repeat(8), "123456789012345", "passwordpassword", "a".repeat(129)]) {
      const email = `policy-${randomUUID()}@example.test`; emails.push(email);
      const response = await request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN)
        .send({ email, password, name: "Policy fixture" });
      expect.soft(response.status).toBe(400);
      expect.soft(JSON.stringify(response.body)).not.toContain(password);
    }
    expect(await db.select({ id: authUsers.id }).from(authUsers).where(inArray(authUsers.email, emails))).toEqual([]);
  });

  it.each(["🚀".repeat(128), "  café notes from a quiet morning  ", "Pines passwordpassword by the river"])("accepts new local passwords with Unicode and spaces without trimming", async password => {
    const email = `unicode-${randomUUID()}@example.test`;
    const response = await request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN)
      .send({ email, password, name: "Unicode policy fixture" });
    expect(response.status).toBe(200);
    const signedIn = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password });
    expect(signedIn.status).toBe(200);
    expect(sessionCookies(signedIn).length).toBeGreaterThan(0);
  });

  it("keeps existing shorter credentials usable while enforcing policy on their next password change", async () => {
    const userId = randomUUID(), email = `legacy-${userId}@example.test`, password = "old-short";
    const now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Existing account", email, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: CREDENTIAL_ISSUER, providerId: "credential",
      accountId: userId, userId, password: await hashPassword(password), createdAt: now, updatedAt: now });
    const signIn = () => request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password });
    const signedIn = await signIn(); expect(signedIn.status).toBe(200);
    // Native dummy hashing must not disclose whether a legacy account exists.
    for (const target of [email, `missing-${userId}@example.test`]) {
      const denied = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
        .send({ email: target, password: "bad-short" });
      expect(denied.status).toBe(401);
      expect(denied.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    }
    const cookie = sessionCookies(signedIn).map(value => value.split(";", 1)[0]).join("; ");
    const change = (newPassword: string) => request(app).post("/api/auth/change-password").set("Origin", ORIGIN)
      .set("Cookie", cookie).send({ currentPassword: password, newPassword, revokeOtherSessions: false });
    expect((await change("passwordpassword")).status).toBe(400);
    expect((await signIn()).status).toBe(200);
    expect((await change("A quiet river in the morning 2026")).status).toBe(200);
    expect((await signIn()).status).toBe(401);
    const [account] = await db.select().from(authAccounts).where(eq(authAccounts.userId, userId));
    expect(account.password).not.toContain("A quiet river");
    const changed = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email, password: "A quiet river in the morning 2026" });
    expect(changed.status).toBe(200);
  });

  it("enforces new local password policy on the pathless internal setPassword API", async () => {
    const email = `passwordless-${randomUUID()}@example.test`, password = "Initial café passphrase for this fixture";
    const created = await request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN)
      .send({ email, password, name: "Passwordless account fixture" });
    expect(created.status).toBe(200);
    const userId = created.body.user.id;
    // Removing a credential now revokes the original native session.
    await db.delete(authAccounts).where(eq(authAccounts.userId, userId));
    const nativeApi = auth.api as Auth["api"];
    const oldHeaders = new Headers({ origin: ORIGIN,
      cookie: sessionCookies(created).map(value => value.split(";", 1)[0]).join("; ") });
    await expect(nativeApi.setPassword({ headers: oldHeaders, body: { newPassword: "A longer native café passphrase 2026" } }))
      .rejects.toMatchObject({ status: "UNAUTHORIZED" });
    // Seed a passwordless native session through the maintained provider. This
    // structural fixture tests password policy, not SSO or MFA qualification.
    const nativeContext = await (auth as unknown as Auth).$context;
    const fresh = await nativeContext.internalAdapter.createSession(userId);
    expect(fresh).toBeTruthy();
    const signature = await makeSignature(fresh!.token, nativeContext.secret);
    const headers = new Headers({ origin: ORIGIN,
      cookie: `${nativeContext.authCookies.sessionToken.name}=${encodeURIComponent(`${fresh!.token}.${signature}`)}` });
    await expect(nativeApi.setPassword({ headers, body: { newPassword: "passwordpassword" } }))
      .rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "PASSWORD_TOO_COMMON" } });
    expect(await db.select().from(authAccounts).where(eq(authAccounts.userId, userId))).toEqual([]);
    await expect(nativeApi.setPassword({ headers, body: { newPassword: "A longer native café passphrase 2026" } }))
      .resolves.toMatchObject({ status: true });
    const signedIn = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email, password: "A longer native café passphrase 2026" });
    expect(signedIn.status).toBe(200);
  });

  it("rotates an aged native session only after real password verification", async () => {
    const fixture = await signedUpFixture();
    await db.update(authSessions).set({ authenticationMethod: null, authenticatedAt: null, authenticatorVersion: null,
      createdAt: new Date(Date.now() - 2 * 86400_000) })
      .where(eq(authSessions.id, fixture.sessionId));
    const actor = { type: "board" as const, source: "session" as const,
      userId: fixture.userId, sessionId: fixture.sessionId };
    await expect(assertHumanAuthentication(db, actor, { requireRecent: true, phishingResistant: false }))
      .rejects.toMatchObject({ status: 403 });
    const confirm = (password: string) => request(app).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password });
    expect((await confirm("wrong password")).status).toBe(400);
    const [unknown] = await db.select().from(authSessions).where(eq(authSessions.id, fixture.sessionId));
    expect(unknown).toMatchObject({ authenticationMethod: null, authenticatedAt: null, authenticatorVersion: null });
    expect((await request(app).get("/api/auth/list-sessions").set("Cookie", fixture.cookie)).status).toBe(403);
    const accepted = await confirm(PASSWORD);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ status: true });
    const sessions = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).not.toBe(fixture.sessionId);
    expect(sessions[0].authenticationMethod).toBe("password");
    await expect(assertHumanAuthentication(db, actor, { requireRecent: true, phishingResistant: false }))
      .rejects.toMatchObject({ status: 403 });
    const cookie = sessionCookies(accepted).map(value => value.split(";", 1)[0]).join("; ");
    expect((await request(app).get("/api/auth/list-sessions").set("Cookie", cookie)).status).toBe(200);
    const visible = await request(app).get("/api/auth/get-session").set("Cookie", cookie);
    expect(visible.body.session).not.toHaveProperty("authenticatedAt");
    await expect(db.transaction(tx => assertHumanAuthentication(tx, { ...actor, sessionId: sessions[0].id }, {
      requireRecent: true, phishingResistant: false,
    }))).resolves.toMatchObject({ method: "password" });
    const unauthenticated = await request(app).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).send({ password: PASSWORD });
    expect(unauthenticated.status).toBe(401);
    const [clock] = await db.execute<{ fresh: boolean }>(sql`select authenticated_at<=clock_timestamp()
      and authenticated_at>=clock_timestamp()-interval '5 seconds' as fresh from "session" where id=${sessions[0].id}`);
    expect(clock.fresh).toBe(true);
  });

  it("rolls back native session writes and cookies and runs native hooks only after physical commit", async () => {
    const fixture = await signedUpFixture();
    await db.update(authSessions).set({ authenticationMethod: null, authenticatedAt: null, authenticatorVersion: null })
      .where(eq(authSessions.id, fixture.sessionId));
    const nativeContext = await (auth as unknown as Auth).$context;
    const remove = nativeContext.internalAdapter.deleteSession.bind(nativeContext.internalAdapter);
    let rollbackHookRan = false;
    const spy = vi.spyOn(nativeContext.internalAdapter, "deleteSession").mockImplementationOnce(async token => {
      await remove(token);
      await queueAfterTransactionHook(async () => { rollbackHookRan = true; });
      throw new APIError("BAD_REQUEST", { code: "FIXTURE_ROLLBACK", message: "Abort after native writes" });
    });
    const confirm = () => request(app).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password: PASSWORD });
    try {
      const rejected = await confirm();
      expect(rejected.status).toBe(400);
      expect(sessionCookies(rejected)).toEqual([]);
    } finally { spy.mockRestore(); }
    expect(rollbackHookRan).toBe(false);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId)))
      .toMatchObject([{ id: fixture.sessionId, authenticationMethod: null }]);
    const key = "password-reauth:" + createHash("sha256").update(fixture.userId).digest("hex");
    expect(await db.select().from(authRateLimits).where(eq(authRateLimits.key, key))).toMatchObject([{ count: 1 }]);
    let committed = false;
    const success = vi.spyOn(nativeContext.internalAdapter, "deleteSession").mockImplementationOnce(async token => {
      await remove(token);
      await queueAfterTransactionHook(async () => {
        // An independent connection must see the replacement, not uncommitted writes.
        const rows = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
        committed = rows.length === 1 && rows[0].id !== fixture.sessionId
          && rows[0].authenticationMethod === "password";
      });
    });
    try {
      const accepted = await confirm();
      expect(accepted.status).toBe(200);
      expect(sessionCookies(accepted)).toHaveLength(1);
      expect(committed).toBe(true);
    } finally { success.mockRestore(); }
  });

  it("commits password confirmation attempts across native instances without renewing the window", async () => {
    const fixture = await signedUpFixture();
    const second = express();
    second.all("/api/auth/{*authPath}", createBetterAuthHandler(createBetterAuthInstance(db, testConfig(), [ORIGIN])));
    const key = "password-reauth:" + createHash("sha256").update(fixture.userId).digest("hex");
    let windowStart: number | null = null;
    for (let i = 0; i < 10; i++) {
      const response = await request(i % 2 ? second : app).post("/api/auth/reauthenticate/password")
        .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password: "wrong password" });
      expect(response.status).toBe(400);
      const [budget] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
      windowStart ??= budget.lastRequest;
      expect(budget).toMatchObject({ count: i + 1, lastRequest: windowStart });
    }
    const limited = await request(second).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password: PASSWORD });
    expect(limited.status).toBe(429);
    const [budget] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(budget).toMatchObject({ count: 11, lastRequest: windowStart });
    const independent = await signedUpFixture();
    expect((await request(second).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).set("Cookie", independent.cookie).send({ password: PASSWORD })).status).toBe(200);
  });

  it("denies erased identity markers despite restored password material and stale native sessions", async () => {
    const fixture = await signedUpFixture();
    // Structural restored-state marker, not encrypted-backup qualification.
    await db.insert(accountDeletionOperations).values({ userId: fixture.userId,
      idempotencyKey: createHash("sha256").update(randomUUID()).digest("hex"),
      status: "completed", completedAt: new Date() });
    await expect(assertHumanAuthentication(db, { type: "board", source: "session",
      userId: fixture.userId, sessionId: fixture.sessionId }, { requireRecent: true, phishingResistant: false }))
      .rejects.toMatchObject({ status: 403 });
    const reauth = await request(app).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password: PASSWORD });
    expect(reauth.status).toBe(401);
    const key = "password-reauth:" + createHash("sha256").update(fixture.userId).digest("hex");
    expect(await db.select().from(authRateLimits).where(eq(authRateLimits.key, key))).toEqual([]);
    const signin = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email: fixture.email, password: PASSWORD });
    expect(signin.status).toBe(401);
    expect(signin.body.code).toBe("AUTHENTICATION_STATE_CHANGED");
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId)))
      .toHaveLength(1); // Only the structural stale session; no new login survives.
  });

  it("rejects a password login whose credential changes after native verification", async () => {
    const fixture = await signedUpFixture();
    const replacement = "A different native password after rotation 2026";
    const replacementHash = await hashPassword(replacement);
    const nativeContext = await (auth as unknown as Auth).$context;
    const verify = nativeContext.password.verify;
    let interleaved = false;
    // Keep the maintained verifier and real PostgreSQL writes. Interleave a
    // committed rotation after verification but before native session creation.
    const spy = vi.spyOn(nativeContext.password, "verify").mockImplementationOnce(async input => {
      const verified = await verify(input);
      expect(verified).toBe(true);
      await db.update(authAccounts).set({ password: replacementHash }).where(eq(authAccounts.userId, fixture.userId));
      interleaved = true;
      return verified;
    });
    try {
      const response = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
        .send({ email: fixture.email, password: PASSWORD });
      expect(interleaved).toBe(true);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTHENTICATION_STATE_CHANGED");
    } finally { spy.mockRestore(); }
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toEqual([]);
    const old = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email: fixture.email, password: PASSWORD });
    expect(old.status).toBe(401);
    const current = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email: fixture.email, password: replacement });
    expect(current.status).toBe(200);
    const [user] = await db.select().from(authUsers).where(eq(authUsers.id, fixture.userId));
    const [session] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(session).toMatchObject({ authenticationMethod: "password", authenticatorVersion: user.authenticatorVersion });
  });

  it("does not reserve confirmation attempts past a held native user lock", async () => {
    const fixture = await signedUpFixture();
    const key = "password-reauth:" + createHash("sha256").update(fixture.userId).digest("hex");
    await db.transaction(async tx => {
      await tx.select().from(authUsers).where(eq(authUsers.id, fixture.userId)).for("update");
      const response = await request(app).post("/api/auth/reauthenticate/password")
        .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password: PASSWORD });
      expect.soft(response.status).toBe(409);
      expect.soft(await db.select().from(authRateLimits).where(eq(authRateLimits.key, key))).toEqual([]);
    });
    const retried = await request(app).post("/api/auth/reauthenticate/password")
      .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ password: PASSWORD });
    expect(retried.status).toBe(200);
    const [budget] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(budget.count).toBe(1);
  });
});
