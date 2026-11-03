import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { and, eq, sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { createDb, authSessions, authUsers, companies, environmentLeases, heartbeatRuns, issues } from "../../../packages/db/src/index.ts";
import { createApp } from "../../../server/src/app.js";
import { createStorageService } from "../../../server/src/storage/service.js";
import { createLocalDiskStorageProvider } from "../../../server/src/storage/local-disk-provider.js";
import { createDecisionWakeOriginAgent } from "../../../server/src/services/decision-wakeup.js";
import { issueService } from "../../../server/src/services/issues.js";
import { getAssignedMcpGateway } from "../../../server/src/services/native-runtime/assigned-mcp-tools.js";
import { verifyNativeCleanupRuntimeState } from "../../../server/src/services/execution-sandbox/run-lease-cleanup.js";
import { setupLiveEventsWebSocketServer } from "../../../server/src/realtime/live-events-ws.js";
import { startEmbeddedPostgresTestDatabase } from "../../../server/src/__tests__/helpers/embedded-postgres.js";
import { withManagedNativeHeartbeatFixture } from "../../../server/src/__tests__/helpers/managed-native-heartbeat-fixture.js";
import { createControlledNativeSignoffBackend } from "../../../server/src/__tests__/helpers/controlled-native-signoff-backend.js";
import { makeConversationFixtureTreeWritable } from "../../../server/src/__tests__/helpers/managed-native-conversation-frame.js";
import { listenOnFetchAllowedPort } from "../fetch-allowed-port";

/** Real Human UI and agent-auth policy API over the existing two-agent Native
 * scheduler/Host owner. The shared controlled backend dispatches no model;
 * this case makes no provider/OpenCode SDK qualification claim. */
export async function withManagedSignoffCommentRequirement(page: Page, deadlineAt: number,
  inspect: (facts: { origin: string; companyPrefix: string; issueId: string; identifier: string;
    reviewerId: string; reviewerRunId: string; board: APIRequestContext;
    missingComment: () => Promise<Awaited<ReturnType<APIRequestContext["patch"]>>> }) => Promise<void>) {
  const binary = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY;
  if (!binary) throw new Error("managed_signoff_ui_requires_source_bound_provider_artifact");
  const remaining = () => { const ms = deadlineAt - Date.now(); if (ms <= 0) throw new Error("managed_signoff_ui_initial_deadline_expired"); return ms; };
  const root = await mkdtemp(join(tmpdir(), "managed-signoff-comment-ui-"));
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: ReturnType<typeof createDb> | undefined;
  let completed = false;
  const previousApi = process.env.PAPERCLIP_API_URL;
  const previousDiagnostics = process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS;
  const backendOwner = createControlledNativeSignoffBackend();
  try {
    process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS = "1";
    database = await startEmbeddedPostgresTestDatabase("managed-signoff-comment-ui-", { preserveDataOnFailure: () => !completed });
    const scopedDb = createDb(database.connectionString); db = scopedDb;
    await withManagedNativeHeartbeatFixture({ db: scopedDb, root, opencodeBinary: binary, timeoutSec: 180,
      schedulerMode: "serial", managedTwoAgentSignoff: true,
      controlledNativeSessionBackendFactory: backendOwner.controlledBackend,
      providerReply: () => { throw new Error("managed_signoff_ui_provider_dispatch_unexpected"); },
      driveScheduler: async ({ actor, companyId, heartbeat, managedAgentIds, managedSignoff, closeManagedAgentHostForRun, factsForRun }) => {
        assert(managedAgentIds && managedSignoff && actor.userId && actor.sessionId);
        const server = createServer();
        let app: Awaited<ReturnType<typeof createApp>> | undefined;
        let live: ReturnType<typeof setupLiveEventsWebSocketServer> | undefined;
        try {
          const resolveSessionFromHeaders = async (headers: Headers) => {
            const entry = (headers.get("cookie") ?? "").split(";").map(x => x.trim()).find(x => x.startsWith("session_token="));
            if (!entry) return null;
            const [session] = await scopedDb.select().from(authSessions).where(and(
              eq(authSessions.token, decodeURIComponent(entry.slice("session_token=".length))), sql`${authSessions.expiresAt} > now()`));
            if (!session) return null;
            const [user] = await scopedDb.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
              .from(authUsers).where(eq(authUsers.id, session.userId));
            return user ? { session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt }, user } : null;
          };
          const port = await listenOnFetchAllowedPort(server), origin = `http://127.0.0.1:${port}`;
          const registered = getAssignedMcpGateway(scopedDb);
          app = await createApp(scopedDb, { heartbeat, assignedToolGateway: registered,
            resolveSession: req => resolveSessionFromHeaders(new Headers({ cookie: req.header("cookie") ?? "" })),
            uiMode: "static", serverPort: port, deploymentMode: "authenticated", deploymentExposure: "private",
            bindHost: "127.0.0.1", allowedHostnames: ["127.0.0.1"], authReady: true, companyDeletionEnabled: false,
            storageService: createStorageService(createLocalDiskStorageProvider(join(root, "storage"))),
            localPluginDir: join(root, "plugins"), managedPluginAutoInstall: [],
            decisionServiceOptions: { wakeOriginAgent: createDecisionWakeOriginAgent(heartbeat.wakeup) },
          });
          assert.equal(getAssignedMcpGateway(scopedDb), registered);
          server.on("request", app);
          live = setupLiveEventsWebSocketServer(server, scopedDb, { deploymentMode: "authenticated", resolveSessionFromHeaders });
          process.env.PAPERCLIP_API_URL = `${origin}/api`;
          await page.context().setExtraHTTPHeaders({ Origin: origin });
          const [session] = await scopedDb.select().from(authSessions).where(and(eq(authSessions.id, actor.sessionId),
            eq(authSessions.userId, actor.userId), sql`${authSessions.expiresAt} > now()`));
          assert(session);
          await page.context().addCookies([{ name: "session_token", value: session.token, url: origin }]);
          const locale = await page.request.patch(`${origin}/api/auth/preferences`, { data: { expectedUserId: actor.userId, locale: "en" } });
          assert(locale.ok());
          const [company] = await scopedDb.select().from(companies).where(eq(companies.id, companyId)); assert(company);
          const created = await page.request.post(`${origin}/api/companies/${companyId}/issues`, { data: {
            title: "Signoff comment required", description: "Review the work and require the participant's decision comment.",
            status: "todo", executionPolicy: { stages: [{ type: "review", participants: [{ type: "agent", agentId: managedAgentIds.reviewer }] }] },
          } });
          expect(created.status()).toBe(201);
          const task = await created.json() as { id: string; identifier: string };
          await issueService(scopedDb).update(task.id, { assigneeAgentId: managedAgentIds.executor,
            actorUserId: actor.userId, privacyActor: actor, companyGuard: companyId });
          const wake = await heartbeat.wakeup(managedAgentIds.executor, { source: "assignment", triggerDetail: "system",
            reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId,
            payload: { issueId: task.id }, contextSnapshot: { issueId: task.id } });
          assert(wake);
          const executorControl = await backendOwner.waitForBackend(wake.id);
          await executorControl.waitForStart(); executorControl.release();
          const runRows = () => scopedDb.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, task.id)));
          await expect.poll(async () => (await runRows()).find(run => run.id === wake.id)?.status,
            { timeout: remaining() }).toBe("succeeded");
          await expect.poll(async () => (await runRows()).find(run => run.agentId === managedAgentIds.reviewer)?.id,
            { timeout: remaining() }).toEqual(expect.any(String));
          const reviewer = (await runRows()).find(run => run.agentId === managedAgentIds.reviewer); assert(reviewer);
          const reviewControl = await backendOwner.waitForBackend(reviewer.id); await reviewControl.waitForStart();
          const [currentReviewer] = await scopedDb.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, reviewer.id));
          assert(currentReviewer && currentReviewer.status === "running" && currentReviewer.runtimeMode === "native" &&
            currentReviewer.agentId === managedAgentIds.reviewer && currentReviewer.responsibleUserId === actor.userId);
          const context = currentReviewer.contextSnapshot as Record<string, unknown>;
          expect(context).toMatchObject({ source: "issue.execution_stage", statusDecisionSource: "native_status_decision",
            executionStage: { wakeRole: "reviewer", stageType: "review", currentParticipant: { type: "agent", agentId: managedAgentIds.reviewer } } });
          await inspect({ origin, companyPrefix: company.issuePrefix, issueId: task.id, identifier: task.identifier,
            reviewerId: managedAgentIds.reviewer, reviewerRunId: reviewer.id, board: page.request,
            missingComment: () => page.request.patch(`${origin}/api/issues/${task.id}`, {
              headers: { Authorization: `Bearer ${managedSignoff.agentApiTokens.reviewer}`, "X-Paperclip-Run-Id": reviewer.id },
              data: { status: "done" },
            }),
          });
          reviewControl.release(); await heartbeat.drainActiveRunExecutions();
          await closeManagedAgentHostForRun(reviewer.id);
          const runs = await runRows(); expect(runs).toHaveLength(2);
          for (const run of runs) {
            expect(run).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: task.id,
              responsibleUserId: actor.userId, nativeProcessCleanupPending: false });
            expect(factsForRun(run.id)).toMatchObject({ providerCallCount: 0, issuerFacts: [] });
            const leases = await scopedDb.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, run.id)));
            expect(leases).toHaveLength(1);
            const lease = leases[0]; assert(lease);
            expect(lease).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
            expect(lease.releasedAt).toBeInstanceOf(Date);
            expect(await verifyNativeCleanupRuntimeState(scopedDb, { companyId, runId: run.id, leaseId: lease.id },
              lease.metadata?.remoteExecutionTermination)).toMatchObject({ state: "stopped", runId: run.id, leaseId: lease.id });
          }
        } finally {
          backendOwner.close();
          const cleanupErrors: unknown[] = [];
          try { await heartbeat.drainActiveRunExecutions(); } catch (error) { cleanupErrors.push(error); }
          try { await page.goto("about:blank"); } catch (error) { cleanupErrors.push(error); }
          if (live) { const ownedLive = live; for (const client of ownedLive.clients) client.terminate();
            try { await new Promise<void>((resolve, reject) => ownedLive.close(error => error ? reject(error) : resolve())); }
            catch (error) { cleanupErrors.push(error); } }
          if (app) { const shutdown: unknown = app.locals.paperclipShutdown;
            try { assert.equal(typeof shutdown, "function"); if (typeof shutdown === "function") await shutdown(); }
            catch (error) { cleanupErrors.push(error); } }
          if (server.listening) { try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
            catch (error) { cleanupErrors.push(error); } }
          if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Managed signoff UI cleanup failed");
        }
      },
    });
    completed = true;
  } finally {
    backendOwner.close();
    if (previousApi === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = previousApi;
    if (previousDiagnostics === undefined) delete process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS; else process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS = previousDiagnostics;
    try { if (db) await db.$client.end({ timeout: 5 }); } finally { await database?.cleanup(); }
    if (!completed) console.info("managed_signoff_ui_failure_root_retained", JSON.stringify({ path: root }));
    else { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }
}
