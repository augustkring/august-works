import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { HttpError } from "../errors.js";
import { errorHandler } from "../middleware/error-handler.js";
import { saasCommercialGuard } from "../middleware/saas-commercial-guard.js";
import { saasRoutes } from "../routes/saas.js";
import { saasSupportService } from "../services/saas/support.js";
import type { SaasPlatform } from "../services/saas/platform.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { SecretProviderClientError } from "../secrets/types.js";
import { secretService } from "../services/secrets.js";
import { companyService } from "../services/companies.js";
import { saasOffboardingService } from "../services/saas/offboarding.js";
import { awsSecretsManagerProvider, createAwsSecretsManagerProvider } from "../secrets/aws-secrets-manager-provider.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  createDb,
  agentIdentities,
  agents,
  authUsers,
  companies,
  billingAccountCompanies,
  companyMemberships,
  companyDeletionOperations,
  platformAdminAudit,
  authSessions,
  companySecretProviderConfigs,
  companySecretVersions,
  companyOnboardingRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 scoped content purge",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-purge-");
      db = createDb(database.connectionString);
      await db
        .insert(authUsers)
        .values({
          id: "owner",
          name: "Owner",
          email: "owner@example.test",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("holds both company purge doors until original managed secret deletion is acknowledged", async () => {
      const companyId = randomUUID(), name = "Pending managed vault company";
      await db.insert(companies).values({ id: companyId, name, issuePrefix: "PMV" });
      await db.insert(companyMemberships).values({ companyId, principalType: "user",
        principalId: "owner", membershipRole: "owner", status: "active" });
      const secrets = secretService(db);
      const vault = await secrets.createProviderConfig(companyId, { provider: "aws_secrets_manager",
        displayName: "Original company vault", config: { region: "us-east-1", namespace: "company-erasure" } });
      let failDelete = true, scheduled = false, absent = false;
      const deleteWire = vi.fn(async (_input: { SecretId: string; RecoveryWindowInDays?: number }) => {
        if (failDelete) throw new Error("controlled company AWS deletion failure");
        scheduled = true; return {};
      });
      const unreachable = async () => { throw new Error("unexpected company AWS operation"); };
      const provider = createAwsSecretsManagerProvider({ gateway: {
        createSecret: async input => ({ ARN: `arn:aws:secretsmanager:us-east-1:123456789012:secret:${input.Name}`,
          VersionId: "company-version-1" }),
        putSecretValue: unreachable, getSecretValue: unreachable, deleteSecret: deleteWire,
        describeSecret: async input => {
          if (absent) throw Object.assign(new Error("Original secret is absent"), { name: "ResourceNotFoundException" });
          return { ARN: input.SecretId, ...(scheduled ? { DeletedDate: 1_800_000_000 } : {}) };
        },
      } });
      const createSpy = vi.spyOn(awsSecretsManagerProvider, "createSecret").mockImplementation(provider.createSecret);
      const deleteSpy = vi.spyOn(awsSecretsManagerProvider, "deleteOrArchive").mockImplementation(provider.deleteOrArchive);
      try {
        const secret = await secrets.create(companyId, { name: "Company retained value", key: "company-retained-value",
          provider: "aws_secrets_manager", providerConfigId: vault.id, value: "controlled-company-value" });
        await secrets.disableProviderConfig(vault.id);
        await expect(secrets.remove(secret.id)).rejects.toMatchObject({ details: { code: "secret_provider_erasure_pending" } });
        await expect(companyService(db).remove(companyId)).rejects.toMatchObject({ details: { code: "secret_provider_erasure_pending" } });
        await expect(purgeCompanyContent(db, companyId)).rejects.toMatchObject({ details: { code: "secret_provider_erasure_pending" } });
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(await secrets.getById(secret.id)).toMatchObject({ status: "deleted", providerConfigId: vault.id,
          key: secret.key, externalRef: secret.externalRef });
        const eraseObjects = vi.fn(async () => ({ objectCount: 0 }));
        // No runtime or billable resource exists. These controlled boundaries
        // return empty evidence, not proof of erasing a real provider object.
        const offboarding = saasOffboardingService(db,
          { offboardCompany: async () => ({ subscriptionCount: 0 }) } as never,
          { cancelUnplacedForDeletion: async () => {}, list: async () => [] } as never,
          { targets: () => ({}), erase: eraseObjects } as never);
        const now = new Date();
        const requested = await offboarding.request(companyId, "owner", {
          confirmation: name, acknowledgeExport: true, idempotencyKey: `managed-company-${companyId}`,
        }, now);
        for (let step = 1; step <= 4; step++)
          await offboarding.processOne(new Date(now.getTime() + step * 1_000));
        expect(await offboarding.get(companyId)).toMatchObject({ id: requested.id, stage: "purge", completedAt: null });
        await offboarding.processOne(new Date(now.getTime() + 5_000));
        expect(await offboarding.get(companyId)).toMatchObject({ stage: "purge", completedAt: null,
          errorCode: "secret_provider_erasure_pending" });
        expect(deleteWire).not.toHaveBeenCalled(); expect(eraseObjects).not.toHaveBeenCalled();
        expect(await secrets.getProviderConfigById(vault.id)).toMatchObject({ id: vault.id, status: "disabled" });
        await secrets.updateProviderConfig(vault.id, { status: "ready" });
        await offboarding.processOne(new Date(now.getTime() + 66_000));
        expect(deleteWire).toHaveBeenCalledTimes(1);
        expect(await offboarding.get(companyId)).toMatchObject({ stage: "purge", completedAt: null });
        expect(await secrets.getById(secret.id)).toMatchObject({ status: "deleted", key: secret.key,
          externalRef: secret.externalRef, providerConfigId: vault.id });
        expect(eraseObjects).not.toHaveBeenCalled();
        failDelete = false;
        await offboarding.processOne(new Date(now.getTime() + 127_000));
        expect(await offboarding.get(companyId)).toMatchObject({ stage: "purge", completedAt: null });
        expect(eraseObjects).not.toHaveBeenCalled();
        await offboarding.processOne(new Date(now.getTime() + 188_000));
        expect(await offboarding.get(companyId)).toMatchObject({ stage: "purge", completedAt: null });
        expect(deleteWire).toHaveBeenCalledTimes(2);
        absent = true;
        await offboarding.processOne(new Date(now.getTime() + 249_000));
        expect(await offboarding.get(companyId)).toMatchObject({ status: "completed", stage: "completed",
          completedAt: expect.any(Date), errorCode: null });
        expect(deleteWire.mock.calls.map(([call]) => call.SecretId)).toEqual([secret.externalRef, secret.externalRef]);
        expect(eraseObjects).toHaveBeenCalledTimes(1);
        expect(await secrets.getById(secret.id)).toBeNull();
        expect(await db.select().from(companySecretVersions).where(eq(companySecretVersions.secretId, secret.id))).toEqual([]);
        expect(await db.select().from(companySecretProviderConfigs).where(eq(companySecretProviderConfigs.id, vault.id))).toEqual([]);
        expect((await db.select().from(companies).where(eq(companies.id, companyId)))[0])
          .toMatchObject({ status: "archived", name: "Deleted company" });
      } finally { createSpy.mockRestore(); deleteSpy.mockRestore(); }
    });

    it("parks deterministic erasure failures and resumes only the same operation under current operator authority", async () => {
      const companyId = randomUUID(), name = "Operator erasure repair";
      await db.insert(companies).values({ id: companyId, name, issuePrefix: "OER" });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "owner",
        membershipRole: "owner", status: "active" });
      const secrets = secretService(db);
      const vault = await secrets.createProviderConfig(companyId, { provider: "aws_secrets_manager",
        displayName: "Original repair vault", config: { region: "us-east-1", namespace: "repair" } });
      const create = vi.spyOn(awsSecretsManagerProvider, "createSecret").mockResolvedValue({
        material: { source: "managed", secretId: "arn:aws:secretsmanager:us-east-1:123456789012:secret:controlled" },
        valueSha256: "a".repeat(64), externalRef: "arn:aws:secretsmanager:us-east-1:123456789012:secret:controlled" });
      // Worker/service boundary controls only. These errors and the final
      // resolved provider contract do not qualify real AWS physical erasure.
      const identity = new HttpError(409, "private provider diagnostic must never be retained", {
        code: "secret_provider_erasure_identity_unresolved", privateText: "not an operator receipt" });
      const remove = vi.spyOn(awsSecretsManagerProvider, "deleteOrArchive").mockRejectedValue(identity);
      const eraseObjects = vi.fn(async () => ({ objectCount: 0 }));
      const offboarding = saasOffboardingService(db,
        { offboardCompany: async () => ({ subscriptionCount: 0 }) } as never,
        { cancelUnplacedForDeletion: async () => {}, list: async () => [] } as never,
        { targets: () => ({}), erase: eraseObjects } as never, undefined, undefined, ["owner"]);
      try {
        const secret = await secrets.create(companyId, { name: "Retained original", key: "retained-original",
          provider: "aws_secrets_manager", providerConfigId: vault.id, value: "controlled-value" });
        const now = new Date();
        const requested = await offboarding.request(companyId, "owner", { confirmation: name,
          acknowledgeExport: true, idempotencyKey: `repair-${companyId}` }, now);
        for (let step = 1; step <= 5; step++) await offboarding.processOne(new Date(now.getTime() + step * 1000));
        const failed = await offboarding.get(companyId);
        expect(failed).toMatchObject({ id: requested.id, stage: "purge", status: "failed", completedAt: null,
          errorCode: "secret_provider_erasure_identity_unresolved" });
        expect(JSON.stringify(failed!.evidence)).not.toContain("private provider diagnostic");
        expect(JSON.stringify(failed!.evidence)).not.toContain("not an operator receipt");
        expect(await offboarding.processOne(new Date(now.getTime() + 86_400_000))).toBe(false);
        expect(remove).toHaveBeenCalledTimes(1); expect(eraseObjects).not.toHaveBeenCalled();
        expect(await secrets.getById(secret.id)).toMatchObject({ status: "deleted", externalRef: secret.externalRef });
        const failure = failed!.evidence.lastFailure as { observedAt: string };
        const expected = { operationId: requested.id, errorCode: failed!.errorCode!, failedAt: failure.observedAt };
        const actor = { type: "board" as const, source: "session" as const, userId: "owner",
          sessionId: await seedNativePasskeySession(db, "owner") };
        // DB-backed session resolution exercises the mounted operator/domain
        // guards; real passkey ceremonies belong to native-auth browser tests.
        const config = { operatorUserIds: ["owner"] } as SaasPlatform["config"];
        const enabled = vi.fn(async () => false);
        const platform = { config, offboarding, enabled, support: saasSupportService(db, config) } as unknown as SaasPlatform;
        const app = express(); app.use(express.json());
        app.use(async (req, _res, next) => {
          const value = req.get("cookie")?.split(";").map(part => part.trim())
            .find(part => part.startsWith("session_token="))?.slice("session_token=".length);
          const [session] = value ? await db.select().from(authSessions).where(and(
            eq(authSessions.token, decodeURIComponent(value)), sql`${authSessions.expiresAt}>clock_timestamp()`,
          )).limit(1) : [];
          req.actor = session ? { type: "board", source: req.get("x-fixture-local") ? "local_implicit" : "session",
            userId: session.userId, sessionId: session.id, companyIds: [],
            authenticatedCredentialExpiresAt: session.expiresAt.getTime() } : { type: "none", source: "none" };
          next();
        });
        app.use("/api", saasCommercialGuard(db, platform), saasRoutes(db, platform)); app.use(errorHandler);
        const [session] = await db.select().from(authSessions).where(eq(authSessions.id, actor.sessionId));
        const cookie = `session_token=${encodeURIComponent(session!.token)}`;
        const url = `/api/saas/internal/company-deletions/${companyId}/retry`;
        expect((await request(app).get("/api/saas/internal/company-deletions")).status).toBe(401);
        expect((await request(app).post(url).set("Cookie", cookie).set("x-fixture-local", "true").send(expected)).status).toBe(401);
        await db.insert(authUsers).values({ id: "offboarding-nonoperator", name: "Other owner",
          email: "other-offboarding@example.test", emailVerified: true, createdAt: now, updatedAt: now });
        await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "offboarding-nonoperator",
          membershipRole: "owner", status: "active" });
        const otherSessionId = await seedNativePasskeySession(db, "offboarding-nonoperator");
        const [otherSession] = await db.select().from(authSessions).where(eq(authSessions.id, otherSessionId));
        expect((await request(app).get("/api/saas/internal/company-deletions")
          .set("Cookie", `session_token=${encodeURIComponent(otherSession!.token)}`)).status).toBe(403);
        await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 360_000) })
          .where(eq(authSessions.id, actor.sessionId));
        expect((await request(app).get("/api/saas/internal/company-deletions").set("Cookie", cookie)).status).toBe(200);
        expect((await request(app).post(url).set("Cookie", cookie).send(expected)).status).toBe(403);
        await db.update(authSessions).set({ authenticatedAt: new Date() }).where(eq(authSessions.id, actor.sessionId));
        const extraCompanies = Array.from({ length: 101 }, (_, index) => ({ id: randomUUID(), name: `Recovery queue ${index}`,
          issuePrefix: `RQ${index}`, status: "archived" }));
        await db.insert(companies).values(extraCompanies);
        await db.insert(companyDeletionOperations).values(extraCompanies.map(company => ({ companyId: company.id,
          requestedByUserId: "owner", idempotencyKey: `page-${company.id}`, status: "failed", stage: "purge",
          errorCode: "secret_provider_erasure_identity_unresolved", evidence: { lastFailure: { observedAt: now.toISOString() } } })));
        const page = await request(app).get("/api/saas/internal/company-deletions").set("Cookie", cookie);
        const customerStatus = await request(app).get(`/api/companies/${companyId}/deletion`).set("Cookie", cookie);
        expect(customerStatus.status).toBe(200);
        expect(customerStatus.headers["cache-control"]).toBe("private, no-store");
        expect(customerStatus.body).toMatchObject({ id: requested.id, status: "failed", errorCode: expected.errorCode });
        expect(Number.isFinite(Date.parse(customerStatus.body.notBefore))).toBe(true);
        expect(page.status).toBe(200); expect(page.headers["cache-control"]).toBe("private, no-store");
        expect(page.body.operations).toHaveLength(100); expect(page.body.nextCursor).toBeTruthy();
        const secondPage = await request(app).get("/api/saas/internal/company-deletions")
          .query({ after: page.body.nextCursor }).set("Cookie", cookie);
        expect(secondPage.status).toBe(200); expect(secondPage.body.nextCursor).toBeNull();
        const listed = [...page.body.operations, ...secondPage.body.operations];
        expect(new Set(listed.map(row => row.id)).size).toBe(102);
        expect(listed.find(row => row.id === requested.id)).toMatchObject({ companyId,
          errorCode: expected.errorCode, lastFailure: { observedAt: expected.failedAt } });
        expect(JSON.stringify(listed)).not.toContain("private provider");
        expect(listed.every(row => !Object.hasOwn(row, "requestedByUserId") && !Object.hasOwn(row, "evidence"))).toBe(true);
        expect((await request(app).post(url).set("Cookie", cookie).send({ ...expected, errorCode: "unknown" })).status).toBe(400);
        expect((await request(app).post(url).set("Cookie", cookie).send({ ...expected, failedAt: now.toISOString() })).status).toBe(409);
        await expect(offboarding.recover(companyId, { ...actor, source: "local_implicit" }, expected))
          .rejects.toMatchObject({ status: 403 });
        await expect(offboarding.recover(companyId, actor, { ...expected, operationId: randomUUID() }))
          .rejects.toMatchObject({ status: 404 });
        await expect(offboarding.recover(companyId, actor, { ...expected, failedAt: now.toISOString() }))
          .rejects.toMatchObject({ status: 409 });
        const recovered = await request(app).post(url).set("Cookie", cookie).send(expected);
        expect(recovered.status).toBe(202); expect(recovered.headers["cache-control"]).toBe("private, no-store");
        expect(recovered.body).toMatchObject({ id: requested.id, stage: "purge", status: "processing" });
        expect((await request(app).post(url).set("Cookie", cookie).send(expected)).status).toBe(409);
        expect(enabled).not.toHaveBeenCalled();
        await expect(offboarding.recover(companyId, actor, expected)).rejects.toMatchObject({ status: 409 });
        remove.mockRejectedValue(new SecretProviderClientError({ provider: "aws_secrets_manager", operation: "deleteSecret",
          code: "conflict", message: "scheduled deletion", rawMessage: "private provider payload" }));
        await offboarding.processOne(new Date(now.getTime() + 10_000));
        expect(await offboarding.get(companyId)).toMatchObject({ id: requested.id, status: "processing",
          errorCode: "secret_provider_erasure_pending", completedAt: null });
        remove.mockRejectedValue(new SecretProviderClientError({ provider: "aws_secrets_manager", operation: "deleteSecret",
          code: "access_denied", message: "private access diagnostic", rawMessage: "private provider payload" }));
        await offboarding.processOne(new Date(now.getTime() + 71_000));
        const denied = await offboarding.get(companyId);
        expect(denied).toMatchObject({ status: "failed", errorCode: "offboarding_provider_access_denied", completedAt: null });
        await db.delete(authSessions).where(eq(authSessions.id, actor.sessionId));
        const deniedExpected = { operationId: requested.id, errorCode: denied!.errorCode!,
          failedAt: (denied!.evidence.lastFailure as { observedAt: string }).observedAt };
        await expect(offboarding.recover(companyId, actor, deniedExpected)).rejects.toMatchObject({ status: 403 });
        expect((await request(app).post(url).set("Cookie", cookie).send(deniedExpected)).status).toBe(401);
        expect(await secrets.getById(secret.id)).not.toBeNull(); expect(eraseObjects).not.toHaveBeenCalled();
        const audit = await db.select().from(platformAdminAudit).where(eq(platformAdminAudit.resourceId, requested.id));
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ action: "company.deletion_recovery_requested", operatorUserId: "owner" });
        expect(JSON.stringify(audit)).not.toContain("private provider");
      } finally { create.mockRestore(); remove.mockRestore(); }
    });

    it("keeps a parked operation and concurrent evidence when an earlier billing worker settles late", async () => {
      const companyId = randomUUID(), name = "Late offboarding worker";
      await db.insert(companies).values({ id: companyId, name, issuePrefix: "LOW" });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "owner",
        membershipRole: "owner", status: "active" });
      let calls = 0, releaseFirst!: () => void;
      const released = new Promise<void>(resolve => { releaseFirst = resolve; });
      const offboarding = saasOffboardingService(db, { offboardCompany: async () => {
        if (++calls === 1) { await released; return { subscriptionCount: 0 }; }
        throw new SecretProviderClientError({ provider: "aws_secrets_manager", operation: "deleteSecret",
          code: "access_denied", message: "controlled permanent owner failure" });
      } } as never, { cancelUnplacedForDeletion: async () => {}, list: async () => [] } as never,
      { targets: () => ({}), erase: vi.fn() } as never);
      const now = new Date();
      const requested = await offboarding.request(companyId, "owner", { confirmation: name,
        acknowledgeExport: true, idempotencyKey: `late-${companyId}` }, now);
      await offboarding.processOne(new Date(now.getTime() + 1_000));
      await offboarding.processOne(new Date(now.getTime() + 2_000));
      expect(await offboarding.get(companyId)).toMatchObject({ stage: "billing" });
      // PostgreSQL retains microseconds that a JavaScript Date cannot carry.
      await db.update(companyDeletionOperations).set({
        notBefore: sql`date_trunc('second', clock_timestamp()) - interval '1 second' + interval '0.123456 seconds'`,
      }).where(eq(companyDeletionOperations.id, requested.id));
      const first = offboarding.processOne(new Date(now.getTime() + 5_000));
      try {
        await vi.waitFor(() => expect(calls).toBe(1));
        await db.update(companyDeletionOperations).set({ evidence:
          sql`${companyDeletionOperations.evidence} || '{"concurrentFundingReceipt":"retained"}'::jsonb`,
        }).where(eq(companyDeletionOperations.id, requested.id));
        await offboarding.processOne(new Date(now.getTime() + 5_000));
        expect(await offboarding.get(companyId)).toMatchObject({ stage: "billing", status: "failed",
          errorCode: "offboarding_provider_access_denied", completedAt: null,
          evidence: { concurrentFundingReceipt: "retained" } });
      } finally { releaseFirst(); await first; }
      expect(await offboarding.get(companyId)).toMatchObject({ stage: "billing", status: "failed",
        errorCode: "offboarding_provider_access_denied", completedAt: null,
        evidence: { concurrentFundingReceipt: "retained", lastFailure: { recoveryRequired: true } } });
      expect(await offboarding.processOne(new Date(now.getTime() + 86_400_000))).toBe(false);
      expect(calls).toBe(2);
    });

    it("erases owned content and orphan persona metadata while preserving other companies and billing tombstones", async () => {
      const onboarding = saasOnboardingService(db),
        first = await onboarding.create("owner", {
          name: "Deleted fixture",
          idempotencyKey: "deleted-fixture-001",
        }),
        second = await onboarding.create("owner", {
          name: "Retained fixture",
          idempotencyKey: "retained-fixture-001",
        });
      const [shared, orphan] = await db
        .insert(agentIdentities)
        .values([
          { name: "Shared persona", homeCompanyId: first.companyId },
          {
            name: "Private persona",
            homeCompanyId: first.companyId,
            description: "Erase private profile",
          },
        ])
        .returning();
      await db.insert(agents).values([
        {
          companyId: first.companyId,
          agentIdentityId: shared!.id,
          name: "Deleted presence",
        },
        {
          companyId: first.companyId,
          agentIdentityId: orphan!.id,
          name: "Private presence",
        },
        {
          companyId: second.companyId,
          agentIdentityId: shared!.id,
          name: "Retained presence",
        },
      ]);
      const before = await db
        .select()
        .from(companyMemberships)
        .where(eq(companyMemberships.companyId, second.companyId));
      await expect(
        purgeCompanyContent(db, first.companyId),
      ).rejects.toBeTruthy();
      await db
        .update(agentIdentities)
        .set({ homeCompanyId: second.companyId })
        .where(eq(agentIdentities.id, shared!.id));
      const result = await purgeCompanyContent(db, first.companyId);
      expect(result.companyTombstoneRetained).toBe(true);
      expect(
        await db
          .select()
          .from(agents)
          .where(eq(agents.companyId, first.companyId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(companyOnboardingRuns)
          .where(eq(companyOnboardingRuns.companyId, first.companyId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(billingAccountCompanies)
          .where(eq(billingAccountCompanies.companyId, first.companyId)),
      ).toHaveLength(1);
      const [tombstone] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, first.companyId));
      expect(tombstone!.name).toBe("Deleted company");
      const [retained] = await db
        .select()
        .from(agents)
        .where(eq(agents.companyId, second.companyId));
      expect(retained!.name).toBe("Retained presence");
      expect(
        await db
          .select()
          .from(companyMemberships)
          .where(eq(companyMemberships.companyId, second.companyId)),
      ).toEqual(before);
      const [persona] = await db
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.id, orphan!.id));
      expect(persona).toMatchObject({
        name: "Deleted agent",
        description: null,
        status: "archived",
      });
      const [active] = await db
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.id, shared!.id));
      expect(active!.name).toBe("Shared persona");
      expect(
        (await db.select().from(authUsers).where(eq(authUsers.id, "owner")))[0]!
          .email,
      ).toBe("owner@example.test");
    });
  },
);
