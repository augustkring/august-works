import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountDeletionOperations,
  activityLog,
  authAccounts,
  authRateLimits,
  authSessions,
  authUsers,
  billingAccounts,
  billingSubscriptions,
  boardApiKeys,
  companies,
  companyMemberships,
  companySecrets,
  companySecretVersions,
  emailDeliveries,
  principalPermissionGrants,
  userSecretDefinitions,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accountDeletionService } from "../services/saas/account-deletion.js";
import { saasRoutes } from "../routes/saas.js";
import { saasCommercialGuard } from "../middleware/saas-commercial-guard.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { SaasPlatform } from "../services/saas/platform.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 personal account offboarding",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      passwordHash: string;
    const password = "Account deletion fixture password 2026!";
    const input = (key: string) => ({
      confirmation: "DELETE MY ACCOUNT",
      password,
      acknowledgeExport: true,
      idempotencyKey: key,
    });
    const effects = {
      removeSecret: async (id: string) =>
        db.delete(companySecrets).where(eq(companySecrets.id, id)),
      cancelRun: async () => {},
    };
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase(
        "aw-v6-account-delete-",
      );
      db = createDb(database.connectionString);
      passwordHash = await hashPassword(password);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    async function user(id: string) {
      const now = new Date();
      await db.insert(authUsers).values({
        id,
        name: "Private " + id,
        email: id + "@example.test",
        emailVerified: true,
        image: "private-avatar",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(authAccounts).values({
        id: randomUUID(),
        issuer: "local:credential",
        accountId: id,
        providerId: "credential",
        userId: id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }
    async function organization(
      owners: string[],
      name = "Fixture organization",
    ) {
      const [company] = await db
        .insert(companies)
        .values({
          name,
          issuePrefix: randomUUID()
            .replaceAll("-", "")
            .slice(0, 6)
            .toUpperCase(),
        })
        .returning();
      await db.insert(companyMemberships).values(
        owners.map((id) => ({
          companyId: company!.id,
          principalType: "user",
          principalId: id,
          membershipRole: "owner",
        })),
      );
      return company!.id;
    }
    it("requires exact confirmation and the current password, preserving a durable failed-attempt budget", async () => {
      await user("password-owner");
      const service = accountDeletionService(db, effects);
      await expect(
        service.request("password-owner", {
          ...input("password-fixture-001"),
          confirmation: "delete",
        }),
      ).rejects.toBeTruthy();
      for (let i = 0; i < 10; i++)
        await expect(
          service.request("password-owner", {
            ...input("password-fixture-001"),
            password: "wrong",
          }),
        ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.request("password-owner", input("password-fixture-001")),
      ).rejects.toMatchObject({ status: 429 });
      expect(
        (await db.select().from(authRateLimits)).some(
          (row) => row.count === 11,
        ),
      ).toBe(true);
      expect(await db.select().from(accountDeletionOperations)).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(authUsers)
            .where(eq(authUsers.id, "password-owner"))
        )[0]!.name,
      ).toBe("Private password-owner");
    });
    it("binds HTTP deletion to the authenticated account and rejects stale identity, body targets and local implicit actors", async () => {
      await user("http-user");
      await user("http-other");
      const platform = {
        accountDeletion: accountDeletionService(db, effects),
        enabled: async () => true,
      } as unknown as SaasPlatform;
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.actor = {
          type: "board",
          source: req.header("x-fixture-local") ? "local_implicit" : "session",
          userId: "http-user",
          companyIds: [],
        };
        next();
      });
      app.use(
        "/api",
        saasCommercialGuard(db, platform),
        saasRoutes(db, platform),
      );
      app.use(errorHandler);
      const body = input("http-account-fixture-001");
      expect(
        (
          await request(app)
            .post("/api/saas/account/deletion?expectedUserId=http-other")
            .send(body)
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .post("/api/saas/account/deletion")
            .set("x-fixture-local", "true")
            .send(body)
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .post("/api/saas/account/deletion")
            .send({ ...body, userId: "http-other" })
        ).status,
      ).toBe(400);
      const accepted = await request(app)
        .post("/api/saas/account/deletion?expectedUserId=http-user")
        .send(body);
      expect(accepted.status).toBe(202);
      expect(accepted.body.status).toBe("requested");
      expect(
        (await request(app).get("/api/saas/account/sessions")).status,
      ).toBe(401);
      expect(
        (
          await db
            .select()
            .from(authUsers)
            .where(eq(authUsers.id, "http-other"))
        )[0]!.emailVerified,
      ).toBe(true);
      await platform.accountDeletion.processOne(new Date(Date.now() + 1000));
    });
    it("rejects sole owners including archived organizations and a misleading organization name", async () => {
      await user("sole-owner");
      const id = await organization(["sole-owner"], "Deleted company");
      await db
        .update(companies)
        .set({ status: "archived" })
        .where(eq(companies.id, id));
      await expect(
        accountDeletionService(db, effects).request(
          "sole-owner",
          input("sole-owner-fixture-001"),
        ),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "ACCOUNT_SOLE_OWNER" },
      });
      expect(
        await db
          .select()
          .from(companyMemberships)
          .where(eq(companyMemberships.companyId, id)),
      ).toHaveLength(1);
    });
    it("serializes concurrent owner departures and retains one real owner", async () => {
      await user("owner-a");
      await user("owner-b");
      const id = await organization(["owner-a", "owner-b"]);
      const service = accountDeletionService(db, effects);
      const results = await Promise.allSettled([
        service.request("owner-a", input("owner-a-fixture-001")),
        service.request("owner-b", input("owner-b-fixture-001")),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(companyMemberships)
          .where(eq(companyMemberships.companyId, id)),
      ).toHaveLength(1);
      await service.processOne(new Date(Date.now() + 1000));
    });
    it("requires closed billing and no live subscription even if the billing status claims closed", async () => {
      await user("payer-owner");
      const [account] = await db
        .insert(billingAccounts)
        .values({
          displayName: "Retained legal billing",
          payerUserId: "payer-owner",
        })
        .returning();
      const service = accountDeletionService(db, effects);
      await expect(
        service.request("payer-owner", input("payer-fixture-001")),
      ).rejects.toMatchObject({ details: { code: "ACCOUNT_BILLING_OPEN" } });
      await db
        .update(billingAccounts)
        .set({ status: "closed" })
        .where(eq(billingAccounts.id, account!.id));
      const [subscription] = await db
        .insert(billingSubscriptions)
        .values({
          billingAccountId: account!.id,
          providerSubscriptionId: "fixture-subscription",
          status: "active",
          providerUpdatedAt: new Date(),
          sourceHash: "a".repeat(64),
        })
        .returning();
      await expect(
        service.request("payer-owner", input("payer-fixture-001")),
      ).rejects.toMatchObject({ details: { code: "ACCOUNT_BILLING_OPEN" } });
      await db
        .update(billingSubscriptions)
        .set({ status: "canceled" })
        .where(eq(billingSubscriptions.id, subscription!.id));
      await service.request("payer-owner", input("payer-fixture-001"));
      await service.processOne(new Date(Date.now() + 1000));
      expect(
        await db
          .select()
          .from(billingAccounts)
          .where(eq(billingAccounts.id, account!.id)),
      ).toHaveLength(1);
    });
    it("fences access immediately and retries private credential removal without claiming completion or altering coworkers", async () => {
      await user("member-delete");
      await user("coworker");
      const id = await organization(["coworker"]),
        now = new Date();
      await db.insert(companyMemberships).values({
        companyId: id,
        principalType: "user",
        principalId: "member-delete",
        membershipRole: "member",
      });
      await db.insert(authSessions).values({
        id: randomUUID(),
        userId: "member-delete",
        token: "private-session",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60000),
      });
      await db.insert(boardApiKeys).values({
        userId: "member-delete",
        name: "Private key",
        keyHash: "a".repeat(64),
      });
      await db.insert(principalPermissionGrants).values({
        companyId: id,
        principalType: "user",
        principalId: "member-delete",
        permissionKey: "agents:create",
      });
      await db.insert(activityLog).values({
        companyId: id,
        actorType: "user",
        actorId: "member-delete",
        action: "fixture.audit",
        entityType: "company",
        entityId: id,
      });
      await db.insert(emailDeliveries).values({
        userId: "member-delete",
        purpose: "security",
        recipientHash: "b".repeat(64),
        dedupeKey: "account-erasure-email",
        payloadCiphertext: "encrypted-personal-payload",
        payloadExpiresAt: new Date(now.getTime() + 60000),
      });
      const [definition] = await db
        .insert(userSecretDefinitions)
        .values({
          companyId: id,
          key: "personal-fixture",
          name: "Personal fixture",
        })
        .returning();
      const [secret] = await db
        .insert(companySecrets)
        .values({
          companyId: id,
          key: "personal-fixture",
          name: "Personal fixture",
          scope: "user",
          ownerUserId: "member-delete",
          userSecretDefinitionId: definition!.id,
        })
        .returning();
      await db.insert(companySecretVersions).values({
        secretId: secret!.id,
        version: 1,
        material: { ciphertext: "private-fixture" },
        valueSha256: "c".repeat(64),
        fingerprintSha256: "d".repeat(64),
      });
      let fail = true;
      const service = accountDeletionService(db, {
        ...effects,
        removeSecret: async (secretId) => {
          if (fail) throw Error("Provider unavailable with private material");
          return effects.removeSecret(secretId);
        },
      });
      const accepted = await service.request(
        "member-delete",
        input("member-delete-fixture-001"),
        now,
      );
      expect(accepted.status).toBe("requested");
      expect(
        await service.request(
          "member-delete",
          input("member-delete-fixture-001"),
          now,
        ),
      ).toEqual(accepted);
      expect(
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.userId, "member-delete")),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, "member-delete")),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(boardApiKeys)
          .where(eq(boardApiKeys.userId, "member-delete")),
      ).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(authUsers)
            .where(eq(authUsers.id, "member-delete"))
        )[0],
      ).toMatchObject({
        name: "Deleted account",
        image: null,
        emailVerified: false,
      });
      expect(
        (
          await db
            .select()
            .from(emailDeliveries)
            .where(eq(emailDeliveries.userId, "member-delete"))
        )[0],
      ).toMatchObject({ payloadCiphertext: null, status: "expired" });
      await expect(
        db.insert(companyMemberships).values({
          companyId: id,
          principalType: "user",
          principalId: "member-delete",
        }),
      ).rejects.toBeTruthy();
      await expect(
        db
          .update(companySecrets)
          .set({ status: "active" })
          .where(eq(companySecrets.id, secret!.id)),
      ).rejects.toBeTruthy();
      await service.processOne(new Date(now.getTime() + 1000));
      expect(
        (
          await db
            .select()
            .from(accountDeletionOperations)
            .where(eq(accountDeletionOperations.userId, "member-delete"))
        )[0],
      ).toMatchObject({
        status: "processing",
        completedAt: null,
        errorCode: "account_erasure_pending",
      });
      fail = false;
      await service.processOne(new Date(now.getTime() + 32000));
      expect(
        await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, "member-delete")),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(companySecretVersions)
          .where(eq(companySecretVersions.secretId, secret!.id)),
      ).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(accountDeletionOperations)
            .where(eq(accountDeletionOperations.userId, "member-delete"))
        )[0]!.status,
      ).toBe("completed");
      await expect(
        db.insert(authUsers).values({
          id: "member-delete",
          name: "Resurrected",
          email: "other@example.test",
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toBeTruthy();
      expect(
        await db
          .select()
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, id),
              eq(companyMemberships.principalId, "coworker"),
            ),
          ),
      ).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(activityLog)
            .where(eq(activityLog.actorId, "member-delete"))
        )[0]!.action,
      ).toBe("fixture.audit");
    });
  },
);
