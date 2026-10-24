import { inspect } from "node:util";
import { createHash, createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { hashPassword, makeSignature, symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { APIError, type Auth } from "better-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authAccounts, authRateLimits, authSessions, authTwoFactors, authUsers, authVerifications,
  createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { createBetterAuthHandler, createBetterAuthInstance } from "../auth/better-auth.js";
import { accountDeletionService } from "../services/saas/account-deletion.js";
import { logger } from "../middleware/logger.js";
import { assertHumanAuthentication } from "../auth/authenticator-assurance.js";
import type { Config } from "../config.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const ORIGIN = "http://localhost:41999", PASSWORD = "A native factor fixture password 2026";
function cookies(previous: string, response: request.Response) {
  const jar = new Map(previous.split(";").filter(Boolean).map(part => {
    const index = part.indexOf("="); return [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
  const raw = response.headers["set-cookie"];
  for (const part of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const pair = part.split(";", 1)[0], index = pair.indexOf("="), name = pair.slice(0, index);
    if (/;\s*Max-Age=0(?:;|$)/i.test(part) || !pair.slice(index + 1)) jar.delete(name);
    else jar.set(name, pair.slice(index + 1));
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

describe("maintained native TOTP and recovery lifecycle", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let auth: ReturnType<typeof createBetterAuthInstance>, app: express.Express, config: Config;
  const originalSecret = process.env.BETTER_AUTH_SECRET, originalRate = process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED;
  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "native-two-factor-integration-fixture-secret";
    process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED = "false";
    database = await startEmbeddedPostgresTestDatabase("native-two-factor-lifecycle-");
    db = createDb(database.connectionString);
    config = { deploymentMode: "authenticated", deploymentExposure: "private",
      authBaseUrlMode: "explicit", authPublicBaseUrl: ORIGIN, authDisableSignUp: false,
      allowedHostnames: ["127.0.0.1"], port: 41999 } as Config;
    auth = createBetterAuthInstance(db, config, [ORIGIN]);
    app = express(); app.all("/api/auth/{*authPath}", createBetterAuthHandler(auth));
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await database?.cleanup();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalRate === undefined) delete process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED; else process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED = originalRate;
  });
  const post = (path: string, cookie = "") => request(app).post(`/api/auth/${path}`).set("Origin", ORIGIN).set("Cookie", cookie);
  async function signup() {
    const email = `factor-${randomUUID()}@example.test`;
    const response = await post("sign-up/email").send({ email, password: PASSWORD, name: "Native factor fixture" });
    expect(response.status).toBe(200);
    return { email, userId: response.body.user.id as string, cookie: cookies("", response) };
  }
  const usedSteps = new Map<string, number>();
  async function code(userId: string) {
    const [factor] = await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, userId));
    const context = await (auth as unknown as Auth).$context;
    const secret = await symmetricDecrypt({ key: context.secretConfig, data: factor.secret });
    const step = Math.floor(Date.now()/30_000);
    const previous = usedSteps.get(userId);
    const next = previous === undefined ? step : Math.max(step, previous+1);
    usedSteps.set(userId, next);
    // Retain the real native generator; its documented adjacent step supplies
    // a distinct valid code without changing clocks or mocking verification.
    return createOTP(secret).hotp(next);
  }
  async function enrolled() {
    const fixture = await signup();
    const enabled = await post("two-factor/enable", fixture.cookie).send({ password: PASSWORD, issuer: "Untrusted issuer" });
    expect(enabled.status).toBe(200);
    expect(new URL(enabled.body.totpURI).pathname).toContain("Blentera");
    expect(enabled.body.backupCodes).toHaveLength(10);
    fixture.cookie = cookies(fixture.cookie, enabled);
    const firstCode = await code(fixture.userId);
    const completed = await post("two-factor/verify-totp", fixture.cookie).send({ code: firstCode });
    expect(completed.status).toBe(200);
    expect(completed.body.user.twoFactorEnabled).toBe(true);
    expect(completed.body.user).not.toHaveProperty("authenticatorVersion");
    fixture.cookie = cookies(fixture.cookie, completed);
    return { ...fixture, firstCode, backupCodes: enabled.body.backupCodes as string[] };
  }

  it("verifies real TOTP and one-use recovery codes while fencing native password challenges", async () => {
    const fixture = await enrolled();
    const [factor] = await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId));
    expect(factor.verified).toBe(true);
    const [user] = await db.select().from(authUsers).where(eq(authUsers.id, fixture.userId));
    const [session] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(session).toMatchObject({ authenticationMethod: "totp", authenticatorVersion: user.authenticatorVersion });
    const actor = { type: "board" as const, source: "session" as const, userId: fixture.userId, sessionId: session.id };
    await expect(assertHumanAuthentication(db, actor, { requireRecent: true, phishingResistant: false }))
      .resolves.toMatchObject({ method: "totp" });
    const replace = await post("two-factor/enable", fixture.cookie).send({ password: PASSWORD });
    expect(replace.status).toBe(409);
    expect((await db.select().from(authTwoFactors).where(eq(authTwoFactors.id, factor.id)))[0].secret).toBe(factor.secret);
    const signin = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
    expect(signin.status).toBe(200);
    expect(signin.body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    const challenge = cookies("", signin);
    const [nonce] = await db.select().from(authVerifications).where(sql`value=${fixture.userId} and identifier like '2fa-%'`);
    expect(nonce.authenticatorVersion).toBe(user.authenticatorVersion);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toHaveLength(1);
    expect((await post("two-factor/verify-totp", challenge).send({ code: "invalid" })).status).toBe(401);
    expect((await db.select().from(authTwoFactors).where(eq(authTwoFactors.id, factor.id)))[0].failedVerificationCount).toBe(1);
    const complete = await post("two-factor/verify-totp", challenge).send({ code: await code(fixture.userId) });
    expect(complete.status).toBe(200);
    expect(cookies("", complete)).toContain("session_token");
    expect((await post("two-factor/verify-totp", challenge).send({ code: fixture.firstCode })).status).toBe(401);
    const recoverySignin = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
    const recovered = await post("two-factor/verify-backup-code", cookies("", recoverySignin))
      .send({ code: fixture.backupCodes[0] });
    expect(recovered.status).toBe(200);
    const sessions = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ authenticationMethod: "backup_code", authenticatorVersion: user.authenticatorVersion + 1 });
    await expect(assertHumanAuthentication(db, actor, { requireRecent: false, phishingResistant: false }))
      .rejects.toMatchObject({ status: 403 });
    const replaySignin = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
    expect((await post("two-factor/verify-backup-code", cookies("", replaySignin))
      .send({ code: fixture.backupCodes[0] })).status).toBe(401);
    const key = "factor-reauth:" + createHash("sha256").update(fixture.userId).digest("hex");
    expect((await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)))[0].count).toBe(5);
  }, 60_000);

  it("keeps configuration behind recent factor proof and preserves its real time across recovery-code rotation", async () => {
    const fixture = await enrolled();
    const [before] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    const [factor] = await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId));
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now()-600_000) }).where(eq(authSessions.id, before.id));
    expect((await post("two-factor/generate-backup-codes", fixture.cookie).send({ password: PASSWORD })).status).toBe(403);
    expect((await post("two-factor/get-totp-uri", fixture.cookie).send({ password: PASSWORD })).status).toBe(403);
    expect((await db.select().from(authTwoFactors).where(eq(authTwoFactors.id, factor.id)))[0].backupCodes).toBe(factor.backupCodes);
    const confirmed = await post("two-factor/verify-totp", fixture.cookie).send({ code: await code(fixture.userId) });
    expect(confirmed.status).toBe(200);
    fixture.cookie = cookies(fixture.cookie, confirmed);
    const [proof] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    const rotated = await post("two-factor/generate-backup-codes", fixture.cookie).send({ password: PASSWORD });
    expect(rotated.status).toBe(200); expect(rotated.body.backupCodes).toHaveLength(10);
    fixture.cookie = cookies(fixture.cookie, rotated);
    const [replacement] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(replacement.id).not.toBe(proof.id);
    expect(replacement).toMatchObject({ authenticationMethod: "totp", authenticatedAt: proof.authenticatedAt,
      authenticatorVersion: proof.authenticatorVersion!+1 });
    const disabled = await post("two-factor/disable", fixture.cookie).send({ password: PASSWORD });
    expect(disabled.status).toBe(200);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toEqual([]);
    expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId))).toEqual([]);
    expect((await db.select().from(authUsers).where(eq(authUsers.id, fixture.userId)))[0].twoFactorEnabled).toBe(false);
    expect((await post("sign-in/email").send({ email: fixture.email, password: PASSWORD })).status).toBe(200);
  }, 60_000);

  it("commits the in-session verification budget across native instances without extending its window", async () => {
    const fixture = await enrolled(), second = express();
    second.all("/api/auth/{*authPath}", createBetterAuthHandler(createBetterAuthInstance(db, config, [ORIGIN])));
    const key = "factor-reauth:" + createHash("sha256").update(fixture.userId).digest("hex");
    const [initial] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(initial.count).toBe(1);
    for (let i=0;i<9;i++) {
      const wrong = await request(i%2 ? second : app).post("/api/auth/two-factor/verify-totp")
        .set("Origin", ORIGIN).set("Cookie", fixture.cookie).send({ code: "invalid" });
      expect(wrong.status).toBe(401);
    }
    const limited = await post("two-factor/verify-totp", fixture.cookie).send({ code: await code(fixture.userId) });
    expect(limited.status).toBe(429);
    expect((await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)))[0])
      .toMatchObject({ count: 11, lastRequest: initial.lastRequest });
  }, 60_000);

  it("refuses trusted-device and session-skipping shortcuts while consuming the real native challenge", async () => {
    const fixture = await enrolled(), context = await (auth as unknown as Auth).$context;
    for (const path of ["two-factor/send-otp", "two-factor/verify-otp", "totp/generate"]) {
      expect((await post(path, fixture.cookie).send({ code: "fixture", secret: "fixture" })).status).toBe(404);
    }
    const identifier = `trust-device-${randomUUID()}`, now = new Date();
    await db.insert(authVerifications).values({ id: randomUUID(), identifier, value: fixture.userId,
      createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime()+86400_000) });
    const token = createHmac("sha256", context.secret).update(`${fixture.userId}!${identifier}`).digest("base64url");
    const value = `${token}!${identifier}`, signature = await makeSignature(value, context.secret);
    const trust = `${context.createAuthCookie("trust_device").name}=${encodeURIComponent(`${value}.${signature}`)}`;
    const signin = await post("sign-in/email", trust).send({ email: fixture.email, password: PASSWORD });
    expect(signin.body.twoFactorRedirect).toBe(true);
    const challenge = cookies("", signin);
    expect((await post("two-factor/verify-totp", challenge).send({ code: await code(fixture.userId), trustDevice: true })).status).toBe(400);
    expect((await post("two-factor/verify-backup-code", challenge).send({ code: fixture.backupCodes[0], disableSession: true })).status).toBe(400);
    const complete = await post("two-factor/verify-backup-code", challenge).send({ code: fixture.backupCodes[0] });
    expect(complete.status).toBe(200);
    expect(await db.select().from(authVerifications).where(sql`value=${fixture.userId} and identifier like '2fa-%'`)).toEqual([]);
  }, 60_000);

  it("requires recent actual MFA for password changes and preserves its earlier authentication event", async () => {
    const fixture = await enrolled(), replacementPassword = "A replacement password after recent MFA 2026";
    const [credential] = await db.select().from(authAccounts).where(eq(authAccounts.userId, fixture.userId));
    const [old] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now()-600_000) }).where(eq(authSessions.id, old.id));
    const change = () => post("change-password", fixture.cookie).send({ currentPassword: PASSWORD,
      newPassword: replacementPassword, revokeOtherSessions: false });
    expect((await change()).status).toBe(403);
    expect((await db.select().from(authAccounts).where(eq(authAccounts.id, credential.id)))[0].password).toBe(credential.password);
    const confirmationCode = await code(fixture.userId);
    const confirmed = await post("two-factor/verify-totp", fixture.cookie).send({ code: confirmationCode });
    expect(confirmed.status).toBe(200); fixture.cookie = cookies(fixture.cookie, confirmed);
    const [proof] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    const changed = await change(); expect(changed.status).toBe(200);
    const [session] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(session).toMatchObject({ authenticationMethod: "totp", authenticatedAt: proof.authenticatedAt,
      authenticatorVersion: proof.authenticatorVersion!+1 });
    expect(session.id).not.toBe(proof.id);
    expect((await post("sign-in/email").send({ email: fixture.email, password: PASSWORD })).status).toBe(401);
    const challenge = await post("sign-in/email").send({ email: fixture.email, password: replacementPassword });
    expect(challenge.body.twoFactorRedirect).toBe(true);
    const replay = await post("two-factor/verify-totp", cookies("", challenge)).send({ code: confirmationCode });
    expect(replay.status).toBe(401); expect(replay.body.code).toBe("OTP_ALREADY_USED");
  }, 60_000);

  it("requires a current recent factor session for irreversible account exit", async () => {
    const fixture = await enrolled();
    // Mail delivery/verification is qualified separately. This fixture starts
    // from the real native MFA session and the existing verified-account gate.
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, fixture.userId));
    const service = accountDeletionService(db, { removeSecret: async () => {}, cancelRun: async () => {} });
    const input = { confirmation: "DELETE MY ACCOUNT", password: PASSWORD,
      acknowledgeExport: true, idempotencyKey: randomUUID() };
    await expect(service.request(fixture.userId, input)).rejects.toMatchObject({ status: 401 });
    const [old] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    const actor = { type: "board" as const, source: "session" as const, userId: fixture.userId, sessionId: old.id };
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now()-600_000) }).where(eq(authSessions.id, old.id));
    await expect(service.request(fixture.userId, input, new Date(), actor)).rejects.toMatchObject({ status: 403 });
    const confirmed = await post("two-factor/verify-totp", fixture.cookie).send({ code: await code(fixture.userId) });
    expect(confirmed.status).toBe(200);
    const [current] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    await expect(service.request(fixture.userId, input, new Date(), { ...actor, sessionId: current.id }))
      .resolves.toMatchObject({ status: "requested" });
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toEqual([]);
    expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId))).toEqual([]);
  }, 60_000);

  it("refuses a verified TOTP value reused with another real password challenge", async () => {
    const fixture = await enrolled();
    const signin = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
    expect(signin.body.twoFactorRedirect).toBe(true);
    const replay = await post("two-factor/verify-totp", cookies("", signin)).send({ code: fixture.firstCode });
    expect.soft(replay.status).toBe(401);
    expect.soft(replay.body.code).toBe("OTP_ALREADY_USED");
    expect.soft(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toHaveLength(1);
  }, 60_000);

  it("commits a verified OTP consumption once across simultaneous native challenges", async () => {
    const fixture = await enrolled();
    const first = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
    const second = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
    const value = await code(fixture.userId);
    const results = await Promise.all([first, second].map(response => post("two-factor/verify-totp", cookies("", response))
      .send({ code: value })));
    expect(results.filter(response => response.status===200)).toHaveLength(1);
    expect(results.filter(response => response.status===401 || response.status===409)).toHaveLength(1);
    const [factor] = await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId));
    expect(factor.totpReplayState).toHaveLength(2); // Enrollment plus the one accepted new code.
    expect(factor.totpReplayState.every(entry => /^[a-f0-9]{64}$/.test(entry.fingerprint))).toBe(true);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toHaveLength(2);
  }, 60_000);

  it("keeps a verified OTP consumed when the subsequent native session write fails", async () => {
    const fixture = await enrolled(), context = await (auth as unknown as Auth).$context;
    const value = await code(fixture.userId);
    const spy = vi.spyOn(context.internalAdapter, "createSession").mockImplementationOnce(async () => {
      throw new APIError("BAD_REQUEST", { code: "FIXTURE_SESSION_WRITE_FAILURE", message: "Abort session completion" });
    });
    try {
      const failed = await post("two-factor/verify-totp", fixture.cookie).send({ code: value });
      expect(failed.status).toBe(400);
    } finally { spy.mockRestore(); }
    const retried = await post("two-factor/verify-totp", fixture.cookie).send({ code: value });
    expect(retried.status).toBe(401);
    expect(retried.body.code).toBe("OTP_ALREADY_USED");
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toHaveLength(1);
  }, 60_000);

  it("pins the actual prior session while publishing a fresh in-session factor proof", async () => {
    const fixture = await enrolled(), context = await (auth as unknown as Auth).$context;
    const [old] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    const create = context.internalAdapter.createSession.bind(context.internalAdapter);
    let pinned = false;
    const spy = vi.spyOn(context.internalAdapter, "createSession").mockImplementationOnce(async (...args) => {
      try {
        await db.transaction(tx => tx.execute(sql`select id from "session" where id=${old.id} for update nowait`));
      } catch (error) {
        pinned = (error as { cause?: { code?: string } }).cause?.code === "55P03";
        if (!pinned) throw error;
      }
      return create(...args);
    });
    try {
      const confirmed = await post("two-factor/verify-totp", fixture.cookie).send({ code: await code(fixture.userId) });
      expect(confirmed.status).toBe(200); expect(pinned).toBe(true);
    } finally { spy.mockRestore(); }
  }, 60_000);

  it("binds browser security intent to its actual cookie or first-factor account", async () => {
    const first = await signup(), other = await signup();
    const info = await request(app).get("/api/auth/security").set("Cookie", first.cookie)
      .set("X-Blentera-Expected-User", first.userId);
    expect(info.status).toBe(200);
    expect(info.headers["cache-control"]).toContain("no-store");
    expect(info.body).toEqual({ userId: first.userId, hasPassword: true, twoFactorEnabled: false, phishingResistantRequired: false, passkeysAvailable: true });
    expect((await request(app).get("/api/auth/security").set("Cookie", first.cookie)
      .set("X-Blentera-Expected-User", other.userId)).status).toBe(409);
    expect((await post("reauthenticate/password", first.cookie).set("X-Blentera-Expected-User", other.userId)
      .send({ password: PASSWORD })).status).toBe(409);
    expect((await post("two-factor/enable", first.cookie).set("X-Blentera-Expected-User", other.userId)
      .send({ password: PASSWORD })).status).toBe(409);
    expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, first.userId))).toEqual([]);
    const enabled = await post("two-factor/enable", first.cookie).set("X-Blentera-Expected-User", first.userId)
      .send({ password: PASSWORD });
    expect(enabled.status).toBe(200); first.cookie = cookies(first.cookie, enabled);
    const firstCode = await code(first.userId);
    expect((await post("two-factor/verify-totp", first.cookie).set("X-Blentera-Expected-User", other.userId)
      .send({ code: firstCode })).status).toBe(409);
    expect((await db.select().from(authUsers).where(eq(authUsers.id, first.userId)))[0].twoFactorEnabled).toBe(false);
    expect((await post("two-factor/verify-totp", first.cookie).set("X-Blentera-Expected-User", first.userId)
      .send({ code: firstCode })).status).toBe(200);
    const signin = await post("sign-in/email").send({ email: first.email, password: PASSWORD });
    expect(signin.body).toMatchObject({ userId: first.userId, twoFactorRedirect: true });
    const challenge = cookies("", signin), nextCode = await code(first.userId);
    expect((await post("two-factor/verify-totp", challenge).set("X-Blentera-Expected-User", other.userId)
      .send({ code: nextCode })).status).toBe(409);
    expect((await post("two-factor/verify-totp", challenge).set("X-Blentera-Expected-User", first.userId)
      .send({ code: nextCode })).status).toBe(200);
  }, 60_000);

  it("cancels an unverified enrollment through its native owner without disabling a verified factor", async () => {
    const fixture = await signup();
    const enabled = await post("two-factor/enable", fixture.cookie).send({ password: PASSWORD });
    expect(enabled.status).toBe(200); fixture.cookie = cookies(fixture.cookie, enabled);
    const cancelled = await post("two-factor/cancel-enrollment", fixture.cookie)
      .set("X-Blentera-Expected-User", fixture.userId).set("X-Blentera-Expected-Session", enabled.body.sessionId).send({});
    expect(cancelled.status).toBe(200); fixture.cookie = cookies(fixture.cookie, cancelled);
    expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId))).toEqual([]);
    expect((await db.select().from(authUsers).where(eq(authUsers.id, fixture.userId)))[0].twoFactorEnabled).toBe(false);
    const [current] = await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId));
    expect(current.authenticationMethod).toBe("password");
    expect((await post("two-factor/cancel-enrollment", fixture.cookie)
      .set("X-Blentera-Expected-Session", enabled.body.sessionId).send({})).status).toBe(200);
    expect((await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId)))[0].id).toBe(current.id);
    const replacement = await post("two-factor/enable", fixture.cookie).send({ password: PASSWORD });
    expect(replacement.status).toBe(200); fixture.cookie = cookies(fixture.cookie, replacement);
    expect((await post("two-factor/cancel-enrollment", fixture.cookie)
      .set("X-Blentera-Expected-Session", enabled.body.sessionId).send({})).status).toBe(409);
    expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId))).toHaveLength(1);
    expect((await post("two-factor/cancel-enrollment", fixture.cookie)
      .set("X-Blentera-Expected-Session", replacement.body.sessionId).send({})).status).toBe(200);
    const verified = await enrolled();
    expect((await post("two-factor/cancel-enrollment", verified.cookie).send({})).status).toBe(401);
    expect((await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, verified.userId)))[0].verified).toBe(true);
  }, 60_000);

  it("keeps direct maintained provider error messages and arguments out of SDK logs", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const context = await (auth as unknown as Auth).$context;
      context.logger.error("NATIVE-CLIENT-DATA-CANARY", new Error("NATIVE-CHALLENGE-CANARY"));
      expect(spy).toHaveBeenCalledWith({ component: "native-authentication" }, "Native authentication provider event");
      expect(inspect(spy.mock.calls, { depth: null })).not.toContain("CANARY");
    } finally { spy.mockRestore(); }
  });

  it("binds native registration options to the server-owned account, session and generation", async () => {
    const first = await signup(), other = await signup();
    expect((await request(app).get("/api/auth/methods")).body).toEqual({ passkey: true });
    expect((await request(app).get("/api/auth/passkey/generate-register-options")).status).toBe(401);
    const [active] = await db.select().from(authSessions).where(eq(authSessions.userId, first.userId));
    const options = await request(app).get("/api/auth/passkey/generate-register-options")
      .query({ context: "untrusted-client-context", name: "untrusted-user-name" }).set("Cookie", first.cookie)
      .set("X-Blentera-Expected-User", first.userId).set("X-Blentera-Expected-Session", active.id);
    expect(options.status).toBe(200);
    expect(options.body.rp).toEqual({ name: "Blentera", id: "localhost" });
    expect(options.body.authenticatorSelection.userVerification).toBe("required");
    const rows = await db.select().from(authVerifications).where(sql`${authVerifications.value} like ${'%"type":"registration"%'}`);
    const pending = rows.find(row => JSON.parse(row.value).userData.id === first.userId)!;
    expect(JSON.parse(pending.value).context).toBe(JSON.stringify({ sessionId: active.id, version: active.authenticatorVersion }));
    const raw = options.headers["set-cookie"] as unknown as string[];
    const challengeOnly = { headers: { "set-cookie": raw.filter(value => value.split("=",1)[0].includes("better-auth-passkey")) } } as unknown as request.Response;
    expect((await post("passkey/verify-registration", cookies(other.cookie, challengeOnly))
      .set("X-Blentera-Expected-User", other.userId).send({ response: {} })).status).toBe(401);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.id, pending.id))).toEqual([]);
    expect((await post("passkey/verify-registration", cookies(first.cookie, options)).send({ response: {} })).status).toBe(401);
    expect(await db.execute(sql`select id from passkey where user_id=${first.userId}`)).toHaveLength(0);
  }, 60_000);

  it("commits the maintained challenge consumption before a failed protected database transaction", async () => {
    const fixture = await signup();
    const options = await request(app).get("/api/auth/passkey/generate-register-options").set("Cookie", fixture.cookie);
    expect(options.status).toBe(200);
    const cookie = cookies(fixture.cookie, options), observer = createDb(database.connectionString);
    const rows = await db.select().from(authVerifications).where(sql`${authVerifications.value} like ${'%"type":"registration"%'}`);
    const pending = rows.find(row => JSON.parse(row.value).userData.id===fixture.userId)!;
    const original = db.transaction.bind(db);
    let observed = false;
    const spy = vi.spyOn(db, "transaction").mockImplementation(async (...args) => {
      const visible = await observer.select().from(authVerifications).where(eq(authVerifications.id, pending.id));
      if (!visible.length) { observed = true; throw new Error("Protected native transaction unavailable: SQL-TOKEN-CANARY"); }
      return original(...args);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post("passkey/verify-registration", cookie).send({ response: {} });
      expect(response.status).toBe(500);
      expect(observed).toBe(true);
      expect(inspect(consoleError.mock.calls, { depth: null })).not.toContain("CANARY");
      expect(JSON.stringify(response.body)).not.toContain("CANARY");
    } finally { spy.mockRestore(); consoleError.mockRestore(); }
    expect(await observer.select().from(authVerifications).where(eq(authVerifications.id, pending.id))).toEqual([]);
    expect((await post("passkey/verify-registration", cookie).send({ response: {} })).status).toBe(401);
    expect(await db.execute(sql`select id from passkey where user_id=${fixture.userId}`)).toHaveLength(0);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toHaveLength(1);
  }, 60_000);

  it("does not let registration request a new login session or reuse its rejected native challenge", async () => {
    const fixture = await signup();
    const options = await request(app).get("/api/auth/passkey/generate-register-options").set("Cookie", fixture.cookie);
    expect(options.status).toBe(200);
    const cookie = cookies(fixture.cookie, options);
    expect((await post("passkey/verify-registration", cookie).send({ response: {}, createSession: true })).status).toBe(401);
    expect((await post("passkey/verify-registration", cookie).send({ response: {} })).status).toBe(401);
    expect(await db.execute(sql`select id from passkey where user_id=${fixture.userId}`)).toHaveLength(0);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toHaveLength(1);
  }, 60_000);

  it("rejects stale first-factor verification before issuing any MFA challenge", async () => {
    const fixture = await enrolled();
    const context = await (auth as unknown as Auth).$context, verify = context.password.verify;
    const replacement = await hashPassword("A replacement credential while native verification runs 2026");
    const spy = vi.spyOn(context.password, "verify").mockImplementationOnce(async input => {
      const valid = await verify(input);
      await db.update(authAccounts).set({ password: replacement }).where(eq(authAccounts.userId, fixture.userId));
      return valid;
    });
    try {
      const stale = await post("sign-in/email").send({ email: fixture.email, password: PASSWORD });
      expect(stale.status).toBe(401);
      expect(stale.body.code).toBe("AUTHENTICATION_STATE_CHANGED");
    } finally { spy.mockRestore(); }
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, fixture.userId))).toEqual([]);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.value, fixture.userId))).toEqual([]);
  }, 60_000);
});
