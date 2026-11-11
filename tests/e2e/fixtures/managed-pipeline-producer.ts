import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { and, asc, eq, inArray, sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { createDb, authSessions, authUsers, companies, environmentLeases, heartbeatRunEvents, heartbeatRuns } from "../../../packages/db/src/index.ts";
import { createApp } from "../../../server/src/app.js";
import { createStorageService } from "../../../server/src/storage/service.js";
import { createLocalDiskStorageProvider } from "../../../server/src/storage/local-disk-provider.js";
import { createDecisionWakeOriginAgent } from "../../../server/src/services/decision-wakeup.js";
import { issueService } from "../../../server/src/services/issues.js";
import { accessService } from "../../../server/src/services/access.js";
import { updateMemberPermissionsSchema } from "../../../packages/shared/src/validators/access.ts";
import { getAssignedMcpGateway } from "../../../server/src/services/native-runtime/assigned-mcp-tools.js";
import { verifyNativeCleanupRuntimeState } from "../../../server/src/services/execution-sandbox/run-lease-cleanup.js";
import { startEmbeddedPostgresTestDatabase } from "../../../server/src/__tests__/helpers/embedded-postgres.js";
import { withManagedNativeHeartbeatFixture } from "../../../server/src/__tests__/helpers/managed-native-heartbeat-fixture.js";
import { createControlledNativeSignoffBackend } from "../../../server/src/__tests__/helpers/controlled-native-signoff-backend.js";
import { boundedRunnerFailureDiagnostic, makeConversationFixtureTreeWritable } from "../../../server/src/__tests__/helpers/managed-native-conversation-frame.js";
import { listenOnFetchAllowedPort } from "../fetch-allowed-port";

/** An actual current Native producer for pipeline application/API contracts.
 * The existing controlled backend holds its real Run; no provider dispatch,
 * accepted Run seed, process JWT, or model qualification is supplied here. */
export async function withManagedPipelineProducer(deadlineAt: number, inspect: (facts: {
  db: ReturnType<typeof createDb>; board: APIRequestContext; agentApi: APIRequestContext;
  company: { id: string; issuePrefix: string }; key: { agentId: string; runId: string; taskId: string };
}) => Promise<void>) {
  const binary = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY;
  if (!binary) throw new Error("managed_pipeline_requires_source_bound_provider_artifact");
  const remaining = () => { const ms = deadlineAt - Date.now(); if (ms <= 0) throw new Error("managed_pipeline_initial_deadline_expired"); return ms; };
  const root = await mkdtemp(join(tmpdir(), "managed-pipeline-producer-"));
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: ReturnType<typeof createDb> | undefined;
  let completed = false;
  const previousApi = process.env.PAPERCLIP_API_URL;
  const previousDiagnostics = process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS;
  const backendOwner = createControlledNativeSignoffBackend();
  try {
    process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS = "1";
    database = await startEmbeddedPostgresTestDatabase("managed-pipeline-producer-", { preserveDataOnFailure: () => !completed });
    const scopedDb = createDb(database.connectionString); db = scopedDb;
    await withManagedNativeHeartbeatFixture({ db: scopedDb, root, opencodeBinary: binary, timeoutSec: 180,
      schedulerMode: "serial", controlledNativeSessionBackendFactory: backendOwner.controlledBackend,
      providerReply: () => { throw new Error("managed_pipeline_provider_dispatch_unexpected"); },
      driveScheduler: async ({ actor, companyId, agentId, heartbeat, factsForRun }) => {
        assert(actor.userId && actor.sessionId);
        const server = createServer();
        let app: Awaited<ReturnType<typeof createApp>> | undefined;
        let board: APIRequestContext | undefined;
        let agentApi: APIRequestContext | undefined;
        try {
          const port = await listenOnFetchAllowedPort(server), origin = `http://127.0.0.1:${port}`;
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
          const registered = getAssignedMcpGateway(scopedDb);
          app = await createApp(scopedDb, { heartbeat, assignedToolGateway: registered,
            resolveSession: req => resolveSessionFromHeaders(new Headers({ cookie: req.header("cookie") ?? "" })),
            uiMode: "none", serverPort: port, deploymentMode: "authenticated", deploymentExposure: "private",
            bindHost: "127.0.0.1", allowedHostnames: ["127.0.0.1"], authReady: true, companyDeletionEnabled: false,
            storageService: createStorageService(createLocalDiskStorageProvider(join(root, "storage"))),
            localPluginDir: join(root, "plugins"), managedPluginAutoInstall: [],
            decisionServiceOptions: { wakeOriginAgent: createDecisionWakeOriginAgent(heartbeat.wakeup) },
          });
          assert.equal(getAssignedMcpGateway(scopedDb), registered); server.on("request", app);
          process.env.PAPERCLIP_API_URL = `${origin}/api`;
          const [session] = await scopedDb.select().from(authSessions).where(and(eq(authSessions.id, actor.sessionId),
            eq(authSessions.userId, actor.userId), sql`${authSessions.expiresAt} > now()`)); assert(session);
          board = await pwRequest.newContext({ baseURL: origin,
            extraHTTPHeaders: { Origin: origin, Cookie: `session_token=${encodeURIComponent(session.token)}` } });
          // Member-list UI is Human-only. Use the same canonical grant owner
          // as agent invite approval, after the actual Human permission check.
          const access = accessService(scopedDb);
          assert(await access.canUser(companyId, actor.userId, "users:manage_permissions"));
          await access.ensureMembership(companyId, "agent", agentId, "member", "active");
          const existing = await access.listPrincipalGrants(companyId, "agent", agentId);
          const grants = updateMemberPermissionsSchema.parse({ grants: [
            ...existing.map(grant => ({ permissionKey: grant.permissionKey, scope: grant.scope })),
            ...(!existing.some(grant => grant.permissionKey === "pipelines:write") ? [{ permissionKey: "pipelines:write", scope: null }] : []),
          ] });
          await access.setPrincipalGrants(companyId, "agent", agentId, grants.grants, actor.userId);
          const keyResponse = await board.post(`/api/agents/${agentId}/keys`, { data: { name: "Current Native pipeline writer" } });
          expect(keyResponse.ok()).toBe(true); const apiKey = await keyResponse.json() as { id: string; token: string };
          const taskResponse = await board.post(`/api/companies/${companyId}/issues`, { data: {
            title: "Human-authored pipeline writer source", description: "Exercise the source-bound pipeline API contracts.", status: "todo",
          } });
          expect(taskResponse.status()).toBe(201); const task = await taskResponse.json() as { id: string };
          await issueService(scopedDb).update(task.id, { assigneeAgentId: agentId,
            actorUserId: actor.userId, privacyActor: actor, companyGuard: companyId });
          const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
            requestedByActorType: "user", requestedByActorId: actor.userId, payload: { issueId: task.id }, contextSnapshot: { issueId: task.id } });
          assert(wake); const control = await backendOwner.waitForBackend(wake.id); await control.waitForStart();
          const [run] = await scopedDb.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, wake.id)));
          expect(run).toMatchObject({ status: "running", runtimeMode: "native", agentId, nativeIssueId: task.id, responsibleUserId: actor.userId });
          const [company] = await scopedDb.select().from(companies).where(eq(companies.id, companyId)); assert(company);
          agentApi = await pwRequest.newContext({ baseURL: origin,
            extraHTTPHeaders: { Authorization: `Bearer ${apiKey.token}`, "X-Paperclip-Run-Id": run!.id } });
          await inspect({ db: scopedDb, board, agentApi, company: { id: companyId, issuePrefix: company.issuePrefix },
            key: { agentId, runId: run!.id, taskId: task.id } });
          control.release(); await heartbeat.drainActiveRunExecutions();
          try {
            await expect.poll(async () => (await scopedDb.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id)))[0]?.status,
              { timeout: remaining() }).toBe("succeeded");
          } catch {
            // Keep the original Native failure private while attaching its bounded
            // code/stage and message hashes to the Playwright assertion report.
            let diagnostic: unknown = { availability: "unavailable" };
            try {
              const [failedRun] = await scopedDb.select({ status: heartbeatRuns.status,
                errorCode: heartbeatRuns.errorCode, error: heartbeatRuns.error,
                executionStage: heartbeatRuns.executionStage, nativePhase: heartbeatRuns.nativePhase })
                .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, wake.id)));
              if (failedRun) {
                const events = await scopedDb.select({ seq: heartbeatRunEvents.seq, eventType: heartbeatRunEvents.eventType,
                  message: heartbeatRunEvents.message, payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents)
                  .where(and(eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, wake.id),
                    inArray(heartbeatRunEvents.eventType, ["error", "turn.failed"])))
                  .orderBy(asc(heartbeatRunEvents.seq)).limit(4);
                const statuses = ["queued", "running", "succeeded", "failed", "timed_out", "cancelled", "interrupted", "superseded"];
                diagnostic = { status: statuses.includes(failedRun.status) ? failedRun.status : "other",
                  ...boundedRunnerFailureDiagnostic(0, { executionStage: failedRun.executionStage,
                    nativePhase: failedRun.nativePhase, error: { code: failedRun.errorCode, message: failedRun.error } }),
                  runnerFailures: events.map(event => ({ eventType: event.eventType,
                    ...boundedRunnerFailureDiagnostic(event.seq, event.payload, event.message) })) };
              }
            } catch { /* Diagnostic collection must not replace the assertion failure. */ }
            throw new Error(`managed_pipeline_native_run_failure:${JSON.stringify(diagnostic)}`);
          }
          expect(factsForRun(wake.id)).toMatchObject({ providerCallCount: 0, issuerFacts: [] });
          const leases = await scopedDb.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, wake.id)));
          expect(leases).toHaveLength(1); const lease = leases[0]; assert(lease);
          expect(lease).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
          expect(lease.releasedAt).toBeInstanceOf(Date);
          expect(await verifyNativeCleanupRuntimeState(scopedDb, { companyId, runId: wake.id, leaseId: lease.id },
            lease.metadata?.remoteExecutionTermination)).toMatchObject({ state: "stopped", runId: wake.id, leaseId: lease.id });
          expect((await scopedDb.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId))))).toHaveLength(1);
        } finally {
          backendOwner.close(); const errors: unknown[] = [];
          try { await heartbeat.drainActiveRunExecutions(); } catch (error) { errors.push(error); }
          for (const context of [agentApi, board]) if (context) { try { await context.dispose(); } catch (error) { errors.push(error); } }
          if (app) { const shutdown: unknown = app.locals.paperclipShutdown;
            try { assert.equal(typeof shutdown, "function"); if (typeof shutdown === "function") await shutdown(); } catch (error) { errors.push(error); } }
          if (server.listening) { try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { errors.push(error); } }
          if (errors.length) throw new AggregateError(errors, "Managed pipeline API cleanup failed");
        }
      },
    });
    completed = true;
  } finally {
    backendOwner.close();
    if (previousApi === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = previousApi;
    if (previousDiagnostics === undefined) delete process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS; else process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS = previousDiagnostics;
    try { if (db) await db.$client.end({ timeout: 5 }); } finally { await database?.cleanup(); }
    if (!completed) console.info("managed_pipeline_api_failure_root_retained", JSON.stringify({ path: root }));
    else { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }
}
