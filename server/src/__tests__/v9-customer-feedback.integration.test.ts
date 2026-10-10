import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  authUsers,
  agents,
  issueComments,
  issues,
  feedbackExports,
  companies,
  companyMemberships,
  createDb,
  customerFeedback,
  customerFeedbackAccess,
  customerFeedbackEvents,
  saasNotifications,
} from "@paperclipai/db";
import { customerFeedbackRoutes } from "../routes/customer-feedback.js";
import { feedbackService } from "../services/feedback.js";
import { customerFeedbackService } from "../services/customer-feedback.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { eraseAccountAccess } from "../services/saas/account-deletion.js";
import { assertDatabaseRestoreAdmission } from "../services/saas/database-admission.js";
import { errorHandler } from "../middleware/error-handler.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V9 native customer feedback on migrated PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      companyId: string,
      foreignId: string,
      userId: string,
      otherUser: string,
      operatorId: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v9-feedback-");
      db = createDb(database.connectionString);
    });
    afterAll(async () => {
      await database?.cleanup();
    });
    beforeEach(async () => {
      companyId = randomUUID();
      foreignId = randomUUID();
      userId = randomUUID();
      otherUser = randomUUID();
      operatorId = randomUUID();
      for (const id of [companyId, foreignId])
        await db.insert(companies).values({
          id,
          name: "Feedback company",
          issuePrefix: `F${id.slice(0, 7)}`,
        });
      await db.insert(authUsers).values({
        id: operatorId,
        name: "Operator",
        email: `${operatorId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      for (const principalId of [userId, otherUser])
        await db.insert(companyMemberships).values({
          companyId,
          principalType: "user",
          principalId,
          status: "active",
          membershipRole: "viewer",
        });
      await instanceSettingsService(db).updateExperimental({
        customer_feedback_v9: true,
      });
    });
    const actor = (principal = userId) => ({
      type: "board" as const,
      source: "session" as const,
      userId: principal,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "viewer", status: "active" }],
    });
    function app(principal = userId) {
      const application = express();
      application.use(express.json());
      application.use((req, _res, next) => {
        req.actor = actor(principal);
        next();
      });
      application.use(
        "/api",
        customerFeedbackRoutes(db, { operatorUserIds: [operatorId] }),
      );
      application.use(errorHandler);
      return application;
    }
    const input = () => ({
      idempotencyKey: randomUUID(),
      category: "BUG",
      body: "An approval cannot be opened",
      goal: "Finish reviewing the proposal",
      omitName: true,
      context: {
        surfaceKey: "needs_you",
        locale: "en",
        timezone: "UTC",
        viewportClass: "wide",
      },
    });
    it("lets a current viewer submit actor-owned feedback and keeps no-name identity out of the canonical submission", async () => {
      const response = await request(app())
        .post(`/api/companies/${companyId}/customer-feedback`)
        .send(input())
        .expect(201);
      expect(response.body.feedbackId).toMatch(/^AWF-[A-F0-9]{32}$/);
      const [row] = await db
        .select()
        .from(customerFeedback)
        .where(eq(customerFeedback.id, response.body.id));
      expect(row!.submittedByUserId).toBeNull();
      expect(row!.diagnostics).toBeNull();
      expect(row!.context.routeTemplate).toBe("/needs-you");
      expect(response.body).not.toHaveProperty("submittedByUserId");
      expect(response.body).not.toHaveProperty("context");
      const [audit] = await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(activityLog.action, "customer_feedback.received"),
          ),
        );
      expect(audit!.entityId).not.toBe(row!.id);
      expect(audit!.details).toBeNull();
    });
    it("commits one immutable submission for concurrent/retried request keys and rejects changed content", async () => {
      const payload = input(),
        url = `/api/companies/${companyId}/customer-feedback`;
      const results = await Promise.all([
        request(app()).post(url).send(payload),
        request(app()).post(url).send(payload),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0]!.body.id).toBe(results[1]!.body.id);
      await request(app())
        .post(url)
        .send({ ...payload, body: "Different text" })
        .expect(409);
      await expect(
        db
          .update(customerFeedback)
          .set({ body: "Overwritten original" })
          .where(eq(customerFeedback.id, results[0]!.body.id)),
      ).rejects.toThrow();
    });
    it("rejects raw-page metadata, diagnostics without consent, cross-tenant access, stale membership and account swaps", async () => {
      const url = `/api/companies/${companyId}/customer-feedback`;
      await request(app())
        .post(url)
        .send({
          ...input(),
          context: {
            ...input().context,
            rawUrl: "https://example.test/?token=private",
          },
        })
        .expect(400);
      await request(app())
        .post(url)
        .send({
          ...input(),
          diagnostics: { safeErrorCodes: [], correlationIds: [] },
        })
        .expect(400);
      await request(app())
        .post(`/api/companies/${foreignId}/customer-feedback`)
        .send(input())
        .expect(403);
      await request(app())
        .post(`${url}?expectedUserId=${otherUser}`)
        .send(input())
        .expect(409);
      await db
        .update(companyMemberships)
        .set({ status: "inactive" })
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalId, userId),
          ),
        );
      await request(app()).post(url).send(input()).expect(403);
    });
    it("keeps customer history private even from another company member", async () => {
      const response = await request(app())
        .post(`/api/companies/${companyId}/customer-feedback`)
        .send(input())
        .expect(201);
      const other = await request(app(otherUser))
        .get(`/api/companies/${companyId}/customer-feedback`)
        .expect(200);
      expect(other.body).toEqual([]);
      await request(app(otherUser))
        .get(
          `/api/companies/${companyId}/customer-feedback/${response.body.id}`,
        )
        .expect(404);
      await request(app(otherUser))
        .get(`/api/companies/${companyId}/customer-feedback/${randomUUID()}`)
        .expect(404);
    });
    it("preserves the native restore quarantine through feedback rollout and ordinary setting writes", async () => {
      const marker = {admission: "blocked", restoredAt: "2026-10-09T00:00:00.000Z"};
      try {
      await db.execute(sql`update instance_settings set general=general||jsonb_build_object('awV6RestoreQuarantine',${JSON.stringify(marker)}::jsonb) where singleton_key='default'`);
      const settings = instanceSettingsService(db, {runtimeEnv: {}});
      for (const enabled of [false, true, false]) {
        await settings.updateExperimental({customer_feedback_v9: enabled});
        await expect(assertDatabaseRestoreAdmission(db)).rejects.toThrow("remains quarantined");
        expect(await settings.getGeneral()).not.toHaveProperty("awV6RestoreQuarantine");
        expect((await settings.getGeneral()).outputFeedbackPolicyVersion).toBe("aw-v9-local-v1");
      }
      await settings.updateGeneral({keyboardShortcuts: true});
      await expect(assertDatabaseRestoreAdmission(db)).rejects.toThrow("remains quarantined");
      const [stored] = await db.execute(sql`select general from instance_settings where singleton_key='default'`);
      expect(stored!.general.awV6RestoreQuarantine).toEqual(marker);
      } finally {
        await db.execute(sql`update instance_settings set general=general-'awV6RestoreQuarantine' where singleton_key='default'`);
      }
    });
    it("pages private queues and operator history without losing PostgreSQL sub-millisecond ties or accepting foreign cursors", async () => {
      const submitted = await request(app())
        .post(`/api/companies/${companyId}/customer-feedback`)
        .send(input())
        .expect(201);
      const id = submitted.body.id;
      const rows = Array.from({ length: 26 }, () => ({
        id: randomUUID(),
        companyId,
        category: "OTHER",
        body: "Synthetic paging prerequisite",
        omitName: true,
        context: {
          ...input().context,
          routeTemplate: "/dashboard",
          releaseBuildId: "unverified:paging-fixture",
        },
        createdAt: sql`'2026-10-09 00:00:00.123456+00'::timestamptz`,
      }));
      await db.insert(customerFeedback).values(rows);
      await db.insert(customerFeedbackAccess).values(
        rows.map((row) => ({
          companyId,
          feedbackId: row.id,
          userId,
          requestKey: randomUUID(),
          requestHash: "paging-fixture",
        })),
      );
      for (const url of [
        `/api/companies/${companyId}/customer-feedback`,
        `/api/internal/customer-feedback/${companyId}`,
      ]) {
        const caller = url.includes("/internal/") ? app(operatorId) : app();
        const first = await request(caller).get(url).expect(200);
        const second = await request(caller)
          .get(`${url}?before=${first.body.at(-1).id}`)
          .expect(200);
        const ids = [...first.body, ...second.body].map(
          (value: { id: string }) => value.id,
        );
        expect(ids).toHaveLength(27);
        expect(new Set(ids).size).toBe(27);
        expect(new Set(ids)).toEqual(
          new Set([id, ...rows.map((row) => row.id)]),
        );
      }
      const events = Array.from({ length: 103 }, () => ({
        id: randomUUID(),
        companyId,
        feedbackId: id,
        kind: "product_message",
        body: "Customer-visible answer",
        internalNote: "Private note",
        customerVisible: true,
        requestKey: randomUUID(),
        requestHash: "paging-fixture",
        createdAt: sql`'2026-10-09 00:00:00.123456+00'::timestamptz`,
      }));
      await db.insert(customerFeedbackEvents).values(events);
      const url = `/api/internal/customer-feedback/${companyId}/${id}`;
      const first = await request(app(operatorId)).get(url).expect(200);
      expect(first.body.events).toHaveLength(100);
      expect(first.body.nextEventCursor).toBeTruthy();
      const second = await request(app(operatorId))
        .get(`${url}?beforeEvent=${first.body.nextEventCursor}`)
        .expect(200);
      expect(second.body.events).toHaveLength(3);
      expect(second.body.nextEventCursor).toBeNull();
      expect(
        new Set(
          [...first.body.events, ...second.body.events].map(
            (event: { id: string }) => event.id,
          ),
        ),
      ).toEqual(new Set(events.map((event) => event.id)));
      await request(app(operatorId))
        .get(`${url}?beforeEvent=${randomUUID()}`)
        .expect(404);
      await request(app(operatorId))
        .get(`/api/internal/customer-feedback/${foreignId}?before=${id}`)
        .expect(404);
      await request(app(operatorId))
        .get(`/api/internal/customer-feedback/${foreignId}/${id}`)
        .expect(404);
      const customer = await request(app())
        .get(`/api/companies/${companyId}/customer-feedback/${id}`)
        .expect(200);
      expect(JSON.stringify(customer.body)).not.toContain("Private note");
      expect(customer.body).not.toHaveProperty("events");
      await db
        .update(authUsers)
        .set({ emailVerified: false })
        .where(eq(authUsers.id, operatorId));
      await request(app(operatorId)).get(url).expect(403);
    });
    it("separates verified platform triage and customer messages, uses version fences and appends follow-ups", async () => {
      const response = await request(app())
          .post(`/api/companies/${companyId}/customer-feedback`)
          .send(input())
          .expect(201),
        id = response.body.id;
      const url = `/api/internal/customer-feedback/${companyId}/${id}/triage`,
        payload = {
          idempotencyKey: randomUUID(),
          expectedVersion: 0,
          internalState: "NEEDS_INFO",
          customerMessage: "Which browser were you using?",
          internalNote: "Confidential internal investigation",
        };
      await request(app()).post(url).send(payload).expect(403);
      const triage = await request(app(operatorId))
        .post(url)
        .send(payload)
        .expect(200);
      expect(triage.body.status).toBe("NEEDS_INFO");
      expect(JSON.stringify(triage.body)).not.toContain("Confidential");
      const notifications = await db
        .select()
        .from(saasNotifications)
        .where(eq(saasNotifications.companyId, companyId));
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.userId).toBe(userId);
      expect(JSON.stringify(notifications)).not.toContain("Which browser");
      expect(JSON.stringify(notifications)).not.toContain("Confidential");
      const internal = await request(app(operatorId))
        .get(`/api/internal/customer-feedback/${companyId}/${id}`)
        .expect(200);
      expect(JSON.stringify(internal.body)).toContain(payload.internalNote);
      expect(JSON.stringify(internal.body)).not.toContain(userId);
      expect(internal.body).not.toHaveProperty("access");
      await request(app(operatorId))
        .post(url)
        .send({ ...payload, idempotencyKey: randomUUID() })
        .expect(409);
      const follow = {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        body: "Firefox 140",
      };
      const result = await request(app())
        .post(`/api/companies/${companyId}/customer-feedback/${id}/follow-up`)
        .send(follow)
        .expect(200)
        .expect("Cache-Control", "private, no-store");
      expect(result.body.status).toBe("REVIEWING");
      expect(result.body.body).toBe(input().body);
      expect(result.body.messages.map((m: { body: string }) => m.body)).toEqual(
        [payload.customerMessage, follow.body],
      );
      await request(app())
        .post(`/api/companies/${companyId}/customer-feedback/${id}/follow-up`)
        .send(follow)
        .expect(200);
      const events = await db
        .select()
        .from(customerFeedbackEvents)
        .where(eq(customerFeedbackEvents.feedbackId, id));
      expect(events).toHaveLength(2);
      await expect(
        db
          .update(customerFeedbackEvents)
          .set({ body: "Rewritten" })
          .where(eq(customerFeedbackEvents.feedbackId, id)),
      ).rejects.toThrow();
    });
    it("enforces compound tenant references and erases no-name feedback through native account deletion", async () => {
      const service = customerFeedbackService(db),
        result = await service.create(actor(), companyId, input());
      await expect(
        db.insert(customerFeedbackAccess).values({
          companyId: foreignId,
          feedbackId: result.id,
          userId: otherUser,
          requestKey: randomUUID(),
          requestHash: "invalid",
        }),
      ).rejects.toThrow();
      await db.transaction((tx) => eraseAccountAccess(tx, userId));
      expect(
        await db
          .select()
          .from(customerFeedback)
          .where(eq(customerFeedback.id, result.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(customerFeedbackAccess)
          .where(eq(customerFeedbackAccess.feedbackId, result.id)),
      ).toHaveLength(0);
      await db.execute(sql`select 1`);
    });
    it("does not reuse legacy output-sharing consent or capture trace bundles, even after flag rollback", async () => {
      const [agent] = await db
        .insert(agents)
        .values({
          companyId,
          name: "Helper",
          role: "engineer",
          status: "active",
          adapterType: "codex_local",
        })
        .returning();
      const [issue] = await db
        .insert(issues)
        .values({ companyId, title: "Review report" })
        .returning();
      const [comment] = await db
        .insert(issueComments)
        .values({
          companyId,
          issueId: issue!.id,
          authorAgentId: agent!.id,
          body: "Confidential generated report",
        })
        .returning();
      const settings = instanceSettingsService(db);
      await settings.updateGeneral({
        feedbackDataSharingPreference: "allowed",
      });
      const vote = await feedbackService(db).saveIssueVote({
        issueId: issue!.id,
        targetType: "issue_comment",
        targetId: comment!.id,
        vote: "up",
        authorUserId: userId,
        allowSharing: true,
      });
      expect(vote.sharingEnabled).toBe(false);
      expect(vote.traceId).toBeNull();
      expect(
        await db
          .select()
          .from(feedbackExports)
          .where(eq(feedbackExports.feedbackVoteId, vote.vote.id)),
      ).toHaveLength(0);
      await settings.updateExperimental({ customer_feedback_v9: false });
      expect((await settings.getGeneral()).outputFeedbackPolicyVersion).toBe(
        "aw-v9-local-v1",
      );
      const after = await feedbackService(db).saveIssueVote({
        issueId: issue!.id,
        targetType: "issue_comment",
        targetId: comment!.id,
        vote: "down",
        authorUserId: userId,
        allowSharing: true,
      });
      expect(after.sharingEnabled).toBe(false);
      expect(after.traceId).toBeNull();
      let uploads = 0;
      const exporter = feedbackService(db, {
        shareClient: {
          uploadTraceBundle: async () => {
            uploads++;
            return { objectKey: "unexpected" };
          },
        },
      });
      expect(await exporter.flushPendingFeedbackTraces()).toEqual({
        attempted: 0,
        sent: 0,
        failed: 0,
      });
      expect(uploads).toBe(0);
    });
    it("fails closed when the rollout flag is disabled", async () => {
      await instanceSettingsService(db).updateExperimental({
        customer_feedback_v9: false,
      });
      await request(app())
        .post(`/api/companies/${companyId}/customer-feedback`)
        .send(input())
        .expect(404);
    });
  },
);
