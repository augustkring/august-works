import { randomUUID } from "node:crypto";
import { secretService } from "../services/secrets.js";
import { companyService } from "../services/companies.js";
import { saasOffboardingService } from "../services/saas/offboarding.js";
import { awsSecretsManagerProvider, createAwsSecretsManagerProvider } from "../secrets/aws-secrets-manager-provider.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  agentIdentities,
  agents,
  authUsers,
  companies,
  billingAccountCompanies,
  companyMemberships,
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
          errorCode: "offboarding_reconciliation_pending" });
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
