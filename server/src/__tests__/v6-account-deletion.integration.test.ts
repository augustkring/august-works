import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountDeletionOperations,
  activityLog,
  authAccounts,
  authPasskeys,
  authRateLimits,
  authSessions,
  authTwoFactors,
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
  supportCaseDeletionMarkers,
  supportCaseEvents,
  supportCases,
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
    const supportDataPolicy = {
      schemaVersion: 1,
      policyVersion: "support-account-test-v1",
      recipientName: "Blentera Support",
      privacyNoticeUrl: "https://example.test/privacy",
      processingRegion: "eu",
      retentionTrigger: "after_last_customer_or_support_message",
      retentionDays: 30,
      backupMaxDays: 7,
      restoreLagDays: 1,
      deletionMarkerDays: 30,
      legalHoldPolicyId: "support-account-test-v1",
    } as const;
    async function createSupportCase(
      companyId: string,
      openerUserId: string,
      options: { legalHold?: boolean; deliveryState?: "pending" | "unknown" } = {},
    ) {
      const createdAt = new Date();
      const [supportCase] = await db
        .insert(supportCases)
        .values({
          companyId,
          openedByUserId: openerUserId,
          subject: "Account deletion support fixture",
          description: "Private support case fixture",
          dataPolicy: supportDataPolicy,
          legalHold: options.legalHold ?? false,
          holdReason: options.legalHold ? "Account deletion fixture hold" : null,
          createdAt,
          updatedAt: createdAt,
          lastMessageAt: createdAt,
          expiresAt: new Date(createdAt.getTime() + 86400000),
        })
        .returning();
      const [event] = await db
        .insert(supportCaseEvents)
        .values({
          companyId,
          caseId: supportCase!.id,
          authorUserId: openerUserId,
          kind: "request",
          body: "Private support event fixture",
          customerStatus: "RECEIVED",
          requestKey: randomUUID(),
          requestHash: "a".repeat(64),
          deliveryState: options.deliveryState ?? "pending",
        })
        .returning();
      return { supportCase: supportCase!, event: event! };
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
    it("erases local support content with deletion markers before completing personal account erasure", async () => {
      await user("support-local-delete");
      await user("support-local-coworker");
      const companyId = await organization([
        "support-local-delete",
        "support-local-coworker",
      ]);
      const { supportCase, event } = await createSupportCase(
        companyId,
        "support-local-delete",
      );
      const service = accountDeletionService(db, effects);

      const accepted = await service.request(
        "support-local-delete",
        input("support-local-delete-fixture-001"),
      );
      expect(accepted.status).toBe("requested");
      expect(
        await db
          .select()
          .from(supportCases)
          .where(eq(supportCases.id, supportCase.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(supportCaseEvents)
          .where(eq(supportCaseEvents.id, event.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(supportCaseDeletionMarkers)
          .where(eq(supportCaseDeletionMarkers.caseId, supportCase.id)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subjectId: supportCase.id,
            targetKind: "case",
          }),
          expect.objectContaining({
            subjectId: event.id,
            targetKind: "event",
          }),
        ]),
      );

      await service.processOne(new Date(Date.now() + 1000));
      expect(
        await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, "support-local-delete")),
      ).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(accountDeletionOperations)
            .where(eq(accountDeletionOperations.userId, "support-local-delete"))
        )[0],
      ).toMatchObject({ status: "completed", completedAt: expect.any(Date) });
    });
    it("keeps held support ownership as a scrubbed principal and leaves account erasure pending", async () => {
      await user("support-held-delete");
      await user("support-held-coworker");
      await db
        .update(authUsers)
        .set({ locale: "da" })
        .where(eq(authUsers.id, "support-held-delete"));
      const companyId = await organization([
        "support-held-delete",
        "support-held-coworker",
      ]);
      const { supportCase, event } = await createSupportCase(
        companyId,
        "support-held-delete",
        { legalHold: true, deliveryState: "unknown" },
      );
      const now = new Date();
      await db.insert(authSessions).values({ id: randomUUID(), userId: "support-held-delete", token: randomUUID(),
        createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60000) });
      const service = accountDeletionService(db, effects);

      const accepted = await service.request(
        "support-held-delete",
        input("support-held-delete-fixture-001"),
      );
      expect(accepted.status).toBe("requested");
      expect(
        (
          await db
            .select()
            .from(authUsers)
            .where(eq(authUsers.id, "support-held-delete"))
        )[0],
      ).toMatchObject({
        name: "Deleted account",
        image: null,
        emailVerified: false,
        locale: null,
      });
      expect(
        await db
          .select()
          .from(companyMemberships)
          .where(eq(companyMemberships.principalId, "support-held-delete")),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(supportCases)
          .where(eq(supportCases.id, supportCase.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(supportCaseEvents)
          .where(eq(supportCaseEvents.id, event.id)),
      ).toHaveLength(1);

      expect(await db.select().from(authSessions).where(eq(authSessions.userId, "support-held-delete"))).toEqual([]);
      expect(await db.select().from(authAccounts).where(eq(authAccounts.userId, "support-held-delete"))).toEqual([]);
      await service.processOne(new Date(Date.now() + 1000));
      expect(
        await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, "support-held-delete")),
      ).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(accountDeletionOperations)
            .where(eq(accountDeletionOperations.userId, "support-held-delete"))
        )[0],
      ).toMatchObject({
        status: "processing",
        completedAt: null,
        errorCode: "account_erasure_pending",
      });
      await db.update(supportCases).set({ legalHold: false, holdReason: null }).where(eq(supportCases.id, supportCase.id));
      await service.processOne(new Date(Date.now() + 61000));
      expect(await db.select().from(supportCases).where(eq(supportCases.id, supportCase.id))).toHaveLength(1);
      expect((await db.select().from(accountDeletionOperations)
        .where(eq(accountDeletionOperations.userId, "support-held-delete")))[0])
        .toMatchObject({ completedAt: null, errorCode: "account_erasure_pending" });
    });
    it("retains an authored local event when its other support case has uncertain sibling delivery", async () => {
      await user("support-event-author");
      await user("support-case-opener");
      await user("support-event-coworker");
      const companyId = await organization([
        "support-event-author",
        "support-case-opener",
        "support-event-coworker",
      ]);
      const { supportCase } = await createSupportCase(
        companyId,
        "support-case-opener",
      );
      const [authoredEvent] = await db
        .insert(supportCaseEvents)
        .values({
          companyId,
          caseId: supportCase.id,
          authorUserId: "support-event-author",
          kind: "customer_reply",
          body: "Private authored reply fixture",
          customerStatus: "RECEIVED",
          requestKey: randomUUID(),
          requestHash: "b".repeat(64),
          deliveryState: "pending",
        })
        .returning();
      await db.insert(supportCaseEvents).values({
        companyId,
        caseId: supportCase.id,
        authorUserId: "support-case-opener",
        kind: "support_message",
        body: "Provider outcome is uncertain",
        customerStatus: "INVESTIGATING",
        requestKey: randomUUID(),
        requestHash: "c".repeat(64),
        deliveryState: "unknown",
      });
      const service = accountDeletionService(db, effects);

      await service.request(
        "support-event-author",
        input("support-event-author-fixture-001"),
      );
      expect(
        await db
          .select()
          .from(supportCaseEvents)
          .where(eq(supportCaseEvents.id, authoredEvent!.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.id, "support-event-author")),
      ).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(accountDeletionOperations)
            .where(eq(accountDeletionOperations.userId, "support-event-author"))
        )[0],
      ).toMatchObject({ status: "requested", completedAt: null });
    });
    it("accepts the full supported Unicode password for irreversible account confirmation", async () => {
      const id = "unicode-password-offboarding", unicodePassword = "🚀".repeat(128);
      await user(id);
      await db.update(authAccounts).set({ password: await hashPassword(unicodePassword) })
        .where(eq(authAccounts.userId, id));
      await expect(accountDeletionService(db, effects).request(id, {
        ...input("unicode-password-offboarding-001"), password: unicodePassword,
      })).resolves.toMatchObject({ status: "requested" });
    });
    it("erases native authenticators when offboarding retains a scrubbed user row", async () => {
      const id = "native-authenticator-erasure";
      await user(id);
      // Structural provider records only; this test qualifies erasure, not an
      // MFA ceremony or an operator authentication policy.
      await db.insert(authTwoFactors).values({
        id: randomUUID(), userId: id, secret: "fixture-encrypted-totp",
        backupCodes: "fixture-encrypted-recovery", verified: true,
      });
      await db.update(authUsers).set({ twoFactorEnabled: true, phishingResistantRequired: true })
        .where(eq(authUsers.id, id));
      const [passkey] = await db.insert(authPasskeys).values({
        id: randomUUID(), userId: id, publicKey: "fixture-public-key", credentialID: randomUUID(),
        counter: 1, deviceType: "singleDevice", backedUp: false,
      }).returning();
      await expect(db.delete(authPasskeys).where(eq(authPasskeys.id, passkey.id)))
        .rejects.toMatchObject({ cause: { code: "23514" } });
      const reauthKey = "password-reauth:" + createHash("sha256").update(id).digest("hex");
      await db.insert(authRateLimits).values({ id: randomUUID(), key: reauthKey, count: 3, lastRequest: 0 });
      await accountDeletionService(db, effects).request(id, input("native-authenticator-erasure-001"));
      expect(await db.select().from(authRateLimits).where(eq(authRateLimits.key, reauthKey))).toEqual([]);
      expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, id))).toEqual([]);
      expect(await db.select().from(authPasskeys).where(eq(authPasskeys.userId, id))).toEqual([]);
      const [retained] = await db.select().from(authUsers).where(eq(authUsers.id, id));
      expect(retained).toMatchObject({ name: "Deleted account", emailVerified: false,
        twoFactorEnabled: false, phishingResistantRequired: true });
    });
  },
);
