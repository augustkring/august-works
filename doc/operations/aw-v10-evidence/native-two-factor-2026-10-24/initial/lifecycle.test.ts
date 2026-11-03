import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { hashPassword, symmetricDecrypt } from "better-auth/crypto";
import type { Auth } from "better-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authAccounts, authRateLimits, authSessions, authTwoFactors, authUsers, authVerifications,
  createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { createBetterAuthHandler, createBetterAuthInstance } from "../auth/better-auth.js";
import { assertHumanAuthentication } from "../auth/authenticator-assurance.js";
import type { Config } from "../config.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const ORIGIN = "http://127.0.0.1:41999", PASSWORD = "A native factor fixture password 2026";
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
  let auth: ReturnType<typeof createBetterAuthInstance>, app: express.Express;
  const originalSecret = process.env.BETTER_AUTH_SECRET, originalRate = process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED;
  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "native-two-factor-integration-fixture-secret";
    process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED = "false";
    database = await startEmbeddedPostgresTestDatabase("native-two-factor-lifecycle-");
    db = createDb(database.connectionString);
    auth = createBetterAuthInstance(db, { deploymentMode: "authenticated", deploymentExposure: "private",
      authBaseUrlMode: "explicit", authPublicBaseUrl: ORIGIN, authDisableSignUp: false,
      allowedHostnames: ["127.0.0.1"], port: 41999 } as Config, [ORIGIN]);
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
  async function code(userId: string) {
    const [factor] = await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, userId));
    const context = await (auth as unknown as Auth).$context;
    const secret = await symmetricDecrypt({ key: context.secretConfig, data: factor.secret });
    const api = auth.api as unknown as { generateTOTP(input: { body: { secret: string } }): Promise<{ code: string }> };
    return (await api.generateTOTP({ body: { secret } })).code;
  }
  async function enrolled() {
    const fixture = await signup();
    const enabled = await post("two-factor/enable", fixture.cookie).send({ password: PASSWORD, issuer: "Untrusted issuer" });
    expect(enabled.status).toBe(200);
    expect(new URL(enabled.body.totpURI).pathname).toContain("Blentera");
    expect(enabled.body.backupCodes).toHaveLength(10);
    fixture.cookie = cookies(fixture.cookie, enabled);
    const completed = await post("two-factor/verify-totp", fixture.cookie).send({ code: await code(fixture.userId) });
    expect(completed.status).toBe(200);
    fixture.cookie = cookies(fixture.cookie, completed);
    return { ...fixture, backupCodes: enabled.body.backupCodes as string[] };
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
    expect((await post("two-factor/verify-totp", challenge).send({ code: await code(fixture.userId) })).status).toBe(401);
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
