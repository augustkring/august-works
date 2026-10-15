import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { saasRoutes } from "../routes/saas.js";
import { v6FeatureEnabled, type V6FeatureKey } from "@paperclipai/shared";
import type { SaasPlatform } from "../services/saas/platform.js";
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
        service.status(session.id, "operator"),
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
        service.status(original.id, "operator"),
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
        service.status(original.id, "operator"),
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
  },
);
