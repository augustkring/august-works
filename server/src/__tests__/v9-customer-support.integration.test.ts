import express, { type Request } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authUsers,
  companyMemberships,
  supportSessions,
  activityLog,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { saasSupportService } from "../services/saas/support.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readCustomerSupportHistory } from "../services/experience/customer-support.js";
import { customerSupportRoutes } from "../routes/customer-support.js";
import { errorHandler } from "../middleware/error-handler.js";
import { companyExperience } from "../services/experience/company-navigation.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe.sequential : describe.skip)(
  "V9 native V6 support history",
  () => {
    let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      companyId: string;
    let service: ReturnType<typeof saasSupportService>;
    const actor = {
      type: "board" as const,
      source: "session" as const,
      userId: "owner",
      isInstanceAdmin: true,
    };
    beforeAll(async () => {
      fixture = await startEmbeddedPostgresTestDatabase("v9-customer-support-");
      db = createDb(fixture.connectionString);
      await db
        .insert(authUsers)
        .values(
          ["owner", "operator", "other"].map((id) => ({
            id,
            name: id,
            email: `${id}@support.example.test`,
            emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          })),
        );
      companyId = (
        await saasOnboardingService(db).create("owner", {
          name: "Support source",
          idempotencyKey: "v9-support-company-01",
        })
      ).companyId;
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
        progressive_shell_v9: true,
        saas_deployment_profile_v6: true,
        admin_support_v6: true,
      });
      service = saasSupportService(db, {
        environment: "staging",
        operatorUserIds: ["operator"],
      } as SaasPlatformConfig);
    }, 60000);
    afterAll(async () => {
      await fixture?.cleanup();
    });
    async function approve(at = new Date()) {
      return service.approve(
        companyId,
        "owner",
        {
          companyId,
          operatorUserId: "operator",
          reason: "private-support-reason-canary",
          scopes: ["status:read", "runtime:manage"],
          expiresInMinutes: 30,
        },
        at,
      );
    }
    it("projects real original V6 approval and revocation without a new grant or private reason/owner identity", async () => {
      const session = await approve();
      const before = await db.select().from(activityLog);
      const view = await readCustomerSupportHistory(db, actor, companyId);
      expect(
        view.entries.find((entry) => entry.sessionId === session.id),
      ).toMatchObject({
        operatorReference: "operator",
        state: "recorded",
        origin: "native_v6_approval",
        scopes: ["status:read", "runtime:manage"],
      });
      expect(JSON.stringify(view)).not.toContain(
        "private-support-reason-canary",
      );
      expect(JSON.stringify(view)).not.toContain("approvedByUserId");
      expect(await db.select().from(activityLog)).toHaveLength(before.length);
      await service.revoke(companyId, "owner", session.id);
      expect(
        (await readCustomerSupportHistory(db, actor, companyId)).entries.find(
          (entry) => entry.sessionId === session.id,
        )?.state,
      ).toBe("revoked");
      await expect(
        service.status(session.id, "operator"),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("reads an expired native approval as a historical limit, without claiming an active access decision", async () => {
      const session = await approve(new Date(Date.now() - 2 * 60 * 60 * 1000));
      expect(
        (await readCustomerSupportHistory(db, actor, companyId)).entries.find(
          (entry) => entry.sessionId === session.id,
        )?.state,
      ).toBe("expired");
      await expect(
        service.status(session.id, "operator"),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("retains Native operator/owner/scope admission independently of a recorded history row", async () => {
      const session = await approve();
      await expect(service.status(session.id, "other")).rejects.toMatchObject({
        status: 403,
      });
      const removed = saasSupportService(db, {
        environment: "staging",
        operatorUserIds: [],
      } as SaasPlatformConfig);
      await expect(
        removed.status(session.id, "operator"),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await readCustomerSupportHistory(db, actor, companyId)).entries.find(
          (entry) => entry.sessionId === session.id,
        )?.state,
      ).toBe("recorded");
    });
    it("bounds and excludes another tenant's actual native approval records", async () => {
      const foreign = (
        await saasOnboardingService(db).create("other", {
          name: "Other support",
          idempotencyKey: "v9-support-company-02",
        })
      ).companyId;
      const foreignSession = await service.approve(foreign, "other", {
        companyId: foreign,
        operatorUserId: "operator",
        reason: "other-tenant-private-canary",
        scopes: ["status:read"],
        expiresInMinutes: 15,
      });
      for (let n = 0; n < 11; n++) await approve();
      const view = await readCustomerSupportHistory(db, actor, companyId);
      expect(view.entries).toHaveLength(10);
      expect(view.hasMore).toBe(true);
      expect(JSON.stringify(view)).not.toContain(foreignSession.id);
      await expect(
        readCustomerSupportHistory(db, actor, foreign),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("refuses a stale instance-admin claim and removes the Company link after native owner membership loss", async () => {
      expect(
        (await companyExperience(db, actor, companyId)).sections
          .flatMap((section) => section.entries)
          .find((entry) => entry.id === "support_access")?.href,
      ).toBe("/company/support-access");
      await db
        .update(companyMemberships)
        .set({ membershipRole: "admin" })
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalId, "owner"),
          ),
        );
      try {
        await expect(
          readCustomerSupportHistory(db, actor, companyId),
        ).rejects.toMatchObject({ status: 403 });
        expect(
          (await companyExperience(db, actor, companyId)).sections
            .flatMap((section) => section.entries)
            .some((entry) => entry.id === "support_access"),
        ).toBe(false);
      } finally {
        await db
          .update(companyMemberships)
          .set({ membershipRole: "owner" })
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalId, "owner"),
            ),
          );
      }
    });
    it("mounts account-bound private no-store HTTP and refuses changed accounts, unknown query, agents and rollback", async () => {
      const app = express();
      let current: Request["actor"] = { ...actor };
      app.use((req, _res, next) => {
        req.actor = { ...current, companyIds: [companyId] };
        next();
      });
      app.use("/api", customerSupportRoutes(db));
      app.use(errorHandler);
      const url = `/api/companies/${companyId}/experience/support-access`;
      const response = await request(app)
        .get(url)
        .query({ expectedUserId: "owner" });
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(
        (await request(app).get(url).query({ expectedUserId: "other" })).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .get(url)
            .query({ expectedUserId: "owner", extra: "private-query" })
        ).status,
      ).toBe(400);
      current = { type: "agent", source: "agent_key", agentId: "00000000-0000-4000-8000-000000000001", companyId };
      expect((await request(app).get(url).query({ expectedUserId: "owner" })).status).toBe(403);
      current = { type: "board", source: "local_implicit", userId: "owner", isInstanceAdmin: true };
      expect((await request(app).get(url).query({ expectedUserId: "local-board" })).status).toBe(403);
      current = { ...actor };
      await instanceSettingsService(db).updateExperimental({
        progressive_shell_v9: false,
      });
      try {
        expect(
          (await request(app).get(url).query({ expectedUserId: "owner" }))
            .status,
        ).toBe(404);
      } finally {
        await instanceSettingsService(db).updateExperimental({
          progressive_shell_v9: true,
        });
      }
      await instanceSettingsService(db).updateExperimental({ admin_support_v6: false });
      try { expect((await request(app).get(url).query({ expectedUserId: "owner" })).status).toBe(404); }
      finally { await instanceSettingsService(db).updateExperimental({ admin_support_v6: true }); }
      expect(await db.select().from(supportSessions)).not.toHaveLength(0);
    });
  },
);
