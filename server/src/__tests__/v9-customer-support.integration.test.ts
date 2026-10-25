import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authUsers,
  authSessions,
  companyMemberships,
  supportSessions,
  supportCases,
  supportCaseEvents,
  supportCaseDeletionMarkers,
  companyDeletionOperations,
  companies,
  activityLog,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { saasSupportService } from "../services/saas/support.js";
import { saasRoutes } from "../routes/saas.js";
import { v6FeatureEnabled, type V6FeatureKey } from "@paperclipai/shared";
import type { SaasPlatform } from "../services/saas/platform.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readCustomerSupportHistory } from "../services/experience/customer-support.js";
import { customerSupportRoutes } from "../routes/customer-support.js";
import { errorHandler } from "../middleware/error-handler.js";
import { companyExperience } from "../services/experience/company-navigation.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe.sequential : describe.skip)(
  "V9 native V6 support history",
  () => {
    let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      companyId: string;
    let operatorActor: AuthorizationActor, otherActor: AuthorizationActor;
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
      await db.insert(authUsers).values(
        ["owner", "operator", "other"].map((id) => ({
          id,
          name: id,
          email: `${id}@support.example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
      operatorActor = {
        type: "board", source: "session", userId: "operator",
        sessionId: await seedNativePasskeySession(db, "operator"),
      };
      otherActor = {
        type: "board", source: "session", userId: "other",
        sessionId: await seedNativePasskeySession(db, "other"),
      };
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
        service.status(session.id, operatorActor),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("replays a committed Native revocation after lost acknowledgement without moving its original receipt", async () => {
      const session = await approve();
      const transact = db.transaction.bind(db);
      let dropped = false;
      const loseAck = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (callback, config) => {
          const result = await transact(callback, config);
          if (!dropped) {
            dropped = true;
            throw new Error("Lost Native revocation acknowledgement");
          }
          return result;
        });
      try {
        await expect(
          service.revoke(companyId, actor.userId, session.id),
        ).rejects.toThrow("Lost Native revocation acknowledgement");
      } finally {
        loseAck.mockRestore();
      }
      const [original] = await db
        .select()
        .from(supportSessions)
        .where(eq(supportSessions.id, session.id));
      expect(original?.revokedAt).not.toBeNull();
      const replay = await service.revoke(
        companyId,
        actor.userId,
        session.id,
        new Date(Date.now() + 60000),
      );
      expect(replay.revokedAt).toEqual(original!.revokedAt);
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, session.id),
              eq(activityLog.action, "support.access_revoked"),
            ),
          ),
      ).toHaveLength(1);
      await expect(
        service.status(session.id, operatorActor),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("serializes concurrent Native revocation and repeats current owner admission on replay", async () => {
      const session = await approve();
      const times = [new Date(), new Date(Date.now() + 60000)];
      const replies = await Promise.all(
        times.map((now) =>
          service.revoke(companyId, actor.userId, session.id, now),
        ),
      );
      expect(replies[0]!.revokedAt).toEqual(replies[1]!.revokedAt);
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, session.id),
              eq(activityLog.action, "support.access_revoked"),
            ),
          ),
      ).toHaveLength(1);
      await db
        .update(companyMemberships)
        .set({ status: "suspended" })
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalId, actor.userId),
          ),
        );
      try {
        await expect(
          service.revoke(companyId, actor.userId, session.id),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await db
          .update(companyMemberships)
          .set({ status: "active" })
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalId, actor.userId),
            ),
          );
      }
    });
    it("replays the exact Native approval after lost post-commit acknowledgement with one immutable grant and audit", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Original reviewed support access",
        scopes: ["status:read", "runtime:manage"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const transact = db.transaction.bind(db);
      const loseAck = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (callback, config) => {
          await transact(callback, config);
          throw new Error("Lost approval acknowledgement after commit");
        });
      try {
        await expect(
          service.approve(companyId, "owner", input),
        ).rejects.toThrow("Lost approval acknowledgement after commit");
      } finally {
        loseAck.mockRestore();
      }
      const original = await service.get(companyId, "owner", input.approvalId);
      const replay = await service.approve(
        companyId,
        "owner",
        input,
        new Date(Date.now() + 60000),
      );
      expect(replay).toEqual(original);
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, input.approvalId),
              eq(activityLog.action, "support.access_approved"),
            ),
          ),
      ).toHaveLength(1);
      await service.revoke(companyId, "owner", original.id);
      const revoked = await service.approve(companyId, "owner", input);
      expect(revoked.revokedAt).not.toBeNull();
      expect(revoked.createdAt).toEqual(original.createdAt);
      await expect(
        service.status(original.id, operatorActor),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("serializes concurrent original approvals and refuses every changed immutable field", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Concurrent reviewed support access",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const replies = await Promise.all([
        service.approve(companyId, "owner", input),
        service.approve(companyId, "owner", input),
      ]);
      expect(replies[0]).toEqual(replies[1]);
      for (const patch of [
        { reason: "Changed approved purpose" },
        { scopes: ["runtime:manage"] },
        { expiresInMinutes: 60 },
      ])
        await expect(
          service.approve(companyId, "owner", { ...input, ...patch }),
        ).rejects.toMatchObject({
          status: 409,
          details: { code: "SUPPORT_APPROVAL_CHANGED" },
        });
      expect(
        await db
          .select()
          .from(supportSessions)
          .where(eq(supportSessions.id, input.approvalId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, input.approvalId),
              eq(activityLog.action, "support.access_approved"),
            ),
          ),
      ).toHaveLength(1);
      expect(
        await service.approve(companyId, "owner", {
          ...input,
          scopes: ["status:read", "status:read"],
        }),
      ).toEqual(replies[0]);
    });
    it("retains expired approval time and rechecks current owner, operator and Native rollout on replay or receipt read", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Expired reviewed support access",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const original = await service.approve(
        companyId,
        "owner",
        input,
        new Date(Date.now() - 3600000),
      );
      expect(await service.approve(companyId, "owner", input)).toEqual(
        original,
      );
      await expect(
        service.status(original.id, operatorActor),
      ).rejects.toMatchObject({ status: 403 });
      const withdrawn = saasSupportService(db, {
        environment: "staging",
        operatorUserIds: [],
      } as unknown as SaasPlatformConfig);
      await expect(
        withdrawn.approve(companyId, "owner", input),
      ).rejects.toMatchObject({ status: 403 });
      await db
        .update(companyMemberships)
        .set({ status: "suspended" })
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalId, "owner"),
          ),
        );
      try {
        await expect(
          service.approve(companyId, "owner", input),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          service.get(companyId, "owner", original.id),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await db
          .update(companyMemberships)
          .set({ status: "active" })
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalId, "owner"),
            ),
          );
      }
      await instanceSettingsService(db).updateExperimental({
        admin_support_v6: false,
      });
      try {
        await expect(
          service.approve(companyId, "owner", input),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          service.get(companyId, "owner", original.id),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await instanceSettingsService(db).updateExperimental({
          admin_support_v6: true,
        });
      }
    });
    it("refuses a missing or ambiguous Native approval audit rather than inferring a successful grant", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Native approval audit binding",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const original = await service.approve(companyId, "owner", input);
      const [audit] = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, original.id),
            eq(activityLog.action, "support.access_approved"),
          ),
        );
      await db.delete(activityLog).where(eq(activityLog.id, audit!.id));
      try {
        await expect(
          service.approve(companyId, "owner", input),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.get(companyId, "owner", original.id),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await db.insert(activityLog).values(audit!);
      }
      const [duplicate] = await db
        .insert(activityLog)
        .values({ ...audit!, id: randomUUID() })
        .returning();
      try {
        await expect(
          service.approve(companyId, "owner", input),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.get(companyId, "owner", original.id),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await db.delete(activityLog).where(eq(activityLog.id, duplicate!.id));
      }
      expect(await service.get(companyId, "owner", original.id)).toEqual(
        original,
      );
      await expect(
        service.get(companyId, "owner", randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("durably retains a content-free review across a new service instance and blocks a replacement reference", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Private reason before approval canary",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      const before = await db.select().from(supportSessions);
      const prepared = await service.prepareApproval(companyId, "owner", input);
      const restarted = saasSupportService(db, {
        environment: "staging",
        operatorUserIds: ["operator"],
      } as SaasPlatformConfig);
      expect(await restarted.pendingApproval(companyId, "owner")).toEqual(
        prepared,
      );
      expect(
        await restarted.prepareApproval(companyId, "owner", input),
      ).toEqual(prepared);
      expect(await db.select().from(supportSessions)).toHaveLength(
        before.length,
      );
      const reviews = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, input.approvalId),
            eq(activityLog.action, "support.approval_reviewed"),
          ),
        );
      expect(reviews).toHaveLength(1);
      expect(Object.keys(reviews[0]!.details!)).toEqual(["requestHash"]);
      expect(JSON.stringify(reviews)).not.toContain(input.reason);
      expect(JSON.stringify(reviews)).not.toContain('"operatorUserId"');
      await expect(
        restarted.prepareApproval(companyId, "owner", {
          ...input,
          approvalId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "SUPPORT_REVIEW_PENDING" },
      });
      await restarted.cancelApproval(companyId, "owner", input.approvalId);
      expect(await restarted.pendingApproval(companyId, "owner")).toBeNull();
    });
    it("cancels an original ungranted request and fences a late approval without revoking an already-recorded grant", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Cancel original pending approval",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const cancelled = await service.cancelApproval(
        companyId,
        "owner",
        input.approvalId,
      );
      expect(cancelled.state).toBe("cancelled");
      expect(
        await service.cancelApproval(companyId, "owner", input.approvalId),
      ).toEqual(cancelled);
      await expect(
        service.approve(companyId, "owner", input),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "SUPPORT_APPROVAL_CANCELLED" },
      });
      expect(
        await db
          .select()
          .from(supportSessions)
          .where(eq(supportSessions.id, input.approvalId)),
      ).toHaveLength(0);
      const next = { ...input, approvalId: randomUUID() };
      await service.prepareApproval(companyId, "owner", next);
      const grant = await service.approve(companyId, "owner", next);
      expect(await service.pendingApproval(companyId, "owner")).toBeNull();
      expect(
        (await service.cancelApproval(companyId, "owner", next.approvalId))
          .state,
      ).toBe("recorded");
      expect(
        (await service.get(companyId, "owner", grant.id)).revokedAt,
      ).toBeNull();
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, next.approvalId),
              eq(activityLog.action, "support.approval_cancelled"),
            ),
          ),
      ).toHaveLength(0);
      await service.revoke(companyId, "owner", grant.id);
    });
    it("serializes original cancellation versus grant and retains cancellation recovery after rollout rollback", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Concurrent Native grant or cancellation",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const [cancelled, approved] = await Promise.allSettled([
        service.cancelApproval(companyId, "owner", input.approvalId),
        service.approve(companyId, "owner", input),
      ]);
      expect(cancelled.status).toBe("fulfilled");
      const [grant] = await db
        .select()
        .from(supportSessions)
        .where(eq(supportSessions.id, input.approvalId));
      if (grant) {
        expect(approved.status).toBe("fulfilled");
        expect(
          (cancelled as PromiseFulfilledResult<{ state: string }>).value.state,
        ).toBe("recorded");
        await service.revoke(companyId, "owner", grant.id);
      } else {
        expect(approved.status).toBe("rejected");
        expect(
          (cancelled as PromiseFulfilledResult<{ state: string }>).value.state,
        ).toBe("cancelled");
      }
      const next = { ...input, approvalId: randomUUID() };
      await service.prepareApproval(companyId, "owner", next);
      await instanceSettingsService(db).updateExperimental({
        admin_support_v6: false,
      });
      try {
        expect(
          (await service.cancelApproval(companyId, "owner", next.approvalId))
            .state,
        ).toBe("cancelled");
      } finally {
        await instanceSettingsService(db).updateExperimental({
          admin_support_v6: true,
        });
      }
    });
    it("replays a Native review reservation after lost acknowledgement and refuses absent or changed original reservations", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Review lost acknowledgement",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await expect(
        service.approve(companyId, "owner", input),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "SUPPORT_REVIEW_UNCONFIRMED" },
      });
      const transact = db.transaction.bind(db);
      const loseAck = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (callback, config) => {
          await transact(callback, config);
          throw new Error("Lost review acknowledgement after commit");
        });
      try {
        await expect(
          service.prepareApproval(companyId, "owner", input),
        ).rejects.toThrow("Lost review acknowledgement after commit");
      } finally {
        loseAck.mockRestore();
      }
      const original = await service.pendingApproval(companyId, "owner");
      expect(await service.prepareApproval(companyId, "owner", input)).toEqual(
        original,
      );
      await expect(
        service.prepareApproval(companyId, "owner", {
          ...input,
          reason: "Changed reviewed private purpose",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await service.cancelApproval(companyId, "owner", input.approvalId);
    });
    it("replays a committed cancellation after lost acknowledgement without another terminal or late grant", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Cancellation lost acknowledgement",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const transact = db.transaction.bind(db);
      const loseAck = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (callback, config) => {
          await transact(callback, config);
          throw new Error("Lost cancellation acknowledgement after commit");
        });
      try {
        await expect(
          service.cancelApproval(companyId, "owner", input.approvalId),
        ).rejects.toThrow("Lost cancellation acknowledgement after commit");
      } finally {
        loseAck.mockRestore();
      }
      expect(
        (await service.cancelApproval(companyId, "owner", input.approvalId))
          .state,
      ).toBe("cancelled");
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, input.approvalId),
              eq(activityLog.action, "support.approval_cancelled"),
            ),
          ),
      ).toHaveLength(1);
      await expect(
        service.approve(companyId, "owner", input),
      ).rejects.toMatchObject({ status: 409 });
      expect(await service.pendingApproval(companyId, "owner")).toBeNull();
    });
    it("excludes another company or current owner from the original pending command and its terminal", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Original company owner binding",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      const prepared = await service.prepareApproval(companyId, "owner", input);
      const otherCompany = (
        await saasOnboardingService(db).create("owner", {
          name: "Other support scope",
          idempotencyKey: "v9-support-other-scope-01",
        })
      ).companyId;
      expect(await service.pendingApproval(otherCompany, "owner")).toBeNull();
      await expect(
        service.prepareApproval(otherCompany, "owner", {
          ...input,
          companyId: otherCompany,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.cancelApproval(otherCompany, "owner", input.approvalId),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.get(otherCompany, "owner", input.approvalId),
      ).rejects.toMatchObject({ status: 404 });
      const [otherOwner] = await db
        .insert(companyMemberships)
        .values({
          companyId,
          principalType: "user",
          principalId: "other",
          membershipRole: "owner",
          status: "active",
        })
        .returning();
      try {
        expect(await service.pendingApproval(companyId, "other")).toBeNull();
        await expect(
          service.prepareApproval(companyId, "other", input),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.cancelApproval(companyId, "other", input.approvalId),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await db
          .delete(companyMemberships)
          .where(eq(companyMemberships.id, otherOwner!.id));
      }
      expect(await service.pendingApproval(companyId, "owner")).toEqual(
        prepared,
      );
      await service.cancelApproval(companyId, "owner", input.approvalId);
    });
    it("keeps inconsistent review/cancellation evidence unresolved and never releases a replacement grant", async () => {
      const input = {
        companyId,
        approvalId: randomUUID(),
        operatorUserId: "operator",
        reason: "Ambiguous Native command evidence",
        scopes: ["status:read"],
        expiresInMinutes: 30,
      };
      await service.prepareApproval(companyId, "owner", input);
      const [review] = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, input.approvalId),
            eq(activityLog.action, "support.approval_reviewed"),
          ),
        );
      const [duplicate] = await db
        .insert(activityLog)
        .values({ ...review!, id: randomUUID() })
        .returning();
      try {
        await expect(
          service.pendingApproval(companyId, "owner"),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.approve(companyId, "owner", input),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.cancelApproval(companyId, "owner", input.approvalId),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await db.delete(activityLog).where(eq(activityLog.id, duplicate!.id));
      }
      await service.cancelApproval(companyId, "owner", input.approvalId);
      const [terminal] = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, input.approvalId),
            eq(activityLog.action, "support.approval_cancelled"),
          ),
        );
      const [duplicateTerminal] = await db
        .insert(activityLog)
        .values({ ...terminal!, id: randomUUID() })
        .returning();
      try {
        expect(await service.pendingApproval(companyId, "owner")).toMatchObject(
          { approvalId: input.approvalId, state: "pending" },
        );
        await expect(
          service.cancelApproval(companyId, "owner", input.approvalId),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          service.prepareApproval(companyId, "owner", {
            ...input,
            approvalId: randomUUID(),
          }),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await db
          .delete(activityLog)
          .where(eq(activityLog.id, duplicateTerminal!.id));
      }
      expect(await service.pendingApproval(companyId, "owner")).toBeNull();
      expect(
        await db
          .select()
          .from(supportSessions)
          .where(eq(supportSessions.id, input.approvalId)),
      ).toHaveLength(0);
    });
    it("keeps original Native approval/read/revocation routes private and replays the same revocation receipt", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.actor = {
          ...actor,
          isInstanceAdmin: false,
          companyIds: [companyId],
        } as Request["actor"];
        next();
      });
      const platform = {
        support: service,
        enabled: async (key: V6FeatureKey) =>
          v6FeatureEnabled(
            await instanceSettingsService(db).getExperimental(),
            key,
          ),
      } as SaasPlatform;
      app.use("/api", saasRoutes(db, platform));
      app.use(errorHandler);
      const path = `/api/companies/${companyId}/support-sessions`;
      const approvalId = randomUUID();
      const prepared = await request(app)
        .post(`${path}/reviews`)
        .query({ expectedUserId: "owner" })
        .send({
          companyId,
          approvalId,
          operatorUserId: "operator",
          reason: "Review temporary Native access",
          scopes: ["status:read"],
          expiresInMinutes: 30,
        })
        .expect(201);
      expect(prepared.body).toMatchObject({
        companyId,
        approvalId,
        state: "pending",
      });
      const pending = await request(app)
        .get(`${path}/pending-review`)
        .query({ expectedUserId: "owner" })
        .expect(200);
      expect(pending.body).toEqual(prepared.body);
      const created = await request(app)
        .post(path)
        .query({ expectedUserId: "owner" })
        .send({
          companyId,
          operatorUserId: "operator",
          approvalId,
          reason: "Review temporary Native access",
          scopes: ["status:read"],
          expiresInMinutes: 30,
        })
        .expect(201);
      expect(created.body.id).toBe(approvalId);
      const original = await request(app)
        .get(`${path}/${approvalId}`)
        .query({ expectedUserId: "owner" })
        .expect(200);
      expect(original.headers["cache-control"]).toBe("private, no-store");
      expect(original.body).toEqual(created.body);
      const approvalReplay = await request(app)
        .post(path)
        .query({ expectedUserId: "owner" })
        .send({
          companyId,
          approvalId,
          operatorUserId: "operator",
          reason: "Review temporary Native access",
          scopes: ["status:read"],
          expiresInMinutes: 30,
        })
        .expect(201);
      expect(approvalReplay.body).toEqual(created.body);
      await request(app)
        .post(path)
        .query({ expectedUserId: "owner" })
        .send({
          companyId,
          approvalId,
          operatorUserId: "operator",
          reason: "Changed reviewed Native access",
          scopes: ["status:read"],
          expiresInMinutes: 30,
        })
        .expect(409);

      expect(created.headers["cache-control"]).toBe("private, no-store");
      const read = await request(app)
        .get(path)
        .query({ expectedUserId: "owner" })
        .expect(200);
      expect(read.headers["cache-control"]).toBe("private, no-store");
      const revoked = await request(app)
        .delete(`${path}/${created.body.id}`)
        .query({ expectedUserId: "owner" })
        .expect(200);
      const replay = await request(app)
        .delete(`${path}/${created.body.id}`)
        .query({ expectedUserId: "owner" })
        .expect(200);
      expect(replay.headers["cache-control"]).toBe("private, no-store");
      expect(replay.body.revokedAt).toBe(revoked.body.revokedAt);
      expect(
        await db
          .select()
          .from(activityLog)
          .where(
            and(
              eq(activityLog.entityId, created.body.id),
              eq(activityLog.action, "support.access_revoked"),
            ),
          ),
      ).toHaveLength(1);
      const changed = await request(app)
        .get(path)
        .query({ expectedUserId: "another-account" })
        .expect(409);
      expect(changed.headers["cache-control"]).toBe("private, no-store");
    });
    it("admits internal support status only through the current native operator session", async () => {
      const grant = await approve();
      let currentActor: AuthorizationActor = operatorActor;
      const app = express();
      app.use((req, _res, next) => { req.actor = currentActor; next(); });
      const platform = {
        config: { environment: "staging", operatorUserIds: ["operator"] },
        support: service,
        enabled: async () => true,
      } as unknown as SaasPlatform;
      app.use("/api", saasRoutes(db, platform));
      app.use(errorHandler);
      const path = `/api/saas/internal/support/${grant.id}/status`;
      expect((await request(app).get(path)).status).toBe(200);
      currentActor = { ...operatorActor, sessionId: undefined };
      expect((await request(app).get(path)).status).toBe(403);
    });
    it("records an idempotent customer-safe operator response without granting tenant access", async () => {
      const now = new Date();
      const [caseRow] = await db.insert(supportCases).values({
        companyId, openedByUserId: "owner", category: "other", subject: "Operator response test",
        description: "customer description", customerStatus: "RECEIVED", version: 0,
        dataPolicy: { schemaVersion: 1, policyVersion: "test.support.v1", recipientName: "Test", privacyNoticeUrl: "https://example.test/privacy", processingRegion: "test", retentionTrigger: "after_last_customer_or_support_message", retentionDays: 30, backupMaxDays: 7, restoreLagDays: 2, deletionMarkerDays: 10, legalHoldPolicyId: "test.support.hold.v1" },
        expiresAt: new Date(now.getTime() + 29 * 86400000),
      }).returning();
      await db.insert(supportCaseEvents).values({ companyId, caseId: caseRow!.id, authorUserId: "owner", kind: "request", body: "customer description", customerStatus: "RECEIVED", requestKey: randomUUID(), requestHash: "a".repeat(64), deliveryState: "not_required" });
      const currentActor: AuthorizationActor = operatorActor;
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.actor = currentActor; next(); });
      app.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      app.use(errorHandler);
      const command = { companyId, expectedVersion: 0, requestKey: randomUUID(), body: "Please confirm the connection name.", status: "WAITING_FOR_YOU" };
      const path = `/api/saas/internal/support-cases/${caseRow!.id}/respond`;
      const first = await request(app).post(path).send(command).expect(200);
      expect(first.body).toMatchObject({ caseId: caseRow!.id, version: 1, status: "WAITING_FOR_YOU" });
      expect(Object.keys(first.body).sort()).toEqual(["caseId", "eventId", "status", "version"]);
      await request(app).post(path).query({ unexpected: "1" }).send({ ...command, requestKey: randomUUID() }).expect(400);
      await request(app).post(path).send({ ...command, caseId: randomUUID(), requestKey: randomUUID() }).expect(400);
      const replay = await request(app).post(path).send(command).expect(200);
      expect(replay.body).toEqual(first.body);
      const customerActor: AuthorizationActor = { ...actor, sessionId: await seedNativePasskeySession(db, "owner") };
      const customerApp = express();
      customerApp.use((req, _res, next) => { req.actor = customerActor; next(); });
      customerApp.use("/api", customerSupportRoutes(db));
      customerApp.use(errorHandler);
      const customerPath = `/api/companies/${companyId}/support/cases/${caseRow!.id}?expectedUserId=owner`;
      const customerEn = await request(customerApp).get(customerPath).set("Accept-Language", "en").expect(200);
      const customerDa = await request(customerApp).get(customerPath).set("Accept-Language", "da").expect(200);
      expect(customerEn.body.status).toBe("WAITING_FOR_YOU");
      expect(customerEn.body.requestedResponse).toBe(command.body);
      expect(customerEn.body.timeline).toContainEqual(expect.objectContaining({ kind: "status_change", body: command.body, author: "support", delivery: "not_required" }));
      expect(customerDa.body).toEqual(customerEn.body);
      const later = await request(app).post(path).send({ ...command, expectedVersion: 1, requestKey: randomUUID(), body: "The investigation is underway.", status: "INVESTIGATING" }).expect(200);
      expect(later.body.version).toBe(2);
      expect(await request(app).post(path).send(command).expect(200).then(response => response.body)).toEqual(first.body);
      expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, caseRow!.id))).toHaveLength(3);
      await request(app).post(path).send({ ...command, requestKey: randomUUID(), body: "Stale edit", status: "RESOLVED" }).expect(409);
      await request(app).post(`/api/saas/internal/support-cases/${randomUUID()}/respond`).send({ ...command, caseId: undefined, requestKey: randomUUID() }).expect(404);
      await request(app).post(path).send({ ...command, companyId: randomUUID(), requestKey: randomUUID() }).expect(404);
      const old = new Date(Date.now() - 3 * 86400000);
      const [expiredCase] = await db.insert(supportCases).values({ companyId, openedByUserId: "owner", category: "other", subject: "Expired", description: "expired request", customerStatus: "RECEIVED", version: 0,
        dataPolicy: { schemaVersion: 1, policyVersion: "test.support.v1", recipientName: "Test", privacyNoticeUrl: "https://example.test/privacy", processingRegion: "test", retentionTrigger: "after_last_customer_or_support_message", retentionDays: 30, backupMaxDays: 7, restoreLagDays: 2, deletionMarkerDays: 10, legalHoldPolicyId: "test.support.hold.v1" },
        createdAt: old, updatedAt: old, lastMessageAt: old, expiresAt: new Date(old.getTime() + 86400000) }).returning();
      await request(app).post(`/api/saas/internal/support-cases/${expiredCase!.id}/respond`).send({ ...command, caseId: undefined, requestKey: randomUUID() }).expect(404);
      const expiringSession = await seedNativePasskeySession(db, "operator");
      await db.update(authSessions).set({ expiresAt: new Date(Date.now() + 3500) }).where(eq(authSessions.id, expiringSession));
      await db.execute(sql.raw(`create function aw_test_support_operator_delay() returns trigger language plpgsql as $$ begin perform pg_sleep(4); return new; end $$`));
      await db.execute(sql.raw(`create trigger z_aw_test_support_operator_delay after insert on support_case_events for each row execute function aw_test_support_operator_delay()`));
      try {
        const expiringApp = express();
        expiringApp.use(express.json());
        expiringApp.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: "operator", sessionId: expiringSession }; next(); });
        expiringApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
        expiringApp.use(errorHandler);
        await request(expiringApp).post(path).send({ ...command, expectedVersion: 2, requestKey: randomUUID(), body: "Must not commit after original expiry." }).expect(403);
        expect((await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, caseRow!.id))).length).toBe(3);
      } finally {
        await db.execute(sql.raw("drop trigger z_aw_test_support_operator_delay on support_case_events"));
        await db.execute(sql.raw("drop function aw_test_support_operator_delay()"));
      }
      const deniedApp = express();
      deniedApp.use(express.json());
      deniedApp.use((req, _res, next) => { req.actor = otherActor; next(); });
      deniedApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      deniedApp.use(errorHandler);
      await request(deniedApp).post(path).send({ ...command, requestKey: randomUUID() }).expect(403);
      const staleSessionApp = express();
      staleSessionApp.use(express.json());
      staleSessionApp.use((req, _res, next) => { req.actor = { ...operatorActor, sessionId: undefined }; next(); });
      staleSessionApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      staleSessionApp.use(errorHandler);
      await request(staleSessionApp).post(path).send({ ...command, requestKey: randomUUID() }).expect(403);
      const keyActorApp = express();
      keyActorApp.use(express.json());
      keyActorApp.use((req, _res, next) => { req.actor = { ...operatorActor, source: "board_key", sessionId: undefined, keyId: "structural-key", authenticatedKeyHash: "a".repeat(64) }; next(); });
      keyActorApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      keyActorApp.use(errorHandler);
      await request(keyActorApp).post(path).send({ ...command, requestKey: randomUUID() }).expect(403);
      const localActorApp = express();
      localActorApp.use(express.json());
      localActorApp.use((req, _res, next) => { req.actor = { ...operatorActor, source: "local_implicit" }; next(); });
      localActorApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      localActorApp.use(errorHandler);
      await request(localActorApp).post(path).send({ ...command, requestKey: randomUUID() }).expect(401);
      await db.insert(companyDeletionOperations).values({ companyId, requestedByUserId: "owner", idempotencyKey: randomUUID() });
      const deletingSession = await seedNativePasskeySession(db, "operator");
      const deletingApp = express();
      deletingApp.use(express.json());
      deletingApp.use((req, _res, next) => { req.actor = { ...operatorActor, sessionId: deletingSession }; next(); });
      deletingApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      deletingApp.use(errorHandler);
      const deletingResponse = await request(deletingApp).post(path).send({ ...command, requestKey: randomUUID() });
      expect(deletingResponse.status, JSON.stringify(deletingResponse.body)).toBe(404);
      await db.delete(companyDeletionOperations).where(eq(companyDeletionOperations.companyId, companyId));
      const closedSession = await seedNativePasskeySession(db, "operator");
      const closedApp = express();
      closedApp.use(express.json());
      closedApp.use((req, _res, next) => { req.actor = { ...operatorActor, sessionId: closedSession }; next(); });
      closedApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      closedApp.use(errorHandler);
      const resolved = await request(closedApp).post(path).send({ ...command, expectedVersion: 2, requestKey: randomUUID(), body: "The issue has been resolved.", status: "RESOLVED" }).expect(200);
      expect(resolved.body).toMatchObject({ version: 3, status: "RESOLVED" });
      const resolvedView = await request(customerApp).get(customerPath).set("Accept-Language", "en").expect(200);
      expect(resolvedView.body.status).toBe("RESOLVED");
      expect(resolvedView.body.resolvedAt).toBeTruthy();
      const resolvedAt = resolvedView.body.resolvedAt;
      const closed = await request(closedApp).post(path).send({ ...command, expectedVersion: 3, requestKey: randomUUID(), body: "The case is now closed.", status: "CLOSED" }).expect(200);
      expect(closed.body).toMatchObject({ version: 4, status: "CLOSED" });
      const closedView = await request(customerApp).get(customerPath).set("Accept-Language", "da").expect(200);
      expect(closedView.body).toMatchObject({ status: "CLOSED", resolvedAt });
      const closedResponse = await request(closedApp).post(path).send({ ...command, expectedVersion: 4, requestKey: randomUUID(), body: "Cannot add a message to closed history." });
      expect(closedResponse.status, JSON.stringify(closedResponse.body)).toBe(409);
      await db.delete(supportCaseEvents).where(eq(supportCaseEvents.id, first.body.eventId));
      expect(await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.subjectId, first.body.eventId))).toHaveLength(1);
      await request(closedApp).post(path).send(command).expect(403);
      await db.update(companies).set({ status: "archived" }).where(eq(companies.id, companyId));
      const archivedSession = await seedNativePasskeySession(db, "operator");
      const archivedApp = express();
      archivedApp.use(express.json());
      archivedApp.use((req, _res, next) => { req.actor = { ...operatorActor, sessionId: archivedSession }; next(); });
      archivedApp.use("/api", saasRoutes(db, { config: { environment: "staging", operatorUserIds: ["operator"] }, support: service, enabled: async () => true } as unknown as SaasPlatform));
      archivedApp.use(errorHandler);
      await request(archivedApp).post(path).send({ ...command, expectedVersion: 4, requestKey: randomUUID() }).expect(404);
      await db.update(companies).set({ status: "active" }).where(eq(companies.id, companyId));
    });
    it("reads an expired native approval as a historical limit, without claiming an active access decision", async () => {
      // The real bounded history returns ten newest approvals. Keep this older
      // receipt in its own real company so other cases cannot page it out.
      const expiredCompany = (await saasOnboardingService(db).create("owner", {
        name: "Isolated expired support history", idempotencyKey: randomUUID(),
      })).companyId;
      const session = await service.approve(expiredCompany, "owner", {
        companyId: expiredCompany, operatorUserId: "operator",
        reason: "Review expired historical Native access", scopes: ["status:read"], expiresInMinutes: 30,
      }, new Date(Date.now() - 2 * 60 * 60 * 1000));
      expect(
        (await readCustomerSupportHistory(db, actor, expiredCompany)).entries.find(
          (entry) => entry.sessionId === session.id,
        )?.state,
      ).toBe("expired");
      await expect(
        service.status(session.id, operatorActor),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("retains Native operator/owner/scope admission independently of a recorded history row", async () => {
      const session = await approve();
      await expect(service.status(session.id, otherActor)).rejects.toMatchObject({
        status: 403,
      });
      const removed = saasSupportService(db, {
        environment: "staging",
        operatorUserIds: [],
      } as SaasPlatformConfig);
      await expect(
        removed.status(session.id, operatorActor),
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
      current = {
        type: "agent",
        source: "agent_key",
        agentId: "00000000-0000-4000-8000-000000000001",
        companyId,
      };
      expect(
        (await request(app).get(url).query({ expectedUserId: "owner" })).status,
      ).toBe(403);
      current = {
        type: "board",
        source: "local_implicit",
        userId: "owner",
        isInstanceAdmin: true,
      };
      expect(
        (await request(app).get(url).query({ expectedUserId: "local-board" }))
          .status,
      ).toBe(403);
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
      await instanceSettingsService(db).updateExperimental({
        admin_support_v6: false,
      });
      try {
        expect(
          (await request(app).get(url).query({ expectedUserId: "owner" }))
            .status,
        ).toBe(404);
      } finally {
        await instanceSettingsService(db).updateExperimental({
          admin_support_v6: true,
        });
      }
      expect(await db.select().from(supportSessions)).not.toHaveLength(0);
    });
    it("mounts the optional assistant with strict current-Human HTTP contracts and no-network disabled behavior", async () => {
      const ownerActor: AuthorizationActor = {
        type: "board",
        source: "session",
        userId: "owner",
        sessionId: await seedNativePasskeySession(db, "owner"),
        companyIds: [companyId],
      };
      const assistant = {
        availability: vi.fn(async () => ({ available: false as const })),
        answer: vi.fn(async (_actor: AuthorizationActor, _companyId: string, input: { requestId: string }) => ({
          requestId: input.requestId,
          kind: "unavailable" as const,
          citations: [] as [],
        })),
      };
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.actor = ownerActor; next(); });
      app.use("/api", customerSupportRoutes(db, { assistant: assistant as never }));
      app.use(errorHandler);
      const base = `/api/companies/${companyId}/support/assistant`;
      const availability = await request(app).get(base).query({ expectedUserId: "owner", locale: "en" }).expect(200);
      expect(availability.headers["cache-control"]).toBe("private, no-store");
      expect(availability.body).toEqual({ available: false });
      expect(assistant.availability).toHaveBeenCalledWith(ownerActor, companyId, { expectedUserId: "owner", locale: "en" });
      await request(app).get(base).query({ expectedUserId: "other", locale: "en" }).expect(409);
      await request(app).get(`/api/companies/${randomUUID()}/support/assistant`)
        .query({ expectedUserId: "owner", locale: "en" }).expect(403);
      await request(app).get(base).query({ expectedUserId: "owner", locale: "en", unexpected: "1" }).expect(400);
      await request(app).get(base).query({ expectedUserId: "owner" }).expect(400);
      expect(assistant.availability).toHaveBeenCalledTimes(1);

      const input = {
        requestId: randomUUID(), expectedUserId: "owner", question: "How do I use Help?",
        locale: "en", consent: true, consentPolicyRevision: "a".repeat(64),
      };
      const answered = await request(app).post(`${base}/answers`).send(input).expect(200);
      expect(answered.headers["cache-control"]).toBe("private, no-store");
      expect(answered.body).toEqual({ requestId: input.requestId, kind: "unavailable", citations: [] });
      expect(assistant.answer).toHaveBeenCalledWith(ownerActor, companyId, input, expect.any(AbortSignal));
      await request(app).post(`${base}/answers`).send({ ...input, requestId: randomUUID(), expectedUserId: "other" }).expect(409);
      await request(app).post(`${base}/answers`).send({ ...input, requestId: randomUUID(), extra: "rejected" }).expect(400);
      await request(app).post(`${base}/answers`).send({ ...input, requestId: randomUUID(), consent: false }).expect(400);
      await request(app).post(`${base}/answers`).query({ unexpected: "1" }).send({ ...input, requestId: randomUUID() }).expect(400);
      expect(assistant.answer).toHaveBeenCalledTimes(1);

      const disabled = express();
      disabled.use(express.json());
      disabled.use((req, _res, next) => { req.actor = ownerActor; next(); });
      disabled.use("/api", customerSupportRoutes(db));
      disabled.use(errorHandler);
      expect((await request(disabled).get(base).query({ expectedUserId: "owner", locale: "en" }).expect(200)).body)
        .toEqual({ available: false });
      expect((await request(disabled).post(`${base}/answers`).send(input).expect(200)).body)
        .toEqual({ requestId: input.requestId, kind: "unavailable", citations: [] });
    });
  },
);
