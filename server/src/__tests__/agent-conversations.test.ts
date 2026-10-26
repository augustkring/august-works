import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { applyRunnerGoalPrpEvent } from "../services/runner-goals.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";
import express from "express";
import request from "supertest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { actorMiddleware } from "../middleware/auth.js";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  authUsers,
  authSessions,
  agents,
  agentTaskSessions,
  agentWakeupRequests,
  companyMemberships,
  companies,
  createDb,
  documentRevisions,
  documents,
  heartbeatRuns,
  issueComments,
  issueTreeHolds,
  issueThreadInteractions,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { documentService, type DocumentRevisionSourceCapture } from "../services/documents.js";
import { getTaskPlanContext } from "../services/task-plan-context.js";
import { terminalizeLegacyExecution, LEGACY_RECOVERY_CAUSE } from "../services/legacy-execution-recovery.js";
import { settleUnrecoverableExecutions } from "../services/execution-recovery-resolution.js";
import { renderPaperclipWakePrompt } from "@paperclipai/adapter-utils/server-utils";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  AGENT_CHAT_DIRECTIVE,
  conversationNativeDecision,
  deliverConversationComments,
  conversationReplay,
  isWaitingConversation,
  isConversationExecutionWake,
  prepareConversationTurn,
  settleConversationTurn,
  undeliveredConversationComments,
} from "../services/agent-conversations.js";
import { classifyIssueGraphLiveness } from "../services/recovery/issue-graph-liveness.js";
import { runningProcesses } from "../adapters/index.js";
import { buildLowTrustSourceTrust, LOW_TRUST_QUARANTINED_BODY } from "../services/source-trust.js";
import {
  buildPaperclipTaskMarkdown,
  buildPaperclipWakePayload,
  heartbeatService,
} from "../services/heartbeat.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "persistent agent conversations",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
    let db: ReturnType<typeof createDb>;
    let companyId: string;
    let agentId: string;
    let localBoardSessionId: string;
    const sessionIds = new Map<string, string>();
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase(
        "paperclip-agent-conversations-",
      );
      db = createDb(database.connectionString);
      companyId = randomUUID();
      agentId = randomUUID();
      await db
        .insert(authUsers)
        .values({
          id: "local-board",
          name: "Local Board",
          email: "local@paperclip.test",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
      await db
        .insert(companies)
        .values({
          id: companyId,
          name: "Chats",
          issuePrefix: "CHAT",
          requireBoardApprovalForNewAgents: false,
          defaultResponsibleUserId: "local-board",
        });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "local-board",
        status: "active", membershipRole: "owner" });
      await ensureHumanRoleDefaultGrants(db, { companyId, principalId: "local-board", membershipRole: "owner", grantedByUserId: null });
      localBoardSessionId = await seedNativePasskeySession(db, "local-board");
      sessionIds.set("local-board", localBoardSessionId);
      await db
        .insert(agents)
        .values({
          id: agentId,
          companyId,
          name: "Planner",
          role: "engineer",
          status: "idle",
          adapterType: "process",
        });
      await instanceSettingsService(db).updateExperimental({
        enableAgentChat: true,
      });
    }, 90000);
    afterAll(async () => {
      if (db) await heartbeatService(db).drainActiveRunExecutions();
      await db?.$client.end({ timeout: 0 });
      await database?.cleanup();
    });
    const create = (user = randomUUID()) =>
      issueService(db).create(companyId, {
        title: "Conversation",
        conversationAgentId: agentId,
        conversationUserId: user,
        assigneeAgentId: agentId,
        status: "in_review",
        conversationState: "waiting",
      });
    async function runFor(issueId: string, commentId: string, overrides = {}) {
      return (
        await db
          .insert(heartbeatRuns)
          .values({
            companyId,
            agentId,
            status: "running",
            contextSnapshot: {
              issueId,
              taskKey: issueId,
              wakeCommentId: commentId,
              commentId,
              ...overrides,
            },
          })
          .returning()
      )[0]!;
    }
    it("routes the first authenticated Human comment through the configured heartbeat owner", async () => {
      const userId = randomUUID();
      await db.insert(authUsers).values({ id: userId, name: "Configured heartbeat owner",
        email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
        status: "active", membershipRole: "operator" });
      await ensureHumanRoleDefaultGrants(db, { companyId, principalId: userId, membershipRole: "operator", grantedByUserId: null });
      const sessionId = await seedNativePasskeySession(db, userId);
      const heartbeat = { wakeup: vi.fn(async () => null) } as unknown as ReturnType<typeof heartbeatService>;
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.actor = { type: "board", source: "session", userId, sessionId, companyIds: [companyId] };
        next();
      });
      app.use("/api", issueRoutes(db, {} as never, { heartbeat }));
      app.use(errorHandler);

      const path = `/api/companies/${companyId}/chats/${agentId}`;
      const shell = await request(app).post(path);
      expect(shell.status, JSON.stringify(shell.body)).toBe(200);
      const foreignApp = express();
      foreignApp.use(express.json());
      foreignApp.use((req, _res, next) => {
        req.actor = { type: "board", source: "session", userId: "local-board",
          sessionId: localBoardSessionId, companyIds: [companyId] };
        next();
      });
      foreignApp.use("/api", issueRoutes(db, {} as never, { heartbeat }));
      foreignApp.use(errorHandler);
      const foreignFirstComment = await request(foreignApp).post(`/api/issues/${shell.body.id}/comments`).send({
        body: "A different Human must not start this conversation.", clientRequestId: randomUUID(),
      });
      expect(foreignFirstComment.status).toBe(404);
      expect(heartbeat.wakeup).not.toHaveBeenCalled();
      expect(await db.select().from(issueComments).where(eq(issueComments.issueId, shell.body.id))).toHaveLength(0);
      const linkedOwnerId = randomUUID();
      await db.insert(authUsers).values({ id: linkedOwnerId, name: "Linked shell owner",
        email: `${linkedOwnerId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: linkedOwnerId,
        status: "active", membershipRole: "operator" });
      await ensureHumanRoleDefaultGrants(db, { companyId, principalId: linkedOwnerId,
        membershipRole: "operator", grantedByUserId: null });
      const linkedSessionId = await seedNativePasskeySession(db, linkedOwnerId);
      const linkedApp = express();
      linkedApp.use(express.json());
      linkedApp.use((req, _res, next) => {
        req.actor = { type: "board", source: "session", userId: linkedOwnerId,
          sessionId: linkedSessionId, companyIds: [companyId] };
        next();
      });
      linkedApp.use("/api", issueRoutes(db, {} as never, { heartbeat }));
      linkedApp.use(errorHandler);
      const linkedShell = await request(linkedApp).post(path);
      expect(linkedShell.status, JSON.stringify(linkedShell.body)).toBe(200);
      const parent = await issueService(db).create(companyId, { title: "A shell with a parent is not empty" });
      await db.update(issues).set({ parentId: parent.id }).where(eq(issues.id, linkedShell.body.id));
      const linkedComment = await request(linkedApp).post(`/api/issues/${linkedShell.body.id}/comments`).send({
        body: "A linked shell must not be admitted as an empty conversation.", clientRequestId: randomUUID(),
      });
      expect([403, 404]).toContain(linkedComment.status);
      expect(heartbeat.wakeup).not.toHaveBeenCalled();
      expect(await db.select().from(issueComments).where(eq(issueComments.issueId, linkedShell.body.id))).toHaveLength(0);
      const firstComment = await request(app).post(`/api/issues/${shell.body.id}/comments`).send({
        body: "Create the first authenticated Native conversation input.", clientRequestId: randomUUID(),
      });
      expect(firstComment.status, JSON.stringify(firstComment.body)).toBe(201);
      expect(heartbeat.wakeup).toHaveBeenCalledTimes(1);
      expect(heartbeat.wakeup).toHaveBeenCalledWith(agentId, expect.objectContaining({
        reason: "issue_commented", requestedByActorType: "user", requestedByActorId: userId,
        contextSnapshot: expect.objectContaining({ issueId: shell.body.id, source: "issue.comment" }),
      }));
      const [persisted] = await db.select().from(issues).where(eq(issues.id, shell.body.id));
      expect(persisted).toMatchObject({ conversationState: "active", conversationUserId: userId,
        payloadSourceProtocolVersion: 1, payloadSourceSnapshot: expect.any(Object) });
      expect((await db.select().from(issueComments).where(eq(issueComments.id, firstComment.body.id)))).toHaveLength(1);
    });
    it("atomically resolves one task per person and agent and excludes it from ordinary lists", async () => {
      const user = randomUUID();
      expect(
        await issueService(db).getConversation(companyId, agentId, user),
      ).toBeNull();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => create(user)),
      );
      expect(new Set(results.map((issue) => issue.id)).size).toBe(1);
      expect((await create()).id).not.toBe(results[0].id);
      expect(
        (await issueService(db).list(companyId)).some(
          (issue) => issue.id === results[0].id,
        ),
      ).toBe(false);
      expect(
        (
          await issueService(db).list(companyId, { q: results[0].identifier! })
        ).some((issue) => issue.id === results[0].id),
      ).toBe(true);
      expect(
        (await issueService(db).getById(results[0].id))?.conversationUserId,
      ).toBe(user);
      await expect(
        issueService(db).update(results[0].id, { status: "done" }),
      ).rejects.toThrow(/conversation/i);
      await expect(
        issueService(db).update(results[0].id, { assigneeAgentId: null }),
      ).rejects.toThrow(/conversation/i);
    });
    it("resolves through authenticated company routes, keeps opens read-only, and limits conversation payloads to their Human owner", async () => {
      const appFor = (userId?: string, allowed = true) => {
        const app = express();
        app.use(express.json());
        if (!userId)
          app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
        else
          app.use((req, _res, next) => {
            req.actor = {
              type: "board",
              source: "session",
              userId,
              sessionId: sessionIds.get(userId),
              companyIds: allowed ? [companyId] : [],
            };
            next();
          });
        app.use("/api", issueRoutes(db, { wakeup: async () => null } as never));
        app.use(errorHandler);
        return app;
      };
      const path = `/api/companies/${companyId}/chats/${agentId}`;
      const owner = randomUUID();
      const colleague = randomUUID();
      const app = appFor(owner);
      for (const userId of [owner, colleague]) {
        await db.insert(authUsers).values({ id: userId, name: "Conversation route user",
          email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
        await db
          .insert(companyMemberships)
          .values({
            companyId,
            principalType: "user",
            principalId: userId,
            status: "active",
            membershipRole: "operator",
          });
        await ensureHumanRoleDefaultGrants(db, {
          companyId,
          principalId: userId,
          membershipRole: "operator",
          grantedByUserId: null,
        });
        sessionIds.set(userId, await seedNativePasskeySession(db, userId));
      }
      expect((await request(app).get(path)).body).toBeNull();
      expect(
        await issueService(db).getConversation(companyId, agentId, owner),
      ).toBeNull();
      expect((await request(app).post(path).send({ conversationUserId: "spoof" })).status).toBe(400);
      const resolved = await Promise.all([
        request(app).post(path),
        request(app).post(path),
      ]);
      expect(resolved.every((response) => response.status === 200)).toBe(true);
      expect(resolved[0].body.id).toBe(resolved[1].body.id);
      expect(resolved[0].body.conversationUserId).toBe(owner);
      const ownerRead = await request(appFor(owner)).get(`/api/issues/${resolved[0].body.id}`);
      expect(ownerRead.status).toBe(200);
      expect(ownerRead.body).toMatchObject({ id: resolved[0].body.id, conversationUserId: owner });
      const colleagueRead = await request(appFor(colleague)).get(`/api/issues/${resolved[0].body.id}`);
      expect(colleagueRead.status).toBe(404);
      expect(JSON.stringify(colleagueRead.body)).not.toContain("Conversation");
      expect(
        (await request(appFor(randomUUID(), false)).get(path)).status,
      ).toBe(403);
      const chatId = resolved[0].body.id;
      const beforeModeChange = await issueService(db).getById(chatId);
      expect(beforeModeChange?.workMode).toBe("standard");
      expect(beforeModeChange).toMatchObject({ conversationAgentId: agentId, conversationUserId: owner });
      await expect(issueService(db).update(chatId, {
        workMode: "planning",
        privateWorkAdmission: "owned_conversation_work_mode",
        privacyActor: { type: "board", source: "session", userId: colleague, sessionId: sessionIds.get(colleague)! },
      })).rejects.toThrow("The native conversation work mode change is unavailable");
      await expect(issueService(db).update(chatId, {
        workMode: "planning",
        title: "Service token must not admit extra fields",
        privateWorkAdmission: "owned_conversation_work_mode",
        privacyActor: { type: "board", source: "session", userId: owner, sessionId: sessionIds.get(owner)! },
      })).rejects.toThrow("The native conversation work mode change is unavailable");
      expect((await issueService(db).getById(chatId))?.workMode).toBe("standard");
      const ownerModeChange = await request(appFor(owner)).patch(`/api/issues/${chatId}`)
        .send({ workMode: "planning" });
      expect(ownerModeChange.status, JSON.stringify(ownerModeChange.body)).toBe(200);
      expect((await issueService(db).getById(chatId))?.workMode).toBe("planning");
      const colleagueModeChange = await request(appFor(colleague)).patch(`/api/issues/${chatId}`)
        .send({ workMode: "standard" });
      expect(colleagueModeChange.status).toBe(404);
      expect((await issueService(db).getById(chatId))?.workMode).toBe("planning");
      const expandedModeChange = await request(appFor(owner)).patch(`/api/issues/${chatId}`)
        .send({ workMode: "standard", title: "Must not change through the narrow exception" });
      expect(expandedModeChange.status).toBe(422);
      expect(await issueService(db).getById(chatId)).toMatchObject({
        title: beforeModeChange!.title,
        workMode: "planning",
      });
      const privateWorkTask = await issueService(db).create(companyId, {
        title: "Private work must remain unavailable",
        visibility: "private",
        responsibleUserId: owner,
        createdByUserId: owner,
      });
      const genericPrivateTaskWrite = await request(app)
        .post(`/api/issues/${privateWorkTask.id}/comments`)
        .send({ body: "Hello", clientRequestId: randomUUID() });
      expect(genericPrivateTaskWrite.status).toBe(422);
      expect(genericPrivateTaskWrite.body.error).toBe("Private tasks are not available");
      const queuedInterrupt = { queueId: randomUUID(), revision: "queue-revision", targetRunId: randomUUID() };
      expect((await request(appFor(colleague)).post(`/api/issues/${chatId}/queued-comments/interrupt`)
        .send(queuedInterrupt)).status).toBe(404);
      for (const body of ["Hello", "/new"]) {
        expect((await request(appFor(colleague)).post(`/api/issues/${chatId}/comments`)
          .send({ body, clientRequestId: randomUUID() })).status).toBe(404);
      }
      expect((await request(appFor(colleague))
        .post(`/api/companies/${companyId}/issues/${chatId}/attachments`)
        .attach("file", Buffer.from("foreign upload"), "note.txt")).status).toBe(403);

      const [planReview] = await db.insert(issueThreadInteractions).values({
        companyId, issueId: chatId, kind: "request_confirmation", status: "pending",
        continuationPolicy: "wake_assignee_on_accept", payload: { version: 1, prompt: "Hand off this plan?" },
      }).returning();
      expect((await request(appFor(colleague))
        .post(`/api/issues/${chatId}/interactions/${planReview.id}/accept`).send({})).status).toBe(404);
      expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, planReview.id)))[0].status).toBe("pending");
      const [pause] = await db.insert(issueTreeHolds).values({
        companyId, rootIssueId: chatId, mode: "pause", status: "active",
        createdByActorType: "user", createdByUserId: owner,
        releasePolicy: { strategy: "manual", note: "leaf_pause" },
      }).returning();
      const blockedSend = await request(appFor(owner)).post(`/api/issues/${chatId}/comments`)
        .send({ body: "Continue working", clientRequestId: randomUUID() });
      expect(blockedSend.status, JSON.stringify(blockedSend.body)).toBe(409);
      expect(await db.select().from(issueComments).where(eq(issueComments.issueId, chatId))).toHaveLength(0);
      const resetRequest = { body: "/new", clientRequestId: randomUUID() };
      const reset = await request(appFor(owner)).post(`/api/issues/${chatId}/comments`).send(resetRequest);
      expect(reset.status).toBe(201);
      const retriedResets = await Promise.all(Array.from({ length: 3 }, () =>
        request(appFor(owner)).post(`/api/issues/${chatId}/comments`).send(resetRequest)));
      expect(retriedResets.every((response) => response.status === 201 && response.body.id === reset.body.id)).toBe(true);
      const addedEvents = await db.select().from(activityLog).where(and(
        eq(activityLog.entityId, chatId), eq(activityLog.action, "issue.comment_added"),
      ));
      expect(addedEvents).toHaveLength(1);
      const ownerMessage = await request(appFor(owner)).post(`/api/issues/${chatId}/comments`)
        .send({ body: "Owner follow-up", clientRequestId: randomUUID() });
      expect(ownerMessage.status, JSON.stringify(ownerMessage.body)).toBe(201);

      expect((await db.select().from(issueTreeHolds).where(eq(issueTreeHolds.id, pause.id)))[0].status).toBe("released");
      await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, owner)));
      const revokedMembershipMessage = await request(appFor(owner)).post(`/api/issues/${chatId}/comments`)
        .send({ body: "Revoked membership", clientRequestId: randomUUID() });
      expect(revokedMembershipMessage.status).toBe(404);
      expect((await db.select().from(issueComments).where(eq(issueComments.issueId, chatId)))
        .some(comment => comment.body === "Revoked membership")).toBe(false);
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: owner,
        status: "active", membershipRole: "operator" });
      await ensureHumanRoleDefaultGrants(db, { companyId, principalId: owner, membershipRole: "operator", grantedByUserId: null });
      await db.delete(authSessions).where(eq(authSessions.id, sessionIds.get(owner)!));
      const revokedOwnerMessage = await request(appFor(owner)).post(`/api/issues/${chatId}/comments`)
        .send({ body: "Stale session", clientRequestId: randomUUID() });
      expect(revokedOwnerMessage.status).toBe(404);
      const revokedOwnerModeChange = await request(appFor(owner)).patch(`/api/issues/${chatId}`)
        .send({ workMode: "standard" });
      expect(revokedOwnerModeChange.status).toBe(404);
      expect((await issueService(db).getById(chatId))?.workMode).toBe("planning");
      const messagesAfterRevokedAttempt = await db.select().from(issueComments).where(eq(issueComments.issueId, chatId));
      expect(messagesAfterRevokedAttempt.some(comment => comment.body === "Stale session")).toBe(false);
      const local = await request(appFor()).post(path);
      expect(local.body.conversationUserId).toBe("local-board");
      await instanceSettingsService(db).updateExperimental({
        enableAgentChat: false,
      });
      expect((await request(app).get(path)).status).toBe(404);
      expect((await request(app).post(`/api/issues/${chatId}/queued-comments/interrupt`)
        .send(queuedInterrupt)).status).toBe(404);
      expect(
        (await request(app).get(`/api/issues/${resolved[0].body.id}`)).status,
      ).toBe(404);
      await instanceSettingsService(db).updateExperimental({
        enableAgentChat: true,
      });
    });
    it("deduplicates concurrent message retries and preserves recoverable delivery", async () => {
      const issue = await create();
      const clientRequestId = randomUUID();
      const messages = await Promise.all(
        Array.from({ length: 4 }, () =>
          issueService(db).addComment(
            issue.id,
            "Help scope a project",
            { userId: "local-board" },
            { clientRequestId },
          ),
        ),
      );
      expect(new Set(messages.map((message) => message.id)).size).toBe(1);
      expect(
        await undeliveredConversationComments(db, companyId, issue.id),
      ).toHaveLength(1);
      await expect(
        issueService(db).addComment(
          issue.id,
          "Different",
          { userId: "local-board" },
          { clientRequestId },
        ),
      ).rejects.toThrow(/different content/);
    });
    it("resets only this task, keeps history, and fences stale replies and retries", async () => {
      const issue = await create();
      const other = await create();
      const before = await issueService(db).addComment(
        issue.id,
        "Old session secret context",
        { userId: "local-board" },
      );
      const oldRun = await runFor(issue.id, before.id);
      await prepareConversationTurn(db, oldRun);
      for (const target of [issue, other])
        await db
          .insert(agentTaskSessions)
          .values({
            companyId,
            agentId,
            adapterType: "process",
            taskKey: target.id,
            sessionDisplayId: "old-session",
          });
      const command = await issueService(db).addComment(issue.id, "/new", {
        userId: "local-board",
      });
      const resetRun = await runFor(issue.id, command.id);
      expect((await prepareConversationTurn(db, resetRun)).reset).toBe(true);
      expect(
        (
          await prepareConversationTurn(
            db,
            (
              await db
                .select()
                .from(heartbeatRuns)
                .where(eq(heartbeatRuns.id, resetRun.id))
            )[0]!,
          )
        ).reset,
      ).toBe(true);
      const [current] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issue.id));
      expect(current.conversationSessionGeneration).toBe(1);
      expect(current.conversationBoundaryCommentId).toBe(command.id);
      expect(
        await db
          .select()
          .from(agentTaskSessions)
          .where(eq(agentTaskSessions.taskKey, issue.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(agentTaskSessions)
          .where(eq(agentTaskSessions.taskKey, other.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(issueComments)
          .where(eq(issueComments.issueId, issue.id)),
      ).toHaveLength(2);
      await expect(
        issueService(db).addComment(issue.id, "Late old reply", {
          agentId,
          runId: oldRun.id,
        }),
      ).rejects.toThrow(/earlier session/);
      await expect(
        prepareConversationTurn(
          db,
          (
            await db
              .select()
              .from(heartbeatRuns)
              .where(eq(heartbeatRuns.id, oldRun.id))
          )[0]!,
        ),
      ).rejects.toThrow(/older turn/);
      expect(await applyRunnerGoalPrpEvent(db, { companyId, agentId, issueId: issue.id, adapterType: "process" }, {
        eventType: "session.capabilities.updated", sourceRunId: oldRun.id, sourceSeq: 500, payload: {},
      })).toBeNull();
      expect(await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.taskKey, issue.id))).toHaveLength(0);
      const next = await issueService(db).addComment(
        issue.id,
        "Fresh context",
        { userId: "local-board" },
      );
      expect(
        (await conversationReplay(db, companyId, issue.id, next.id)).markdown,
      ).not.toContain("Old session");
      const payload = await buildPaperclipWakePayload({
        db, companyId,
        contextSnapshot: { issueId: issue.id, conversationMode: true, wakeCommentId: next.id },
        continuationSummary: { key: "summary", title: null, body: "Old session summary", updatedAt: new Date() },
        issueSummary: { ...issue, description: "Old session description" },
      });
      expect(JSON.stringify(payload)).not.toContain("Old session");
      expect(payload?.planReviewContext).toBeNull();
      expect(payload?.documentReviewContext).toBeNull();
      const later = await issueService(db).addComment(
        issue.id,
        "Following turn",
        { userId: "local-board" },
      );
      expect(
        (await conversationReplay(db, companyId, issue.id, later.id)).markdown,
      ).toContain("Fresh context");
      expect(
        (await conversationReplay(db, companyId, issue.id, next.id)).markdown,
      ).not.toContain("Following turn");
    });
    it("captures replay renditions, exact selected versions and unknown source history without rereading", async () => {
      const issue = await create();
      const [captured] = await db.insert(issueComments).values({ companyId, issueId: issue.id,
        authorUserId: "local-board", body: "Long replay ".repeat(900), payloadSourceProtocolVersion: 1,
        createdAt: new Date("2026-10-01T00:00:01Z") }).returning();
      const [quarantined] = await db.insert(issueComments).values({ companyId, issueId: issue.id,
        authorAgentId: agentId, body: "PRIVATE_QUARANTINED_REPLAY",
        sourceTrust: buildLowTrustSourceTrust({ issueId: issue.id, agentId }),
        createdAt: new Date("2026-10-01T00:00:02Z") }).returning();
      // A structural binding fixture, not production source qualification.
      // The actual PostgreSQL envelope hash differs from the rendered line.
      const [sealed] = await db.execute<{ snapshot: Record<string, unknown> }>(sql`
        with body as (select public.aw_native_payload_body_hash('comment',to_jsonb(c)) as hash
          from issue_comments c where c.id=${captured!.id}::uuid), content as (
          select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','comment','companyId',${companyId}::text,
            'id',${captured!.id}::text,'contentHash',hash),'policy',jsonb_build_object('issueIds','[]'::jsonb,
            'projectIds','[]'::jsonb,'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),
            'inputs','[]'::jsonb) as value from body)
        update issue_comments set payload_source_snapshot=value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')),
          updated_at='2026-10-01T01:02:03.123456Z'::timestamptz from content where id=${captured!.id}::uuid
        returning payload_source_snapshot as snapshot`);
      const replay = await conversationReplay(db, companyId, issue.id, null);
      const lines = [JSON.stringify({ author: "user", body: captured!.body.slice(0,8000) }),
        JSON.stringify({ author: "agent", body: LOW_TRUST_QUARANTINED_BODY })];
      expect(replay.markdown).toBe(lines.join("\n"));
      expect(replay.markdown).not.toContain("PRIVATE_QUARANTINED_REPLAY");
      const [version] = await db.execute<{ version: string }>(sql`select extract(epoch from updated_at)::text as version
        from issue_comments where id=${captured!.id}::uuid`);
      expect(version!.version).toMatch(/123456$/);
      expect(replay.sourceCaptures).toEqual([
        { input: { kind: "comment", issueId: issue.id, commentId: captured!.id, sourceVersion: version!.version,
          contentHash: createHash("sha256").update(lines[0]!,"utf8").digest("hex") }, payloadSourceSnapshot: sealed!.snapshot },
        { input: { kind: "comment", issueId: issue.id, commentId: quarantined!.id,
          sourceVersion: expect.any(String), contentHash: createHash("sha256").update(lines[1]!,"utf8").digest("hex") },
          payloadSourceSnapshot: null },
      ]);
      await db.update(issueComments).set({ body: "Later replacement", payloadSourceSnapshot: null }).where(eq(issueComments.id,captured!.id));
      expect(replay.sourceCaptures[0]!.payloadSourceSnapshot).toEqual(sealed!.snapshot);
      expect(replay.markdown).toBe(lines.join("\n"));
      const ordinary = await issueService(db).create(companyId,{ title: "Ordinary task" });
      expect(await conversationReplay(db,companyId,ordinary.id,null)).toEqual({ markdown: "",sourceCaptures: [] });
    });
    it("captures replay only for the newest forty live comments between boundary and wake in delivery order", async () => {
      const issue = await create();
      const base = Date.parse("2026-10-02T00:00:00Z");
      const [boundary] = await db.insert(issueComments).values({companyId,issueId:issue.id,body:"/new",authorUserId:"local-board",createdAt:new Date(base)}).returning();
      await db.update(issues).set({conversationBoundaryCommentId:boundary!.id}).where(eq(issues.id,issue.id));
      const rows = await db.insert(issueComments).values(Array.from({length:45},(_,i)=>({companyId,issueId:issue.id,
        body:`Replay ${i}`,authorUserId:"local-board",createdAt:new Date(base+(i+1)*1000)}))).returning();
      const [wake] = await db.insert(issueComments).values({companyId,issueId:issue.id,body:"Wake",authorUserId:"local-board",createdAt:new Date(base+50000)}).returning();
      await db.insert(issueComments).values([
        {companyId,issueId:issue.id,body:"Deleted",createdAt:new Date(base+49000),deletedAt:new Date()},
        {companyId,issueId:issue.id,body:"Future",createdAt:new Date(base+51000)},
        {companyId,issueId:issue.id,body:"Prior",createdAt:new Date(base-1000)},
      ]);
      const replay = await conversationReplay(db,companyId,issue.id,wake!.id);
      expect(replay.sourceCaptures.map(capture=>capture.input.commentId)).toEqual(rows.slice(5).map(row=>row.id));
      expect(replay.sourceCaptures.every(capture=>capture.payloadSourceSnapshot===null)).toBe(true);
      expect(replay.markdown.split("\n").map(line=>JSON.parse(line).body)).toEqual(rows.slice(5).map(row=>row.body));
    });
    it("projects the resolved chat plan review into fresh and resumed prompts without replaying old reviews", async () => {
      const issue = await create();
      const { document } = await documentService(db).upsertIssueDocument({
        issueId: issue.id, key: "plan", title: "Plan", format: "markdown", body: "Draft plan",
      });
      const [interaction] = await db.insert(issueThreadInteractions).values({
        companyId, issueId: issue.id, kind: "request_confirmation", status: "rejected",
        payload: { version: 1, target: { type: "issue_document", key: "plan", documentId: document.id,
          revisionId: document.latestRevisionId!, revisionNumber: document.latestRevisionNumber } },
        result: { outcome: "rejected", reason: "Include CHAT_REVIEW_MARKER in the revised plan." },
      }).returning();
      const input = { db, companyId, issueSummary: { ...issue, workMode: "planning" },
        contextSnapshot: { issueId: issue.id, conversationMode: true, interactionId: interaction!.id,
          interactionKind: "request_confirmation", interactionStatus: "rejected" } };
      const payload = await buildPaperclipWakePayload(input);
      expect(payload?.planReviewContext?.interaction).toMatchObject({
        status: "rejected", acceptedTargetRevision: null,
        result: { outcome: "rejected", reason: "Include CHAT_REVIEW_MARKER in the revised plan." },
      });
      for (const resumedSession of [false, true]) {
        const prompt = renderPaperclipWakePrompt(payload, { resumedSession });
        expect(prompt).toContain("request_confirmation rejected");
        expect(prompt).toContain("Include CHAT_REVIEW_MARKER in the revised plan.");
        expect(prompt).toContain("not approval to implement or hand off execution tasks");
        expect(prompt).not.toContain("- accepted target:");
      }
      const later = await buildPaperclipWakePayload({ ...input,
        contextSnapshot: { issueId: issue.id, conversationMode: true } });
      expect(later?.planReviewContext).toBeNull();
      // An unrelated confirmation must not cause old plan context to be replayed.
      await db.update(issueThreadInteractions).set({ payload: { version: 1 } })
        .where(eq(issueThreadInteractions.id, interaction!.id));
      expect((await buildPaperclipWakePayload(input))?.planReviewContext).toBeNull();
    });
    it("includes an initial handoff plan in the first execution prompt and pins approved revisions", async () => {
      const task = await issueService(db).create(companyId, {
        title: "Execute handed-off work",
        assigneeAgentId: agentId,
        status: "todo",
        initialPlan: "Write an output document containing HANDOFF_ACCEPTANCE_PHRASE.",
      });
      const initial = await getTaskPlanContext({ db, companyId, issueId: task.id });
      expect(task.description).toBeNull();
      expect(initial?.body).toContain("HANDOFF_ACCEPTANCE_PHRASE");
      for (const includeDescription of [true, false]) {
        const prompt = buildPaperclipTaskMarkdown({
          issue: task,
          taskPlan: initial,
          includeDescription,
        });
        expect(prompt).toContain("HANDOFF_ACCEPTANCE_PHRASE");
        expect(prompt).toContain(initial!.revisionId);
      }
      const { document: revision } = await documentService(db).upsertIssueDocument({
        issueId: task.id,
        key: "plan",
        format: "markdown",
        body: "A later unapproved draft.",
        baseRevisionId: initial!.revisionId,
      });
      expect((await getTaskPlanContext({ db, companyId, issueId: task.id }))?.revisionId)
        .toBe(revision.latestRevisionId);
      const approved = await getTaskPlanContext({
        db, companyId, issueId: task.id, approvedRevisionId: initial!.revisionId,
      });
      expect(approved?.body).toContain("HANDOFF_ACCEPTANCE_PHRASE");
      expect(approved?.body).not.toContain("unapproved");
      expect(await getTaskPlanContext({ db, companyId: randomUUID(), issueId: task.id })).toBeNull();
      expect(await getTaskPlanContext({
        db, companyId, issueId: task.id, approvedRevisionId: randomUUID(),
      })).toBeNull();
      const conversation = await create();
      await documentService(db).upsertIssueDocument({
        issueId: conversation.id, key: "plan", format: "markdown", body: "Pre-reset chat draft",
      });
      expect(await getTaskPlanContext({ db, companyId, issueId: conversation.id })).toBeNull();
      await documentService(db).upsertIssueDocument({
        issueId: task.id,
        key: "plan",
        format: "markdown",
        body: "QUARANTINED_PLAN_BODY",
        baseRevisionId: revision.latestRevisionId,
        sourceTrust: {
          preset: "low_trust_review",
          disposition: "quarantined",
          sourceIssueId: task.id,
          sourceRunId: randomUUID(),
          sourceAgentId: agentId,
        },
      });
      expect((await getTaskPlanContext({ db, companyId, issueId: task.id }))?.body)
        .not.toContain("QUARANTINED_PLAN_BODY");
      expect((await getTaskPlanContext({
        db, companyId, issueId: task.id, exposeLowTrustRaw: true,
      }))?.body).toBe("QUARANTINED_PLAN_BODY");
    });
    it("captures selected task plan source rendition after redaction while preserving unknown history and public shape", async () => {
      const task=await issueService(db).create(companyId,{title:"Plan source capture",initialPlan:"Original selected plan"});
      const captures:Array<DocumentRevisionSourceCapture|null>=[];
      const read=()=>getTaskPlanContext({db,companyId,issueId:task.id,onSourceCapture:capture=>captures.push(capture)});
      const initial=await read();
      expect(initial!.body).toBe("Original selected plan");
      expect(captures[0]).toEqual({input:{kind:"document_revision",documentId:initial!.documentId,
        revisionId:initial!.revisionId,issueId:task.id,contentHash:createHash("sha256").update(initial!.body,"utf8").digest("hex")},
        payloadSourceSnapshot:null});
      expect(initial).not.toHaveProperty("payloadSourceSnapshot");
      expect(initial).not.toHaveProperty("sourceCapture");
      await documentService(db).upsertIssueDocument({issueId:task.id,key:"plan",format:"markdown",body:"PRIVATE_QUARANTINED_PLAN_SOURCE",
        baseRevisionId:initial!.revisionId,sourceTrust:buildLowTrustSourceTrust({issueId:task.id,agentId})});
      const safe=await read();
      expect(safe!.body).toBe(LOW_TRUST_QUARANTINED_BODY);
      expect(captures[1]!.input.contentHash).toBe(createHash("sha256").update(safe!.body,"utf8").digest("hex"));
      const rawCaptures:Array<DocumentRevisionSourceCapture|null>=[];
      const raw=await getTaskPlanContext({db,companyId,issueId:task.id,exposeLowTrustRaw:true,onSourceCapture:capture=>rawCaptures.push(capture)});
      expect(raw!.body).toBe("PRIVATE_QUARANTINED_PLAN_SOURCE");
      expect(rawCaptures[0]!.input.contentHash).toBe(createHash("sha256").update(raw!.body,"utf8").digest("hex"));
      expect(rawCaptures[0]!.input.contentHash).not.toBe(captures[1]!.input.contentHash);
      for(const selection of [{companyId:randomUUID(),issueId:task.id},{companyId,issueId:task.id,approvedRevisionId:randomUUID()},
        {companyId,issueId:(await create()).id}]){
        const absent:Array<DocumentRevisionSourceCapture|null>=[];
        expect(await getTaskPlanContext({db,...selection,onSourceCapture:capture=>absent.push(capture)})).toBeNull();
        expect(absent).toEqual([null]);
      }
    });
    it("captures exact approved task plan snapshot from the selected revision and retains it after later changes", async () => {
      const task=await issueService(db).create(companyId,{title:"Pinned plan capture",initialPlan:"Earlier historical plan"});
      const initial=await getTaskPlanContext({db,companyId,issueId:task.id});
      const [revision]=await db.insert(documentRevisions).values({companyId,documentId:initial!.documentId,
        revisionNumber:2,body:"Exact selected plan bytes",format:"markdown",payloadSourceProtocolVersion:1}).returning();
      // Source-free canonical structural fixture, not native producer qualification.
      const [sealed]=await db.execute<{snapshot:Record<string,unknown>}>(sql`with content as (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','document_revision','companyId',company_id::text,
          'id',id::text,'contentHash',public.aw_native_payload_body_hash('document_revision',to_jsonb(r))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value
          from document_revisions r where id=${revision!.id}::uuid)
        update document_revisions set payload_source_snapshot=value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'))
          from content where id=${revision!.id}::uuid returning payload_source_snapshot as snapshot`);
      await db.update(documents).set({latestRevisionId:revision!.id,latestRevisionNumber:2,latestBody:revision!.body})
        .where(eq(documents.id,initial!.documentId));
      const captures:Array<DocumentRevisionSourceCapture|null>=[];
      const selected=await getTaskPlanContext({db,companyId,issueId:task.id,onSourceCapture:capture=>captures.push(capture)});
      expect(selected!.revisionId).toBe(revision!.id);
      expect(captures[0]).toEqual({input:{kind:"document_revision",documentId:initial!.documentId,revisionId:revision!.id,
        issueId:task.id,contentHash:createHash("sha256").update(revision!.body,"utf8").digest("hex")},payloadSourceSnapshot:sealed!.snapshot});
      await documentService(db).upsertIssueDocument({issueId:task.id,key:"plan",format:"markdown",body:"Later unapproved replacement",baseRevisionId:revision!.id});
      const approvedCaptures:Array<DocumentRevisionSourceCapture|null>=[];
      expect((await getTaskPlanContext({db,companyId,issueId:task.id,approvedRevisionId:revision!.id,
        onSourceCapture:capture=>approvedCaptures.push(capture)}))!.body).toBe(revision!.body);
      expect(approvedCaptures[0]).toEqual(captures[0]);
      await db.update(documentRevisions).set({body:"Later erased/unknown selected body",payloadSourceSnapshot:null}).where(eq(documentRevisions.id,revision!.id));
      expect(selected!.body).toBe("Exact selected plan bytes");
      expect(captures[0]!.payloadSourceSnapshot).toEqual(sealed!.snapshot);
    });
    it("keeps concurrent delivery and multiple resets in separate ordered queue entries", async () => {
      const issue = await create();
      const first = await issueService(db).addComment(issue.id, "First", {
        userId: "local-board",
      });
      const active = await runFor(issue.id, first.id);
      await prepareConversationTurn(db, active);
      await db
        .update(issues)
        .set({ executionRunId: active.id, executionLockedAt: new Date() })
        .where(eq(issues.id, issue.id));
      runningProcesses.set(active.id, {
        child: {} as never,
        graceSec: 0,
        processGroupId: null,
      });
      try {
        const commands = [];
        for (const body of ["Before reset", "/new", "/new", "After reset"])
          commands.push(
            await issueService(db).addComment(
              issue.id,
              body,
              { userId: "local-board" },
              { clientRequestId: randomUUID() },
            ),
          );
        const heartbeat = heartbeatService(db);
        await Promise.all(
          Array.from({ length: 3 }, () =>
            deliverConversationComments(db, issue, heartbeat.wakeup),
          ),
        );
        const wakes = await db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.agentId, agentId));
        const queued = wakes.filter(
          (wake) =>
            (wake.payload as Record<string, unknown>)?.issueId === issue.id,
        );
        expect(queued).toHaveLength(4);
        expect(
          queued.every((wake) => wake.status === "deferred_issue_execution"),
        ).toBe(true);
        expect(
          queued.map(
            (wake) => (wake.payload as Record<string, unknown>).commentId,
          ),
        ).toEqual(commands.map((comment) => comment.id));
        expect(
          await undeliveredConversationComments(db, companyId, issue.id),
        ).toHaveLength(0);
        for (const command of commands.slice(1, 3)) {
          const reset = await runFor(issue.id, command.id);
          await prepareConversationTurn(db, reset);
        }
        const [current] = await db
          .select()
          .from(issues)
          .where(eq(issues.id, issue.id));
        expect(current.conversationSessionGeneration).toBe(2);
        expect(current.conversationBoundaryCommentId).toBe(commands[2].id);
        await instanceSettingsService(db).updateExperimental({
          enableAgentChat: false,
        });
        expect(
          await heartbeat.wakeup(agentId, {
            contextSnapshot: {
              issueId: issue.id,
              wakeCommentId: commands[3].id,
            },
          }),
        ).toBeNull();
        await instanceSettingsService(db).updateExperimental({
          enableAgentChat: true,
        });
      } finally {
        runningProcesses.delete(active.id);
      }
    });
    it.each([false, true])("runs real process turns and resets without replaying pre-Stop queued input (queued=%s)", async (queuedBeforeStop) => {
      const runtimeCompany = randomUUID();
      const runtimeAgent = randomUUID();
      await db
        .insert(companies)
        .values({
          id: runtimeCompany,
          name: "Runtime chat",
          issuePrefix: queuedBeforeStop ? "RCHATQ" : "RCHAT",
          requireBoardApprovalForNewAgents: false,
          defaultResponsibleUserId: "local-board",
        });
      await db.insert(companyMemberships).values({ companyId: runtimeCompany, principalType: "user", principalId: "local-board",
        status: "active", membershipRole: "owner" });
      await ensureHumanRoleDefaultGrants(db, { companyId: runtimeCompany, principalId: "local-board",
        membershipRole: "owner", grantedByUserId: null });
      const generations: unknown[] = [];
      const app = express();
      app.use(express.json());
      app.post("/respond", async (req, res) => {
        const [run] = await db
          .select()
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, req.body.runId));
        generations.push(run.contextSnapshot?.conversationSessionGeneration);
        await issueService(db).addComment(
          String(run.contextSnapshot?.issueId),
          "What outcome should the task deliver?",
          { agentId: runtimeAgent, runId: run.id },
        );
        res.json({ ok: true });
      });
      const listener = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => listener.once("listening", resolve));
      const address = listener.address() as { port: number };
      const cwd = await mkdtemp(join(tmpdir(), "chat-runtime-"));
      const script = `fetch("http://127.0.0.1:${address.port}/respond", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({runId:process.env.PAPERCLIP_RUN_ID})}).then(async r=>{if(!r.ok){console.error(r.status,await r.text());process.exitCode=1}})`;
      await db
        .insert(agents)
        .values({
          id: runtimeAgent,
          companyId: runtimeCompany,
          name: "Conversation runtime",
          role: "engineer",
          status: "idle",
          adapterType: "process",
          adapterConfig: {
            command: process.execPath,
            args: ["-e", script],
            cwd,
          },
          runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
        });
      const chat = await issueService(db).create(runtimeCompany, {
        title: "Runtime chat",
        conversationAgentId: runtimeAgent,
        conversationUserId: "local-board",
        assigneeAgentId: runtimeAgent,
        conversationState: "waiting",
        status: "in_review",
      });
      const heartbeat = heartbeatService(db);
      const send = async (body: string) => {
        await issueService(db).addComment(
          chat.id,
          body,
          { userId: "local-board" },
          { clientRequestId: randomUUID() },
        );
        await deliverConversationComments(db, chat, heartbeat.wakeup);
      };
      const waitIdle = async () => {
        for (let i = 0; i < 160; i += 1) {
          const current = await issueService(db).getById(chat.id);
          if (isWaitingConversation(current) && !current?.executionRunId)
            return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const runs = await db
          .select()
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.agentId, runtimeAgent));
        throw new Error(
          JSON.stringify(
            runs.map((run) => ({
              status: run.status,
              error: run.error,
              result: run.resultJson,
            })),
          ),
        );
      };
      try {
        await send("Help clarify an idea");
        await waitIdle();
        expect(generations).toEqual([0]);
        // Stop leaves a pause and a no-replay recovery disposition. /new must
        // get through dispatch, release the chat pause, and reset in queue order.
        await db.insert(issueTreeHolds).values({ companyId: runtimeCompany,
          rootIssueId: chat.id, mode: "pause", status: "active", createdByActorType: "user",
          createdByUserId: "local-board", releasePolicy: { strategy: "manual", note: "leaf_pause" },
        });
        await db.insert(issueRecoveryActions).values({ companyId: runtimeCompany,
          sourceIssueId: chat.id, kind: "active_run_watchdog", ownerType: "board",
          cause: "uncertain_provider_action", status: "resolved", fingerprint: randomUUID(),
          evidence: { automaticRecovery: { replay: "blocked" } }, nextAction: "Do not replay the stopped turn.",
        });
        await db.insert(issueThreadInteractions).values({ companyId: runtimeCompany, issueId: chat.id,
          kind: "ask_user_questions", status: "pending", title: "Old topic", payload: { version: 1, questions: [{ id: "old", prompt: "Old topic?", options: [{ id: "yes", label: "Yes" }], selectionMode: "single", required: true }], supersedeOnUserComment: false },
        });
        let stoppedQueuedWakeId: string | null = null;
        if (queuedBeforeStop) {
          const [pending] = await db.insert(issueComments).values({ companyId: runtimeCompany,
            issueId: chat.id, authorUserId: "local-board", body: "Old topic queued before Stop",
          }).returning();
          const [stoppedQueuedWake] = await db.insert(agentWakeupRequests).values({ companyId: runtimeCompany, agentId: runtimeAgent,
            source: "on_demand", reason: "issue_execution_deferred", status: "deferred_issue_execution",
            requestedByActorType: "user", requestedByActorId: "local-board",
            payload: { issueId: chat.id, commentId: pending.id,
              _paperclipWakeContext: { issueId: chat.id, wakeReason: "issue_commented", wakeCommentId: pending.id, wakeCommentIds: [pending.id] } },
          }).returning();
          stoppedQueuedWakeId = stoppedQueuedWake.id;
        }
        await send("/new");
        await waitIdle();
        expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, chat.id)))[0].status).toBe("expired");
        expect((await db.select().from(issueTreeHolds).where(eq(issueTreeHolds.rootIssueId, chat.id)))[0].status).toBe("released");
        expect(generations).toEqual([0]);
        await send("A fresh idea");
        await waitIdle();
        expect(generations).toEqual([0, 1]);
        if (stoppedQueuedWakeId) {
          const [stoppedWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, stoppedQueuedWakeId));
          expect(stoppedWake).toMatchObject({ status: "cancelled", runId: null });
        }

        expect(
          await heartbeat.wakeup(runtimeAgent, {
            source: "automation",
            contextSnapshot: { issueId: chat.id },
          }),
        ).toBeNull();
        const history = await db
          .select()
          .from(issueComments)
          .where(eq(issueComments.issueId, chat.id));
        expect(history).toHaveLength(queuedBeforeStop ? 6 : 5);
      } finally {
        await new Promise<void>((resolve) => listener.close(() => resolve()));
        await rm(cwd, { recursive: true, force: true });
      }
    }, 30000);
    it("parks successful native interaction-only turns without consuming unrelated or stale gates", async () => {
      const chat = await create();
      const message = await issueService(db).addComment(chat.id, "Plan the work", { userId: "local-board" });
      const run = await runFor(chat.id, message.id);
      const prepared = await prepareConversationTurn(db, run);
      const succeeded = { ...run, contextSnapshot: prepared.context, status: "succeeded" };
      const [interaction] = await db.insert(issueThreadInteractions).values({
        companyId, issueId: chat.id, sourceRunId: run.id, createdByAgentId: agentId,
        kind: "request_confirmation", status: "answered", payload: { version: 1 },
      }).returning();
      expect(await settleConversationTurn(db, succeeded)).toBe(false);
      await db.update(issueThreadInteractions).set({ status: "pending", sourceRunId: null })
        .where(eq(issueThreadInteractions.id, interaction.id));
      expect(await settleConversationTurn(db, succeeded)).toBe(false);
      await db.update(issueThreadInteractions).set({ sourceRunId: run.id })
        .where(eq(issueThreadInteractions.id, interaction.id));
      for (const status of ["failed", "cancelled", "timed_out"]) {
        expect(await settleConversationTurn(db, { ...succeeded, status })).toBe(false);
      }
      await db.update(issueThreadInteractions).set({ createdByAgentId: null })
        .where(eq(issueThreadInteractions.id, interaction.id));
      expect(await settleConversationTurn(db, succeeded)).toBe(false);
      await db.update(issueThreadInteractions).set({ createdByAgentId: agentId })
        .where(eq(issueThreadInteractions.id, interaction.id));
      expect(await settleConversationTurn(db, { ...succeeded,
        contextSnapshot: { ...prepared.context, conversationSessionGeneration: -1 },
      })).toBe(false);
      expect(await settleConversationTurn(db, succeeded)).toBe(true);
      const [idle] = await db.select().from(issues).where(eq(issues.id, chat.id));
      expect(isWaitingConversation(idle)).toBe(true);
      const [pending] = await db.select().from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interaction.id));
      expect(pending.status).toBe("pending");
    });
    it("rejects late replies and session events from cancelled conversation turns", async () => {
      const chat = await create();
      const message = await issueService(db).addComment(chat.id, "Old topic", { userId: "local-board" });
      const run = await runFor(chat.id, message.id);
      await prepareConversationTurn(db, run);
      await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run.id));
      const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
      process.env.PAPERCLIP_AGENT_JWT_SECRET = "test-conversation-cancellation-secret";
      try {
        const app = express();
        app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
        app.post("/mutate", (_req, res) => res.sendStatus(204));
        const token = createLocalAgentJwt(agentId, companyId, "process", run.id)!;
        expect((await request(app).post("/mutate").set("Authorization", `Bearer ${token}`)).status).toBe(403);
      } finally {
        if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
        else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
      }
      await expect(issueService(db).addComment(chat.id, "Late old reply", { agentId, runId: run.id }))
        .rejects.toThrow(/cancelled/);
      expect(await applyRunnerGoalPrpEvent(db, { companyId, agentId, issueId: chat.id, adapterType: "process" }, {
        eventType: "session.capabilities.updated", sourceRunId: run.id, sourceSeq: 500, payload: {},
      })).toBeNull();
    });
    it("ignores execution dependency wakes during active and idle chat turns", async () => {
      const chat = await create();
      const heartbeat = heartbeatService(db);
      const blocker = await issueService(db).create(companyId, { title: "Linked execution", status: "done" });
      await issueService(db).update(chat.id, { blockedByIssueIds: [blocker.id] });
      const ordinary = await issueService(db).create(companyId, {
        title: "Ordinary dependent",
        status: "in_review",
        assigneeAgentId: agentId,
        blockedByIssueIds: [blocker.id],
      });
      for (const state of [
        { status: "in_review", conversationState: "waiting" },
        { status: "blocked", conversationState: "active" },
      ]) {
        await db.update(issues).set(state).where(eq(issues.id, chat.id));
        for (const reason of ["issue_blockers_resolved", "issue_children_completed", "issue_unblock_requested"]) {
          expect(await heartbeat.wakeup(agentId, {
            source: "automation",
            reason,
            contextSnapshot: { issueId: chat.id, wakeReason: reason },
          })).toBeNull();
        }
        expect((await issueService(db).listWakeableBlockedDependents(blocker.id)).map((issue) => issue.id))
          .toEqual([ordinary.id]);
      }
      expect((await issueService(db).getDependencyReadiness(chat.id)).blockerIssueIds).toEqual([blocker.id]);
    });

    it.each([
      { name: "reset idle chat", generation: 1, sourceGeneration: 0, waiting: true, ordinary: false, superseded: true },
      { name: "reset active chat", generation: 1, sourceGeneration: 0, waiting: false, ordinary: false, superseded: true },
      { name: "newer reply in the same session", generation: 1, sourceGeneration: 1, waiting: true, ordinary: false, superseded: true },
      { name: "current unanswered chat turn", generation: 1, sourceGeneration: 1, waiting: false, ordinary: false, superseded: false },
      { name: "unprepared failure without a session generation", generation: 1, sourceGeneration: undefined, waiting: true, ordinary: false, superseded: false },
      { name: "ordinary review task", generation: 0, sourceGeneration: 0, waiting: true, ordinary: true, superseded: false },
    ])("guards delayed cancelled-run recovery for $name", async (scenario) => {
      const task = scenario.ordinary
        ? await issueService(db).create(companyId, { title: "Ordinary review", status: "in_review", assigneeAgentId: agentId })
        : await create();
      const status = scenario.waiting ? "in_review" : "in_progress";
      await db.update(issues).set({
        status,
        ...(scenario.ordinary ? {} : {
          conversationSessionGeneration: scenario.generation,
          conversationState: scenario.waiting ? "waiting" : "active",
        }),
      }).where(eq(issues.id, task.id));
      const run = await runFor(task.id, randomUUID(), {
        conversationSessionGeneration: scenario.sourceGeneration,
      });
      await terminalizeLegacyExecution({ db, run, status: "cancelled", patch: { finishedAt: new Date() } });
      let actions = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, task.id));
      expect(actions).toHaveLength(scenario.superseded ? 0 : 1);
      // Also exercise an action queued before /new or the newer reply settled.
      if (!actions.length) {
        actions = await db.insert(issueRecoveryActions).values({
          companyId, sourceIssueId: task.id, kind: "active_run_watchdog",
          ownerType: "board", returnOwnerAgentId: agentId,
          cause: LEGACY_RECOVERY_CAUSE, fingerprint: `legacy-execution:${run.id}`,
          evidence: { runId: run.id }, nextAction: "Reconcile stopped work",
        }).returning();
      }
      await settleUnrecoverableExecutions(db);
      const [after] = await db.select().from(issues).where(eq(issues.id, task.id));
      const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actions[0]!.id));
      expect(after.status).toBe(scenario.superseded ? status : "blocked");
      expect(action).toMatchObject({ status: "resolved", outcome: scenario.superseded ? "cancelled" : "blocked" });
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)))[0].status).toBe("cancelled");
      if (!scenario.ordinary) expect(after.conversationSessionGeneration).toBe(scenario.generation);
    });

    it("only parks answered turns and preserves idle across recovery classification", async () => {
      const issue = await create();
      const message = await issueService(db).addComment(
        issue.id,
        "Which goal matters?",
        { userId: "local-board" },
      );
      const run = await runFor(issue.id, message.id);
      const prepared = await prepareConversationTurn(db, run);
      const succeeded = {
        ...run,
        contextSnapshot: prepared.context,
        status: "succeeded",
      };
      expect(await settleConversationTurn(db, succeeded)).toBe(false);
      await issueService(db).addComment(
        issue.id,
        "What outcome should the task deliver?",
        { agentId, runId: run.id },
      );
      expect(await settleConversationTurn(db, succeeded)).toBe(true);
      const [idle] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issue.id));
      expect(isWaitingConversation(idle)).toBe(true);
      expect(
        classifyIssueGraphLiveness({
          issues: [idle],
          relations: [],
          agents: [],
        }),
      ).toEqual([]);
      await instanceSettingsService(db).updateExperimental({
        enableAgentChat: false,
      });
      await expect(
        issueService(db).addComment(issue.id, "/new", {
          userId: "local-board",
        }),
      ).rejects.toThrow(/disabled/);
      expect(
        isWaitingConversation(
          (await db.select().from(issues).where(eq(issues.id, issue.id)))[0],
        ),
      ).toBe(true);
      await instanceSettingsService(db).updateExperimental({
        enableAgentChat: true,
      });
      const child = await issueService(db).create(companyId, { title: "Execute work", status: "done" });
      await db.update(issues).set({ parentId: issue.id }).where(eq(issues.id, child.id));
      expect(
        await issueService(db).getWakeableParentAfterChildCompletion(issue.id, {
          issueId: child.id,
          summary: "Finished",
        }),
      ).toBeNull();
    });
  },
);

describe("conversation execution wake policy", () => {
  it.each(["issue_blockers_resolved", "issue_children_completed", "issue_unblock_requested"])(
    "suppresses %s only for conversation containers",
    (reason) => {
      expect(isConversationExecutionWake({ conversationAgentId: "agent", conversationUserId: "user" }, reason)).toBe(true);
      expect(isConversationExecutionWake({}, reason)).toBe(false);
    },
  );
  it.each(["issue_commented", "interaction_resolved", "run_failed", "issue_recovery_action_restored"])(
    "preserves %s handling for pending conversation turns",
    (reason) => expect(isConversationExecutionWake({ conversationAgentId: "agent", conversationUserId: "user" }, reason)).toBe(false),
  );
});

describe("chat prompt policy", () => {
  it("preserves explicit plan approval while avoiding ritual confirmations for ordinary chat", () => {
    expect(AGENT_CHAT_DIRECTIVE).toContain("When the user asks to approve a plan before handoff");
    expect(AGENT_CHAT_DIRECTIVE).toContain('interactionKind: "confirmation"');
    expect(AGENT_CHAT_DIRECTIVE).toContain("targetRevisionId from the saved document's latestRevisionId");
    expect(AGENT_CHAT_DIRECTIVE).toContain('payload.target to { type: "issue_document", key: "plan", revisionId: latestRevisionId }');
    expect(AGENT_CHAT_DIRECTIVE).toContain("ordinary conversation replies and draft planning do not need confirmation");
    expect(AGENT_CHAT_DIRECTIVE).toContain("In Ask mode, discuss the plan without creating or revising documents or approval cards");
  });

  it.each([true, false])("preserves rejected-plan changes in task markdown (includeDescription=%s)", (includeDescription) => {
    const prompt = buildPaperclipTaskMarkdown({
      issue: { id: "chat", title: "Chat", workMode: "planning", conversationAgentId: "agent" },
      interaction: { kind: "request_confirmation", status: "rejected" },
      planReview: { status: "rejected", reason: "Add CHAT_REVIEW_MARKER and a validation step." },
      acceptedPlanContinuation: true,
      acceptedPlan: { revisionId: "stale-approved-plan" },
      includeDescription,
    });
    expect(prompt).toContain("Rejected plan review directive:");
    expect(prompt).toContain("Add CHAT_REVIEW_MARKER and a validation step.");
    expect(prompt).toContain("not approval to implement or hand off execution tasks");
    expect(prompt).toContain("first GET /api/issues/{issueId}/documents/plan");
    expect(prompt).toContain("baseRevisionId set to that latestRevisionId");
    expect(prompt).toContain("Bind the new approval request to the revision returned by the successful update");
    expect(prompt).not.toContain("Accepted chat plan directive:");
    expect(prompt).not.toContain("stale-approved-plan");
  });
  it.each(["standard", "ask", "planning"])(
    "keeps handoff instructions in %s, including accepted plans and resumes",
    (workMode) => {
      const prompt = buildPaperclipTaskMarkdown({
        issue: {
          id: "chat",
          identifier: null,
          title: "Chat",
          workMode,
          conversationAgentId: "agent",
          description: "Pre-boundary summary that must not replay",
        },
        acceptedPlanContinuation: true,
        includeDescription: true,
        acceptedPlan: { revisionId: "old-approved-plan" },
      });
      expect(prompt).toContain(AGENT_CHAT_DIRECTIVE);
      expect(prompt).not.toContain("Pre-boundary summary");
      expect(prompt).not.toContain("old-approved-plan");
      expect(prompt).not.toContain("Implement the accepted plan on this issue");
      expect(prompt).toContain("Create and link each task before claiming it exists");
    },
  );
});

describe("native conversation finalization", () => {
  it("does not require execution completion or schedule a continuation after a successful chat turn", () => {
    const decision = {
      policyVersion: "paperclip.native-status-arbiter.v1",
      statusAction: "in_progress",
      toStatus: "in_progress",
      reasonCode: "completion_evidence_incomplete",
      unblockDescriptor: null,
      effects: [
        {
          kind: "enqueue_continuation",
          continuationKind: "same_agent",
          summary: "Finish",
          idempotencyKey: "next",
          agentId: "agent",
        },
      ],
    } as Parameters<typeof conversationNativeDecision>[0]["decision"];
    const input = {
      conversation: true,
      terminalState: "succeeded",
      workspaceFinalizeStatus: "succeeded",
      hasGovernanceGate: false,
      priorStatus: "in_progress" as const,
      decision,
    };
    expect(conversationNativeDecision(input)).toMatchObject({
      statusAction: "preserve",
      effects: [],
    });
    expect(
      conversationNativeDecision({ ...input, hasGovernanceGate: true }),
    ).toBe(decision);
    expect(
      conversationNativeDecision({ ...input, terminalState: "failed" }),
    ).toBe(decision);
    expect(conversationNativeDecision({ ...input, conversation: false })).toBe(
      decision,
    );
  });
});
