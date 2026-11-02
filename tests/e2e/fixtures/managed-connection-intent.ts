import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "../../../packages/db/node_modules/drizzle-orm/index.js";
import { expect, type Page } from "@playwright/test";
import { nativeRunInputSourceReceiptSchema } from "../../../packages/shared/src/validators/native-payload-source-snapshot.ts";
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

/** Actual supported serial Native lifecycle with only the fixed Railway HTTP
 * boundary controlled. Authentication, Human input, Plans, Runs, installation,
 * catalog contracts, tool dispatch and terminalization retain their owners. */
export async function withManagedConnectionIntent(page: Page, deadlineAt: number) {
  const binary = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY;
  if (!binary) throw new Error("managed_connection_requires_source_bound_provider_artifact");
  const remaining = () => {
    const value = deadlineAt - Date.now();
    if (value <= 0) throw new Error("managed_connection_initial_case_deadline_expired");
    return value;
  };
  const root = await mkdtemp(join(tmpdir(), "managed-connection-intent-"));
  let completed = false;
  const database = await startEmbeddedPostgresTestDatabase("managed-connection-intent-", {
    preserveDataOnFailure: () => !completed,
  });
  const db = createDb(database.connectionString);
  let railway: Awaited<ReturnType<typeof prepareConnectionIntentRailwayFixture>> | undefined;
  const providerRuns: string[] = [];
  let actualOutput: string | undefined;
  const request = async (...args: Parameters<NonNullable<typeof railway>["request"]>) => {
    assert(railway, "The canonical Railway fixture must exist before provider HTTP");
    return railway.request(...args);
  };
  const previousApi = process.env.PAPERCLIP_API_URL;
  try {
    await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: binary, timeoutSec: 180,
      schedulerMode: "serial", assignedToolGatewayHttpRequest: request,
      prepareNativeRuntimeContext: async ({ companyId, agentId, actor }) => {
        assert(actor.type === "board" && actor.source === "session" && actor.userId && actor.sessionId);
        await db.update(agents).set({ runtimeConfig: { timeoutSec: 180,
          heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
        // This identity is only the existing installation holder. Its adapter
        // is never invoked and it confers no runtime or paid qualification.
        const [holder] = await db.insert(agents).values({ companyId, name: "Existing Railway holder",
          role: "engineer", status: "idle", adapterType: "process", adapterConfig: {}, runtimeConfig: {} }).returning();
        assert(holder);
        railway = await prepareConnectionIntentRailwayFixture({ db, companyId, userId: actor.userId, holderAgentId: holder.id });
      },
      beforeProviderResponse: async ({ actor, reservation, run, manifest, request: wire, sourceReceipt }) => {
        assert.equal(reservation.status, "dispatched"); assert.equal(reservation.purpose, "worker_model");
        assert(reservation.maximumMinor > 0 && reservation.workerAttemptId);
        assert.equal(reservation.providerWireReceipt?.bodySha256, wire.wireBodySha256);
        assert.equal(manifest.runId, run.id); assert.equal(run.responsibleUserId, actor.userId);
        assert(nativeRunInputSourceReceiptSchema.safeParse(sourceReceipt).success);
      },
      providerReply: ({ body, callIndex, execution, runId }) => {
        if (!providerRuns.includes(runId)) providerRuns.push(runId);
        assert(providerRuns.length <= 2, "The interaction may produce exactly two Runs");
        const ordinal = providerRuns.indexOf(runId);
        const tools = body.tools as Array<{ name: string }>;
        assert(Array.isArray(tools));
        const tool = (name: string) => {
          const selected = tools.find(item => item.name === name || ["paperclip__", "paperclip_", "paperclip."].some(prefix => item.name === prefix + name));
          assert(selected, `The real runtime must advertise ${name}`); return selected.name;
        };
        const use = (id: string, name: string, input: Record<string, unknown>) => ({
          stop_reason: "tool_use" as const, content: [{ type: "tool_use", id, name, input }],
        });
        if (ordinal === 0 && callIndex === 1) {
          assert(!tools.some(item => item.name.toLowerCase().includes("railway") && /list[-_]?projects/.test(item.name.toLowerCase())));
          return use("connection-search", tool("connections_search"), { query: "railway" });
        }
        if (ordinal === 0 && callIndex === 2)
          return use("connection-request", tool("connection_request"), { service: "railway" });
        if (ordinal === 1 && callIndex === 1) {
          assert(railway);
          const selected = tools.filter(item => item.name.toLowerCase().includes("railway") && /list[-_]?projects/.test(item.name.toLowerCase()));
          assert.equal(selected.length, 1, "Use the actual installed fixed Railway descriptor");
          return use("railway-projects", selected[0]!.name, { workspaceId: railway.workspaceId });
        }
        if (ordinal === 1 && callIndex === 2) {
          const messages = body.messages as Array<{ content: unknown }>;
          const results = messages.flatMap(message => Array.isArray(message.content) ? message.content : []) as Array<Record<string, unknown>>;
          const result = results.find(item => item.type === "tool_result" && item.tool_use_id === "railway-projects");
          assert(result && result.is_error !== true, "The retained output must come from the actual successful tool result");
          actualOutput = JSON.stringify(result.content);
          assert(actualOutput.includes("Fixture project inventory"));
          return use("connection-result", tool("write_document"), { idempotencyKey: "connection-actual-railway-output",
            key: "result", title: "Railway project inventory", body: actualOutput, baseRevisionId: null });
        }
        if ((ordinal === 0 && callIndex === 3) || (ordinal === 1 && callIndex === 3)) {
          const done = ordinal === 1;
          return use(`connection-finish-${ordinal}`, tool("paperclip_finish"), {
            schema: "paperclip.run_result.v1", reportedWorkDisposition: done ? "done" : "yielded",
            summary: done ? "Retained the actual Railway inventory." : "Waiting for the responsible Human's connection card.",
            completionClaim: { contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: done,
              criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
                status: done ? "satisfied" : "unknown", evidenceRefs: [] })),
              remainingWork: done ? [] : [{ description: "Read the inventory after Human access approval.", blocksCompletion: true }] },
            evidence: [], verification: [], attentionRequests: [], artifacts: [],
            ...(!done ? { continuation: { kind: "response_wake", summary: "Resume after the Human resolves the connection card.",
              idempotencyKey: "connection-human-response" } } : {}),
          });
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: ordinal ? "The actual inventory is retained." : "The connection card is waiting for the Human." }] };
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
          // The official fixture supplies its own server Origin globally.
          // This real app has a distinct listener: use its actual browser
          // origin, preserving the existing session CSRF guard rather than
          // weakening it or borrowing the official app's authority.
          await page.context().setExtraHTTPHeaders({ Origin: origin });
          await page.context().addCookies([{ name: "session_token", value: session.token, url: origin }]);
          const locale = await page.request.patch(`${origin}/api/auth/preferences`, { data: { expectedUserId: actor.userId, locale: "en" } });
          assert(locale.ok(), "Set the actual fixture Human account language through its existing owner");
          const [company] = await db.select().from(companies).where(eq(companies.id, companyId)); assert(company);
          const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)); assert(agent);
          const task = await issueService(db).create(companyId, { title: "Read our Railway projects",
            description: "Read the fixed Railway project inventory after my connection approval; retain its actual output.",
            status: "in_progress", responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId },
            db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
          const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
            expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
            completionContract: { objective: "Retain the actual Railway project inventory", requiredOutputs: [{ kind: "task_document", key: "result" }],
              businessInvariants: ["Only the Human may approve connection access", "Use the actual fixed-contract tool result"] },
            budgets: { maxWallClockSeconds: 360, maxModelCostMinor: 10, maxToolActions: 8, maxRetries: 1 },
            workers: [{ key: "inventory", issueId: task.id }] });
          await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
            action: "start", rationale: "Human requests a bounded inventory with a connection card if needed" });
          const response = await page.request.post(`${origin}/api/issues/${task.id}/comments`, { data: {
            body: "Read our Railway projects. Send me the connection card if access is missing, then wait for my answer.",
          } });
          assert.equal(response.status(), 201); const comment = await response.json() as { id: string };
          const runRows = () => db.select({ run: heartbeatRuns, wake: agentWakeupRequests }).from(heartbeatRuns)
            .innerJoin(agentWakeupRequests, and(eq(agentWakeupRequests.id, heartbeatRuns.wakeupRequestId),
              eq(agentWakeupRequests.companyId, companyId))).where(and(eq(heartbeatRuns.companyId, companyId),
              eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.nativeIssueId, task.id)));
          await expect.poll(async () => (await runRows()).find(row =>
            (row.wake.payload as Record<string, unknown>)?.commentId === comment.id)?.run.status,
            { timeout: remaining() }).toBe("succeeded");
          const first = (await runRows()).find(row => (row.wake.payload as Record<string, unknown>)?.commentId === comment.id);
          assert(first); assert.equal(first.wake.source, "automation"); assert.equal(first.wake.requestedByActorId, actor.userId);
          assert.equal(first.run.responsibleUserId, actor.userId);
          const [savedComment] = await db.select().from(issueComments).where(eq(issueComments.id, comment.id));
          assert(savedComment && savedComment.authorUserId === actor.userId && savedComment.body.includes("Read our Railway projects"));
          await expect.poll(async () => {
            const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
              eq(environmentLeases.heartbeatRunId, first.run.id)));
            const [terminal] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, first.run.id));
            return leases.length > 0 && leases.every(lease => lease.status === "released" && lease.cleanupStatus === "success")
              && terminal?.nativeProcessCleanupPending === false;
          }, { timeout: remaining() }).toBe(true);
          for (const lease of await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
            eq(environmentLeases.heartbeatRunId, first.run.id)))) {
            const stopped = await verifyNativeCleanupRuntimeState(db, { companyId, runId: first.run.id, leaseId: lease.id },
              lease.metadata?.remoteExecutionTermination);
            assert.equal(stopped.state, "stopped");
          }
          const taskUrl = `/${company.issuePrefix}/issues/${task.identifier}`;
          await page.goto(origin + taskUrl);
          await expect(page.getByText(`${agent.name} needs Railway`, { exact: true })).toBeVisible({ timeout: remaining() });
          await page.getByRole("button", { name: "Connect / Use existing" }).click();
          await expect(page.getByRole("heading", { name: "Use an existing connection" })).toBeVisible();
          await page.getByRole("button", { name: railway.connection.name }).click();
          await expect(page.getByText("Railway connected", { exact: true })).toBeVisible({ timeout: remaining() });
          await expect(page).toHaveURL(origin + taskUrl);
          await expect(page.getByTestId("connection-intent-focus-target").filter({ hasText: "Railway connected" })).toBeFocused();
          expect(await page.locator("body").innerText()).not.toMatch(/\/authorize\?|authorizationUrl/);
          const [card] = await db.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId),
            eq(issueThreadInteractions.issueId, task.id), eq(issueThreadInteractions.kind, "connection_intent")));
          assert(card && card.status === "accepted" && card.sourceRunId === first.run.id && card.addresseeUserId === actor.userId);
          await expect.poll(async () => (await runRows()).find(row =>
            (row.wake.payload as Record<string, unknown>)?.interactionId === card.id)?.run.status,
            { timeout: remaining() }).toBe("succeeded");
          const runs = await runRows(); assert.equal(runs.length, 2); assert(runs.every(row => row.run.status === "succeeded"));
          const second = runs.find(row => row.run.id !== first.run.id); assert(second);
          assert.equal((second.wake.payload as Record<string, unknown>).interactionId, card.id);
          assert.equal(second.wake.requestedByActorId, actor.userId); assert.equal(second.run.responsibleUserId, actor.userId);
          assert.deepEqual(providerRuns, [first.run.id, second.run.id]);
          assert(factsForRun(first.run.id).providerCallCount >= 3 && factsForRun(second.run.id).providerCallCount >= 3);
          for (const row of runs) {
            const facts = factsForRun(row.run.id);
            assert(facts.issuerFacts.length > 0 && facts.issuerFacts.every(fact => fact.scope === "worker_model" && fact.runId === row.run.id));
          }
          assert.equal(railway.captures().filter(item => item.purpose === "projects_call").length, 1);
          const [current] = await db.select().from(issues).where(eq(issues.id, task.id)); assert.equal(current?.status, "done");
          const [result] = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
            and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, companyId))).where(and(
              eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
          assert(actualOutput); assert.equal(result?.body, actualOutput);
          const cards = await db.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId),
            eq(issueThreadInteractions.issueId, task.id), eq(issueThreadInteractions.kind, "connection_intent")));
          assert.equal(cards.filter(item => item.status === "accepted").length, 1);
          assert.equal(cards.filter(item => item.status === "pending").length, 0);
          assert(cards.every(item => ["accepted", "expired"].includes(item.status)));
          const humanComments = await db.select().from(issueComments).where(and(eq(issueComments.companyId, companyId),
            eq(issueComments.issueId, task.id), eq(issueComments.authorUserId, actor.userId)));
          assert.equal(humanComments.length, 1, "Human connection acceptance must continue without resending the request");
        } finally {
          const cleanupErrors: unknown[] = [];
          if (app) {
            try { await page.goto("about:blank"); } catch (error) { cleanupErrors.push(error); }
          }
          if (live) {
            const ownedLive = live;
            for (const client of ownedLive.clients) client.terminate();
            try { await new Promise<void>((resolve, reject) => ownedLive.close(error => error ? reject(error) : resolve())); }
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
          if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Managed connection app cleanup failed");
        }
      },
    });
    completed = true;
  } finally {
    if (previousApi === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = previousApi;
    try { await db.$client.end({ timeout: 5 }); } finally { await database.cleanup(); }
    // Preserve the actual Run/Host tree for failed two-Run provenance audits.
    if (!completed) console.info("managed_connection_failure_root_retained", JSON.stringify({ path: root }));
    else { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }
}
