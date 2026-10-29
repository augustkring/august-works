import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, randomBytes, createHash, generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import {
  createDb, authAccounts, authPasskeys, authRateLimits, authSessions, authTwoFactors, authUsers, authVerifications, accountDeletionOperations,
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
(support.supported ? describe : describe.skip)("account deletion through verified OIDC and native reauthentication", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let auth: ReturnType<typeof createBetterAuthInstance>;
  let operator: Awaited<ReturnType<typeof seedV5Companies>>;
  let operatorActor: AuthorizationActor;
  let targetUserId: string;
  let configuredOperatorUserIds: string[] = [];
  let providerId: string;
  let jar = new Map<string, string>();
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const previousEncryptionKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  const idpIssuer = "https://oidc.test.invalid";
  let idpSubject = "fixture-stable-subject";
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
    configuredOperatorUserIds = [operator.userId];
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
      saasPlatform: { deployment: { sourceSha }, operatorUserIds: configuredOperatorUserIds } } as unknown as Config;
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
  async function makePasskeyResponse(challenge: string, credentialId: string, privateKey: KeyObject) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
    const authenticatorData = Buffer.concat([
      createHash("sha256").update(new URL(origin).hostname).digest(), Buffer.from([0x05, 0, 0, 0, 1]),
    ]);
    const clientDataHash = createHash("sha256").update(clientDataJSON).digest();
    const signer = createSign("SHA256");
    signer.update(Buffer.concat([authenticatorData, clientDataHash]));
    signer.end();
    const signature = signer.sign(privateKey).toString("base64url");
    return { id: credentialId, rawId: credentialId, type: "public-key", authenticatorAttachment: "platform",
      clientExtensionResults: {}, response: { authenticatorData: authenticatorData.toString("base64url"),
        clientDataJSON: clientDataJSON.toString("base64url"), signature, userHandle: null } };
  }
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
    expect(authorization.status, JSON.stringify(await authorization.clone().json())).toBe(200);
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
    expect(ready).toEqual({ userId: targetUserId, providerId, available: true, requiresNativeFactor: false, nativeFactorMethod: null,
      ready: true, challengeId: challenge.challengeId });
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

  it("requires a real native TOTP session after the fresh OIDC callback for 2FA accounts", async () => {
    jar.clear();
    targetUserId = `oidc-delete-mfa-target-${randomUUID()}`;
    idpSubject = `fixture-mfa-subject-${randomUUID()}`;
    const time = new Date();
    await db.insert(authUsers).values({ id: targetUserId, name: "OIDC deletion MFA fixture",
      email: `${targetUserId}@test.invalid`, emailVerified: true, createdAt: time, updatedAt: time });
    const { companyMemberships } = await import("@paperclipai/db");
    await db.insert(companyMemberships).values({ companyId: operator.home, principalType: "user", principalId: targetUserId,
      status: "active", membershipRole: "viewer" });
    await enterpriseIdentityPolicyService(db, { operatorUserIds: [operator.userId], sourceSha,
      protectedEvidenceOrigin: "https://qualification.test.invalid", appOrigin: origin })
      .bind(operatorActor, operator.home, { userId: targetUserId, subject: idpSubject,
        manageMembershipLifecycle: false, reason: "Bind the native-factor OIDC fixture subject" });
    const otpSecret = "JBSWY3DPEHPK3PXP";
    const context = await (auth as unknown as import("better-auth").Auth).$context;
    const encryptedSecret = await symmetricEncrypt({ key: context.secretConfig, data: otpSecret });
    const encryptedBackupCodes = await symmetricEncrypt({ key: context.secretConfig, data: JSON.stringify(["DELETE-CODE-12345"]) });
    await db.insert(authTwoFactors).values({ id: randomUUID(), userId: targetUserId, secret: encryptedSecret,
      backupCodes: encryptedBackupCodes, verified: true });
    await db.update(authUsers).set({ twoFactorEnabled: true, authenticatorVersion: 1 }).where(eq(authUsers.id, targetUserId));
    expect((await completeOidc(`${origin}/company/settings/security`)).callback.status).toBe(302);
    await clearThisFixtureSignInRateLimit();
    const initialSessionId = await currentSession();

    const challenge = await startDeleteReauth(initialSessionId);
    const authorization = await request("/sign-in/sso", "POST", { providerId, callbackURL: challenge.callbackURL }, expectedHeaders(initialSessionId));
    expect(authorization.status, JSON.stringify(await authorization.clone().json())).toBe(200);
    const url = new URL((await authorization.json() as { url: string }).url);
    const state = url.searchParams.get("state")!, nonce = url.searchParams.get("nonce")!;
    const code = randomUUID();
    tokenByCode.set(code, await signedToken({ nonce, authTime: Math.floor(Date.now() / 1000) }));
    expect((await request(`/sso/callback/${providerId}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`)).status).toBe(302);
    const callbackSessionId = await currentSession();
    const pendingStatus = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(callbackSessionId))).json() as {
      ready: boolean; requiresNativeFactor: boolean; challengeId: string | null;
    };
    expect(pendingStatus).toMatchObject({ ready: false, requiresNativeFactor: true, challengeId: challenge.challengeId });
    expect((await request("/account-deletion/sso/factor-complete", "POST", {}, expectedHeaders(callbackSessionId))).status).toBe(403);
    const step = Math.floor(Date.now() / 30_000);
    const verified = await request("/two-factor/verify-totp", "POST", { code: await createOTP(otpSecret).hotp(step) });
    expect(verified.status, JSON.stringify(await verified.clone().json())).toBe(200);
    const factorSessionId = await currentSession();
    expect(factorSessionId).not.toBe(callbackSessionId);
    const completed = await request("/account-deletion/sso/factor-complete", "POST", {}, expectedHeaders(factorSessionId));
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ userId: targetUserId, sessionId: factorSessionId,
      challengeId: challenge.challengeId, ready: true });
    const replay = await request("/account-deletion/sso/factor-complete", "POST", {}, expectedHeaders(factorSessionId));
    expect(replay.status).toBe(200); // Acknowledgement is idempotent; the proof remains session-bound and one-use at deletion.
    const ready = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(factorSessionId))).json();
    expect(ready).toMatchObject({ ready: true, requiresNativeFactor: true, challengeId: challenge.challengeId });

    const recoveryChallenge = await startDeleteReauth(factorSessionId);
    const recoveryAuthorization = await request("/sign-in/sso", "POST", { providerId, callbackURL: recoveryChallenge.callbackURL }, expectedHeaders(factorSessionId));
    expect(recoveryAuthorization.status).toBe(200);
    const recoveryUrl = new URL((await recoveryAuthorization.json() as { url: string }).url);
    const recoveryState = recoveryUrl.searchParams.get("state")!, recoveryNonce = recoveryUrl.searchParams.get("nonce")!;
    const recoveryCode = randomUUID();
    tokenByCode.set(recoveryCode, await signedToken({ nonce: recoveryNonce, authTime: Math.floor(Date.now() / 1000) }));
    expect((await request(`/sso/callback/${providerId}?state=${encodeURIComponent(recoveryState)}&code=${encodeURIComponent(recoveryCode)}`)).status).toBe(302);
    const recoveryCallbackSessionId = await currentSession();
    const recoveryVerified = await request("/two-factor/verify-backup-code", "POST", { code: "DELETE-CODE-12345" });
    expect(recoveryVerified.status, JSON.stringify(await recoveryVerified.clone().json())).toBe(200);
    const recoverySessionId = await currentSession();
    expect(recoverySessionId).not.toBe(recoveryCallbackSessionId);
    const recoveryFinished = await request("/account-deletion/sso/factor-complete", "POST", {}, expectedHeaders(recoverySessionId));
    if (recoveryFinished.status !== 200) {
      const [proofRow] = await db.select().from(authVerifications)
        .where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`));
      const proof = JSON.parse(proofRow!.value) as Record<string, unknown>;
      const [factorSession] = await db.select({ id: authSessions.id, authenticationMethod: authSessions.authenticationMethod,
        authenticatorVersion: authSessions.authenticatorVersion, expiresAt: authSessions.expiresAt })
        .from(authSessions).where(eq(authSessions.id, recoverySessionId));
      const [sourceSession] = await db.select({ id: authSessions.id, authenticatorVersion: authSessions.authenticatorVersion,
        expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.id, String(proof.sourceSessionId)));
      const [ownerVersion] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers)
        .where(eq(authUsers.id, targetUserId));
      const [callbackSession] = await db.select({ id: authSessions.id }).from(authSessions)
        .where(eq(authSessions.id, String(proof.callbackSessionId)));
      throw new Error(JSON.stringify({ response: await recoveryFinished.clone().json(), challenge: {
        state: proof.state, authenticatorVersion: proof.authenticatorVersion, callbackSessionId: proof.callbackSessionId,
        proofSessionId: proof.proofSessionId, nativeFactorSessionId: proof.nativeFactorSessionId,
        nativeFactorAuthenticatorVersion: proof.nativeFactorAuthenticatorVersion,
      }, ownerVersion, sourceSession, factorSession, callbackSession }));
    }
    expect(await recoveryFinished.json()).toMatchObject({ challengeId: recoveryChallenge.challengeId, ready: true });

    const deletion = accountDeletionService(db, { enterpriseSourceSha: sourceSha, removeSecret: async () => {}, cancelRun: async () => {} });
    let receipt;
    try {
      receipt = await deletion.request(targetUserId, { confirmation: "DELETE MY ACCOUNT", reauthenticationProofId: recoveryChallenge.challengeId,
        acknowledgeExport: true, idempotencyKey: "oidc-delete-mfa-receipt-0001" }, new Date(),
        { type: "board", source: "session", userId: targetUserId, sessionId: recoverySessionId });
    } catch (error) {
      const [proofRow] = await db.select().from(authVerifications)
        .where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`));
      const proof = JSON.parse(proofRow!.value) as Record<string, unknown>;
      const [diagnostics] = await db.execute(sql`select
        ${proof.authTime!}::double precision between (extract(epoch from clock_timestamp())-299)*1000 and (extract(epoch from clock_timestamp())+5000)*1000 as auth_time,
        ${proofRow!.expiresAt.toISOString()}::timestamptz>clock_timestamp()+interval '1 second' as row_expiry,
        ${String(proof.expiresAt)}::timestamptz>clock_timestamp()+interval '1 second' as proof_expiry,
        ${String(proof.sourceSessionExpiresAt)}::timestamptz>clock_timestamp()+interval '1 second' as source_expiry,
        (select expires_at>clock_timestamp()+interval '1 second' from "session" where id=${recoverySessionId}) as factor_expiry,
        not exists(select 1 from "session" where id=${String(proof.callbackSessionId)} and user_id=${targetUserId}) as callback_absent,
        exists(select 1 from "user" where id=${targetUserId} and authenticator_version=${String(proof.nativeFactorAuthenticatorVersion)}::integer) as owner_version,
        ${String(proof.sourceSessionExpiresAt)} as saved_source_expiry`);
      throw new Error(JSON.stringify({ error: error instanceof Error ? error.message : "failed", diagnostics }));
    }
    expect(receipt.status).toBe("requested");
  });

  it("requires qualified SSO and an already enrolled native passkey for an operator with an unset PR flag", async () => {
    jar.clear();
    targetUserId = `oidc-delete-pr-target-${randomUUID()}`;
    configuredOperatorUserIds.push(targetUserId);
    idpSubject = `fixture-pr-subject-${randomUUID()}`;
    const time = new Date();
    await db.insert(authUsers).values({ id: targetUserId, name: "OIDC deletion passkey fixture",
      email: `${targetUserId}@test.invalid`, emailVerified: true, createdAt: time, updatedAt: time });
    const operatorPassword = "CURRENT-OPERATOR-DELETE-PASSWORD-2026";
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: targetUserId,
      providerId: "credential", userId: targetUserId, password: await hashPassword(operatorPassword), createdAt: time, updatedAt: time });
    const { companyMemberships } = await import("@paperclipai/db");
    await db.insert(companyMemberships).values({ companyId: operator.home, principalType: "user", principalId: targetUserId,
      status: "active", membershipRole: "viewer" });
    const [initialOperator] = await db.select().from(authUsers).where(eq(authUsers.id, targetUserId));
    expect(initialOperator).toMatchObject({ phishingResistantRequired: false });

    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    expect(jwk.x).toBeTruthy(); expect(jwk.y).toBeTruthy();
    const x = Buffer.from(jwk.x!, "base64url"), y = Buffer.from(jwk.y!, "base64url");
    const cosePublicKey = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      x, Buffer.from([0x22, 0x58, 0x20]), y]);
    const credentialId = randomBytes(32).toString("base64url");
    await db.insert(authPasskeys).values({ id: randomUUID(), name: "Previously enrolled PR key",
      publicKey: cosePublicKey.toString("base64url"), userId: targetUserId, credentialID: credentialId, counter: 0,
      deviceType: "singleDevice", backedUp: false, transports: "internal", createdAt: time, aaguid: null });
    await enterpriseIdentityPolicyService(db, { operatorUserIds: [operator.userId], sourceSha,
      protectedEvidenceOrigin: "https://qualification.test.invalid", appOrigin: origin })
      .bind(operatorActor, operator.home, { userId: targetUserId, subject: idpSubject,
        manageMembershipLifecycle: false, reason: "Bind pre-enrolled PR passkey deletion fixture" });

    const firstLogin = await completeOidc(`${origin}/company/settings/security`);
    expect(firstLogin.callback.status).toBe(302);
    const sourceSessionId = await currentSession();
    await clearThisFixtureSignInRateLimit();
    const ordinaryRegistrationOptions = await request("/passkey/generate-register-options", "GET", undefined, expectedHeaders(sourceSessionId));
    expect(ordinaryRegistrationOptions.status).not.toBe(200);
    expect(await currentSession()).toBe(sourceSessionId);
    const ordinaryOptionsResponse = await request("/passkey/generate-authenticate-options", "GET", undefined, expectedHeaders(sourceSessionId));
    expect(ordinaryOptionsResponse.status).toBe(200);
    const ordinaryOptions = await ordinaryOptionsResponse.json() as { challenge: string };
    const ordinaryAttempt = await request("/passkey/verify-authentication", "POST",
      { response: await makePasskeyResponse(ordinaryOptions.challenge, credentialId, privateKey) }, expectedHeaders(sourceSessionId));
    expect(ordinaryAttempt.status).not.toBe(200);
    expect(await currentSession()).toBe(sourceSessionId);
    const initialStatus = await (await request("/account-deletion/sso/status", "GET", undefined,
      expectedHeaders(sourceSessionId))).json() as { available: boolean; requiresNativeFactor: boolean; nativeFactorMethod: string | null };
    expect(initialStatus).toMatchObject({ available: true, requiresNativeFactor: true, nativeFactorMethod: "passkey" });

    const finishSso = async (sourceSession: string) => {
      const challenge = await startDeleteReauth(sourceSession);
      const authorization = await request("/sign-in/sso", "POST", { providerId, callbackURL: challenge.callbackURL }, expectedHeaders(sourceSession));
      expect(authorization.status, JSON.stringify(await authorization.clone().json())).toBe(200);
      const url = new URL((await authorization.json() as { url: string }).url);
      const state = url.searchParams.get("state")!, nonce = url.searchParams.get("nonce")!;
      const code = randomUUID(); tokenByCode.set(code, await signedToken({ nonce, authTime: Math.floor(Date.now() / 1000) }));
      const callback = await request(`/sso/callback/${providerId}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`);
      expect(callback.status).toBe(302);
      await clearThisFixtureSignInRateLimit();
      const proofSessionId = await currentSession();
      return { challenge, proofSessionId };
    };
    const optionsFor = async (sessionId: string) => {
      const response = await request("/passkey/generate-authenticate-options", "GET", undefined, expectedHeaders(sessionId));
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      return await response.json() as { challenge: string; userVerification?: string; allowCredentials?: Array<{ id: string }> };
    };
    const verify = async (sessionId: string, challenge: string) => request("/passkey/verify-authentication", "POST",
      { response: await makePasskeyResponse(challenge, credentialId, privateKey) }, expectedHeaders(sessionId));

    // A same-user but unrelated SSO session cannot use the prior challenge's WebAuthn ceremony.
    const wrongSessionProof = await finishSso(sourceSessionId);
    const wrongSessionOptions = await optionsFor(wrongSessionProof.proofSessionId);
    expect(wrongSessionOptions.userVerification).toBe("required");
    expect(wrongSessionOptions.allowCredentials?.some(item => item.id === credentialId)).toBe(true);
    const unrelatedLogin = await completeOidc(`${origin}/company/settings/security`);
    expect(unrelatedLogin.callback.status).toBe(302);
    const unrelatedSessionId = await currentSession();
    const wrongSessionResult = await verify(unrelatedSessionId, wrongSessionOptions.challenge);
    expect(wrongSessionResult.status).not.toBe(200);
    expect(await currentSession()).toBe(unrelatedSessionId);
    expect((await verify(unrelatedSessionId, wrongSessionOptions.challenge)).status).not.toBe(200);
    expect(await currentSession()).toBe(unrelatedSessionId);
    await clearThisFixtureSignInRateLimit();

    // A changed qualification after options issuance invalidates the scoped ceremony.
    const changedPolicyProof = await finishSso(unrelatedSessionId);
    const changedPolicyOptions = await optionsFor(changedPolicyProof.proofSessionId);
    const [policy] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.providerId, providerId));
    await db.update(enterpriseIdentityPolicies).set({ updatedAt: new Date(Date.now() + 1_000) })
      .where(eq(enterpriseIdentityPolicies.id, policy!.id));
    const changedPolicyResult = await verify(changedPolicyProof.proofSessionId, changedPolicyOptions.challenge);
    expect(changedPolicyResult.status).not.toBe(200);
    expect(await currentSession()).toBe(changedPolicyProof.proofSessionId);
    await db.update(enterpriseIdentityPolicies).set({ updatedAt: policy!.updatedAt }).where(eq(enterpriseIdentityPolicies.id, policy!.id));
    await clearThisFixtureSignInRateLimit();

    // The exact callback session, current binding and pre-existing credential complete the required UV ceremony.
    const successfulProof = await finishSso(changedPolicyProof.proofSessionId);
    const authenticationOptions = await optionsFor(successfulProof.proofSessionId);
    expect(authenticationOptions.allowCredentials?.some(item => item.id === credentialId)).toBe(true);
    const [webauthnChallenge] = await db.select().from(authVerifications)
      .where(sql`${authVerifications.value} like ${`%${authenticationOptions.challenge}%`}`).limit(1);
    const webauthnValue = webauthnChallenge ? JSON.parse(webauthnChallenge.value) as Record<string, unknown> : null;
    const webauthnScope = typeof webauthnValue?.context === "string"
      ? JSON.parse(webauthnValue.context) as Record<string, unknown> : null;
    const [accountProof] = await db.select().from(authVerifications)
      .where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`));
    const storedProof = accountProof ? JSON.parse(accountProof.value) as Record<string, unknown> : null;
    const verified = await verify(successfulProof.proofSessionId, authenticationOptions.challenge);
    const errorPayload = await verified.clone().json().catch(() => null) as { code?: unknown; message?: unknown } | null;
    if (verified.status !== 200) throw new Error(JSON.stringify({ status: verified.status,
      code: typeof errorPayload?.code === "string" ? errorPayload.code : null,
      challengeContext: { present: Boolean(webauthnScope), purposeMatches: webauthnScope?.purpose === "account-deletion",
        challengeMatches: webauthnScope?.challengeId === successfulProof.challenge.challengeId,
        userMatches: webauthnScope?.userId === targetUserId,
        callbackSessionMatches: webauthnScope?.callbackSessionId === successfulProof.proofSessionId,
        sourceSessionPresent: typeof webauthnScope?.sourceSessionId === "string",
        revisionPresent: typeof webauthnScope?.policyRevision === "string" },
      proof: { state: storedProof?.state, nativeMethod: storedProof?.nativeFactorMethod,
        callbackSessionMatches: storedProof?.callbackSessionId === successfulProof.proofSessionId,
        authenticatorVersionMatches: storedProof?.authenticatorVersion === webauthnChallenge?.authenticatorVersion } }));
    expect(verified.status).toBe(200);
    const passkeySessionId = await currentSession();
    expect(passkeySessionId).not.toBe(successfulProof.proofSessionId);
    const completed = await request("/account-deletion/sso/factor-complete", "POST", {}, expectedHeaders(passkeySessionId));
    expect(completed.status, JSON.stringify(await completed.clone().json())).toBe(200);
    expect(await completed.json()).toMatchObject({ userId: targetUserId, sessionId: passkeySessionId,
      challengeId: successfulProof.challenge.challengeId, ready: true });
    const status = await (await request("/account-deletion/sso/status", "GET", undefined,
      expectedHeaders(passkeySessionId))).json();
    expect(status).toMatchObject({ available: true, requiresNativeFactor: true, nativeFactorMethod: "passkey",
      ready: true, challengeId: successfulProof.challenge.challengeId });

    const deletion = accountDeletionService(db, { enterpriseSourceSha: sourceSha, operatorUserIds: configuredOperatorUserIds,
      removeSecret: async () => {}, cancelRun: async () => {} });
    const passwordOnly = { confirmation: "DELETE MY ACCOUNT", password: operatorPassword,
      acknowledgeExport: true, idempotencyKey: "oidc-delete-pr-operator-password-only" };
    await expect(deletion.request(targetUserId, passwordOnly, new Date(),
      { type: "board", source: "session", userId: targetUserId, sessionId: passkeySessionId }))
      .rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, targetUserId))).toEqual([]);
    const receipt = await deletion.request(targetUserId, { confirmation: "DELETE MY ACCOUNT", password: operatorPassword,
      reauthenticationProofId: successfulProof.challenge.challengeId,
      acknowledgeExport: true, idempotencyKey: "oidc-delete-pr-passkey-0001" }, new Date(),
      { type: "board", source: "session", userId: targetUserId, sessionId: passkeySessionId });
    expect(receipt.status).toBe("requested");
    expect(await db.select().from(authVerifications).where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`))).toEqual([]);
    configuredOperatorUserIds.splice(configuredOperatorUserIds.indexOf(targetUserId), 1);
  });

  it("requires a fresh native passkey for a configured local operator and then permits password-confirmed deletion", async () => {
    jar.clear();
    const localOperatorId = `local-delete-operator-${randomUUID()}`;
    configuredOperatorUserIds.push(localOperatorId);
    const now = new Date(), email = `${localOperatorId}@test.invalid`, password = "LOCAL-OPERATOR-DELETE-PASSWORD-2026";
    await db.insert(authUsers).values({ id: localOperatorId, name: "Local operator fixture", email,
      emailVerified: true, phishingResistantRequired: false, createdAt: now, updatedAt: now });
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: localOperatorId,
      providerId: "credential", userId: localOperatorId, password: await hashPassword(password), createdAt: now, updatedAt: now });
    const [ownerBeforeCredential] = await db.select().from(authUsers).where(eq(authUsers.id, localOperatorId));
    expect(ownerBeforeCredential).toMatchObject({ phishingResistantRequired: false });
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    expect(jwk.x).toBeTruthy(); expect(jwk.y).toBeTruthy();
    const x = Buffer.from(jwk.x!, "base64url"), y = Buffer.from(jwk.y!, "base64url");
    const cosePublicKey = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      x, Buffer.from([0x22, 0x58, 0x20]), y]);
    const credentialId = randomBytes(32).toString("base64url");
    await db.insert(authPasskeys).values({ id: randomUUID(), name: "Local operator pre-enrolled PR key",
      publicKey: cosePublicKey.toString("base64url"), userId: localOperatorId, credentialID: credentialId, counter: 0,
      deviceType: "singleDevice", backedUp: false, transports: "internal", createdAt: now, aaguid: null });
    const [owner] = await db.select().from(authUsers).where(eq(authUsers.id, localOperatorId));
    expect(owner).toMatchObject({ phishingResistantRequired: false });
    const passwordLogin = await request("/sign-in/email", "POST", { email, password });
    expect(passwordLogin.status, JSON.stringify(await passwordLogin.clone().json())).toBe(200);
    targetUserId = localOperatorId;
    const passwordSessionId = await currentSession();
    const deletion = accountDeletionService(db, { operatorUserIds: configuredOperatorUserIds,
      removeSecret: async () => {}, cancelRun: async () => {} });
    await expect(deletion.request(localOperatorId, { confirmation: "DELETE MY ACCOUNT", password,
      acknowledgeExport: true, idempotencyKey: "local-operator-password-only-delete" }, now,
      { type: "board", source: "session", userId: localOperatorId, sessionId: passwordSessionId }))
      .rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, localOperatorId))).toEqual([]);

    const optionsResponse = await request("/passkey/generate-authenticate-options", "GET", undefined,
      expectedHeaders(passwordSessionId));
    expect(optionsResponse.status, JSON.stringify(await optionsResponse.clone().json())).toBe(200);
    const options = await optionsResponse.json() as { challenge: string; userVerification?: string;
      allowCredentials?: Array<{ id: string }> };
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials?.some(item => item.id === credentialId)).toBe(true);
    const assertion = await request("/passkey/verify-authentication", "POST",
      { response: await makePasskeyResponse(options.challenge, credentialId, privateKey) }, expectedHeaders(passwordSessionId));
    expect(assertion.status, JSON.stringify(await assertion.clone().json())).toBe(200);
    const passkeySessionId = await currentSession();
    expect(passkeySessionId).not.toBe(passwordSessionId);
    const [passkeySession] = await db.select().from(authSessions).where(eq(authSessions.id, passkeySessionId));
    expect(passkeySession).toMatchObject({ authenticationMethod: "passkey", authenticatorVersion: owner!.authenticatorVersion });
    expect(passkeySession!.authenticatedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    const [promotedOwner] = await db.select().from(authUsers).where(eq(authUsers.id, localOperatorId));
    expect(promotedOwner).toMatchObject({ phishingResistantRequired: true });

    const receipt = await deletion.request(localOperatorId, { confirmation: "DELETE MY ACCOUNT", password,
      acknowledgeExport: true, idempotencyKey: "local-operator-password-and-passkey-delete" }, new Date(),
      { type: "board", source: "session", userId: localOperatorId, sessionId: passkeySessionId });
    expect(receipt.status).toBe("requested");
    expect(await db.select().from(authVerifications).where(eq(authVerifications.identifier,
      `account-deletion-oidc:${localOperatorId}`))).toEqual([]);
    configuredOperatorUserIds.splice(configuredOperatorUserIds.indexOf(localOperatorId), 1);
  });
});
