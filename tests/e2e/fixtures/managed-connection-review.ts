import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { createDb, agents, authSessions, authUsers, companies, heartbeatRuns, agentWakeupRequests,
  issueComments, issueThreadInteractions, issues, documents, issueDocuments, environmentLeases } from "../../../packages/db/src/index.ts";
import { createApp } from "../../../server/src/app.js";
import { createStorageService } from "../../../server/src/storage/service.js";
import { createLocalDiskStorageProvider } from "../../../server/src/storage/local-disk-provider.js";
import { setupLiveEventsWebSocketServer } from "../../../server/src/realtime/live-events-ws.js";
import { getAssignedMcpGateway } from "../../../server/src/services/native-runtime/assigned-mcp-tools.js";
import { verifyNativeCleanupRuntimeState } from "../../../server/src/services/execution-sandbox/run-lease-cleanup.js";
import { issueService } from "../../../server/src/services/issues.js";
import { createDecisionWakeOriginAgent } from "../../../server/src/services/decision-wakeup.js";
import { orchestrationService } from "../../../server/src/services/orchestration/orchestration-service.js";
import { startEmbeddedPostgresTestDatabase } from "../../../server/src/__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable } from "../../../server/src/__tests__/helpers/managed-native-conversation-frame.js";
import { withManagedNativeHeartbeatFixture } from "../../../server/src/__tests__/helpers/managed-native-heartbeat-fixture.js";
import { prepareConnectionIntentRailwayFixture } from "../../../server/src/__tests__/helpers/connection-intent-railway-fixture.js";
import { listenOnFetchAllowedPort } from "../fetch-allowed-port";

export type ConnectionReviewJourney = "approve" | "decline" | "always" | "failure";
type ReviewDriver = {
  page: Page; context: BrowserContext; request: APIRequestContext;
  seed: { companyId: string; prefix: string }; agent: { id: string; name: string };
  issue: { id: string; identifier: string }; remaining: () => number;
  start: () => Promise<void>; waitInitialRun: () => Promise<void>;
  createLaterTask: () => Promise<{ id: string }>; calls: () => number;
  recordPendingComment: (commentId: string) => Promise<void>;
  resolutionRunId: () => string;
};
const record = (value: unknown): Record<string, unknown> => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};

/** A real Human, installed fixed-contract Railway tool and actual scheduler
 * Runs. Only the existing Railway HTTP boundary and model responses are
 * controlled. No process adapter, synthetic Run, or generic MCP exemption. */
export async function withManagedConnectionReview(input: {
  page: Page; journey: ConnectionReviewJourney; deadlineAt: number;
  driveReview: (driver: ReviewDriver) => Promise<void>;
}) {
  const binary = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY;
  if (!binary) throw new Error("managed_review_requires_source_bound_provider_artifact");
  const remaining = () => {
    const value = input.deadlineAt - Date.now();
    if (value <= 0) throw new Error("managed_review_initial_case_deadline_expired");
    return value;
  };
  const root = await mkdtemp(join(tmpdir(), "managed-connection-review-"));
  let completed = false;
  const database = await startEmbeddedPostgresTestDatabase("managed-connection-review-", {
    preserveDataOnFailure: () => !completed,
  });
  const db = createDb(database.connectionString);
  let railway: Awaited<ReturnType<typeof prepareConnectionIntentRailwayFixture>> | undefined;
  const request = async (...args: Parameters<NonNullable<typeof railway>["request"]>) => {
    assert(railway); return railway.request(...args);
  };
  type Role = "request" | "pending_note" | "resolution" | "later";
  const rolesByRun = new Map<string, { role: Role; runId: string; wakeId: string; commentId: string | null; interactionId: string | null }>();
  let scope: { companyId: string; agentId: string; userId: string } | undefined;
  let reviewTaskId: string | undefined, firstCommentId: string | undefined;
  let pendingCommentId: string | undefined, pendingReviewId: string | undefined;
  let laterTaskId: string | undefined, laterCommentId: string | undefined;
  const pendingNoteBody = "Keeping this review pending while I check.";
  const providerRuns: string[] = [];
  let responseText = "";
  const outcomeByRun = new Map<string, string>();
  const previousApi = process.env.PAPERCLIP_API_URL;
  const previousDiagnostics = process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS;
  let fixtureFailure: unknown;
  try {
    process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS = "1";
    await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: binary, timeoutSec: 180,
      schedulerMode: "serial", assignedToolGatewayHttpRequest: request,
      prepareNativeRuntimeContext: async ({ companyId, agentId, actor }) => {
        assert(actor.type === "board" && actor.userId && actor.sessionId);
        scope = { companyId, agentId, userId: actor.userId };
        await db.update(agents).set({ runtimeConfig: { timeoutSec: 180,
          heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } })
          .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
        railway = await prepareConnectionIntentRailwayFixture({ db, companyId, userId: actor.userId,
          holderAgentId: agentId, reviewJourney: input.journey });
      },
      // This existing hook runs after the Host authenticates the actual Run,
      // before model dispatch. Role selection never relies on call ordinal.
      beforeManagedModelRequest: async ({ runId, issueId }) => {
        assert(scope && issueId);
        const [bound] = await db.select({ run: heartbeatRuns, wake: agentWakeupRequests }).from(heartbeatRuns)
          .innerJoin(agentWakeupRequests, and(eq(agentWakeupRequests.companyId, scope.companyId),
            eq(agentWakeupRequests.id, heartbeatRuns.wakeupRequestId)))
          .where(and(eq(heartbeatRuns.companyId, scope.companyId), eq(heartbeatRuns.agentId, scope.agentId),
            eq(heartbeatRuns.id, runId))).limit(1);
        assert(bound && bound.run.status === "running" && bound.run.runtimeMode === "native" &&
          bound.run.nativeIssueId === issueId && bound.run.responsibleUserId === scope.userId);
        const payload = record(bound.wake.payload), context = record(bound.run.contextSnapshot);
        const commentId = typeof payload.commentId === "string" ? payload.commentId
          : typeof context.wakeCommentId === "string" ? context.wakeCommentId : null;
        const interactionId = typeof payload.interactionId === "string" ? payload.interactionId
          : typeof context.interactionId === "string" ? context.interactionId : null;
        const [comment] = commentId ? await db.select().from(issueComments).where(and(
          eq(issueComments.companyId, scope.companyId), eq(issueComments.issueId, issueId), eq(issueComments.id, commentId))) : [];
        const reviews = issueId === reviewTaskId ? (await db.select().from(issueThreadInteractions).where(and(
          eq(issueThreadInteractions.companyId, scope.companyId), eq(issueThreadInteractions.issueId, issueId),
          eq(issueThreadInteractions.kind, "request_confirmation")))).filter(row => record(row.payload).toolAction) : [];
        assert(reviews.length <= 1);
        const review = reviews[0];
        let role: Role;
        if (interactionId) {
          const requestRole = [...rolesByRun.values()].find(entry => entry.role === "request");
          assert(issueId === reviewTaskId && review?.id === interactionId && requestRole &&
            review.sourceRunId === requestRole.runId && payload.sourceRunId === review.sourceRunId &&
            bound.wake.requestedByActorId === scope.userId && review.resolvedByUserId === scope.userId &&
            (review.status === "accepted" || review.status === "rejected"));
          role = "resolution";
        } else {
          assert(comment && comment.authorUserId === scope.userId && !comment.createdByRunId && !comment.deletedAt);
          if (issueId === reviewTaskId && comment.id === firstCommentId) role = "request";
          else if (issueId === laterTaskId && comment.id === laterCommentId) {
            assert(input.journey === "always"); role = "later";
          } else {
            assert(issueId === reviewTaskId && comment.body === pendingNoteBody && review);
            assert(!pendingCommentId || pendingCommentId === comment.id);
            assert.equal(review.status, "pending");
            pendingCommentId = comment.id; pendingReviewId = review.id; role = "pending_note";
          }
        }
        const prior = rolesByRun.get(runId);
        if (prior) assert.equal(prior.role, role);
        else {
          assert(![...rolesByRun.values()].some(entry => entry.role === role), "No duplicate or automatic-retry role is allowed");
          rolesByRun.set(runId, { role, runId, wakeId: bound.wake.id, commentId, interactionId });
        }
      },
      beforeProviderResponse: async ({ reservation, run, manifest, request: wire, sourceReceipt }) => {
        assert.equal(reservation.status, "dispatched"); assert.equal(reservation.purpose, "worker_model");
        assert(reservation.maximumMinor > 0 && reservation.workerAttemptId);
        assert.equal(reservation.providerWireReceipt?.bodySha256, wire.wireBodySha256);
        assert.equal(manifest.runId, run.id); assert(sourceReceipt);
      },
      providerReply: ({ body, callIndex, execution, runId }) => {
        if (!providerRuns.includes(runId)) providerRuns.push(runId);
        const binding = rolesByRun.get(runId); assert(binding);
        const role = binding.role;
        assert(providerRuns.length <= (input.journey === "always" ? 4 : 3));
        const tools = body.tools as Array<{ name: string }>;
        const tool = (name: string) => {
          const selected = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."]
            .some(prefix => value.name === `${prefix}${name}`));
          assert(selected, `managed_review_tool_missing_${name}`); return selected.name;
        };
        const use = (id: string, name: string, value: Record<string, unknown>) => ({
          stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input: value }],
        });
        const finish = (done: boolean) => use(`review-finish-${role}`, tool("paperclip_finish"), {
          schema: "paperclip.run_result.v1", reportedWorkDisposition: done ? "done" : "yielded",
          summary: done ? responseText : "Waiting for the responsible Human's governed tool decision.",
          completionClaim: { contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: done,
            criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
              status: done ? "satisfied" : "unknown", evidenceRefs: [] })),
            remainingWork: done ? [] : [{ description: "Wait for the Human tool decision and retain its actual outcome.", blocksCompletion: true }] },
          evidence: [], verification: [], attentionRequests: [], artifacts: [],
          ...(!done ? { continuation: { kind: "response_wake", summary: "Resume after the Human resolves the tool review.",
            idempotencyKey: "railway-review-human-response" } } : {}),
        });
        if ((role === "request" || role === "later") && callIndex === 1) {
          assert(railway);
          const selected = tools.filter(value => /railway/i.test(value.name) && /list[-_]?projects/i.test(value.name));
          assert.equal(selected.length, 1);
          return use(`review-railway-${role}`, selected[0]!.name,
            { workspaceId: railway.workspaceId, first: role === "later" ? 2 : 25 });
        }
        if (role === "request" && callIndex === 2) return finish(false);
        if (role === "pending_note" && callIndex === 1) return finish(false);
        if (role === "resolution" && callIndex === 1) {
          const responses = execution.interactionResponses;
          assert(responses && responses.length === 1);
          const response = record(responses[0]!.response);
          const action = response.status === "rejected" ? null : record(record(response.result).toolAction);
          if (input.journey === "decline") {
            assert.equal(response.status, "rejected");
            responseText = "Review declined. No projects were read.";
          } else if (input.journey === "failure") {
            assert(action); assert.equal(response.status, "accepted"); assert.equal(action.status, "failed");
            responseText = "Read failed: the fixed Railway provider returned an actual failure.";
          } else {
            assert(action); assert.equal(response.status, "accepted"); assert.equal(action.status, "executed");
            assert(JSON.stringify(action.resultSummary).includes("Roadmap"));
            responseText = "I found the actual Railway project Roadmap.";
          }
          outcomeByRun.set(runId, responseText);
          return use("review-document-1", tool("write_document"), { idempotencyKey: "review-retained-outcome", key: "result",
            title: "Actual governed Railway review outcome", body: responseText, baseRevisionId: null });
        }
        if (role === "later" && callIndex === 2) {
          const messages = body.messages as Array<{ content: unknown }>;
          const results = messages.flatMap(message => Array.isArray(message.content) ? message.content : []) as Array<Record<string, unknown>>;
          const result = results.find(value => value.type === "tool_result" && value.tool_use_id === "review-railway-later");
          assert(result && result.is_error !== true && JSON.stringify(result.content).includes("Roadmap"));
          responseText = "I found the actual Railway project Roadmap with the later bounded arguments.";
          outcomeByRun.set(runId, responseText);
          return use("review-document-2", tool("write_document"), { idempotencyKey: "review-retained-outcome", key: "result",
            title: "Actual governed Railway review outcome", body: responseText, baseRevisionId: null });
        }
        // The accepted terminal summary is published by the existing Native
        // presentation owner with this actual Run's agent/run attribution.
        if ((role === "resolution" && callIndex === 2) || (role === "later" && callIndex === 3)) return finish(true);
        return { stop_reason: "end_turn", content: [{ type: "text", text: role === "resolution" || role === "later" ? responseText : "Waiting for the Human review." }] };
      },
      driveScheduler: async ({ actor, companyId, agentId, heartbeat, factsForRun }) => {
        assert(railway && actor.type === "board" && actor.userId && actor.sessionId);
        const [session] = await db.select().from(authSessions).where(and(eq(authSessions.id, actor.sessionId),
          eq(authSessions.userId, actor.userId), sql`${authSessions.expiresAt} > now()`)).limit(1);
        assert(session);
        const resolveSessionFromHeaders = async (headers: Headers) => {
          const entry = (headers.get("cookie") ?? "").split(";").map(value => value.trim()).find(value => value.startsWith("session_token="));
          const token = entry ? decodeURIComponent(entry.slice("session_token=".length)) : null;
          if (!token) return null;
          const [current] = await db.select().from(authSessions).where(and(eq(authSessions.token, token), sql`${authSessions.expiresAt} > now()`)).limit(1);
          if (!current) return null;
          const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email }).from(authUsers).where(eq(authUsers.id, current.userId));
          return user ? { session: { id: current.id, userId: current.userId, expiresAt: current.expiresAt }, user } : null;
        };
        const server = createServer();
        let app: Awaited<ReturnType<typeof createApp>> | undefined;
        let live: ReturnType<typeof setupLiveEventsWebSocketServer> | undefined;
        let ownedContext: BrowserContext | undefined;
        let appFailure: unknown;
        try {
          const port = await listenOnFetchAllowedPort(server), origin = `http://127.0.0.1:${port}`;
          const registered = getAssignedMcpGateway(db);
          app = await createApp(db, { heartbeat, assignedToolGateway: registered,
          toolHttpTransport: { remoteHttpRequest: request, remoteHttpEndpointLookup: railway.endpointLookup },
          resolveSession: req => resolveSessionFromHeaders(new Headers({ cookie: req.header("cookie") ?? "" })),
          uiMode: "static", serverPort: port, deploymentMode: "authenticated", deploymentExposure: "private",
          bindHost: "127.0.0.1", allowedHostnames: ["127.0.0.1"], authReady: true, companyDeletionEnabled: false,
          storageService: createStorageService(createLocalDiskStorageProvider(join(root, "storage"))),
          localPluginDir: join(root, "plugins"), managedPluginAutoInstall: [],
          decisionServiceOptions: { wakeOriginAgent: createDecisionWakeOriginAgent(heartbeat.wakeup) },
          });
          assert.equal(getAssignedMcpGateway(db), registered);
          server.on("request", app);
          live = setupLiveEventsWebSocketServer(server, db, { deploymentMode: "authenticated", resolveSessionFromHeaders });
          process.env.PAPERCLIP_API_URL = `${origin}/api`;
          const browser = input.page.context().browser(); assert(browser);
          ownedContext = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
          await ownedContext.addCookies([{ name: "session_token", value: session.token, url: origin }]);
          const page = await ownedContext.newPage();
          const locale = await ownedContext.request.patch(`${origin}/api/auth/preferences`, { data: { expectedUserId: actor.userId, locale: "en" } });
          assert(locale.ok(), "Use the actual account locale owner");
          const [company] = await db.select().from(companies).where(eq(companies.id, companyId)); assert(company);
          const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)); assert(agent);
          const createTask = async (later: boolean) => {
            const task = await issueService(db).create(companyId, {
              title: later ? "Read projects with different arguments" : "Read recent Railway projects",
              description: "Use the actual fixed Railway contract after the responsible Human's governed review; retain its outcome.",
              status: "todo", responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId,
            }, db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
            const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
              expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
              completionContract: { objective: "Retain the actual governed Railway review outcome",
                requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["No dispatch before Human approval", "Never resend the resolved action"] },
              budgets: { maxWallClockSeconds: later ? 180 : 540, maxModelCostMinor: 10, maxToolActions: 10, maxRetries: later ? 0 : 2 },
              workers: [{ key: "reviewed-reader", issueId: task.id }] });
            await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
              action: "start", rationale: "Human authorizes a bounded reviewed Railway read" });
            return task;
          };
          const task = await createTask(false);
          reviewTaskId = task.id;
          const openTask = async (issueId: string, later: boolean) => {
            const response = await ownedContext!.request.post(`/api/issues/${issueId}/comments`, { data: {
              body: later ? "Read Railway projects again using the later bounded pagination."
                : "Read our Railway projects. Wait for my governed approval before executing the tool, then report the actual outcome.",
            } });
            assert.equal(response.status(), 201);
            const comment = await response.json() as { id: string };
            if (later) laterCommentId = comment.id; else firstCommentId = comment.id;
          };
          const runRows = () => db.select({ run: heartbeatRuns, wake: agentWakeupRequests }).from(heartbeatRuns)
            .innerJoin(agentWakeupRequests, and(eq(agentWakeupRequests.id, heartbeatRuns.wakeupRequestId),
              eq(agentWakeupRequests.companyId, companyId)))
            .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)));
          const verifyStopped = async (runId: string) => {
            await expect.poll(async () => {
              const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
                eq(environmentLeases.heartbeatRunId, runId)));
              const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
              return leases.length > 0 && leases.every(lease => lease.status === "expired" && lease.leasePolicy === "ephemeral" &&
                lease.cleanupStatus === "success" && lease.failureReason === "paperclip_runner_destroy_after_turn" &&
                lease.releasedAt instanceof Date) && run?.nativeProcessCleanupPending === false;
            }, { timeout: remaining() }).toBe(true);
            for (const lease of await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
              eq(environmentLeases.heartbeatRunId, runId)))) {
              const stopped = await verifyNativeCleanupRuntimeState(db, { companyId, runId, leaseId: lease.id }, lease.metadata?.remoteExecutionTermination);
              assert.equal(stopped.state, "stopped");
            }
          };
          await input.driveReview({ page, context: ownedContext, request: ownedContext.request,
            seed: { companyId, prefix: company.issuePrefix }, agent: { id: agentId, name: agent.name },
            issue: { id: task.id, identifier: task.identifier! }, remaining,
            calls: () => railway!.captures().filter(capture => capture.purpose === "projects_call").length,
            start: () => openTask(task.id, false),
            waitInitialRun: async () => {
              await expect.poll(async () => (await runRows()).find(row =>
                (row.wake.payload as Record<string, unknown>)?.commentId === firstCommentId)?.run.status,
                { timeout: remaining() }).toBe("succeeded");
              const first = (await runRows()).find(row => (row.wake.payload as Record<string, unknown>)?.commentId === firstCommentId);
              assert(first && first.run.nativeIssueId === task.id && first.run.responsibleUserId === actor.userId);
              assert.equal(first.wake.source, "automation"); assert.equal(first.wake.requestedByActorId, actor.userId);
              await verifyStopped(first.run.id);
            },
            resolutionRunId: () => {
              const role = [...rolesByRun.values()].find(entry => entry.role === "resolution");
              assert(role); return role.runId;
            },
            recordPendingComment: async commentId => {
              const [note] = await db.select().from(issueComments).where(and(eq(issueComments.companyId, companyId),
                eq(issueComments.issueId, task.id), eq(issueComments.id, commentId)));
              const [review] = await db.select().from(issueThreadInteractions).where(and(
                eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, task.id),
                eq(issueThreadInteractions.kind, "request_confirmation"), eq(issueThreadInteractions.status, "pending")));
              assert(note && note.body === pendingNoteBody && note.authorUserId === actor.userId && !note.createdByRunId && review);
              assert(!pendingCommentId || pendingCommentId === commentId);
              pendingCommentId = commentId; pendingReviewId = review.id;
              // Await the actual durable wake acknowledgement, not an arbitrary delay.
              await expect.poll(async () => (await db.select().from(agentWakeupRequests).where(and(
                eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
                sql`${agentWakeupRequests.payload}->>'issueId' = ${task.id}`)))
                .some(wake => record(wake.payload).commentId === commentId), { timeout: remaining() }).toBe(true);
              // Keep the real Human review pending until this note's actual Run has retired.
              await expect.poll(async () => (await runRows()).some(row =>
                record(row.wake.payload).commentId === commentId), { timeout: remaining() }).toBe(true);
              await heartbeat.drainActiveRunExecutions();
              await expect.poll(async () => (await runRows()).find(row =>
                record(row.wake.payload).commentId === commentId)?.run.status,
                { timeout: remaining() }).toBe("succeeded");
              const noteRun = (await runRows()).find(row => record(row.wake.payload).commentId === commentId);
              assert(noteRun && rolesByRun.get(noteRun.run.id)?.role === "pending_note");
              await verifyStopped(noteRun.run.id);
              const [stillPending] = await db.select().from(issueThreadInteractions).where(and(
                eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, task.id),
                eq(issueThreadInteractions.id, review.id)));
              assert(stillPending && stillPending.status === "pending" && stillPending.sourceRunId === review.sourceRunId);
              assert.equal(railway!.captures().filter(capture => capture.purpose === "projects_call").length, 0);
            },
            createLaterTask: async () => {
              assert.equal(input.journey, "always");
              const later = await createTask(true); laterTaskId = later.id;
              await openTask(later.id, true); return { id: later.id };
            },
          });
          await expect.poll(async () => {
            const observed = await runRows();
            const roles = [...rolesByRun.values()];
            return roles.some(entry => entry.role === "request") && roles.some(entry => entry.role === "resolution") &&
              (input.journey !== "always" || roles.some(entry => entry.role === "later")) &&
              observed.length === roles.length && observed.every(row => row.run.status === "succeeded");
          }, { timeout: remaining() }).toBe(true);
          const rows = await runRows();
          const roles = [...rolesByRun.values()];
          assert.equal(rows.length, roles.length);
          assert.equal(roles.filter(entry => entry.role === "request").length, 1);
          assert.equal(roles.filter(entry => entry.role === "resolution").length, 1);
          assert.equal(roles.filter(entry => entry.role === "pending_note").length, 1);
          assert.equal(roles.filter(entry => entry.role === "later").length, input.journey === "always" ? 1 : 0);
          assert.equal(rows.length, 3 + Number(input.journey === "always"));
          const [card] = await db.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId),
            eq(issueThreadInteractions.issueId, task.id), eq(issueThreadInteractions.kind, "request_confirmation")));
          const first = rows.find(row => (row.wake.payload as Record<string, unknown>)?.commentId === firstCommentId);
          assert(first && card && card.sourceRunId === first.run.id && card.resolvedByUserId === actor.userId);
          const resolution = roles.find(entry => entry.role === "resolution"); assert(resolution);
          const second = rows.find(row => row.run.id === resolution.runId && row.run.nativeIssueId === task.id);
          assert(second && second.wake.requestedByActorId === actor.userId);
          assert.equal((second.wake.payload as Record<string, unknown>).interactionId, card.id);
          assert.equal(providerRuns.length, roles.length);
          assert(pendingCommentId && pendingReviewId === card.id);
          const noteWakes = (await db.select().from(agentWakeupRequests).where(and(
            eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId),
            sql`${agentWakeupRequests.payload}->>'issueId' = ${task.id}`)))
            .filter(wake => record(wake.payload).commentId === pendingCommentId);
          const pendingRole = roles.find(entry => entry.role === "pending_note");
          assert(pendingRole && noteWakes.some(wake => wake.runId === pendingRole.runId));
          assert.deepEqual(new Set(providerRuns), new Set(rows.map(row => row.run.id)));
          for (const row of rows) {
            assert.equal(row.run.runtimeMode, "native"); assert.equal(row.run.responsibleUserId, actor.userId);
            const facts = factsForRun(row.run.id);
            const role = rolesByRun.get(row.run.id); assert(role);
            assert(facts.providerCallCount >= (role.role === "pending_note" ? 1 : 2));
            assert(facts.issuerFacts.length > 0 && facts.issuerFacts.every(fact => fact.scope === "worker_model" && fact.runId === row.run.id));
            await verifyStopped(row.run.id);
          }
          assert.equal(railway.captures().filter(capture => capture.purpose === "projects_call").length,
            input.journey === "decline" ? 0 : input.journey === "always" ? 2 : 1);
          const [finished] = await db.select().from(issues).where(eq(issues.id, task.id)); assert.equal(finished?.status, "done");
          const [retained] = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
            and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, companyId))).where(and(
              eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
          assert.equal(retained?.body, outcomeByRun.get(resolution.runId));
          assert(retained?.body);
        } catch (error) {
          appFailure = error; throw error;
        } finally {
          const cleanupErrors: unknown[] = [];
          try { await ownedContext?.close(); } catch (error) { cleanupErrors.push(error); }
          if (live) {
            const owner = live; for (const client of owner.clients) client.terminate();
            try { await new Promise<void>((resolve, reject) => owner.close(error => error ? reject(error) : resolve())); }
            catch (error) { cleanupErrors.push(error); }
          }
          if (app) {
            const shutdown: unknown = app.locals.paperclipShutdown;
            try { assert.equal(typeof shutdown, "function"); if (typeof shutdown === "function") await shutdown(); }
            catch (error) { cleanupErrors.push(error); }
          }
          if (server.listening) {
            try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
            catch (error) { cleanupErrors.push(error); }
          }
          if (cleanupErrors.length && appFailure === undefined)
            throw new AggregateError(cleanupErrors, "Managed review app cleanup failed");
        }
      },
    });
    completed = true;
  } catch (error) {
    fixtureFailure = error; throw error;
  } finally {
    if (previousApi === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = previousApi;
    if (previousDiagnostics === undefined) delete process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS;
    else process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS = previousDiagnostics;
    const cleanupErrors: unknown[] = [];
    try { await db.$client.end({ timeout: 0 }); } catch (error) { cleanupErrors.push(error); }
    try { await database.cleanup(); } catch (error) { cleanupErrors.push(error); }
    if (completed && cleanupErrors.length === 0) {
      try { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length && fixtureFailure === undefined) throw new AggregateError(cleanupErrors, "Managed review fixture cleanup failed");
  }
}
