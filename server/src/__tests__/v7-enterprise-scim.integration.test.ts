import { secretService } from "../services/secrets.js";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  authUsers,
  authSessions,
  companyMemberships,
  principalPermissionGrants,
  enterpriseIdentityPolicies,
  enterpriseSubjectBindings,
  scimUser,
  type Db,
} from "@paperclipai/db";
import { createBetterAuthInstance } from "../auth/better-auth.js";
import {
  enterpriseIdentityPolicyService,
  enterprisePolicyHash,
} from "../services/enterprise/identity-policy.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies } from "./helpers/v5-fixtures.js";
import type { Config } from "../config.js";
const support = await getEmbeddedPostgresTestSupport(),
  origin = "https://enterprise.example.test";
(support.supported ? describe : describe.skip)(
  "native Better Auth SCIM company projection",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: Db,
      f: Awaited<ReturnType<typeof seedV5Companies>>,
      auth: ReturnType<typeof createBetterAuthInstance>,
      token: string,
      targetUserId: string;
    const previousSecret = process.env.BETTER_AUTH_SECRET;
    const previousEncryptionKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    beforeAll(async () => {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY = "a".repeat(64);
      process.env.BETTER_AUTH_SECRET =
        "enterprise-protocol-fixture-secret-with-32-characters";
      database = await startEmbeddedPostgresTestDatabase("aw-v7-scim-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
      f = await seedV5Companies(db);
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        ai_use_cases_v7: true,
        governance_evidence_v7: true,
        enterprise_identity_v7: true,
      });
      const now = new Date();
      targetUserId = `native-scim-target-${randomUUID()}`;
      await db.insert(authUsers).values({
        id: targetUserId,
        name: "Native profile",
        email: `${targetUserId}@test.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(companyMemberships).values(
        [f.home, f.guest].map((companyId) => ({
          companyId,
          principalType: "user",
          principalId: targetUserId,
          status: "active",
          membershipRole: "viewer",
        })),
      );
      await db.insert(principalPermissionGrants).values(
        [f.home, f.guest].map((companyId) => ({
          companyId,
          principalType: "user",
          principalId: targetUserId,
          permissionKey: "foundation:read",
          scope: null,
        })),
      );
      await db.insert(authSessions).values({
        id: randomUUID(),
        userId: targetUserId,
        token: randomUUID(),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const service = enterpriseIdentityPolicyService(db, {
        operatorUserIds: [f.userId],
        sourceSha: "a".repeat(40),
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        appOrigin: origin,
      });
      const policy = await service.configure(f.actor, f.home, {
        expectedVersion: 0,
        configuration: {
          protocol: "saml",
          issuer: "https://idp.test.invalid",
          domain: "test.invalid",
          entryPoint: "https://idp.test.invalid/sso",
          certificate: readFileSync(
            new URL("./fixtures/v7-idp-certificate.pem", import.meta.url),
            "utf8",
          ),
        },
        operatingEnvelope: {
          awProcessingRegions: ["dk-cph1"],
          providers: [],
          dedicatedPlacement: "none",
          retentionPolicyDescription: "Local protocol fixture",
          contractEvidence: null,
          supportAccess: "native_scoped_owner_approval",
          limitations: [
            "Local native SCIM protocol fixture, not a live IdP or enterprise GA qualification",
          ],
        },
        scimRequired: true,
        reason: "Configure scoped local lifecycle protocol fixture",
      });
      const [native] = await db
        .select()
        .from(enterpriseIdentityPolicies)
        .where(eq(enterpriseIdentityPolicies.id, policy.id));
      await service.qualify(f.actor, f.home, {
        expectedVersion: 1,
        configurationHash: enterprisePolicyHash(native!),
        uri: "https://qualification.test.invalid/qualification/local-protocol-fixture",
        sha256: "b".repeat(64),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      await service.bind(f.actor, f.home, {
        userId: targetUserId,
        subject: "stable-scim-subject",
        manageMembershipLifecycle: true,
        reason: "Explicitly approve company-scoped lifecycle mapping",
      });
      token = (await service.rotateScim(f.actor, f.home, 1, null)).token;
      const config = {
        deploymentProfile: "saas",
        deploymentMode: "authenticated",
        deploymentExposure: "public",
        authBaseUrlMode: "explicit",
        authPublicBaseUrl: origin,
        authDisableSignUp: true,
        allowedHostnames: ["enterprise.example.test"],
        port: 3100,
        publicOriginConfig: {
          primaryAppOrigin: origin,
          allowedAppOrigins: [origin],
          legacyOrigins: [],
        },
        saasPlatform: { deployment: { sourceSha: "a".repeat(40) } },
      } as unknown as Config;
      auth = createBetterAuthInstance(db, config, [origin]);
    }, 60000);
    afterAll(async () => {
      if (previousEncryptionKey === undefined)
        delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
      else process.env.PAPERCLIP_SECRETS_MASTER_KEY = previousEncryptionKey;
      await database?.cleanup();
      if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previousSecret;
    }, 30000);
    const send = (
      path: string,
      method: string,
      body?: unknown,
      bearer = token,
    ) =>
      auth.handler(
        new Request(origin + "/api/auth" + path, {
          method,
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
            Origin: origin,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );

    it("starts qualified SAML sign-in and rejects foreign providers or forged callbacks without issuing sessions", async () => {
      const policy = await enterpriseIdentityPolicyService(db, {
        operatorUserIds: [f.userId],
        sourceSha: "a".repeat(40),
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        appOrigin: origin,
      }).get(f.actor, f.home);
      const start = await send("/sign-in/sso", "POST", {
        providerId: policy.providerId,
        callbackURL: origin + "/",
      });
      const result = await start.json();
      expect(start.status, JSON.stringify(result)).toBe(200);
      expect(result.url).toMatch(/^https:\/\/idp\.test\.invalid\/sso\?/);
      expect(new URL(result.url).searchParams.get("SAMLRequest")).toBeTruthy();
      expect(
        (
          await send("/sign-in/sso", "POST", {
            providerId: "foreign-provider",
            callbackURL: origin + "/",
          })
        ).status,
      ).toBe(403);
      const before = await db.select().from(authSessions);
      const forged =
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="forged" Version="2.0" InResponseTo="unissued"><saml:Issuer>https://idp.test.invalid</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="unsigned" Version="2.0"><saml:Issuer>https://idp.test.invalid</saml:Issuer><saml:Subject><saml:NameID>stable-scim-subject</saml:NameID></saml:Subject></saml:Assertion></samlp:Response>';
      const callback = await auth.handler(
        new Request(
          origin + "/api/auth/sso/saml2/sp/acs/" + policy.providerId,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              SAMLResponse: Buffer.from(forged).toString("base64"),
            }),
          },
        ),
      );
      expect(callback.status).toBeGreaterThanOrEqual(300);
      expect(await db.select().from(authSessions)).toEqual(before);
    });
    it("uses the real framework transaction and retains other-company memberships and global sessions on deprovisioning", async () => {
      const response = await send("/scim/v2/Users", "POST", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "stable-scim-subject",
        userName: "provisioned-name@test.invalid",
        displayName: "IdP profile",
        emails: [{ value: "provisioned-name@test.invalid", primary: true }],
        active: true,
      });
      const created = await response.json();
      expect(response.status, JSON.stringify(created)).toBe(201);
      const before = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, targetUserId));
      expect(before).toHaveLength(1);
      const deactivated = await send(`/scim/v2/Users/${created.id}`, "PATCH", {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      });
      const result = await deactivated.json();
      expect(deactivated.status, JSON.stringify(result)).toBe(200);
      const memberships = await db
        .select()
        .from(companyMemberships)
        .where(eq(companyMemberships.principalId, targetUserId));
      expect(memberships.find((m) => m.companyId === f.home)?.status).toBe(
        "suspended",
      );
      expect(memberships.find((m) => m.companyId === f.guest)?.status).toBe(
        "active",
      );
      expect(
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, targetUserId)),
      ).toHaveLength(before.length);
      expect(
        await db
          .select()
          .from(principalPermissionGrants)
          .where(
            and(
              eq(principalPermissionGrants.companyId, f.home),
              eq(principalPermissionGrants.principalId, targetUserId),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(principalPermissionGrants)
          .where(
            and(
              eq(principalPermissionGrants.companyId, f.guest),
              eq(principalPermissionGrants.principalId, targetUserId),
            ),
          ),
      ).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(authUsers)
            .where(eq(authUsers.id, targetUserId))
        )[0]!.name,
      ).toBe("Native profile");
    });
    it("closes invalid credentials and disabled identity endpoints, including provider registration", async () => {
      expect(
        (await send("/scim/v2/Users", "GET", undefined, "invalid-token"))
          .status,
      ).toBe(401);
      expect(
        (await send("/sso/register", "POST", { providerId: "attacker" }))
          .status,
      ).toBe(404);
      await instanceSettingsService(db).updateExperimental({
        enterprise_identity_v7: false,
      });
      expect((await send("/scim/v2/Users", "GET")).status).toBe(404);
    });
    it("keeps credential CAS and revoked bindings terminal across native restores", async () => {
      await instanceSettingsService(db).updateExperimental({
        enterprise_identity_v7: true,
      });
      const service = enterpriseIdentityPolicyService(db, {
        operatorUserIds: [f.userId],
        sourceSha: "a".repeat(40),
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        appOrigin: origin,
      });
      const before = await service.get(f.actor, f.home);
      expect(before.configurationHash).toMatch(/^[a-f0-9]{64}$/);
      await expect(
        service.rotateScim(f.actor, f.home, before.version, null),
      ).rejects.toMatchObject({ status: 409 });
      const credential = await service.rotateScim(
        f.actor,
        f.home,
        before.version,
        before.scimCredentialId,
      );
      await expect(
        service.rotateScim(
          f.actor,
          f.home,
          before.version,
          before.scimCredentialId,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await send("/scim/v2/Users", "GET", undefined, token)).status,
      ).toBe(401);
      await expect(
        service.configure(f.actor, f.home, {
          expectedVersion: before.version,
          configuration: before.configuration,
          operatingEnvelope: before.operatingEnvelope,
          scimRequired: false,
          reason: "Attempt namespace removal fixture",
        }),
      ).rejects.toMatchObject({ status: 409 });
      const [binding] = await db
        .select()
        .from(enterpriseSubjectBindings)
        .where(eq(enterpriseSubjectBindings.companyId, f.home));
      await service.revokeBinding(f.actor, f.home, binding!.id);
      await expect(
        db
          .update(enterpriseSubjectBindings)
          .set({ status: "active" })
          .where(eq(enterpriseSubjectBindings.id, binding!.id)),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
      const response = await send(
        "/scim/v2/Users",
        "POST",
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          externalId: binding!.subject,
          userName: "restore@test.invalid",
          active: true,
        },
        credential.token,
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
    it("qualifies actual encrypted RSA metadata and invalidates OIDC on native key rotation before fetching the provider", async () => {
      const value = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey;
      const key = await secretService(db).create(
        f.guest,
        { name: "OIDC RSA fixture", provider: "local_encrypted", value },
        { userId: f.userId },
      );
      const service = enterpriseIdentityPolicyService(db, {
        operatorUserIds: [f.userId],
        sourceSha: "a".repeat(40),
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        appOrigin: origin,
      });
      const home = await service.get(f.actor, f.home);
      const policy = await service.configure(f.actor, f.guest, {
        expectedVersion: 0,
        configuration: {
          protocol: "oidc",
          issuer: "https://oidc.test.invalid",
          domain: "oidc.test.invalid",
          clientId: "native-fixture",
          discoveryEndpoint:
            "https://oidc.test.invalid/.well-known/openid-configuration",
          privateKeySecretId: key.id,
          privateKeySecretVersion: 1,
        },
        operatingEnvelope: home.operatingEnvelope,
        scimRequired: false,
        reason: "Local encrypted OIDC protocol fixture",
      });
      const qualified = await service.qualify(f.actor, f.guest, {
        expectedVersion: policy.version,
        configurationHash: policy.configurationHash,
        uri: "https://qualification.test.invalid/qualification/oidc-local-fixture",
        sha256: "b".repeat(64),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(qualified.qualification?.signingKey).toMatchObject({
        secretId: key.id,
        version: 1,
      });
      expect(JSON.stringify(qualified)).not.toContain("BEGIN PRIVATE KEY");
      await secretService(db).rotate(
        key.id,
        { value, expectedLatestVersion: 1 },
        { userId: f.userId },
      );
      expect(
        (
          await send("/sign-in/sso", "POST", {
            providerId: qualified.providerId,
            callbackURL: origin + "/",
          })
        ).status,
      ).toBe(403);
    });
    it("decommissions its company namespace without deleting global users, sessions or other-company access", async () => {
      const service = enterpriseIdentityPolicyService(db, {
        operatorUserIds: [f.userId],
        sourceSha: "a".repeat(40),
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        appOrigin: origin,
      });
      const before = await service.get(f.actor, f.home),
        sessions = await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, targetUserId));
      const result = await service.decommissionScim(
        f.actor,
        f.home,
        before.version,
      );
      expect(result).toMatchObject({
        status: "draft",
        scimRequired: false,
        scimConfigured: false,
        qualification: null,
        version: before.version + 1,
      });
      expect(await db.select().from(scimUser)).toHaveLength(0);
      expect(
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, targetUserId)),
      ).toEqual(sessions);
      const [guest] = await db
        .select()
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, f.guest),
            eq(companyMemberships.principalId, targetUserId),
          ),
        );
      expect(guest?.status).toBe("active");
      expect(
        await db.select().from(authUsers).where(eq(authUsers.id, targetUserId)),
      ).toHaveLength(1);
      const [binding] = await db
        .select()
        .from(enterpriseSubjectBindings)
        .where(eq(enterpriseSubjectBindings.companyId, f.home));
      expect(binding?.status).toBe("revoked");
      await expect(
        service.decommissionScim(f.actor, f.home, before.version),
      ).rejects.toMatchObject({ status: 409 });
    });
  },
);
