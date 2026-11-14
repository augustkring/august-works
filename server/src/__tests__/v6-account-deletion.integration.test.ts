import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  accountDeletionOperations,
  agents,
  activityLog,
  authAccounts,
  authPasskeys,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
  billingAccounts,
  billingSubscriptions,
  boardApiKeys,
  companies,
  companyMemberships,
  connectionGrants,
  toolApplications,
  toolConnections,
  companySecrets,
  companySecretVersions,
  emailDeliveries,
  humanWorkflowCoverages,
  heartbeatRuns,
  principalPermissionGrants,
  supportCaseDeletionMarkers,
  supportCaseEvents,
  supportCases,
  userSecretDefinitions,
  workflowRevisions,
  workflows,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accountDeletionService as nativeAccountDeletionService } from "../services/saas/account-deletion.js";
import { secretService } from "../services/secrets.js";
import { awsSecretsManagerProvider, createAwsSecretsManagerProvider } from "../secrets/aws-secrets-manager-provider.js";
import { saasRoutes } from "../routes/saas.js";
import { open as openSealed, seal } from "../services/saas/crypto.js";
import { saasCommercialGuard } from "../middleware/saas-commercial-guard.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { AuthorizationActor } from "../services/authorization.js";
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
    const fixtureActors = new Map<string, Extract<AuthorizationActor, { type: "board" }>>();
    // These fixtures exercise the real domain owner with actual stored native
    // session IDs. Provider ceremonies are covered in native-two-factor tests.
    function accountDeletionService(reader: typeof db, callbacks: Parameters<typeof nativeAccountDeletionService>[1]) {
      const service = nativeAccountDeletionService(reader, callbacks);
      return { ...service, request: (id: string, raw: unknown, now = new Date(), actor = fixtureActors.get(id), receiptNonce?: string) =>
        service.request(id, raw, now, actor, receiptNonce) };
    }
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
      const [principal] = await db.select().from(authUsers).where(eq(authUsers.id, id));
      const sessionId = randomUUID();
      await db.insert(authSessions).values({ id: sessionId, userId: id, token: randomUUID(), createdAt: now, updatedAt: now,
        expiresAt: new Date(now.getTime()+3600_000), authenticationMethod: "password", authenticatedAt: now,
        authenticatorVersion: principal.authenticatorVersion });
      fixtureActors.set(id, { type: "board", source: "session", userId: id, sessionId });
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
      const companyId = await organization(["http-user", "http-other"]);
      const [agent] = await db.insert(agents).values({ companyId, name: "Deletion receipt fixture", role: "engineer", adapterType: "process" }).returning();
      const [pendingRun] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, responsibleUserId: "http-user", status: "queued" }).returning();
      const outbox = { encryptionKey: "a".repeat(64), keyId: "fixture.outbox", previousKeys: {} as Record<string, string> };
      const platform = {
        accountDeletion: accountDeletionService(db, effects),
        config: { environment: "production", outbox },
        enabled: async () => true,
      } as unknown as SaasPlatform;
      await user("legacy-receipt-account");
      const legacyIdempotencyKey = "legacy-receipt-fixture-001";
      await db.insert(accountDeletionOperations).values({ userId: "legacy-receipt-account",
        idempotencyKey: createHash("sha256").update(legacyIdempotencyKey).digest("hex"), status: "completed", completedAt: new Date() });
      await expect(platform.accountDeletion.prepareReceiptAccess("legacy-receipt-account", legacyIdempotencyKey, ["a".repeat(43)]))
        .rejects.toMatchObject({ status: 409 });
      await expect(platform.accountDeletion.request("legacy-receipt-account", { ...input(legacyIdempotencyKey), receiptRequired: true },
        new Date(), fixtureActors.get("legacy-receipt-account"), "a".repeat(43))).rejects.toMatchObject({ status: 409 });
      expect((await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, "legacy-receipt-account")))[0]!.receiptKeyHash)
        .toBeNull();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const userId = req.header("x-fixture-user") === "http-other" ? "http-other" : "http-user";
        req.actor = req.header("x-anonymous") ? { type: "none", source: "none" } : {
          type: "board", source: req.header("x-fixture-local") ? "local_implicit" : "session",
          userId, companyIds: [], sessionId: fixtureActors.get(userId)?.sessionId,
        };
        next();
      });
      app.use(
        "/api",
        saasCommercialGuard(db, platform),
        saasRoutes(db, platform),
      );
      app.use(errorHandler);
      const body = { ...input("http-account-fixture-001"), receiptRequired: true };
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
      expect((await request(app).post("/api/saas/account/deletion").send(body)).status).toBe(409);
      expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, "http-user"))).toHaveLength(0);
      const accessBody = { idempotencyKey: body.idempotencyKey };
      const [access, concurrentAccess] = await Promise.all([
        request(app).post("/api/saas/account/deletion/receipt-access").send(accessBody),
        request(app).post("/api/saas/account/deletion/receipt-access").send(accessBody),
      ]);
      expect(access.status).toBe(200);
      expect(concurrentAccess.status).toBe(200);
      expect(access.headers["cache-control"]).toBe("no-store");
      expect(access.body).toEqual({ ready: true });
      const receiptCookie = (access.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
      expect((access.headers["set-cookie"] as string[])[0]).toContain("HttpOnly");
      expect((access.headers["set-cookie"] as string[])[0]).toContain("SameSite=Strict");
      expect((access.headers["set-cookie"] as string[])[0]).toContain("Secure");
      expect((access.headers["set-cookie"] as string[])[0]).toContain("Path=/api/saas/account/deletion");
      const cookieMaxAge = Number((access.headers["set-cookie"] as string[])[0]!.match(/;\s*Max-Age=(\d+)/i)?.[1]);
      expect(Number.isInteger(cookieMaxAge)).toBe(true);
      expect(cookieMaxAge).toBeGreaterThan(0);
      expect(cookieMaxAge).toBeLessThanOrEqual(90 * 24 * 60 * 60);
      expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, "http-user"))).toHaveLength(0);
      const reusedAccess = await request(app).post("/api/saas/account/deletion/receipt-access").set("Cookie", receiptCookie).send(accessBody);
      expect(reusedAccess.status).toBe(200);
      expect(reusedAccess.headers["set-cookie"]).toBeUndefined();
      outbox.previousKeys[outbox.keyId] = outbox.encryptionKey;
      outbox.encryptionKey = "b".repeat(64);
      outbox.keyId = "fixture.outbox.next";
      const foreignAccess = await request(app).post("/api/saas/account/deletion/receipt-access").set("x-fixture-user", "http-other")
        .send({ idempotencyKey: "http-other-deletion-fixture-001" });
      const foreignCookie = (foreignAccess.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
      expect((await request(app).post("/api/saas/account/deletion").set("Cookie", foreignCookie).send(body)).status).toBe(409);
      expect(await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, "http-user"))).toHaveLength(0);
      const accepted = await request(app)
        .post("/api/saas/account/deletion?expectedUserId=http-user")
        .set("Cookie", receiptCookie)
        .send(body);
      expect(accepted.status).toBe(202);
      expect(accepted.body.status).toBe("requested");
      const [storedOperation] = await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, "http-user"));
      expect(storedOperation!.receiptKeyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(
        (await request(app).get("/api/saas/account/sessions")).status,
      ).toBe(401);
      const concurrentCookie = (concurrentAccess.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
      const receiptRequest = (cookie = concurrentCookie) => request(app).post("/api/saas/account/deletion/receipt")
        .set("x-anonymous", "true").set("Cookie", cookie).send({});
      const foreignLookup = await receiptRequest(foreignCookie);
      expect(foreignLookup.status).toBe(404);
      expect(foreignLookup.headers["cache-control"]).toBe("no-store");
      expect((await receiptRequest("aw_account_deletion_receipt=not-a-valid-envelope")).status).toBe(404);
      const wireValue = decodeURIComponent(receiptCookie.slice("aw_account_deletion_receipt=".length));
      const keySeparator = wireValue.indexOf("~"), oldKeyId = Buffer.from(wireValue.slice(0, keySeparator), "base64url").toString("utf8");
      const originalAccess = openSealed<{ principalHash: string; requestKeyHash: string; nonce: string; expiresAt: number }>(
        wireValue.slice(keySeparator + 1), "a".repeat(64), "account-deletion-receipt:v1");
      const foreignPrincipalEnvelope = seal({ ...originalAccess, principalHash: createHash("sha256").update("http-other").digest("hex") },
        "a".repeat(64), "account-deletion-receipt:v1");
      const foreignPrincipalCookieValue = `${Buffer.from(oldKeyId, "utf8").toString("base64url")}~${foreignPrincipalEnvelope}`;
      const foreignPrincipalCookie = `aw_account_deletion_receipt=${encodeURIComponent(foreignPrincipalCookieValue)}`;
      expect((await receiptRequest(foreignPrincipalCookie)).status).toBe(404);
      const requested = await receiptRequest();
      expect(requested.status).toBe(200);
      expect(requested.headers["cache-control"]).toBe("no-store");
      expect(requested.body).toMatchObject({ scope: "personal_account", id: storedOperation!.id, status: "requested" });
      expect(requested.body).not.toHaveProperty("userId");
      expect(requested.body).not.toHaveProperty("errorCode");
      await platform.accountDeletion.processOne(new Date(Date.now() + 1000));
      expect((await receiptRequest()).body.status).toBe("processing");
      await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, pendingRun!.id));
      await platform.accountDeletion.processOne(new Date(Date.now() + 60000));
      const completed = await receiptRequest();
      expect(completed.body).toMatchObject({ scope: "personal_account", id: storedOperation!.id, status: "completed" });
      await db.update(accountDeletionOperations).set({ createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) })
        .where(eq(accountDeletionOperations.userId, "http-user"));
      expect((await receiptRequest()).status).toBe(404);
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
    it("counts anonymous receipt guesses before lookup and resets only after the budget window", async () => {
      const service = accountDeletionService(db, effects);
      const address = "receipt-budget-fixture";
      const key = "account-deletion-receipt:" + createHash("sha256").update(address).digest("hex");
      await db.insert(authRateLimits).values({ id: randomUUID(), key, count: 119, lastRequest: Date.now() });
      await expect(service.readReceipt(null, null, address)).rejects.toMatchObject({ status: 404 });
      await expect(service.readReceipt(null, null, address)).rejects.toMatchObject({ status: 429 });
      expect((await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)))[0]!.count).toBe(121);
      await db.update(authRateLimits).set({ lastRequest: Date.now() - 61_000 }).where(eq(authRateLimits.key, key));
      await expect(service.readReceipt(null, null, address)).rejects.toMatchObject({ status: 404 });
      expect((await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)))[0]!.count).toBe(1);
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
      const workflowId = randomUUID(), revisionId = randomUUID();
      await db.transaction(async tx => {
        await tx.insert(workflows).values({ id: workflowId, companyId: id, name: "Deletion coverage fixture", status: "active", publishedRevisionId: revisionId });
        await tx.insert(workflowRevisions).values({ id: revisionId, companyId: id, workflowId, revisionNumber: 1,
          state: "published", graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} },
          createdByUserId: "coworker" });
      });
      const [coverage] = await db.insert(humanWorkflowCoverages).values({ requestId: randomUUID(), companyId: id, principalUserId: "member-delete",
        delegateeUserId: "coworker", workflowId, workflowRevisionId: revisionId, scopeType: "manual", taskId: null,
        startsAt: now, expiresAt: new Date(now.getTime() + 86400_000), reason: "Private personal leave detail" }).returning();
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
      expect(await db.select().from(humanWorkflowCoverages).where(eq(humanWorkflowCoverages.id, coverage!.id)))
        .toMatchObject([{ revokedAt: expect.any(Date), reason: "Revoked during account deletion" }]);
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
    it("keeps personal erasure pending until its original vault deletion survives disable and wire failure", async () => {
      const memberId = "managed-vault-erasure-member", ownerId = "managed-vault-erasure-owner";
      await user(memberId); await user(ownerId);
      const companyId = await organization([ownerId]);
      await db.insert(companyMemberships).values({ companyId, principalType: "user",
        principalId: memberId, membershipRole: "member" });
      const secrets = secretService(db);
      const vault = await secrets.createProviderConfig(companyId, { provider: "aws_secrets_manager",
        displayName: "Original personal vault", config: { region: "us-east-1", namespace: "account-erasure" } });
      const definition = await secrets.createUserSecretDefinition(companyId, { key: "account-private-token",
        name: "Account private token", provider: "aws_secrets_manager", providerConfigId: vault.id });
      let failDelete = true, scheduled = false, absent = false;
      const deleteWire = vi.fn(async (_input: { SecretId: string; RecoveryWindowInDays?: number }) => {
        if (failDelete) throw new Error("controlled AWS deletion failure");
        scheduled = true; return {};
      });
      const unreachable = async () => { throw new Error("unexpected AWS operation during account erasure"); };
      const provider = createAwsSecretsManagerProvider({ gateway: {
        createSecret: async input => ({ ARN: `arn:aws:secretsmanager:us-east-1:123456789012:secret:${input.Name}`,
          VersionId: "account-version-1" }),
        putSecretValue: unreachable, getSecretValue: unreachable, deleteSecret: deleteWire,
        describeSecret: async input => {
          if (absent) throw Object.assign(new Error("Original secret is absent"), { name: "ResourceNotFoundException" });
          return { ARN: input.SecretId, ...(scheduled ? { DeletedDate: 1_800_000_000 } : {}) };
        },
      } });
      const createSpy = vi.spyOn(awsSecretsManagerProvider, "createSecret").mockImplementation(provider.createSecret);
      const deleteSpy = vi.spyOn(awsSecretsManagerProvider, "deleteOrArchive").mockImplementation(provider.deleteOrArchive);
      try {
        const value = await secrets.createCurrentUserSecretValue(companyId, memberId,
          { definitionId: definition.id, value: "fixture-only-controlled-value" });
        expect(value.key).toContain(`user.${definition.key}.`);
        const originalRef = value.externalRef;
        // Component connection ownership is persisted; secret bytes/namespace
        // were produced by the actual original user-secret service above.
        const [application] = await db.insert(toolApplications).values({ companyId,
          applicationKey: `erasure-${randomUUID()}`, name: "Exclusive member credential", type: "mcp_http" }).returning();
        const [connection] = await db.insert(toolConnections).values({ companyId, applicationId: application!.id,
          name: "Exclusive member connection", uid: `erasure-${randomUUID()}`, transport: "mcp_remote",
          credentialPolicy: "per_user", status: "active", enabled: true }).returning();
        const [grant] = await db.insert(connectionGrants).values({ companyId, connectionId: connection!.id,
          kind: "user", subjectUserId: memberId, status: "active",
          credentialSecretRefs: [{ configPath: "headers.Authorization", secretId: value.id, versionSelector: "latest" }] }).returning();
        expect(originalRef).toContain(`/account-erasure/${companyId}/${value.key}`);
        await secrets.disableProviderConfig(vault.id);
        const now = new Date();
        const service = accountDeletionService(db, { ...effects, removeSecret: id => secrets.remove(id) });
        expect(await service.request(memberId, input("managed-vault-erasure-001"), now)).toMatchObject({ status: "requested" });
        expect(await secrets.getById(value.id)).toMatchObject({ ownerUserId: memberId,
          status: "deleted", key: value.key, providerConfigId: vault.id, externalRef: originalRef });
        expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant!.id)))
          .toMatchObject([{ status: "revoked", credentialSecretRefs: [] }]);
        expect(await db.select().from(authSessions).where(eq(authSessions.userId, memberId))).toEqual([]);
        expect(await db.select().from(authAccounts).where(eq(authAccounts.userId, memberId))).toEqual([]);
        expect(await db.select().from(companyMemberships).where(eq(companyMemberships.principalId, memberId))).toEqual([]);
        await service.processOne(new Date(now.getTime() + 1_000));
        const operation = async () => (await db.select().from(accountDeletionOperations)
          .where(eq(accountDeletionOperations.userId, memberId)))[0];
        expect(await operation()).toMatchObject({ status: "processing", completedAt: null,
          errorCode: "account_erasure_pending" });
        expect(await secrets.getById(value.id)).toMatchObject({ status: "deleted", key: value.key,
          providerConfigId: vault.id, externalRef: originalRef, latestVersion: 1 });
        expect(deleteSpy).not.toHaveBeenCalled(); expect(deleteWire).not.toHaveBeenCalled();
        await secrets.updateProviderConfig(vault.id, { status: "ready" });
        await service.processOne(new Date(now.getTime() + 32_000));
        expect(await operation()).toMatchObject({ status: "processing", completedAt: null,
          errorCode: "account_erasure_pending" });
        expect(await secrets.getById(value.id)).toMatchObject({ status: "deleted", key: value.key,
          providerConfigId: vault.id, externalRef: originalRef });
        expect(deleteWire).toHaveBeenCalledTimes(1);
        failDelete = false;
        await service.processOne(new Date(now.getTime() + 64_000));
        expect(await operation()).toMatchObject({ status: "processing", completedAt: null });
        expect(await secrets.getById(value.id)).toMatchObject({ status: "deleted", key: value.key, externalRef: originalRef });
        await service.processOne(new Date(now.getTime() + 96_000));
        expect(await operation()).toMatchObject({ status: "processing", completedAt: null });
        expect(deleteWire).toHaveBeenCalledTimes(2);
        absent = true;
        await service.processOne(new Date(now.getTime() + 128_000));
        expect(await operation()).toMatchObject({ status: "completed", completedAt: expect.any(Date), errorCode: null });
        expect(await db.select().from(authUsers).where(eq(authUsers.id, memberId))).toEqual([]);
        expect(await secrets.getById(value.id)).toBeNull();
        expect(await db.select().from(companySecretVersions).where(eq(companySecretVersions.secretId, value.id))).toEqual([]);
        expect(deleteWire.mock.calls.map(([call]) => call.SecretId)).toEqual([originalRef, originalRef]);
        expect(deleteSpy.mock.calls.every(([call]) => call.providerConfig?.id === vault.id &&
          call.context?.secretKey === value.key)).toBe(true);
        expect(await db.select().from(authUsers).where(eq(authUsers.id, ownerId))).toHaveLength(1);
      } finally { createSpy.mockRestore(); deleteSpy.mockRestore(); }
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
      const now = new Date(), sessionId = randomUUID();
      const [principal] = await db.select().from(authUsers).where(eq(authUsers.id, id));
      await db.insert(authSessions).values({ id: sessionId, userId: id, token: randomUUID(), createdAt: now, updatedAt: now,
        expiresAt: new Date(now.getTime()+300_000), authenticationMethod: "password", authenticatedAt: now,
        authenticatorVersion: principal.authenticatorVersion });
      fixtureActors.set(id, { type: "board", source: "session", userId: id, sessionId });
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
      const now = new Date();
      const [challenge] = await db.insert(authVerifications).values({ id: randomUUID(), identifier: randomUUID(),
        value: JSON.stringify({ type: "registration", expectedChallenge: randomUUID(),
          userData: { id, name: "Private challenge name", displayName: "Private display name" }, context: null }),
        expiresAt: new Date(now.getTime()+300_000), createdAt: now, updatedAt: now }).returning();
      const reauthKey = "password-reauth:" + createHash("sha256").update(id).digest("hex");
      await db.insert(authRateLimits).values({ id: randomUUID(), key: reauthKey, count: 3, lastRequest: 0 });
      const factorKey = "factor-reauth:" + createHash("sha256").update(id).digest("hex");
      await db.insert(authRateLimits).values({ id: randomUUID(), key: factorKey, count: 2, lastRequest: 0 });
      // Structural native proof only. Actual TOTP/recovery ceremonies are
      // exercised in native-two-factor.integration.test.ts.
      const [principal] = await db.select().from(authUsers).where(eq(authUsers.id, id));
      const proofId = randomUUID();
      await db.insert(authSessions).values({ id: proofId, userId: id, token: randomUUID(),
        createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime()+300_000),
        authenticationMethod: "passkey", authenticatedAt: now, authenticatorVersion: principal.authenticatorVersion });
      await accountDeletionService(db, effects).request(id, input("native-authenticator-erasure-001"), now,
        { type: "board", source: "session", userId: id, sessionId: proofId });
      expect(await db.select().from(authVerifications).where(eq(authVerifications.id, challenge.id))).toEqual([]);
      expect(await db.select().from(authRateLimits).where(eq(authRateLimits.key, factorKey))).toEqual([]);
      expect(await db.select().from(authRateLimits).where(eq(authRateLimits.key, reauthKey))).toEqual([]);
      expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, id))).toEqual([]);
      expect(await db.select().from(authPasskeys).where(eq(authPasskeys.userId, id))).toEqual([]);
      const [retained] = await db.select().from(authUsers).where(eq(authUsers.id, id));
      expect(retained).toMatchObject({ name: "Deleted account", emailVerified: false,
        twoFactorEnabled: false, phishingResistantRequired: true });
    });
    it("retains an account-fenced provider reservation when its in-flight create loses the reply", async () => {
      const memberId = "inflight-vault-erasure-member", ownerId = "inflight-vault-erasure-owner";
      await user(memberId); await user(ownerId);
      const companyId = await organization([ownerId]);
      await db.insert(companyMemberships).values({ companyId, principalType: "user",
        principalId: memberId, membershipRole: "member" });
      const secrets = secretService(db);
      const vault = await secrets.createProviderConfig(companyId, { provider: "aws_secrets_manager",
        displayName: "In-flight personal vault", config: { region: "us-east-1", namespace: "inflight-erasure" } });
      const definition = await secrets.createUserSecretDefinition(companyId, { key: "inflight-private-token",
        name: "In-flight private token", provider: "aws_secrets_manager", providerConfigId: vault.id });
      let entered = false, release!: () => void;
      const replyGate = new Promise<void>(resolve => { release = resolve; });
      const unreachable = async () => { throw new Error("unexpected AWS operation for unknown create"); };
      const provider = createAwsSecretsManagerProvider({ gateway: {
        createSecret: async () => {
          entered = true;
          await replyGate;
          throw new Error("controlled lost create reply after provider entry");
        },
        putSecretValue: unreachable, getSecretValue: unreachable, deleteSecret: unreachable,
      } });
      const createSpy = vi.spyOn(awsSecretsManagerProvider, "createSecret").mockImplementation(provider.createSecret);
      const deleteSpy = vi.spyOn(awsSecretsManagerProvider, "deleteOrArchive");
      const creating = secrets.createCurrentUserSecretValue(companyId, memberId,
        { definitionId: definition.id, value: "controlled-inflight-value" }).then(
          value => ({ value, error: undefined as unknown }), error => ({ value: undefined, error }));
      try {
        await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5_000 });
        const service = accountDeletionService(db, { ...effects, removeSecret: id => secrets.remove(id) });
        await service.request(memberId, input("inflight-vault-erasure-001"));
        const [reserved] = await db.select().from(companySecrets).where(and(
          eq(companySecrets.companyId, companyId), eq(companySecrets.ownerUserId, memberId)));
        expect(reserved).toMatchObject({ status: "deleted", latestVersion: 0,
          providerConfigId: vault.id, deletedAt: expect.any(Date) });
        expect(await db.select().from(authSessions).where(eq(authSessions.userId, memberId))).toEqual([]);
        release();
        expect((await creating).error).toMatchObject({ status: 502, details: { code: "provider_error" } });
        expect(await secrets.getById(reserved!.id)).toMatchObject({ status: "deleted", key: reserved!.key,
          providerConfigId: vault.id, latestVersion: 0 });
        expect(deleteSpy).not.toHaveBeenCalled();
        expect((await db.select().from(accountDeletionOperations)
          .where(eq(accountDeletionOperations.userId, memberId)))[0]).toMatchObject({ completedAt: null });
      } finally { release(); await creating; createSpy.mockRestore(); deleteSpy.mockRestore(); }
    });

  },
);
