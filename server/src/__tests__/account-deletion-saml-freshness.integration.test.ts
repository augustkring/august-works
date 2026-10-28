// Drop-in integration fixture for server/src/__tests__ once the private
// Better Auth SSO candidate is installed in the serialized qualification copy.
// It uses the exact transitive samlify dependency of @better-auth/sso; it does
// not add or resolve an app-level samlify dependency.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import {
  createDb, authAccounts, authPasskeys, authRateLimits, authSessions, authUsers,
  authVerifications, companyMemberships, enterpriseIdentityPolicies, type Db,
} from "@paperclipai/db";
import { createBetterAuthInstance } from "../auth/better-auth.js";
import { enterpriseIdentityPolicyService, enterprisePolicyHash } from "../services/enterprise/identity-policy.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies } from "./helpers/v5-fixtures.js";
import type { Config } from "../config.js";
import type { AuthorizationActor } from "../services/authorization.js";

const testRequire = createRequire(new URL("../../package.json", import.meta.url));
const ssoEntry = testRequire.resolve("@better-auth/sso");
const saml: any = createRequire(ssoEntry)("samlify");
const support = await getEmbeddedPostgresTestSupport();
const origin = "https://enterprise.example.test";
const idpIssuer = "https://saml-idp.test.invalid";
const subject = "fixture-stable-saml-subject";
const sourceSha = "a".repeat(40);

(support.supported ? describe : describe.skip)("passwordless account deletion through signed fresh SAML reauthentication", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let auth: ReturnType<typeof createBetterAuthInstance>;
  let operator: Awaited<ReturnType<typeof seedV5Companies>>;
  let operatorActor: AuthorizationActor;
  let targetUserId: string;
  let providerId: string;
  let privateKey: string;
  let certificate: string;
  let tempDirectory: string;
  let sp: any;
  let idp: any;
  let metadataXml: string;
  let sourceSessionId: string;
  const jar = new Map<string, string>();
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const previousEncryptionKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;

  beforeAll(async () => {
    process.env.PAPERCLIP_SECRETS_MASTER_KEY = "e".repeat(64);
    process.env.BETTER_AUTH_SECRET = "account-deletion-saml-fixture-secret-with-32-characters";
    tempDirectory = mkdtempSync(join(tmpdir(), "account-delete-saml-idp-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tempDirectory, "idp-key.pem"),
      "-out", join(tempDirectory, "idp-cert.pem"), "-days", "2", "-subj", "/CN=account-delete-saml-fixture"], { stdio: "ignore" });
    privateKey = readFileSync(join(tempDirectory, "idp-key.pem"), "utf8");
    certificate = readFileSync(join(tempDirectory, "idp-cert.pem"), "utf8");

    database = await startEmbeddedPostgresTestDatabase("aw-account-delete-saml-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    operator = await seedV5Companies(db);
    const time = new Date(), operatorSessionId = randomUUID();
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: operator.userId,
      providerId: "credential", userId: operator.userId, password: "structural-fixture-not-a-password-hash",
      createdAt: time, updatedAt: time });
    await db.insert(authPasskeys).values({ id: randomUUID(), name: "SAML fixture operator structural passkey",
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

    targetUserId = `saml-delete-target-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: targetUserId, name: "SAML deletion fixture", email: `${targetUserId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: operator.home, principalType: "user", principalId: targetUserId,
      status: "active", membershipRole: "viewer" });
    const policyService = enterpriseIdentityPolicyService(db, { operatorUserIds: [operator.userId], sourceSha,
      protectedEvidenceOrigin: "https://qualification.test.invalid", appOrigin: origin });
    const policy = await policyService.configure(operatorActor, operator.home, { expectedVersion: 0,
      configuration: { protocol: "saml", issuer: idpIssuer, domain: "test.invalid", entryPoint: `${idpIssuer}/sso`, certificate },
      operatingEnvelope: { awProcessingRegions: ["dk-cph1"], providers: [], dedicatedPlacement: "none",
        retentionPolicyDescription: "Local signed SAML protocol fixture", contractEvidence: null,
        supportAccess: "native_scoped_owner_approval", limitations: ["Local signed protocol fixture; not a live provider qualification"] },
      scimRequired: false, reason: "Configure local signed SAML account deletion fixture" });
    const [configured] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.id, policy.id));
    const qualified = await policyService.qualify(operatorActor, operator.home, { expectedVersion: 1,
      configurationHash: enterprisePolicyHash(configured!), uri: "https://qualification.test.invalid/qualification/account-delete-saml",
      sha256: "f".repeat(64), expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    providerId = qualified.providerId;
    await policyService.bind(operatorActor, operator.home, { userId: targetUserId, subject,
      manageMembershipLifecycle: false, reason: "Bind the one signed SAML fixture subject" });

    const config = { deploymentProfile: "saas", deploymentMode: "authenticated", deploymentExposure: "public",
      authBaseUrlMode: "explicit", authPublicBaseUrl: origin, authDisableSignUp: true, allowedHostnames: ["enterprise.example.test"],
      port: 3100, publicOriginConfig: { primaryAppOrigin: origin, allowedAppOrigins: [origin], legacyOrigins: [] },
      saasPlatform: { deployment: { sourceSha }, operatorUserIds: [operator.userId] } } as unknown as Config;
    auth = createBetterAuthInstance(db, config, [origin]);
    const metadataResponse = await request(`/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`);
    expect(metadataResponse.status).toBe(200);
    metadataXml = await metadataResponse.text();
    expect(metadataXml).toMatch(/WantAssertionsSigned="true"/);
    sp = saml.ServiceProvider({ metadata: metadataXml });
    idp = saml.IdentityProvider({ entityID: idpIssuer, privateKey, signingCert: certificate,
      singleSignOnService: [{ Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect", Location: `${idpIssuer}/sso` }] });
  }, 60000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await database?.cleanup();
    if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousSecret;
    if (previousEncryptionKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY = previousEncryptionKey;
  }, 30000);

  function cookieHeader() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); }
  function saveCookies(response: Response) {
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(";", 1)[0] ?? "", split = pair.indexOf("=");
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
  async function currentSession(previousRedirect?: string | null) {
    const response = await request("/get-session");
    expect(response.status).toBe(200);
    const value = await response.json() as { session?: { id?: string }; user?: { id?: string } } | null;
    expect(value, `previous redirect: ${previousRedirect ?? "<none>"}`).not.toBeNull();
    expect(value?.user?.id, `previous redirect: ${previousRedirect ?? "<none>"}`).toBe(targetUserId);
    expect(value.session?.id).toBeTruthy();
    return value.session!.id!;
  }
  function expectedHeaders(sessionId: string) { return { "X-Blentera-Expected-User": targetUserId, "X-Blentera-Expected-Session": sessionId }; }
  async function startDeletionChallenge(sessionId: string) {
    const response = await request("/account-deletion/sso/start", "POST", {}, expectedHeaders(sessionId));
    expect(response.status).toBe(200);
    return response.json() as Promise<{ userId: string; challengeId: string; providerId: string; callbackURL: string }>;
  }
  async function clearSignInRateLimit() {
    await db.delete(authRateLimits).where(sql`${authRateLimits.key} like ${"%|%/sign-in/sso"}`);
  }

  type Started = { url: string; samlRequest: string; relayState: string | null; requestId: string };
  async function startSaml(callbackURL: string, sessionId?: string): Promise<Started> {
    const response = await request("/sign-in/sso", "POST", { providerId, callbackURL }, sessionId ? expectedHeaders(sessionId) : {});
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    const url = new URL(body.url);
    const samlRequest = url.searchParams.get("SAMLRequest");
    const relayState = url.searchParams.get("RelayState");
    expect(samlRequest).toBeTruthy();
    const rawRequest = inflateRawSync(Buffer.from(samlRequest!, "base64")).toString("utf8");
    const requestId = rawRequest.match(/\bID="([^"]+)"/)?.[1];
    expect(requestId).toBeTruthy();
    return { url: body.url, samlRequest: samlRequest!, relayState, requestId: requestId! };
  }

  async function signedSamlResponse(started: Started, options: {
    authnInstant?: string; omitAuthnInstant?: boolean; recipient?: string; signedSCDRequestId?: string;
    omitAssertionSignature?: boolean; expiredSCD?: boolean;
  } = {}) {
    const responseSP = options.omitAssertionSignature
      ? saml.ServiceProvider({ metadata: metadataXml.replace(/WantAssertionsSigned="true"/g, 'WantAssertionsSigned="false"') }) : sp;
    const requestInfo = await idp.parseLoginRequest(responseSP, "redirect", { query: {
      SAMLRequest: started.samlRequest, ...(started.relayState ? { RelayState: started.relayState } : {}) } });
    const now = new Date();
    const scdExpiry = new Date(now.getTime() + 120_000).toISOString();
    const authn = options.omitAuthnInstant
      ? `<saml:AuthnStatement SessionIndex="_${randomUUID()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
      : `<saml:AuthnStatement AuthnInstant="${options.authnInstant ?? now.toISOString()}" SessionIndex="_${randomUUID()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`;
    const replace = (template: string) => {
      // `customTagReplacement` is samlify's supported response-template seam;
      // samlify itself signs the finished Assertion using the ephemeral IdP key.
      let templateWithStatement = template.replace("{AuthnStatement}", authn);
      if (options.recipient) templateWithStatement = templateWithStatement.replace("{SubjectRecipient}", options.recipient);
      if (options.signedSCDRequestId) {
        // Replace only the SubjectConfirmationData token; the unsigned Response
        // still references the actual live request for the transplant case.
        templateWithStatement = templateWithStatement.replace(
          'InResponseTo="{InResponseTo}"/></saml:SubjectConfirmation>',
          `InResponseTo="${options.signedSCDRequestId}"/></saml:SubjectConfirmation>`,
        );
      }
      const acs = responseSP.entityMeta.getAssertionConsumerService("post");
      if (typeof acs !== "string" || !acs.startsWith("https://")) throw new Error("SAML fixture has no HTTPS POST ACS");
      const values = { ID: `_${randomUUID()}`, AssertionID: `_${randomUUID()}`, Destination: acs,
        Audience: responseSP.entityMeta.getEntityID(), EntityID: responseSP.entityMeta.getEntityID(),
        SubjectRecipient: acs,
        Issuer: idpIssuer, IssueInstant: now.toISOString(), StatusCode: "urn:oasis:names:tc:SAML:2.0:status:Success",
        ConditionsNotBefore: new Date(now.getTime() - 1000).toISOString(), ConditionsNotOnOrAfter: new Date(now.getTime() + 300_000).toISOString(),
        SubjectConfirmationDataNotOnOrAfter: options.expiredSCD ? new Date(now.getTime() - 1).toISOString() : scdExpiry,
        NameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified", NameID: subject,
        InResponseTo: requestInfo.extract.request.id, AuthnStatement: authn, AttributeStatement: "" };
      return { context: saml.SamlLib.replaceTagsByValue(templateWithStatement, values), id: values.ID };
    };
    const signed = await idp.createLoginResponse(responseSP, requestInfo, "post", { email: subject }, replace);
    return { SAMLResponse: signed.context, RelayState: started.relayState ?? "" };
  }

  async function submitSaml(callback: { SAMLResponse: string; RelayState: string }) {
    const response = await auth.handler(new Request(`${origin}/api/auth/sso/saml2/sp/acs/${encodeURIComponent(providerId)}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(jar.size ? { Cookie: cookieHeader() } : {}) },
      body: new URLSearchParams(callback),
    }));
    saveCookies(response);
    return response;
  }

  it("forces SP-initiated fresh authentication and accepts only its exact signed bearer assertion", async () => {
    // Establish the source browser session through an actual signed SAML ACS.
    const ordinary = await startSaml(`${origin}/company/settings/security`);
    const ordinaryXml = inflateRawSync(Buffer.from(ordinary.samlRequest, "base64")).toString("utf8");
    expect(ordinaryXml).not.toMatch(/ForceAuthn="true"/);
    const ordinaryAssertion = await signedSamlResponse(ordinary);
    const ordinaryResponseXml = Buffer.from(ordinaryAssertion.SAMLResponse, "base64").toString("utf8");
    expect(ordinaryResponseXml).toMatch(/SubjectConfirmationData[^>]*Recipient="https:\/\//);
    const ordinaryCallback = await submitSaml(ordinaryAssertion);
    expect(ordinaryCallback.status, ordinaryCallback.headers.get("location") ?? "no redirect").toBe(302);
    sourceSessionId = await currentSession(ordinaryCallback.headers.get("location"));

    // Stale, missing-authn, wrong-recipient, transplanted signed SCD request,
    // and already-expired SCD claims all fail closed and leave the proof cold.
    const badCases: Array<(started: Started) => ReturnType<typeof signedSamlResponse>> = [
      started => signedSamlResponse(started, { authnInstant: new Date(Date.now() - 600_000).toISOString() }),
      started => signedSamlResponse(started, { omitAuthnInstant: true }),
      started => signedSamlResponse(started, { recipient: `${origin}/wrong-acs` }),
      started => signedSamlResponse(started, { signedSCDRequestId: `_${randomUUID()}` }),
      started => signedSamlResponse(started, { expiredSCD: true }),
      started => signedSamlResponse(started, { omitAssertionSignature: true }),
    ];
    for (const makeResponse of badCases) {
      const challenge = await startDeletionChallenge(sourceSessionId);
      const started = await startSaml(challenge.callbackURL, sourceSessionId);
      const raw = inflateRawSync(Buffer.from(started.samlRequest, "base64")).toString("utf8");
      expect(raw).toMatch(/ForceAuthn="true"/);
      expect(started.requestId).toBeTruthy();
      const callback = await submitSaml(await makeResponse(started));
      expect(callback.status).toBe(302);
      const status = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(sourceSessionId))).json() as { ready: boolean };
      expect(status.ready).toBe(false);
      await clearSignInRateLimit();
    }

    const challenge = await startDeletionChallenge(sourceSessionId);
    const started = await startSaml(challenge.callbackURL, sourceSessionId);
    const forceAuthnRequest = inflateRawSync(Buffer.from(started.samlRequest, "base64")).toString("utf8");
    expect(forceAuthnRequest).toMatch(/ForceAuthn="true"/);
    const assertion = await signedSamlResponse(started);
    const callback = await submitSaml(assertion);
    expect(callback.status).toBe(302);
    const proofSessionId = await currentSession();
    const ready = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(proofSessionId))).json() as {
      ready: boolean; challengeId: string | null;
    };
    expect(ready).toMatchObject({ ready: true, challengeId: challenge.challengeId });

    const [proofRow] = await db.select().from(authVerifications)
      .where(eq(authVerifications.identifier, `account-deletion-oidc:${targetUserId}`));
    expect(proofRow).toBeTruthy();
    const proof = JSON.parse(proofRow!.value) as { protocol: string; samlRequestId: string; samlAssertionId: string };
    expect(proof).toMatchObject({ protocol: "saml", samlRequestId: started.requestId });
    expect(proof.samlAssertionId).toMatch(/^_/);

    // The same signed response and consumed request cannot mint a second proof.
    expect((await submitSaml(assertion)).status).toBe(302);
    const replayReady = await (await request("/account-deletion/sso/status", "GET", undefined, expectedHeaders(proofSessionId))).json() as { ready: boolean };
    expect(replayReady.ready).toBe(true);
  });
});
