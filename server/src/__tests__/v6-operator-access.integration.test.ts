import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { authAccounts, authSessions, authUsers, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { saasCostService } from "../services/billing/costs.js";
import { saasSupportService } from "../services/saas/support.js";
import { saasCommercialGuard } from "../middleware/saas-commercial-guard.js";
import { authorizationService } from "../services/authorization.js";
import { instanceUserRoles } from "@paperclipai/db";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { saasRoutes } from "../routes/saas.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { SaasPlatform } from "../services/saas/platform.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 internal operator HTTP authority",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      app: express.Express,
      companyId: string,
      operatorSessionId: string,
      passwordSessionId: string;
    let service: ReturnType<typeof saasSupportService>;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-operator-");
      db = createDb(database.connectionString);
      const now = new Date();
      await db.insert(authUsers).values(
        ["owner", "operator"].map((id) => ({
          id,
          name: id,
          email: id + "@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: "operator",
        providerId: "credential", userId: "operator", password: "structural-fixture-not-a-password-hash",
        createdAt: now, updatedAt: now });
      const company = await saasOnboardingService(db).create("owner", {
        name: "Operator fixture",
        idempotencyKey: "operator-company-001",
      });
      companyId = company.companyId;
      const config = {
        environment: "staging",
        operatorUserIds: ["operator"],
      } as SaasPlatformConfig;
      service = saasSupportService(db, config);
      const platform = {
        config,
        support: service,
        costs: saasCostService(db, config),
        enabled: async () => true,
      } as unknown as SaasPlatform;
      app = express();
      app.use(express.json());
      // Authentication is stubbed at its boundary. Native cookie/verification behavior has a separate real Better Auth suite.
      app.use((req, _res, next) => {
        const userId = req.header("x-fixture-user") ?? "owner";
        const proof = req.header("x-fixture-proof");
        req.actor = {
          type: "board",
          source: req.header("x-fixture-local") ? "local_implicit" : proof === "board-key" ? "board_key" : "session",
          userId,
          companyIds: req.header("x-fixture-no-membership") ? [] : [companyId],
          isInstanceAdmin: true,
          ...(userId === "operator" && proof !== "missing" && proof !== "board-key"
            ? { sessionId: proof === "password" ? passwordSessionId : operatorSessionId } : {}),
        };
        next();
      });
      app.use("/api", saasCommercialGuard(db, platform));
      app.use("/api", saasRoutes(db, platform));
      app.use(
        "/api",
        instanceSettingsRoutes(db, {
          deploymentProfile: "saas",
          operatorUserIds: config.operatorUserIds,
        }),
      );
      app.use(errorHandler);
    }, 60000);
    beforeEach(async () => {
      operatorSessionId = await seedNativePasskeySession(db, "operator");
      const [user] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, "operator"));
      const now = new Date();
      passwordSessionId = randomUUID();
      await db.insert(authSessions).values({ id: passwordSessionId, userId: "operator", token: randomUUID(), createdAt: now,
        updatedAt: now, expiresAt: new Date(now.getTime() + 3600000), authenticationMethod: "password",
        authenticatedAt: now, authenticatorVersion: user!.version });
    });
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("denies ordinary instance admins, local implicit actors and stale account identity", async () => {
      expect(
        (
          await request(app)
            .get("/api/saas/internal/operations")
            .set("x-fixture-user", "owner")
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get("/api/saas/internal/operations")
            .set("x-fixture-user", "operator")
            .set("x-fixture-local", "1")
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get("/api/saas/internal/operations?expectedUserId=owner")
            .set("x-fixture-user", "operator")
        ).status,
      ).toBe(409);
    });
    it("closes legacy global user administration and native instance-role elevation in SaaS", async () => {
      expect(
        (
          await request(app)
            .get("/api/admin/users")
            .set("x-fixture-user", "operator")
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/api/admin/users/owner/promote-instance-admin")
            .set("x-fixture-user", "operator")
        ).status,
      ).toBe(403);
      await db
        .insert(instanceUserRoles)
        .values({ userId: "operator", role: "instance_admin" });
      const actor = {
        type: "board" as const,
        source: "session" as const,
        userId: "operator",
        isInstanceAdmin: true,
      };
      vi.stubEnv("AW_DEPLOYMENT_PROFILE", "saas");
      try {
        const decision = await authorizationService(db).decide({
          actor,
          action: "agents:configure",
          resource: { type: "company", companyId },
        });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).not.toBe("allow_instance_admin");
        const implicit = await authorizationService(db).decide({
          actor: {
            type: "board",
            source: "local_implicit",
            userId: "local-board",
          },
          action: "agents:configure",
          resource: { type: "company", companyId },
        });
        expect(implicit).toMatchObject({
          allowed: false,
          reason: "deny_unauthenticated",
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it("protects the native global settings surface with the same verified operator authority", async () => {
      expect((await request(app).get("/api/instance/settings/experimental").set("x-fixture-user","operator").set("x-fixture-no-membership","1")).status).toBe(200);
      const path = "/api/instance/settings/experimental",
        input = { billing_v6: false };
      expect(
        (
          await request(app)
            .patch(path)
            .send(input)
            .set("x-fixture-user", "owner")
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(path)
            .send(input)
            .set("x-fixture-user", "operator")
            .set("x-fixture-local", "1")
        ).status,
      ).toBe(401);
      await db
        .update(authUsers)
        .set({ emailVerified: false })
        .where(eq(authUsers.id, "operator"));
      expect(
        (
          await request(app)
            .patch(path)
            .send(input)
            .set("x-fixture-user", "operator")
        ).status,
      ).toBe(403);
      await db
        .update(authUsers)
        .set({ emailVerified: true })
        .where(eq(authUsers.id, "operator"));
      expect(
        (
          await request(app)
            .patch(path)
            .send(input)
            .set("x-fixture-user", "operator")
        ).status,
      ).toBe(200);
    });
    it("returns only bounded metadata to a verified allowlisted operator", async () => {
      const response = await request(app)
        .get("/api/saas/internal/operations?expectedUserId=operator")
        .set("x-fixture-user", "operator");
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        environment: "staging",
        hosts: [],
        profiles: [],
        versions: [],
        support: [],
        deployments: [],
      });
      expect(JSON.stringify(response.body)).not.toContain("example.test");
      expect((await request(app).get("/api/saas/internal/fleet").set("x-fixture-user", "operator")).body)
        .toEqual({ hosts: [], versions: [] });
      expect((await request(app).get("/api/saas/internal/fleet/inventory").set("x-fixture-user", "operator")).status).toBe(200);
      const costs = await request(app).get("/api/saas/internal/costs").set("x-fixture-user", "operator");
      expect(costs.status).toBe(200);
      expect(costs.body).toBeNull();
      await db
        .update(authUsers)
        .set({ emailVerified: false })
        .where(eq(authUsers.id, "operator"));
      expect(
        (
          await request(app)
            .get("/api/saas/internal/operations")
            .set("x-fixture-user", "operator")
        ).status,
      ).toBe(403);
      await db
        .update(authUsers)
        .set({ emailVerified: true })
        .where(eq(authUsers.id, "operator"));
    });
    it("requires a current passkey session across internal reads and recent passkey proof for writes", async () => {
      const path = "/api/saas/internal/operations";
      expect((await request(app).get(path).set("x-fixture-user", "operator").set("x-fixture-proof", "missing")).status).toBe(403);
      expect((await request(app).get(path).set("x-fixture-user", "operator").set("x-fixture-proof", "password")).status).toBe(403);
      expect((await request(app).post("/api/saas/internal/runtime-versions").set("x-fixture-user", "operator")
        .set("x-fixture-proof", "password").send({})).status).toBe(403);
      expect((await request(app).get(path).set("x-fixture-user", "operator").set("x-fixture-proof", "board-key")).status).toBe(403);

      await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301000) }).where(eq(authSessions.id, operatorSessionId));
      expect((await request(app).get(path).set("x-fixture-user", "operator")).status).toBe(200);
      expect((await request(app).post("/api/saas/internal/runtime-versions").set("x-fixture-user", "operator")
        .send({})).status).toBe(403);

      await db.delete(authSessions).where(eq(authSessions.id, operatorSessionId));
      expect((await request(app).get(path).set("x-fixture-user", "operator")).status).toBe(403);
    });
    it("requires an owner grant for company status and immediately honors revocation", async () => {
      const grant = await service.approve(companyId, "owner", {
        companyId,
        operatorUserId: "operator",
        reason: "Read the fixture runtime status",
        scopes: ["status:read"],
        expiresInMinutes: 10,
      });
      const path = "/api/saas/internal/support/" + grant.id + "/status";
      expect(
        (await request(app).get(path).set("x-fixture-user", "owner")).status,
      ).toBe(403);
      expect(
        (await request(app).get(path).set("x-fixture-user", "operator")).body,
      ).toMatchObject({ companyId, runtimes: [] });
      await service.revoke(companyId, "owner", grant.id);
      expect(
        (await request(app).get(path).set("x-fixture-user", "operator")).status,
      ).toBe(403);
    });
  },
);
