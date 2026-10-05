import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { authUsers, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { saasSupportService } from "../services/saas/support.js";
import { saasCommercialGuard } from "../middleware/saas-commercial-guard.js";
import { authorizationService } from "../services/authorization.js";
import { instanceUserRoles } from "@paperclipai/db";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { saasRoutes } from "../routes/saas.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { SaasPlatform } from "../services/saas/platform.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 internal operator HTTP authority",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      app: express.Express,
      companyId: string;
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
        enabled: async () => true,
      } as unknown as SaasPlatform;
      app = express();
      app.use(express.json());
      // Authentication is stubbed at its boundary. Native cookie/verification behavior has a separate real Better Auth suite.
      app.use((req, _res, next) => {
        const userId = req.header("x-fixture-user") ?? "owner";
        req.actor = {
          type: "board",
          source: req.header("x-fixture-local") ? "local_implicit" : "session",
          userId,
          companyIds: req.header("x-fixture-no-membership") ? [] : [companyId],
          isInstanceAdmin: true,
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
