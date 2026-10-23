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

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { Auth } from "better-auth";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authAccounts, authUsers, createDb } from "@paperclipai/db";
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

  it("creates the user and its credential account, then signs that user in", async () => {
    const signUp = await request(app)
      .post("/api/auth/sign-up/email")
      .set("origin", ORIGIN)
      .send({ email: EMAIL, password: PASSWORD, name: "Founder" });

    // A missing `account` column fails here with a 500 and an empty body.
    expect(signUp.status).toBe(200);
    expect(signUp.body?.user?.email).toBe(EMAIL);

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
      .send({ email: EMAIL, password: PASSWORD });

    expect(signIn.status).toBe(200);
    expect(signIn.body?.user?.email).toBe(EMAIL);
    expect(sessionCookies(signIn).length).toBeGreaterThan(0);
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
    // Model an existing passwordless account while retaining its real fresh session.
    await db.delete(authAccounts).where(eq(authAccounts.userId, userId));
    const headers = new Headers({ origin: ORIGIN,
      cookie: sessionCookies(created).map(value => value.split(";", 1)[0]).join("; ") });
    const nativeApi = auth.api as Auth["api"];
    await expect(nativeApi.setPassword({ headers, body: { newPassword: "passwordpassword" } }))
      .rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "PASSWORD_TOO_COMMON" } });
    expect(await db.select().from(authAccounts).where(eq(authAccounts.userId, userId))).toEqual([]);
    await expect(nativeApi.setPassword({ headers, body: { newPassword: "A longer native café passphrase 2026" } }))
      .resolves.toMatchObject({ status: true });
    const signedIn = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email, password: "A longer native café passphrase 2026" });
    expect(signedIn.status).toBe(200);
  });
});
