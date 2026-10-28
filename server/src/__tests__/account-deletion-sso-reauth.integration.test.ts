import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, generateKeyPairSync, createSign } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  createDb, authAccounts, authPasskeys, authRateLimits, authSessions, authUsers, authVerifications, accountDeletionOperations,
  enterpriseIdentityPolicies, type Db,
} from "@paperclipai/db";
import { createBetterAuthInstance } from "../auth/better-auth.js";
import { accountDeletionService } from "../services/saas/account-deletion.js";
import { enterpriseIdentityPolicyService, enterprisePolicyHash } from "../services/enterprise/identity-policy.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { secretService } from "../services/secrets.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies } from "./helpers/v5-fixtures.js";
import type { Config } from "../config.js";
import type { AuthorizationActor } from "../services/authorization.js";

const support = await getEmbeddedPostgresTestSupport();
const origin = "https://enterprise.example.test", sourceSha = "a".repeat(40);
(support.supported ? describe : describe.skip)("passwordless account deletion through verified OIDC reauthentication", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let auth: ReturnType<typeof createBetterAuthInstance>;
  let operator: Awaited<ReturnType<typeof seedV5Companies>>;
  let operatorActor: AuthorizationActor;
  let targetUserId: string;
  let providerId: string;
  let jar = new Map<string, string>();
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const previousEncryptionKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  const idpIssuer = "https://oidc.test.invalid";
  const idpSubject = "fixture-stable-subject";
  const oidcClientId = "account-delete-oidc-fixture";
  const jwksKid = "account-delete-jwks";
  const tokenByCode = new Map<string, string>();
  const { privateKey: idpPrivateKey, publicKey: idpPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const idpPublicJwk = idpPublicKey.export({ format: "jwk" });

  beforeAll(async () => {
    process.env.PAPERCLIP_SECRETS_MASTER_KEY = "c".repeat(64);
    process.env.BETTER_AUTH_SECRET = "account-deletion-sso-fixture-secret-with-32-characters";
    database = await startEmbeddedPostgresTestDatabase("aw-account-delete-sso-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    operator = await seedV5Companies(db);
    const time = new Date(), operatorSessionId = randomUUID();
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: operator.userId,
      providerId: "credential", userId: operator.userId, password: "structural-fixture-not-a-password-hash",
      createdAt: time, updatedAt: time });
    await db.insert(authPasskeys).values({ id: randomUUID(), name: "OIDC fixture operator structural passkey",
      publicKey: "structural-fixture-not-a-credential", userId: operator.userId, credentialID: randomUUID(), counter: 0,
      deviceType: "singleDevice", backedUp: false, transports: null, createdAt: time, aaguid: null });
    const [operatorAuthenticator] = await db.select({ authenticatorVersion: authUsers.authenticatorVersion })
      .from(authUsers).where(eq(authUsers.id, operator.userId));
    await db.insert(authSessions).values({ id: operatorSessionId, userId: operator.userId, token: randomUUID(),
      createdAt: time, updatedAt: time, expiresAt: new Date(time.getTime() + 86_400_000),
      authenticationMethod: "passkey", authenticatedAt: time, authenticatorVersion: operatorAuthenticator!.authenticatorVersion });
    operatorActor = { ...operator.actor, sessionId: operatorSessionId };
    await instanceSettingsService(db).updateExperimental({ saas_deployment_profile_v6: true, transactional_email_v6: true,
      email_verification_required_v6: true, server_onboarding_v6: true, billing_v6: true, billing_entitlements_v6: true,
      ai_use_cases_v7: true, governance_evidence_v7: true, enterprise_identity_v7: true, company_deletion_v6: true });
    targetUserId = `oidc-delete-target-${randomUUID()}`;
    await db.insert(authUsers).values({ id: targetUserId, name: "OIDC deletion fixture", email: `${targetUserId}@test.invalid`,
      emailVerified: true, createdAt: time, updatedAt: time });
    const { companyMemberships } = await import("@paperclipai/db");
    await db.insert(companyMemberships).values({ companyId: operator.home, principalType: "user", principalId: targetUserId,
      status: "active", membershipRole: "viewer" });

    const appSigningKey = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
    const key = await secretService(db).create(operator.home,
      { name: "OIDC deletion app key", provider: "local_encrypted", value: appSigningKey }, { userId: operator.userId });
    const policyService = enterpriseIdentityPolicyService(db, { operatorUserIds: [operator.userId], sourceSha,
      protectedEvidenceOrigin: "https://qualification.test.invalid", appOrigin: origin });
    const policy = await policyService.configure(operatorActor, operator.home, { expectedVersion: 0,
      configuration: { protocol: "oidc", issuer: idpIssuer, domain: "test.invalid", clientId: oidcClientId,
        discoveryEndpoint: `${idpIssuer}/.well-known/openid-configuration`, privateKeySecretId: key.id, privateKeySecretVersion: 1 },
      operatingEnvelope: { awProcessingRegions: ["dk-cph1"], providers: [], dedicatedPlacement: "none",
        retentionPolicyDescription: "Local signed OIDC protocol fixture", contractEvidence: null,
        supportAccess: "native_scoped_owner_approval", limitations: ["Local signed protocol fixture; not a live provider qualification"] },
      scimRequired: false, reason: "Configure local signed OIDC account deletion fixture" });
    const [configured] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.id, policy.id));
    const qualified = await policyService.qualify(operatorActor, operator.home, { expectedVersion: 1,
      configurationHash: enterprisePolicyHash(configured!), uri: "https://qualification.test.invalid/qualification/account-delete-oidc",
      sha256: "d".repeat(64), expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    providerId = qualified.providerId;
    await policyService.bind(operatorActor, operator.home, { userId: targetUserId, subject: idpSubject,
      manageMembershipLifecycle: false, reason: "Bind the one signed OIDC fixture subject" });

    const config = { deploymentProfile: "saas", deploymentMode: "authenticated", deploymentExposure: "public",
      authBaseUrlMode: "explicit", authPublicBaseUrl: origin, authDisableSignUp: true, allowedHostnames: ["enterprise.example.test"],
      port: 3100, publicOriginConfig: { primaryAppOrigin: origin, allowedAppOrigins: [origin], legacyOrigins: [] },
      saasPlatform: { deployment: { sourceSha }, operatorUserIds: [operator.userId] } } as unknown as Config;
    auth = createBetterAuthInstance(db, config, [origin, idpIssuer]);
    const publicJwk = { ...idpPublicJwk };
    Object.assign(publicJwk, { kid: jwksKid, use: "sig", alg: "RS256" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href === `${idpIssuer}/.well-known/openid-configuration`) return Response.json({ issuer: idpIssuer,
        authorization_endpoint: `${idpIssuer}/authorize`, token_endpoint: `${idpIssuer}/token`, jwks_uri: `${idpIssuer}/jwks` });
      if (url.href === `${idpIssuer}/jwks`) return Response.json({ keys: [publicJwk] });
      if (url.href === `${idpIssuer}/token`) {
        const body = new URLSearchParams(typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
        const token = tokenByCode.get(body.get("code") ?? "");
        if (!token) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 300, id_token: token });
      }
      throw new Error(`Unexpected OIDC fixture fetch: ${url.origin}${url.pathname}`);
    });
  }, 60000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await database?.cleanup();
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousSecret;
    if (previousEncryptionKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY = previousEncryptionKey;
  }, 30000);

  function cookieHeader() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); }
  function saveCookies(response: Response) {
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(";", 1)[0] ?? "";
      const split = pair.indexOf("=");
      if (split < 1) continue;
      const name = pair.slice(0, split), value = pair.slice(split + 1);
      if (!value) jar.delete(name); else jar.set(name, value);
    }
  }
  async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    const response = await auth.handler(new Request(origin + "/api/auth" + path, { method,
      headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(jar.size ? { Cookie: cookieHeader() } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    saveCookies(response);
    return response;
  }
  async function signedToken(input: { nonce: string; authTime: number; subject?: string }) {
    const base64url = (value: string) => Buffer.from(value).toString("base64url");
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", kid: jwksKid }));
    const payload = base64url(JSON.stringify({ iss: idpIssuer, aud: oidcClientId, sub: input.subject ?? idpSubject,
      iat: issuedAt, exp: issuedAt + 300, email: `${targetUserId}@test.invalid`, email_verified: true,
      name: "OIDC deletion fixture", nonce: input.nonce, auth_time: input.authTime }));
    const signingInput = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(idpPrivateKey).toString("base64url")}`;
  }
  async function completeOidc(callbackURL: string, options: { authTime?: number; subject?: string; badNonce?: boolean } = {}) {
    const start = await request("/sign-in/sso", "POST", { providerId, callbackURL });
    expect(start.status).toBe(200);
    const startBody = await start.json() as { url: string };
    const authorization = new URL(startBody.url);
    const state = authorization.searchParams.get("state"), requestedNonce = authorization.searchParams.get("nonce");
    expect(state).toBeTruthy(); expect(requestedNonce).toMatch(/^.{16,}$/);
    const code = randomUUID();
    tokenByCode.set(code, await signedToken({ nonce: options.badNonce ? "signed-but-wrong-nonce-value" : requestedNonce!,
      authTime: options.authTime ?? Math.floor(Date.now() / 1000), subject: options.subject }));
    const callback = await request(`/sso/callback/${providerId}?state=${encodeURIComponent(state!)}&code=${encodeURIComponent(code)}`);
    return { callback, state, requestedNonce };
  }
  async function currentSession() {
    const response = await request("/get-session");
    expect(response.status).toBe(200);
    const value = await response.json() as { session?: { id?: string }; user?: { id?: string } };
    expect(value.user?.id).toBe(targetUserId);
    expect(value.session?.id).toBeTruthy();
    return value.session!.id!;
  }
  function expectedHeaders(sessionId: string) { return { "X-Blentera-Expected-User": targetUserId, "X-Blentera-Expected-Session": sessionId }; }
  async function startDeleteReauth(sessionId: string) {
    const result = await request("/account-deletion/sso/start", "POST", {}, expectedHeaders(sessionId));
    expect(result.status).toBe(200);
    return result.json() as Promise<{ userId: string; challengeId: string; providerId: string; callbackURL: string }>;
  }
  async function clearThisFixtureSignInRateLimit() {
    await db.delete(authRateLimits).where(sql`${authRateLimits.key} like ${"%|%/sign-in/sso"}`);
  }

  it("requires a signed fresh OIDC auth_time, nonce and exact state, then consumes a session-bound proof atomically", async () => {
    const first = await completeOidc(`${origin}/company/settings/security`);
    expect(first.callback.status).toBe(302);
    const initialSessionId = await currentSession();
    const statusResponse = await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(initialSessionId));
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ userId: targetUserId, providerId, available: true, ready: false, challengeId: null });

    const staleChallenge = await startDeleteReauth(initialSessionId);
    const stale = await completeOidc(staleChallenge.callbackURL, { authTime: Math.floor(Date.now() / 1000) - 600 });
    expect(stale.callback.status).toBe(302);
    await clearThisFixtureSignInRateLimit();
    let sessionId = await currentSession();
    let status = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(sessionId))).json() as { ready: boolean };
    expect(status.ready).toBe(false);

    const failedChallenge = await startDeleteReauth(sessionId);
    const wrongNonce = await completeOidc(failedChallenge.callbackURL, { badNonce: true });
    expect(wrongNonce.callback.status).toBe(302);
    await clearThisFixtureSignInRateLimit();
    sessionId = await currentSession();
    status = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(sessionId))).json() as { ready: boolean };
    expect(status.ready).toBe(false);

    const challenge = await startDeleteReauth(sessionId);
    const authorization = await request("/sign-in/sso", "POST", { providerId, callbackURL: challenge.callbackURL }, expectedHeaders(sessionId));
    expect(authorization.status).toBe(200);
    const authorizationBody = await authorization.json() as { url: string };
    const authorizationUrl = new URL(authorizationBody.url);
    expect(authorizationUrl.searchParams.get("prompt")).toBe("login");
    expect(authorizationUrl.searchParams.get("max_age")).toBe("0");
    const state = authorizationUrl.searchParams.get("state")!, nonce = authorizationUrl.searchParams.get("nonce")!;
    expect(state).toBeTruthy(); expect(nonce).toMatch(/^.{16,}$/);
    const code = randomUUID();
    tokenByCode.set(code, await signedToken({ nonce, authTime: Math.floor(Date.now() / 1000) }));
    const callback = await request(`/sso/callback/${providerId}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`);
    expect(callback.status).toBe(302);
    sessionId = await currentSession();
    const ready = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(sessionId))).json() as {
      ready: boolean; challengeId: string | null;
    };
    expect(ready).toEqual({ userId: targetUserId, providerId, available: true, ready: true, challengeId: challenge.challengeId });
    expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, targetUserId))).toEqual([]);

    const deletion = accountDeletionService(db, { enterpriseSourceSha: sourceSha, removeSecret: async () => {}, cancelRun: async () => {} });
    const actor: AuthorizationActor = { type: "board", source: "session", userId: targetUserId, sessionId };
    const input = { confirmation: "DELETE MY ACCOUNT" as const, reauthenticationProofId: challenge.challengeId,
      acknowledgeExport: true as const, idempotencyKey: "oidc-delete-receipt-0001" };
    const [policy] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.providerId, providerId));
    await db.update(enterpriseIdentityPolicies).set({ updatedAt: new Date(Date.now() + 1_000) }).where(eq(enterpriseIdentityPolicies.id, policy!.id));
    await expect(deletion.request(targetUserId, input, new Date(), actor)).rejects.toThrow("Current company sign-in confirmation required");
    expect(await db.select().from(authVerifications).where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`))).toHaveLength(1);
    await db.update(enterpriseIdentityPolicies).set({ updatedAt: policy!.updatedAt }).where(eq(enterpriseIdentityPolicies.id, policy!.id));

    const otherUserId = `oidc-delete-other-${randomUUID()}`, now = new Date(), otherSessionId = randomUUID();
    await db.insert(authUsers).values({ id: otherUserId, name: "Other user", email: `${otherUserId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(authSessions).values({ id: otherSessionId, userId: otherUserId, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    await expect(deletion.request(otherUserId, input, new Date(), { type: "board", source: "session", userId: otherUserId, sessionId: otherSessionId }))
      .rejects.toThrow("Current company sign-in confirmation required");
    const otherSessionForTarget = randomUUID();
    await db.insert(authSessions).values({ id: otherSessionForTarget, userId: targetUserId, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    await expect(deletion.request(targetUserId, input, new Date(), { ...actor, sessionId: otherSessionForTarget }))
      .rejects.toThrow("Current company sign-in confirmation required");

    const [proofRow] = await db.select().from(authVerifications)
      .where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`));
    const proofValue = JSON.parse(proofRow!.value) as { expiresAt: string };
    const shortenedExpiry = new Date(Date.now() + 1_000);
    proofValue.expiresAt = shortenedExpiry.toISOString();
    await db.update(authVerifications).set({ value: JSON.stringify(proofValue), expiresAt: shortenedExpiry })
      .where(eq(authVerifications.id, proofRow!.id));
    const lockDb = createDb(database.connectionString);
    let blockedDelete: Promise<{ ok: true } | { error: unknown }> | undefined;
    await lockDb.transaction(async tx => {
      await tx.execute(sql`lock table company_memberships in share row exclusive mode`);
      blockedDelete = deletion.request(targetUserId, input, new Date(), actor)
        .then(() => ({ ok: true as const }), error => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [activity] = await db.execute<{ waiting: boolean }>(sql`
          select exists(select 1 from pg_stat_activity where wait_event_type='Lock'
            and query ilike '%lock table company_memberships in share row exclusive mode%') as waiting`);
        if (activity?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 1_200));
    });
    const expired = await blockedDelete!;
    expect("error" in expired).toBe(true);
    expect((expired as { error: unknown }).error).toMatchObject({ message: "Current company sign-in confirmation required" });
    expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, targetUserId))).toEqual([]);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`))).toHaveLength(1);

    const retryChallenge = await startDeleteReauth(sessionId);
    const retried = await completeOidc(retryChallenge.callbackURL);
    expect(retried.callback.status).toBe(302);
    sessionId = await currentSession();
    const retryInput = { ...input, reauthenticationProofId: retryChallenge.challengeId };
    const receipt = await deletion.request(targetUserId, retryInput, new Date(), { ...actor, sessionId });
    expect(receipt.status).toBe("requested");
    expect(await db.select().from(authVerifications).where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`))).toEqual([]);
    expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, targetUserId))).toHaveLength(1);
    await expect(deletion.request(targetUserId, { ...input, idempotencyKey: "oidc-delete-receipt-0002" }, new Date(), actor))
      .rejects.toThrow("Account deletion is already requested");
  });
});
