const { failedRetryAuthorityObservers } = vi.hoisted(() => ({
  failedRetryAuthorityObservers: new WeakMap<object, (tx: unknown, input: {
    phase: "admission" | "promotion" | "execution"; companyId: string; agentId: string;
    issueId: string | null; wakeupRequestId: string | null; runId?: string;
    contextSnapshot: Record<string, unknown>;
  }) => Promise<void>>(),
}));
vi.mock("../services/durable-chat-wakeup.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../services/durable-chat-wakeup.js")>();
  return {
    ...actual,
    registerFailedChatRunRetryAuthority(db: Parameters<typeof actual.registerFailedChatRunRetryAuthority>[0],
      authority: Parameters<typeof actual.registerFailedChatRunRetryAuthority>[1]) {
      return actual.registerFailedChatRunRetryAuthority(db, async (tx, input) => {
        await failedRetryAuthorityObservers.get(db)?.(tx, input);
        await authority(tx, input);
      });
    },
  };
});

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  environmentLeases,
  nativeRunFinalizations,
  agentWakeupRequests,
  chatConversations,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatActions,
  chatEndpoints,
  chatMessageLinks,
  chatPublications,
  issueComments,
  issueRecoveryActions,
  issues,
  toolApplications,
  toolConnections,
  runtimeHostCommands,
  runtimeOperations,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { installHeartbeatApiUrlFixture, seedHeartbeatResponsibleHuman } from "./helpers/heartbeat-runtime-fixtures.js";
import { heartbeatService } from "../services/heartbeat.js";
import { chatChannelService } from "../services/chat-channels.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary } from "./helpers/managed-native-opencode-e2e-fixture.js";
import {
  authorizeFailedChatRunRetryWake,
  authorizeCommittedChatResponse,
  CommittedChatResponseAuthorizationError,
  registerCommittedChatResponseAuthority,
  createDurableChatWakeupRequest,
  FailedChatRunRetryAuthorizationError,
  registerFailedChatRunRetryAuthority,
} from "../services/durable-chat-wakeup.js";
import { conflict } from "../errors.js";
import { applySlackReceiptReaction as applySlackReceiptReactionRequest } from "../services/chat-slack-receipts.js";
import { readNativeBootstrapPrelaunchCleanup, verifyNativeBootstrapPrelaunchRuntimeState } from "../services/execution-sandbox/native-prelaunch-cleanup.js";
import type { ServerAdapterModule } from "../adapters/index.js";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.js";
import {
  registerServerAdapter,
  runningProcesses,
  unregisterServerAdapter,
} from "../adapters/index.js";

describe("durable inbound chat scheduler receipts", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let nativeFixtureRoot = "";
  const liveRunIds = new Set<string>();
  const unregisterAuthorities: Array<() => void> = [];
  let restoreApiUrl: (() => void) | null = null;
  const execute = vi.fn<ServerAdapterModule["execute"]>(async (input) => {
    const issueId = String(input.context.issueId);
    await db.insert(issueComments).values({
      companyId: input.agent.companyId,
      issueId,
      authorAgentId: input.agent.id,
      createdByRunId: input.runId,
      body: "Exact retry dispatched",
    });
    await db
      .update(issues)
      .set({ status: "done" })
      .where(eq(issues.id, issueId));
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Exact retry dispatched",
    };
  });
  beforeAll(async () => {
    restoreApiUrl = installHeartbeatApiUrlFixture();
    nativeFixtureRoot = await mkdtemp(join(tmpdir(), "durable-chat-managed-retry-"));
    vi.stubEnv("PAPERCLIP_HOME", nativeFixtureRoot);
    temporary = await startEmbeddedPostgresTestDatabase(
      "chat-wakeup-receipts-",
    );
    db = createDb(temporary.connectionString);
    registerServerAdapter({
      type: "durable_chat_retry_test",
      execute,
      testEnvironment: async () => ({
        adapterType: "durable_chat_retry_test",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
    });
  }, 30_000);
  afterEach(() => {
    execute.mockClear();
    for (const unregister of unregisterAuthorities.splice(0)) unregister();
    for (const runId of liveRunIds) runningProcesses.delete(runId);
    liveRunIds.clear();
  });
  afterAll(async () => {
    unregisterServerAdapter("durable_chat_retry_test");
    restoreApiUrl?.();
    await temporary.cleanup();
    vi.unstubAllEnvs();
    if (nativeFixtureRoot) {
      try { await rmdir(nativeFixtureRoot); }
      catch (error) {
        const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
        if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
      }
    }
  });

  async function fixture(deferred = false) {
    const companyId = randomUUID(),
      agentId = randomUUID(),
      issueId = randomUUID(),
      activeRunId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Durable wake",
      issuePrefix: `D${companyId.slice(0, 7)}`,
      defaultResponsibleUserId: "board-user",
      requireBoardApprovalForNewAgents: false,
    });
    await seedHeartbeatResponsibleHuman(db, companyId, "board-user", "owner");
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Maya",
      role: "ceo",
      status: "running",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
    });
    await db.insert(heartbeatRuns).values({
      id: activeRunId,
      companyId,
      agentId,
      status: "running",
      // This fixture-owned slot has no provider process/work. Its retirement
      // must not impersonate an ambiguous legacy provider failure.
      resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } },
      contextSnapshot: { issueId: deferred ? issueId : randomUUID() },
    });
    runningProcesses.set(activeRunId, {
      child: {} as never,
      graceSec: 0,
      processGroupId: null,
    });
    liveRunIds.add(activeRunId);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Bound chat task",
      status: "in_progress",
      assigneeAgentId: agentId,
      responsibleUserId: "board-user",
      ...(deferred
        ? {
            executionRunId: activeRunId,
            executionAgentNameKey: "maya",
            executionLockedAt: new Date(),
          }
        : {}),
    });
    const heartbeat = heartbeatService(db);
    const authorize = vi.fn(async () => {});
    const request = (commentId = randomUUID(), actor = "board-user") =>
      createDurableChatWakeupRequest({
        id: randomUUID(),
        companyId,
        agentId,
        issueId,
        commentId,
        requestedByActorType: "user",
        requestedByActorId: actor,
        requestedAt: new Date(),
        authorize,
      });
    const wake = (durableChatRequest: ReturnType<typeof request>) =>
      queueIssueAssignmentWakeup({
        heartbeat,
        issue: { id: issueId, assigneeAgentId: agentId, status: "in_progress" },
        reason: "External chat message received",
        mutation: "chat_message_received",
        contextSource: "chat:slack",
        requestedByActorType: "user",
        requestedByActorId: durableChatRequest.requestedByActorId,
        wakeCommentId: durableChatRequest.commentId,
        durableChatRequest,
        rethrowOnError: true,
      });
    return {
      companyId,
      agentId,
      issueId,
      activeRunId,
      heartbeat,
      authorize,
      request,
      wake,
    };
  }

  async function executionHold(f: { companyId: string; issueId: string; agentId: string }) {
    const [action] = await db.insert(issueRecoveryActions).values({
      companyId: f.companyId, sourceIssueId: f.issueId, kind: "active_run_watchdog",
      ownerType: "board", returnOwnerAgentId: f.agentId,
      cause: "legacy_execution_requires_reconciliation", status: "resolved",
      fingerprint: randomUUID(), evidence: { automaticRecovery: { replay: "blocked" } },
      nextAction: "Check the stopped execution.",
    }).returning();
    return () => db.update(issueRecoveryActions).set({ evidence: {} }).where(eq(issueRecoveryActions.id, action!.id));
  }

  it("defers held inbound chat exactly once and keeps its authority separate from a generic wake", async () => {
    const f = await fixture();
    const clearHold = await executionHold(f);
    const request = f.request();
    const wake = () => f.heartbeat.wakeup(f.agentId, {
      source: "on_demand", triggerDetail: "manual", reason: "issue_commented",
      payload: { issueId: f.issueId, commentId: request.commentId },
      contextSnapshot: { issueId: f.issueId, source: "chat:slack", wakeCommentId: request.commentId },
      requestedByActorType: "user", requestedByActorId: request.requestedByActorId,
      durableChatRequest: request,
    });
    for (let i = 0; i < 3; i++) expect(await wake()).toBeNull();
    const receipts = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, f.agentId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: request.id, idempotencyKey: request.idempotencyKey, requestedAt: request.requestedAt,
      status: "deferred_issue_execution", runId: null, requestedByActorId: request.requestedByActorId,
      payload: { _paperclipWakeContext: { source: "chat:slack", wakeCommentIds: [request.commentId] } },
    });
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, request.id))).toHaveLength(0);
    await clearHold();
    const generic = await f.heartbeat.wakeup(f.agentId, {
      source: "on_demand", triggerDetail: "manual", reason: "issue_resumed",
      payload: { issueId: f.issueId }, requestedByActorType: "user", requestedByActorId: "board-user",
    });
    expect(generic?.status).toBe("queued");
    expect(generic?.contextSnapshot?.wakeCommentIds).toBeUndefined();
    expect((await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, request.id)))[0]).toMatchObject({
      status: "deferred_issue_execution", runId: null,
    });
  });

  async function retryFixture(deferred = false) {
    const f = await fixture(deferred);
    const applicationId = randomUUID(),
      connectionId = randomUUID(),
      endpointId = randomUUID();
    const failedRunId = randomUUID(),
      actionId = randomUUID();
    const commentIds = [randomUUID(), randomUUID()];
    const taskKey = `D${f.companyId.slice(0, 7)}-1`;
    await db
      .update(issues)
      .set({ identifier: taskKey })
      .where(eq(issues.id, f.issueId));
    await db.insert(toolApplications).values({
      id: applicationId,
      companyId: f.companyId,
      name: "Retry authority",
      type: "chat",
    });
    await db.insert(toolConnections).values({
      id: connectionId,
      companyId: f.companyId,
      applicationId,
      name: "Retry",
      uid: `retry-${connectionId}`,
      connectionPurpose: "channel",
      transport: "chat_sdk",
      status: "active",
    });
    await db.insert(chatEndpoints).values({
      id: endpointId,
      companyId: f.companyId,
      connectionId,
      provider: "slack",
      publicId: randomUUID(),
      assignedAgentId: f.agentId,
      status: "active",
    });
    await db.insert(heartbeatRuns).values({
      id: failedRunId,
      companyId: f.companyId,
      agentId: f.agentId,
      status: "failed",
      finishedAt: new Date(),
      contextSnapshot: {
        issueId: f.issueId,
        taskKey,
        source: "chat:slack",
        wakeCommentIds: commentIds,
      },
    });
    await db.insert(issueComments).values(
      commentIds.map((id) => ({
        id,
        companyId: f.companyId,
        issueId: f.issueId,
        authorUserId: "board-user",
        body: "Exact original request",
      })),
    );
    await db.insert(chatActions).values({
      id: actionId,
      companyId: f.companyId,
      endpointId,
      kind: "failed_run_retry",
      providerActionId: `failed_run_retry:${failedRunId}`,
      status: "issued",
      payload: { issueId: f.issueId, failedRunId },
    });
    const context = {
      issueId: f.issueId,
      source: "chat:slack",
      taskKey,
      wakeCommentId: commentIds[1],
      wakeCommentIds: commentIds,
      retryOfRunId: failedRunId,
      chatFailedRunRetry: { version: 1, actionId, failedRunId },
    };
    const request = createDurableChatWakeupRequest({
      ...f.request(commentIds[1]),
      id: actionId,
      failedRunRetry: { failedRunId },
    });
    const authority = vi.fn(
      async (
        _tx: unknown,
        input: { contextSnapshot: Record<string, unknown>; phase: string },
      ) => {
        expect(input.contextSnapshot).toMatchObject(context);
      },
    );
    const register = () => {
      const dispose = registerFailedChatRunRetryAuthority(db, authority);
      unregisterAuthorities.push(dispose);
      return dispose;
    };
    const wake = (options: Record<string, unknown> = {}) =>
      f.heartbeat.wakeup(f.agentId, {
        source: "assignment",
        triggerDetail: "system",
        reason: "retry_failed_chat_run",
        payload: { ...context },
        contextSnapshot: { ...context },
        requestedByActorType: "user",
        requestedByActorId: "board-user",
        durableChatRequest: request,
        allowRunCoalescing: true,
        ...options,
      });
    return {
      ...f,
      failedRunId,
      actionId,
      context,
      commentIds,
      request,
      authority,
      register,
      wake,
    };
  }

  async function withManagedChannelRetryScenario(
    drive: (input: {
      db: typeof db;
      heartbeat: ReturnType<typeof heartbeatService>;
      service: ReturnType<typeof chatChannelService>;
      companyId: string;
      agentId: string;
      actorUserId: string;
      endpointId: string;
      providerCallCount: () => number;
      sourceRun: typeof heartbeatRuns.$inferSelect;
      retryContext: Record<string, unknown>;
      retryActionId: string;
      authority: ReturnType<typeof vi.fn>;
    }) => Promise<void>,
  ) {
    let endpointCallbacks: { onMessage?: (input: unknown) => Promise<unknown> } | null = null;
    let sourceRunId: string | null = null;
    let sourceProviderInitializationFailures = 0;
    const sourceBootstrapAttempts = new Set<number>();
    let activeRunNegativeProbeObserved = false;
    const identitySuffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const slackTeamId = `T${identitySuffix}`;
    const slackBotId = `U${identitySuffix}`;
    const slackExternalUserId = `U${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const slackChannelId = `C${identitySuffix}`;
    const signingSecret = `durable-retry-signing-${identitySuffix}`;
    const endpoints = new Map<string, unknown>();
    const post = async (threadId: string) => ({ id: randomUUID(), threadId });
    const threadFor = (threadId: string) => ({
      id: threadId, channelId: slackChannelId, isDM: false, channel: { id: slackChannelId, name: "durable-retry" },
      adapter: { addReaction: async () => undefined, removeReaction: async () => undefined,
        editMessage: async (_threadId: string, id: string) => ({ id, threadId }) },
      startTyping: async () => undefined, subscribe: async () => undefined,
      post: async () => post(threadId),
      postEphemeral: async () => ({ ...await post(threadId), usedFallback: false }),
    });
    const runtime = {
      get: (id: string) => endpoints.get(id) ?? null,
      replaceEndpoint: async (options: { endpointId: string; callbacks: unknown; providerConfig: { provider: string } }) => {
        endpointCallbacks = options.callbacks as typeof endpointCallbacks;
        const endpoint = {
          provider: options.providerConfig.provider,
          initialize: async () => undefined,
          shutdown: async () => undefined,
          handleWebhook: async (request: Request) => {
            const body = await request.text();
            const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
            const signature = request.headers.get("x-slack-signature") ?? "";
            const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
            if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
                Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
                !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
              return new Response("invalid signature", { status: 401 });
            const payload = JSON.parse(body) as { type?: unknown; challenge?: unknown };
            return payload.type === "url_verification" && typeof payload.challenge === "string"
              ? Response.json({ challenge: payload.challenge }) : new Response("unexpected webhook", { status: 422 });
          },
          acceptsProviderScope: (raw: unknown) => Boolean(raw && typeof raw === "object" &&
            (raw as { type?: unknown }).type === "url_verification"),
          thread: threadFor,
          applySlackReceiptReaction: (input: Parameters<typeof applySlackReceiptReactionRequest>[0], fetchImpl: typeof fetch) =>
            applySlackReceiptReactionRequest({ ...input, botToken: `xoxb-durable-retry-${identitySuffix}` }, fetchImpl),
          post,
          edit: async (threadId: string, messageId: string) => ({ id: messageId, threadId }),
          addReaction: async () => undefined,
          removeReaction: async () => undefined,
          startTyping: async () => undefined,
          subscribe: async () => undefined,
          postEphemeral: async (threadId: string) => ({ ...await post(threadId), usedFallback: false }),
        };
        endpoints.set(options.endpointId, endpoint);
        return endpoint;
      },
      removeEndpoint: async (id: string) => { endpoints.delete(id); return true; },
      shutdown: async () => { endpoints.clear(); },
    };
    const slackFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://slack.com/api/auth.test") return Response.json({ ok: true,
        team_id: slackTeamId, team: "Paperclip Test", user_id: slackBotId, user: "maya" },
        { headers: { "x-oauth-scopes": "app_mentions:read,assistant:write,channels:history,channels:read,chat:write,commands,files:read,files:write,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,reactions:read,reactions:write,users:read" } });
      if (url.startsWith("https://slack.com/api/conversations.list")) return Response.json({ ok: true,
        channels: [], response_metadata: { next_cursor: "" } });
      if (url.startsWith("https://slack.com/api/conversations.info")) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        const channel = new URL(url).searchParams.get("channel") ?? body.get("channel") ?? "C-DURABLE";
        return Response.json({ ok: true, channel: { id: channel, name: "durable", is_member: true, is_archived: false } });
      }
      if (url === "https://slack.com/api/users.info") return Response.json({ ok: true,
        user: { id: slackExternalUserId, team_id: slackTeamId } });
      if (url === "https://slack.com/api/agents.sessions.setStatus") return Response.json({ ok: true });
      if (url === "https://slack.com/api/reactions.add" || url === "https://slack.com/api/reactions.remove") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (payload.channel !== slackChannelId || payload.timestamp !== "1789000000.100001" || payload.name !== "eyes")
          throw new Error("durable_retry_fixture_receipt_reaction_not_bound_to_original_post");
        return Response.json({ ok: true });
      }
      throw new Error("durable_retry_fixture_unexpected_slack_request");
    };
    const occupancyBeforeStopCommit = new Map<string, number>();
    await withManagedNativeHeartbeatFixture({
      db,
      root: nativeFixtureRoot,
      afterManagedSandboxStopReceipt: async ({ scope }) => {
        if (occupancyBeforeStopCommit.has(scope.runId)) return;
        const [row] = await db.execute<{ count: string }>(sql`
          select public.aw_v10_resource_durable_occupancy(${scope.companyId}::uuid)::text as count
        `);
        if (!row) throw new Error("durable_retry_fixture_pre_stop_occupancy_unavailable");
        occupancyBeforeStopCommit.set(scope.runId, Number(row.count));
      },
      opencodeBinary: qualifiedOpenCodeBinary(),
      timeoutSec: 300,
      schedulerMode: "serial",
      providerReply: ({ body, callIndex, execution }) => {
        const tools = body.tools as Array<{ name: string }>;
        const tool = (name: string) => {
          const selected = tools.find(value => value.name === name ||
            ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${name}`));
          if (!selected) throw new Error(`durable_retry_fixture_tool_missing_${name}`);
          return selected.name;
        };
        if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "retry-write",
          name: tool("write_document"), input: { idempotencyKey: "chat-retry-result", key: "chat-retry-result",
            title: "Exact request result", body: "The exact authenticated request is complete.", baseRevisionId: null } }] };
        if (callIndex === 2) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "retry-finish",
          name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
            summary: "Completed the exact authenticated request.", completionClaim: {
              contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true,
              criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
                status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
            evidence: [], verification: [], attentionRequests: [], artifacts: [] } }] };
        return { stop_reason: "end_turn", content: [{ type: "text", text: "The exact request is complete." }] };
      },
      testBeforeNativeRunnerSpawn: async runId => {
        if (sourceRunId === null) sourceRunId = runId;
        if (runId !== sourceRunId) return;
        const [coordinator] = await db.select({ attempt: nativeRunFinalizations.attempt,
          phase: nativeRunFinalizations.phase }).from(nativeRunFinalizations)
          .where(eq(nativeRunFinalizations.runId, runId));
        if (!coordinator || coordinator.phase !== "observed")
          throw new Error("durable_retry_fixture_bootstrap_attempt_missing");
        sourceBootstrapAttempts.add(coordinator.attempt);
        sourceProviderInitializationFailures = sourceBootstrapAttempts.size;
        // The real Native constructor has bound the qualified SDK image,
        // source authority and remote locator; no provider state or process exists.
        throw new Error("provider_initialize_protocol_error");
      },
      configureHeartbeat: async context => {
        const { configureManagedSerialSchedulerSandboxHost } = await import("./helpers/managed-native-conversation-sandbox-host.js");
        const host = await configureManagedSerialSchedulerSandboxHost({ ...context, root: context.runHome,
          preparedRegistration: context.preparedRegistration,
          withVerifiedModelRun: context.withVerifiedModelRun });
        const before = host.beforeNativeExecution;
        const hostOwner = host as typeof host & {
          closeManagedAgentHostForRun?: (runId: string) => Promise<void>;
          factsForRun?: (runId: string) => Record<string, unknown>;
        };
        return { ...host, beforeNativeExecution: async args => {
          const environment = await before(args);
          if (!activeRunNegativeProbeObserved) {
            const [activeRun] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
              .where(and(eq(heartbeatRuns.companyId, context.companyId), eq(heartbeatRuns.id, args.runId))).limit(1);
            if (activeRun?.status !== "running" || !hostOwner.closeManagedAgentHostForRun || !hostOwner.factsForRun)
              throw new Error("durable_retry_fixture_active_run_negative_probe_unavailable");
            let rejectedWhileActive = false;
            try { await hostOwner.closeManagedAgentHostForRun(args.runId); }
            catch (error) {
              rejectedWhileActive = error instanceof Error && error.message.startsWith("scheduler_unlaunched_native_run_");
              if (!rejectedWhileActive) throw error;
            }
            if (!rejectedWhileActive || hostOwner.factsForRun(args.runId).serialContextRetired !== false)
              throw new Error("durable_retry_fixture_active_run_negative_probe_changed_host");
            const [stillRunning] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
              .where(and(eq(heartbeatRuns.companyId, context.companyId), eq(heartbeatRuns.id, args.runId))).limit(1);
            if (stillRunning?.status !== "running")
              throw new Error("durable_retry_fixture_active_run_negative_probe_changed_run");
            activeRunNegativeProbeObserved = true;
          }
          return environment;
        } };
      },
      driveScheduler: async ({ heartbeat, companyId, agentId, actor, facts, factsForRun, closeManagedAgentHostForRun }) => {
        if (!actor.userId) throw new Error("durable_retry_fixture_current_human_missing");
        let sourcePlanPrepared = false;
        const chatService = chatChannelService(db, {
          heartbeat: { wakeup: async (targetAgentId, wake) => {
            if (!sourcePlanPrepared) {
              const issueId = wake?.contextSnapshot?.issueId;
              if (typeof issueId !== "string") throw new Error("durable_retry_fixture_source_task_missing");
              const [task] = await db.select().from(issues).where(and(
                eq(issues.companyId, companyId), eq(issues.id, issueId)));
              if (!task) throw new Error("durable_retry_fixture_source_task_missing");
              const plan = await orchestrationService(db).create(actor, companyId, {
                issueId, expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
                completionContract: { objective: "Complete the exact authenticated chat request",
                  requiredOutputs: [{ kind: "task_document", key: "chat-retry-result" }],
                  businessInvariants: ["Human review required"] },
                budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId }],
              });
              await orchestrationService(db).decide(actor, companyId, plan.id, {
                expectedVersion: plan.version, action: "start", rationale: "Human authorizes the bounded chat retry check",
              });
              sourcePlanPrepared = true;
            }
            return heartbeat.wakeup(targetAgentId, wake).catch(error => {
              if (wake.reason === "retry_failed_run") {
                console.warn("durable_retry_fixture_admission_failure", {
                  name: error instanceof Error ? error.name : typeof error,
                  code: error && typeof error === "object" && "details" in error
                    ? (error.details as { code?: unknown } | null)?.code : null,
                  message: error instanceof Error ? error.message.slice(0, 200) : null,
                });
              }
              throw error;
            });
          }, cancelRun: heartbeat.cancelRun },
          runtime: runtime as never,
          fetch: slackFetch,
          publicBaseUrl: "https://paperclip.example",
        });
        try {
        const endpoint = await chatService.create(companyId, { provider: "slack", assignedAgentId: agentId,
          name: `Managed durable retry ${identitySuffix}` }, actor.userId);
        await chatService.update(endpoint.id, { allowUnlinkedPeople: false }, actor.userId);
        await chatService.configure(endpoint.id, { action: "configure", credentials: {
          botToken: `xoxb-durable-retry-${identitySuffix}`, signingSecret,
        } }, actor.userId);
        const challengeBody = JSON.stringify({ type: "url_verification", challenge: `challenge-${identitySuffix}` });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${challengeBody}`).digest("hex")}`;
        const verified = await chatService.handleWebhook(endpoint.publicId, "slack", new Request(
          `https://paperclip.example/api/chat-webhooks/${endpoint.publicId}/slack`, { method: "POST",
            headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp,
              "x-slack-signature": signature }, body: challengeBody }));
        expect(verified.status).toBe(200);
        expect(await verified.json()).toEqual({ challenge: `challenge-${identitySuffix}` });
        await chatService.configure(endpoint.id, { action: "verify" }, actor.userId);
        const [principal] = await db.insert(chatExternalPrincipals).values({ companyId, provider: "slack",
          providerAccountId: slackTeamId, externalId: slackExternalUserId, kind: "user", displayName: "Channel User" }).returning();
        if (!principal) throw new Error("durable_retry_fixture_linked_principal_missing");
        await db.insert(chatIdentityLinks).values({ companyId, endpointId: endpoint.id, principalId: principal.id,
          paperclipUserId: actor.userId, status: "linked", confirmedAt: new Date() });
        if (!endpointCallbacks || typeof endpointCallbacks.onMessage !== "function")
          throw new Error("durable_retry_fixture_callbacks_missing");
        const channelId = slackChannelId;
        const threadId = `slack:${channelId}:1789000000.100001`;
        const thread = threadFor(threadId);
        const message = { id: "1789000000.100001", raw: {}, text: "@maya retry the exact original request",
          isMention: true, attachments: [], metadata: { dateSent: new Date(), edited: false },
          author: { userId: slackExternalUserId, userName: "owner", fullName: "Channel User",
            isBot: false, isMe: false, isSystem: false } };
        await endpointCallbacks.onMessage({ endpointId: endpoint.id, provider: "slack", thread, message, trigger: "mention" });
        await chatService.processPendingReceiptReactions(25);
        const [sourceReceiptReaction] = await db.select().from(chatActions).where(and(
          eq(chatActions.endpointId, endpoint.id), eq(chatActions.kind, "receipt_reaction")));
        if (!sourceReceiptReaction || sourceReceiptReaction.status !== "processed" ||
            sourceReceiptReaction.payload.threadId !== threadId || sourceReceiptReaction.payload.messageId !== message.id)
          throw new Error("durable_retry_fixture_original_slack_post_ack_unsettled");
        const [sourceAction] = await db.select().from(chatActions).where(and(
          eq(chatActions.endpointId, endpoint.id), eq(chatActions.kind, "inbound_wakeup")));
        if (!sourceAction) throw new Error("durable_retry_fixture_source_action_missing");
        const terminalDeadline = Date.now() + 240_000;
        let sourceRun: typeof heartbeatRuns.$inferSelect | undefined;
        while (Date.now() < terminalDeadline) {
          const [receipt] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, sourceAction.id));
          if (receipt?.runId) {
            const [candidate] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, receipt.runId));
            if (candidate && !["queued", "running"].includes(candidate.status) &&
                candidate.nativePhase !== "retryable_failure") { sourceRun = candidate; break; }
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!sourceRunId || sourceProviderInitializationFailures !== 3 || !activeRunNegativeProbeObserved || sourceRun?.id !== sourceRunId) {
          const [lastRun] = sourceRunId ? await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, sourceRunId)) : [];
          const [lastCoordinator] = sourceRunId ? await db.select().from(nativeRunFinalizations)
            .where(eq(nativeRunFinalizations.runId, sourceRunId)) : [];
          if (sourceRunId) factsForRun(sourceRunId);
          throw new Error(`durable_retry_fixture_sdk_initialization_hook_not_exhausted: ${JSON.stringify({
            sourceProviderInitializationFailures, activeRunNegativeProbeObserved, sourceRunIdMatches: sourceRun?.id === sourceRunId,
            status: lastRun?.status, nativePhase: lastRun?.nativePhase, errorCode: lastRun?.errorCode, error: lastRun?.error,
            cleanupPending: lastRun?.nativeProcessCleanupPending, sourceProtocol: lastRun?.nativeInputSourceProtocolVersion,
            coordinatorPhase: lastCoordinator?.phase, attempt: lastCoordinator?.attempt, failureCode: lastCoordinator?.failureCode,
            retryDue: lastCoordinator?.nextAttemptAt ? lastCoordinator.nextAttemptAt.getTime() <= Date.now() : null,
            resultPresent: !!lastCoordinator?.resultId, leaseOwnerPresent: !!lastCoordinator?.leaseOwner,
            recoveryMode: lastCoordinator?.failureDetail?.recoveryMode,
          })}`);
        }
        if (!sourceRun || sourceRun.status !== "failed")
          throw new Error("durable_retry_fixture_pre_provider_run_not_failed");
        await heartbeat.drainActiveRunExecutions();
        const [settledSourceRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, sourceRun.id));
        if (!settledSourceRun) throw new Error("durable_retry_fixture_settled_source_run_missing");
        sourceRun = settledSourceRun;
        expect([...sourceBootstrapAttempts].sort()).toEqual([1, 2, 3]);
        const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(
          eq(nativeRunFinalizations.companyId, companyId), eq(nativeRunFinalizations.runId, sourceRun.id))).limit(1);
        const detail = coordinator?.failureDetail;
        if (coordinator?.phase !== "terminal_failure" || coordinator.attempt !== 3 ||
            coordinator.failureCode !== "native_session_retry_exhausted" ||
            detail?.originalFailureCode !== "provider_initialize_protocol_error" ||
            detail.recoveryMode !== "bootstrap_retry" || detail.providerSessionEstablished !== false ||
            detail.providerEventsExist !== false || detail.checkpointExists !== false)
          throw new Error("durable_retry_fixture_sdk_bootstrap_exhaustion_evidence_invalid");
        const [sourceConversation] = await db.select().from(chatConversations)
          .where(eq(chatConversations.id, sourceAction.conversationId!));
        const sourceGeneration = sourceAction.payload.sessionGeneration;
        if (!sourceConversation || typeof sourceGeneration !== "number" ||
            sourceRun.contextSnapshot?.conversationSessionGeneration !== sourceGeneration ||
            sourceConversation.sessionGeneration !== sourceGeneration)
          throw new Error("durable_retry_fixture_run_generation_binding_invalid");
        await db.update(chatConversations)
          .set({ sessionGeneration: sourceConversation.sessionGeneration + 1 })
          .where(eq(chatConversations.id, sourceConversation.id));
        try {
          await expect(db.transaction(tx => chatService.prepareFailedChatRunRetry(tx, {
            companyId, issueId: sourceAction.payload.issueId as string, agentId,
            failedRunId: sourceRun!.id, initiatedByUserId: actor.userId!,
          }))).rejects.toMatchObject({ details: { code: "chat_failed_run_retry_not_authorized" } });
        } finally {
          await db.update(chatConversations)
            .set({ sessionGeneration: sourceConversation.sessionGeneration })
            .where(eq(chatConversations.id, sourceConversation.id));
        }
        const issueRuns = await db.select({ id: heartbeatRuns.id, wakeupRequestId: heartbeatRuns.wakeupRequestId,
          contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)));
        const issueRunRows = issueRuns.filter(row => row.contextSnapshot && typeof row.contextSnapshot === "object" &&
          (row.contextSnapshot as Record<string, unknown>).issueId === sourceAction.payload.issueId);
        if (issueRunRows.length !== 1 || issueRunRows[0]?.id !== sourceRun.id ||
            issueRunRows[0]?.wakeupRequestId !== sourceAction.id || facts().providerCallCount !== 0)
          throw new Error("durable_retry_fixture_automatic_provider_replay_detected");
        const [receipt] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, sourceAction.id));
        const profile = sourceRun.runnerProfileJson && typeof sourceRun.runnerProfileJson === "object"
          ? sourceRun.runnerProfileJson as Record<string, unknown> : {};
        if (!receipt || receipt.runId !== sourceRun.id || sourceRun.runtimeMode !== "native" ||
            !profile.nativeExecutionInput ||
            !sourceRun.runnerInstanceId || !sourceRun.nativeSessionId || sourceRun.nativePhase !== "terminal_failure" ||
            sourceRun.nativeInputSourceProtocolVersion !== 0 || sourceRun.processPid !== null ||
            sourceRun.processGroupId !== null || sourceRun.processStartedAt !== null ||
            !sourceRun.runnerProfileJson?.nativeRemoteRuntimeAssetLocator ||
            factsForRun(sourceRun.id).providerCallCount !== 0)
          throw new Error("durable_retry_fixture_source_run_binding_invalid");
        // Exercise the real exhausted bootstrap owner and its original cleanup scope.
        // Each contradictory DB fact is restored in finally, then the untouched original
        // owner retains the real Host Stop, Inspect, and runtime receipt path.
        const [prelaunchLease] = await db.select().from(environmentLeases).where(and(
          eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, sourceRun.id)));
        if (!prelaunchLease) throw new Error("durable_retry_fixture_prelaunch_lease_missing");
        const prelaunchInput = { companyId, runId: sourceRun.id, leaseId: prelaunchLease.id };
        const actualOwner = await readNativeBootstrapPrelaunchCleanup(db, prelaunchInput);
        const stopCommandCount = async () => (await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
          .where(and(eq(runtimeHostCommands.companyId, companyId),
            eq(runtimeHostCommands.runtimeHostId, actualOwner.owner.hostId),
            eq(runtimeHostCommands.runtimeCellId, actualOwner.owner.cellId),
            eq(runtimeHostCommands.cellGeneration, BigInt(actualOwner.owner.generation)),
            eq(runtimeHostCommands.commandType, "v7_openshell_rpc"),
            sql`${runtimeHostCommands.payload}->>'action' = 'stop'`))).length;
        const baselineStops = await stopCommandCount();
        const expectOwnerRejectsWithoutStop = async (restore: () => Promise<void>) => {
          try {
            await expect(readNativeBootstrapPrelaunchCleanup(db, prelaunchInput, actualOwner.owner)).rejects.toThrow();
            expect(await stopCommandCount()).toBe(baselineStops);
          } finally { await restore(); }
          await expect(readNativeBootstrapPrelaunchCleanup(db, prelaunchInput, actualOwner.owner)).resolves.toMatchObject({
            owner: { runId: sourceRun.id, leaseId: prelaunchLease.id },
          });
        };
        const savedProfile = sourceRun.runnerProfileJson;
        try {
          await db.update(heartbeatRuns).set({ runnerProfileJson: {
            ...(savedProfile && typeof savedProfile === "object" ? savedProfile : {}), sessionCheckpoint: { version: 1, contradictory: true },
          } }).where(eq(heartbeatRuns.id, sourceRun.id));
          await expectOwnerRejectsWithoutStop(async () => {
            await db.update(heartbeatRuns).set({ runnerProfileJson: savedProfile }).where(eq(heartbeatRuns.id, sourceRun.id));
          });
        } finally {
          await db.update(heartbeatRuns).set({ runnerProfileJson: savedProfile }).where(eq(heartbeatRuns.id, sourceRun.id));
        }
        const [lastEvent] = await db.select({ seq: heartbeatRunEvents.seq }).from(heartbeatRunEvents)
          .where(eq(heartbeatRunEvents.runId, sourceRun.id)).orderBy(desc(heartbeatRunEvents.seq)).limit(1);
        const [reconciled] = await db.insert(heartbeatRunEvents).values({ companyId, runId: sourceRun.id, agentId,
          seq: (lastEvent?.seq ?? 0) + 1, eventType: "session.reconciled", sourceEventId: `prelaunch-negative-${randomUUID()}`,
          message: "private negative owner probe" }).returning({ id: heartbeatRunEvents.id });
        try {
          await expectOwnerRejectsWithoutStop(async () => {
            if (reconciled) await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.id, reconciled.id));
          });
        } finally {
          if (reconciled) await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.id, reconciled.id));
        }
        const [foreignRun] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "queued",
          runtimeMode: "legacy" }).returning({ id: heartbeatRuns.id });
        if (!foreignRun) throw new Error("durable_retry_fixture_foreign_run_for_lease_probe_missing");
        const [foreignLease] = await db.insert(environmentLeases).values({ companyId, heartbeatRunId: foreignRun.id,
          environmentId: prelaunchLease.environmentId, status: "active", leasePolicy: prelaunchLease.leasePolicy,
          provider: prelaunchLease.provider, providerLeaseId: prelaunchLease.providerLeaseId,
          metadata: prelaunchLease.metadata }).returning({ id: environmentLeases.id });
        try {
          await expectOwnerRejectsWithoutStop(async () => {
            if (foreignLease) await db.delete(environmentLeases).where(eq(environmentLeases.id, foreignLease.id));
            await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, foreignRun.id));
          });
        } finally {
          if (foreignLease) await db.delete(environmentLeases).where(eq(environmentLeases.id, foreignLease.id));
          await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, foreignRun.id));
        }
        const [foreignClaim] = await db.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId!,
          action: "sandbox.admission_claimed", entityType: "runtime_sandbox", entityId: actualOwner.owner.bindingId,
          details: { generation: actualOwner.owner.generation, claimKey: actualOwner.owner.claimKey,
            policySnapshotId: actualOwner.owner.policySnapshotId, executionManifestId: actualOwner.owner.manifestId,
            executionManifestHash: actualOwner.owner.manifestHash, policyHash: actualOwner.owner.policyHash,
            claimVersion: actualOwner.owner.claimVersion + 1 } }).returning({ id: activityLog.id });
        try {
          await expectOwnerRejectsWithoutStop(async () => {
            if (foreignClaim) await db.delete(activityLog).where(eq(activityLog.id, foreignClaim.id));
          });
        } finally {
          if (foreignClaim) await db.delete(activityLog).where(eq(activityLog.id, foreignClaim.id));
        }
        const occupancy = async () => {
          const [row] = await db.execute<{ count: string }>(sql`
            select public.aw_v10_resource_durable_occupancy(${companyId}::uuid)::text as count
          `);
          if (!row) throw new Error("durable_retry_fixture_resource_occupancy_unavailable");
          return Number(row.count);
        };
        const occupancyBeforeCleanup = occupancyBeforeStopCommit.get(sourceRun.id);
        if (occupancyBeforeCleanup === undefined) throw new Error("durable_retry_fixture_actual_stop_boundary_not_observed");
        expect(occupancyBeforeCleanup).toBeGreaterThanOrEqual(1);
        await closeManagedAgentHostForRun(sourceRun.id);
        const [stoppedSourceRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, sourceRun.id));
        // The distinct typed setup-container Stop settles exactly this run's
        // NULL Native-process occupancy; it never writes a fake process stop.
        expect(stoppedSourceRun?.nativeProcessCleanupPending).toBeNull();
        expect(await occupancy()).toBe(occupancyBeforeCleanup - 1);
        const assertOccupancyHoldRestored = async (restore: () => Promise<void>) => {
          try {
            await expect(occupancy()).resolves.toBe(occupancyBeforeCleanup);
          } finally {
            await restore();
          }
          await expect(occupancy()).resolves.toBe(occupancyBeforeCleanup - 1);
        };
        const savedSettledProfile = stoppedSourceRun?.runnerProfileJson;
        try {
          await db.update(heartbeatRuns).set({ runnerProfileJson: {
            ...(savedSettledProfile && typeof savedSettledProfile === "object" ? savedSettledProfile : {}),
            sessionCheckpoint: { version: 1, contradictory: true },
          } }).where(eq(heartbeatRuns.id, sourceRun.id));
          await assertOccupancyHoldRestored(async () => {
            await db.update(heartbeatRuns).set({ runnerProfileJson: savedSettledProfile }).where(eq(heartbeatRuns.id, sourceRun.id));
          });
        } finally {
          await db.update(heartbeatRuns).set({ runnerProfileJson: savedSettledProfile }).where(eq(heartbeatRuns.id, sourceRun.id));
        }
        const [settledLastEvent] = await db.select({ seq: heartbeatRunEvents.seq }).from(heartbeatRunEvents)
          .where(eq(heartbeatRunEvents.runId, sourceRun.id)).orderBy(desc(heartbeatRunEvents.seq)).limit(1);
        const [settledReconciled] = await db.insert(heartbeatRunEvents).values({ companyId, runId: sourceRun.id, agentId,
          seq: (settledLastEvent?.seq ?? 0) + 1, eventType: "session.reconciled", sourceEventId: `settled-prelaunch-negative-${randomUUID()}`,
          message: "private occupancy projection negative probe" }).returning({ id: heartbeatRunEvents.id });
        try {
          await assertOccupancyHoldRestored(async () => {
            if (settledReconciled) await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.id, settledReconciled.id));
          });
        } finally {
          if (settledReconciled) await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.id, settledReconciled.id));
        }
        let foreignOccupancyRunId: string | null = null;
        let foreignOccupancyLeaseId: string | null = null;
        try {
          const [foreignOccupancyRun] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "queued",
            runtimeMode: "legacy" }).returning({ id: heartbeatRuns.id });
          if (!foreignOccupancyRun) throw new Error("durable_retry_fixture_foreign_occupancy_run_missing");
          foreignOccupancyRunId = foreignOccupancyRun.id;
          const [foreignOccupancyLease] = await db.insert(environmentLeases).values({ companyId, heartbeatRunId: foreignOccupancyRun.id,
            environmentId: prelaunchLease.environmentId, status: "active", leasePolicy: prelaunchLease.leasePolicy,
            provider: prelaunchLease.provider, providerLeaseId: prelaunchLease.providerLeaseId,
            metadata: prelaunchLease.metadata }).returning({ id: environmentLeases.id });
          if (!foreignOccupancyLease) throw new Error("durable_retry_fixture_foreign_occupancy_lease_missing");
          foreignOccupancyLeaseId = foreignOccupancyLease.id;
          expect(await occupancy()).toBeGreaterThanOrEqual(occupancyBeforeCleanup);
        } finally {
          if (foreignOccupancyLeaseId) await db.delete(environmentLeases).where(eq(environmentLeases.id, foreignOccupancyLeaseId));
          if (foreignOccupancyRunId) await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, foreignOccupancyRunId));
        }
        await expect(occupancy()).resolves.toBe(occupancyBeforeCleanup - 1);
        const [settledForeignClaim] = await db.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId!,
          action: "sandbox.admission_claimed", entityType: "runtime_sandbox", entityId: actualOwner.owner.bindingId,
          details: { generation: actualOwner.owner.generation, claimKey: actualOwner.owner.claimKey,
            policySnapshotId: actualOwner.owner.policySnapshotId, executionManifestId: actualOwner.owner.manifestId,
            executionManifestHash: actualOwner.owner.manifestHash, policyHash: actualOwner.owner.policyHash,
            claimVersion: actualOwner.owner.claimVersion + 1, expectedVersion: actualOwner.owner.claimVersion } }).returning({ id: activityLog.id });
        try {
          await assertOccupancyHoldRestored(async () => {
            if (settledForeignClaim) await db.delete(activityLog).where(eq(activityLog.id, settledForeignClaim.id));
          });
        } finally {
          if (settledForeignClaim) await db.delete(activityLog).where(eq(activityLog.id, settledForeignClaim.id));
        }
        const [settledRuntimeOperation] = await db.select().from(runtimeOperations).where(and(
          eq(runtimeOperations.companyId, companyId),
          eq(runtimeOperations.requestedById, "native-bootstrap-cleanup"),
          sql`${runtimeOperations.desiredState}->'nativeBootstrapPrelaunchCleanup'->>'runId' = ${sourceRun.id}`)).limit(1);
        if (!settledRuntimeOperation) throw new Error("durable_retry_fixture_prelaunch_runtime_operation_missing");
        const contradictoryDesiredState = structuredClone(settledRuntimeOperation.desiredState) as Record<string, unknown>;
        const typedSettlement = contradictoryDesiredState.nativeBootstrapPrelaunchCleanup as Record<string, unknown>;
        const savedPhysicalDigest = typedSettlement.physicalReceiptDigest;
        typedSettlement.physicalReceiptDigest = "f".repeat(64);
        try {
          await expect(db.update(runtimeOperations).set({ desiredState: contradictoryDesiredState })
            .where(eq(runtimeOperations.id, settledRuntimeOperation.id))).rejects.toThrow();
        } finally {
          typedSettlement.physicalReceiptDigest = savedPhysicalDigest;
          await db.update(runtimeOperations).set({ desiredState: contradictoryDesiredState })
            .where(eq(runtimeOperations.id, settledRuntimeOperation.id));
        }
        await expect(occupancy()).resolves.toBe(occupancyBeforeCleanup - 1);
        const retry = await db.transaction(tx => chatService.prepareFailedChatRunRetry(tx, {
          companyId, issueId: sourceAction.payload.issueId as string, agentId, failedRunId: sourceRun!.id,
          initiatedByUserId: actor.userId!,
        }));
        const retryContext = { issueId: sourceAction.payload.issueId, taskKey: sourceRun.contextSnapshot?.taskKey,
          conversationSessionGeneration: sourceGeneration, wakeCommentId: sourceAction.payload.commentId,
          wakeCommentIds: [sourceAction.payload.commentId],
          source: "chat:slack", retryOfRunId: sourceRun.id,
          chatFailedRunRetry: { version: 1, actionId: retry.actionId, failedRunId: sourceRun.id } };
        const authority = vi.fn(async (_tx: unknown, input: { contextSnapshot: Record<string, unknown>; phase: string }) => {
          expect(input.contextSnapshot).toMatchObject(retryContext);
        });
        failedRetryAuthorityObservers.set(db, async (tx, input) => authority(tx, input));
        await drive({ db, heartbeat, service: chatService, companyId, agentId, actorUserId: actor.userId!,
          endpointId: endpoint.id, providerCallCount: () => facts().providerCallCount,
          sourceRun, retryContext, retryActionId: retry.actionId, authority });
        } finally {
          failedRetryAuthorityObservers.delete(db);
          await heartbeat.drainActiveRunExecutions();
          await chatService.shutdown();
        }
      },
    });
  }

  it("contains exhausted Native bootstrap setup without inventing a process lifecycle", async () => {
    await withManagedChannelRetryScenario(async ({ companyId, sourceRun, providerCallCount }) => {
      expect(sourceRun).toMatchObject({ status: "failed", nativePhase: "terminal_failure",
        nativeInputSourceProtocolVersion: 0, nativeProcessCleanupPending: null,
        processPid: null, processGroupId: null, processStartedAt: null });
      expect(providerCallCount()).toBe(0);
      const leases = await db.select().from(environmentLeases).where(and(
        eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, sourceRun.id)));
      expect(leases).toHaveLength(1);
      const lease = leases[0]!;
      expect(lease).toMatchObject({ cleanupStatus: "success", releasedAt: expect.any(Date) });
      await expect(verifyNativeBootstrapPrelaunchRuntimeState(db,
        { companyId, runId: sourceRun.id, leaseId: lease.id }, lease.metadata?.remoteExecutionTermination))
        .resolves.toMatchObject({ executionKind: "native_bootstrap_prelaunch", state: "stopped",
          prelaunchStop: { runtimeOperationId: expect.any(String), owner: { runId: sourceRun.id, leaseId: lease.id } } });
      const events = await db.select({ eventType: heartbeatRunEvents.eventType }).from(heartbeatRunEvents).where(and(
        eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, sourceRun.id)));
      expect(events.some(event => ["native.process_start_requested", "native.process_identity_recorded",
        "native.remote_workload_stopped"].includes(event.eventType))).toBe(false);
    });
  }, 300_000);

  it("fails closed for a persisted retry when its live authority is unavailable", async () => {
    const f = await retryFixture();
    await expect(f.wake()).rejects.toBeInstanceOf(
      FailedChatRunRetryAuthorizationError,
    );
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, f.actionId)),
    ).toEqual([]);
  });

  it("does not turn a forged retry selector into authority", async () => {
    const f = await fixture();
    await expect(
      f.heartbeat.wakeup(f.agentId, {
        payload: { issueId: f.issueId },
        contextSnapshot: {
          chatFailedRunRetry: {
            version: 1,
            actionId: randomUUID(),
            failedRunId: randomUUID(),
          },
        },
        requestedByActorType: "user",
        requestedByActorId: "board-user",
      }),
    ).rejects.toBeInstanceOf(FailedChatRunRetryAuthorizationError);
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, f.agentId)),
    ).toEqual([]);
  });

  it("preserves exact retry provenance and a deeply frozen server-only selector", async () => {
    const f = await retryFixture();
    f.register();
    expect(Object.isFrozen(f.request.failedRunRetry)).toBe(true);
    const run = await f.wake();
    expect(run).toMatchObject({
      status: "queued",
      retryOfRunId: f.failedRunId,
      wakeupRequestId: f.actionId,
      contextSnapshot: f.context,
    });
    expect(f.authority).toHaveBeenCalledTimes(1);
    expect(f.authority.mock.calls[0][1]).toMatchObject({ phase: "admission" });
    await f.wake();
    expect(f.authority).toHaveBeenCalledTimes(1);
  });

  it("cannot coalesce an exact retry into active or deferred ordinary work", async () => {
    const f = await retryFixture(true);
    const ordinary = f.request;
    await queueIssueAssignmentWakeup({
      heartbeat: f.heartbeat,
      issue: {
        id: f.issueId,
        assigneeAgentId: f.agentId,
        status: "in_progress",
      },
      reason: "External chat message received",
      mutation: "chat_message_received",
      contextSource: "chat:slack",
      requestedByActorType: "user",
      requestedByActorId: "board-user",
      wakeCommentId: f.commentIds[0],
      durableChatRequest: createDurableChatWakeupRequest({
        ...ordinary,
        id: randomUUID(),
        commentId: f.commentIds[0],
        failedRunRetry: undefined,
      }),
      rethrowOnError: true,
    });
    f.register();
    await f.wake();
    const receipts = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, f.agentId));
    expect(receipts).toHaveLength(2);
    expect(
      receipts.every(
        (row) =>
          row.status === "deferred_issue_execution" && row.coalescedCount === 0,
      ),
    ).toBe(true);
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.wakeupRequestId, f.actionId)),
    ).toEqual([]);
  });

  it("rediscovers a retry from durable provenance even if its hint was stripped", async () => {
    const f = await retryFixture();
    const { chatFailedRunRetry: _selector, ...contextSnapshot } = f.context;
    await expect(
      authorizeFailedChatRunRetryWake(db, db, {
        phase: "execution",
        wakeupRequestId: f.actionId,
        companyId: f.companyId,
        agentId: f.agentId,
        issueId: f.issueId,
        contextSnapshot,
      }),
    ).rejects.toBeInstanceOf(FailedChatRunRetryAuthorizationError);
  });

  it("an older service disposer cannot remove a newer retry authority", async () => {
    const f = await retryFixture();
    const oldDispose = f.register();
    const replacement = vi.fn(async () => {});
    unregisterAuthorities.push(
      registerFailedChatRunRetryAuthority(db, replacement),
    );
    oldDispose();
    await f.wake();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(f.authority).not.toHaveBeenCalled();
  });

  it.each([false, true])("cancels a revoked deferred retry without reopening its batch (execution hold=%s)", async (held) => {
    const f = await retryFixture(true);
    const clearHold = held ? await executionHold(f) : null;
    f.register();
    await f.wake();
    await clearHold?.();
    f.authority.mockImplementation(async (_tx, input) => {
      if (input.phase === "promotion")
        throw conflict("Current chat access was revoked");
    });
    await db
      .update(issues)
      .set({ status: "done" })
      .where(eq(issues.id, f.issueId));
    await f.heartbeat.cancelRun(f.activeRunId, "Fixture predecessor finished", {
      suppressImmediateRecovery: true,
    });
    await f.heartbeat.drainActiveRunExecutions();
    const [receipt] = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, f.actionId));
    expect(receipt).toMatchObject({ status: "cancelled", runId: null });
    expect(receipt.payload).toMatchObject({ wakeCommentIds: f.commentIds });
    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, f.issueId));
    expect(issue).toMatchObject({ status: "done", executionRunId: null });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.wakeupRequestId, f.actionId)),
    ).toEqual([]);
    expect(f.authority.mock.calls.map((call) => call[1].phase)).toEqual([
      "admission",
      "promotion",
    ]);
  });

  it("denies a queued retry at execution when current authority is revoked", async () => {
    const f = await retryFixture();
    f.register();
    const queued = await f.wake();
    f.authority.mockImplementation(async (_tx, input) => {
      if (input.phase === "execution")
        throw conflict("Current chat access was revoked", {
          code: "chat_failed_run_retry_not_authorized",
        });
    });
    await f.heartbeat.cancelRun(
      f.activeRunId,
      "Fixture execution slot released",
      { suppressImmediateRecovery: true },
    );
    await f.heartbeat.drainActiveRunExecutions();
    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, queued!.id));
    expect(run).toMatchObject({
      status: "failed",
      retryOfRunId: f.failedRunId,
      nativeSessionId: null,
      errorCode: "chat_failed_run_retry_not_authorized",
    });
    expect(run.error).toContain("Current chat access was revoked");
    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, f.issueId));
    expect(issue).toMatchObject({ status: "blocked", executionRunId: null });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId)),
    ).toHaveLength(3);
    expect(f.authority.mock.calls.map((call) => call[1].phase)).toEqual([
      "admission",
      "execution",
    ]);
  });

  it.each([false, true])("preserves the exact retry column and comment batch during promotion (execution hold=%s)", async (held) => {
    const f = await retryFixture(true);
    const clearHold = held ? await executionHold(f) : null;
    f.register();
    await f.wake();
    await clearHold?.();
    // A separate fixture-owned run occupies the agent slot after the issue's
    // predecessor releases it, so this asserts promotion before execution.
    const blockerId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: blockerId,
      companyId: f.companyId,
      agentId: f.agentId,
      status: "running",
      contextSnapshot: { issueId: randomUUID() },
    });
    runningProcesses.set(blockerId, {
      child: {} as never,
      graceSec: 0,
      processGroupId: null,
    });
    liveRunIds.add(blockerId);
    await f.heartbeat.cancelRun(f.activeRunId, "Fixture predecessor finished", {
      suppressImmediateRecovery: true,
    });
    await f.heartbeat.drainActiveRunExecutions();
    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.wakeupRequestId, f.actionId));
    expect(run).toMatchObject({
      status: "queued",
      retryOfRunId: f.failedRunId,
      contextSnapshot: f.context,
    });
    const [receipt] = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, f.actionId));
    expect(receipt).toMatchObject({ status: "queued", runId: run.id });
    expect(f.authority.mock.calls.map((call) => call[1].phase)).toEqual([
      "admission",
      "promotion",
    ]);
  });

  it.each([false, true])(
    "rechecks current retry authority immediately before dispatch (revoked=%s)",
    async (revoked) => {
      await withManagedChannelRetryScenario(async (f) => {
        let executionChecks = 0;
        f.authority.mockImplementation(async (tx: unknown, input: { contextSnapshot: Record<string, unknown>; phase: string;
          companyId: string; agentId: string; issueId: string | null; wakeupRequestId: string | null; runId?: string }) => {
          expect(input.contextSnapshot).toMatchObject(f.retryContext);
          if (input.phase === "execution" && ++executionChecks === 2 && revoked) {
            await (tx as typeof db).update(chatConversations).set({ state: "completed" })
              .where(eq(chatConversations.issueId, f.sourceRun.nativeIssueId!));
          }
          // The observer runs before, and delegates to, the exact callback
          // registered by chatChannelService; no authority is substituted.
        });
        const processed = await f.service.processFailedChatRunRetry(f.retryActionId);
        expect(processed.actionId).toBe(f.retryActionId);
        const [retryReceipt] = await db.select().from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, f.retryActionId));
        expect(retryReceipt?.runId).toBeTruthy();
        await f.heartbeat.drainActiveRunExecutions();
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, retryReceipt!.runId!));
        const [occupancy] = await db.execute<{ occupied: number }>(sql`SELECT
          public.aw_v10_resource_durable_occupancy(${f.companyId}::uuid)::int AS occupied`);
        expect(executionChecks, JSON.stringify({ retryStatus: run?.status, errorCode: run?.errorCode,
          errorShape: run?.error?.replace(/Bearer\s+\S+/gi, "[credential]").replace(/https?:\/\/\S+/g, "[url]")
            .replace(/[A-Za-z0-9_-]{24,}/g, "[opaque]").slice(0, 240),
          nextAction: run?.nextAction, livenessReason: run?.livenessReason,
          sourceProcessCleanupPending: f.sourceRun.nativeProcessCleanupPending, occupied: occupancy?.occupied })).toBe(2);
        expect(f.providerCallCount()).toBe(revoked ? 0 : 3);
        expect(run).toMatchObject({ status: revoked ? "failed" : "succeeded", retryOfRunId: f.sourceRun.id,
          runtimeMode: "native" });
        if (revoked) expect(run.errorCode).toBe("chat_failed_run_retry_not_authorized");
        expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.agentId))).toHaveLength(2);
        expect(f.authority.mock.calls.map(call => call[1].phase)).toEqual(["admission", "execution", "execution"]);
      });
    },
    300_000,
  );

  it.each([
    { forceFreshSession: true },
    { resumeFromRunId: randomUUID() },
    { resumeSessionParams: { sessionId: "unrelated-provider-session" } },
    { resumeSessionDisplayId: "unrelated-provider-session" },
  ])(
    "does not admit routing overrides on an exact retry (%j)",
    async (override) => {
      const f = await retryFixture();
      f.register();
      await expect(
        f.wake({ contextSnapshot: { ...f.context, ...override } }),
      ).rejects.toBeInstanceOf(FailedChatRunRetryAuthorizationError);
      expect(f.authority).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, f.actionId)),
      ).toEqual([]);
    },
  );

  it.each([
    { withDeferredInput: false, sourceKind: "inbound_wakeup" },
    { withDeferredInput: true, sourceKind: "inbound_wakeup" },
    { withDeferredInput: false, sourceKind: "unrelated_action" },
    { withDeferredInput: false, sourceKind: "missing" },
  ].flatMap((scope) => [false, true].map((preProvider) => ({ ...scope, preProvider }))))(
    "fences generic recovery by actual original chat ownership ($sourceKind, deferred=$withDeferredInput, pre-provider=$preProvider)",
    async ({ withDeferredInput, sourceKind, preProvider }) => {
      const f = await retryFixture();
      await db
        .update(agents)
        .set({ adapterType: "durable_chat_retry_test" })
        .where(eq(agents.id, f.agentId));
      await db
        .update(chatActions)
        .set({ kind: sourceKind, payload: { issueId: f.issueId } })
        .where(eq(chatActions.id, f.actionId));
      if (sourceKind === "missing")
        await db.delete(chatActions).where(eq(chatActions.id, f.actionId));
      const genericRecoveryExpected = preProvider && sourceKind !== "inbound_wakeup";
      const nextExecutionExpected = preProvider && (withDeferredInput || genericRecoveryExpected);
      const { failedRunRetry: _retry, ...ordinaryRequest } = f.request;
      const wakeOriginal = (id: string, commentId: string) =>
        f.heartbeat.wakeup(f.agentId, {
          source: "assignment",
          triggerDetail: "system",
          reason: "chat_message_received",
          requestedByActorType: "user",
          requestedByActorId: "board-user",
          payload: {
            issueId: f.issueId,
            wakeCommentId: commentId,
            wakeCommentIds: [commentId],
          },
          contextSnapshot: {
            issueId: f.issueId,
            taskKey: f.context.taskKey,
            source: "chat:slack",
            wakeCommentId: commentId,
            wakeCommentIds: [commentId],
          },
          durableChatRequest: createDurableChatWakeupRequest({
            ...ordinaryRequest,
            id,
            commentId,
          }),
          allowRunCoalescing: false,
        });
      if (preProvider) {
        execute.mockResolvedValueOnce({
          exitCode: 1, signal: null, timedOut: false,
          summary: "Fixture failed before provider work",
          resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } },
        });
      } else {
        execute.mockRejectedValueOnce(new Error("Original chat provider outcome is unknown"));
      }
      const original = await wakeOriginal(f.actionId, f.commentIds[1]);
      const deferredId = randomUUID();
      if (withDeferredInput) {
        const [owner] = await db
          .select()
          .from(chatActions)
          .where(eq(chatActions.id, f.actionId));
        await db.insert(chatActions).values({
          ...owner,
          id: deferredId,
          providerActionId: `wakeup:${deferredId}`,
        });
        expect(await wakeOriginal(deferredId, f.commentIds[0])).toBeNull();
        const [receipt] = await db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, deferredId));
        expect(receipt.status).toBe("deferred_issue_execution");
      }
      await f.heartbeat.cancelRun(
        f.activeRunId,
        "Fixture execution slot released",
        { suppressImmediateRecovery: true },
      );
      await f.heartbeat.drainActiveRunExecutions();
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, original!.id));
      expect(run).toMatchObject({
        status: "failed",
        retryOfRunId: null,
        wakeupRequestId: f.actionId,
      });
      expect(execute).toHaveBeenCalledTimes(
        nextExecutionExpected ? 2 : 1,
      );
      const runs = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId));
      expect(runs).toHaveLength(
        nextExecutionExpected ? 4 : 3,
      );
      expect(
        runs.some(
          (entry) =>
            (entry.contextSnapshot as Record<string, unknown>)?.source ===
            "issue.continuation_recovery",
        ),
      ).toBe(genericRecoveryExpected);
      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, f.issueId));
      expect(issue).toMatchObject({
        status:
          nextExecutionExpected ? "done" : preProvider ? "blocked" : "in_progress",
        executionRunId: null,
      });
      if (withDeferredInput) {
        const [receipt] = await db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, deferredId));
        const next = runs.find((entry) => entry.id === receipt.runId);
        if (!preProvider) {
          // Unknown earlier effects require reconciliation. Preserve the
          // separate user's durable cause, without dispatching it on this
          // cancellation/failure path or relabeling it as an automatic retry.
          expect(receipt).toMatchObject({ status: "deferred_issue_execution", runId: null });
          expect(next).toBeUndefined();
          return;
        }
        expect(next).toMatchObject({
          status: "succeeded",
          retryOfRunId: null,
          wakeupRequestId: deferredId,
          contextSnapshot: {
            source: "chat:slack",
            wakeCommentIds: [f.commentIds[0]],
          },
        });
      }
    },
  );

  it("keeps committed-response authority exact-Db scoped and separate from retry hints", async () => {
    const input = {
      companyId: randomUUID(),
      issueId: randomUUID(),
      agentId: randomUUID(),
      runId: randomUUID(),
      resultId: randomUUID(),
    };
    const otherDb = {} as typeof db;
    const authority = vi.fn(async () => undefined);
    const dispose = registerCommittedChatResponseAuthority(db, authority);
    try {
      await expect(
        authorizeCommittedChatResponse(otherDb, db, input),
      ).rejects.toBeInstanceOf(CommittedChatResponseAuthorizationError);
      expect(authority).not.toHaveBeenCalled();
      await authorizeCommittedChatResponse(db, db, input);
      expect(authority).toHaveBeenCalledExactlyOnceWith(db, input);
    } finally {
      dispose();
    }
    await expect(
      authorizeCommittedChatResponse(db, db, input),
    ).rejects.toBeInstanceOf(CommittedChatResponseAuthorizationError);
  });

  it("preserves the current committed-response authority and exact transient failure", async () => {
    const input = {
      companyId: randomUUID(),
      issueId: randomUUID(),
      agentId: randomUUID(),
      runId: randomUUID(),
      resultId: randomUUID(),
    };
    const first = registerCommittedChatResponseAuthority(
      db,
      async () => undefined,
    );
    const storageFailure = new Error("temporary source storage failure");
    const second = registerCommittedChatResponseAuthority(db, async () => {
      throw storageFailure;
    });
    try {
      first();
      await expect(authorizeCommittedChatResponse(db, db, input)).rejects.toBe(
        storageFailure,
      );
    } finally {
      second();
    }
  });

  it("does not discard a deferred retry on transient authority storage failure", async () => {
    const f = await retryFixture(true);
    f.register();
    await f.wake();
    const failure = new Error("Fixture authorization store unavailable");
    f.authority.mockRejectedValueOnce(failure);
    await expect(
      f.heartbeat.cancelRun(f.activeRunId, "Fixture predecessor finished", {
        suppressImmediateRecovery: true,
      }),
    ).rejects.toBe(failure);
    const [receipt] = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, f.actionId));
    expect(receipt).toMatchObject({
      status: "deferred_issue_execution",
      runId: null,
    });
    expect(receipt.payload).toMatchObject({ wakeCommentIds: f.commentIds });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.wakeupRequestId, f.actionId)),
    ).toEqual([]);
  });

  it("retries and competing workers create one queued receipt and one run", async () => {
    const f = await fixture();
    const request = f.request();
    await Promise.all([f.wake(request), f.wake(request)]);
    await f.wake(request);
    const receipts = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, request.id));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      status: "queued",
      idempotencyKey: request.idempotencyKey,
    });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.agentId, f.agentId),
            eq(heartbeatRuns.wakeupRequestId, request.id),
          ),
        ),
    ).toHaveLength(1);
    expect(f.authorize).toHaveBeenCalledTimes(1);
  });

  it("records a stable receipt when merging into a deferred wake and never merges the replay twice", async () => {
    const f = await fixture(true);
    const first = f.request(),
      second = f.request();
    await f.wake(first);
    await f.wake(second);
    await f.wake(second);
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, f.agentId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      status: "deferred_issue_execution",
      coalescedCount: 1,
    });
    expect(rows.find((row) => row.id === second.id)).toMatchObject({
      status: "coalesced",
      payload: { coalescedIntoWakeupRequestId: first.id },
    });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId)),
    ).toHaveLength(1);
  });

  it("keeps different actors in separate deferred receipts", async () => {
    const f = await fixture(true);
    await f.wake(f.request());
    await f.wake(f.request(randomUUID(), "another-user"));
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, f.agentId));
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.status === "deferred_issue_execution" && row.coalescedCount === 0,
      ),
    ).toBe(true);
  });

  it("records queued-run coalescence once with the stable receipt ID", async () => {
    const f = await fixture();
    const first = f.request(),
      second = f.request();
    await f.wake(first);
    const [firstReceipt] = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, first.id));
    await db
      .update(issues)
      .set({
        executionRunId: firstReceipt.runId,
        executionAgentNameKey: "maya",
        executionLockedAt: new Date(),
      })
      .where(eq(issues.id, f.issueId));
    await f.wake(second);
    await f.wake(second);
    const [receipt] = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, second.id));
    expect(receipt).toMatchObject({
      status: "coalesced",
      runId: firstReceipt.runId,
      coalescedCount: 1,
    });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId)),
    ).toHaveLength(2);
  });

  it("rejects a stable receipt ID reused for a different authenticated actor", async () => {
    const f = await fixture();
    const first = f.request();
    await f.wake(first);
    const conflicting = createDurableChatWakeupRequest({
      ...first,
      requestedByActorId: "different-user",
    });
    await expect(f.wake(conflicting)).rejects.toThrow(
      "chat_inbound_wakeup_receipt_conflict",
    );
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, f.agentId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId)),
    ).toHaveLength(2);
  });

  it("never readmits or dispatches a cancelled receipt on replay", async () => {
    const f = await fixture();
    const request = f.request();
    await f.wake(request);
    const [receipt] = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, request.id));
    await db
      .update(agentWakeupRequests)
      .set({ status: "cancelled" })
      .where(eq(agentWakeupRequests.id, request.id));
    await db
      .update(heartbeatRuns)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, receipt.runId!));
    await f.wake(request);
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId)),
    ).toHaveLength(2);
  });

  it("does not accept a JSON copy of the internal scheduling capability", async () => {
    const f = await fixture();
    const request = f.request();
    await expect(f.wake(JSON.parse(JSON.stringify(request)))).rejects.toThrow(
      "chat_inbound_wakeup_binding_denied",
    );
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, f.agentId)),
    ).toEqual([]);
  });

  it("rechecks current authorization in the scheduling transaction", async () => {
    const f = await fixture();
    f.authorize.mockRejectedValueOnce(new Error("reach revoked"));
    await expect(f.wake(f.request())).rejects.toThrow("reach revoked");
    expect(
      await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, f.agentId)),
    ).toEqual([]);
  });

  it.each([
    { provider: "slack", state: "active", callerMarkers: false },
    { provider: "telegram", state: "completed", callerMarkers: false },
    { provider: "slack", state: "active", callerMarkers: true },
  ] as const)(
    "rejects generic failed-chat retry before admission ($provider/$state; caller markers: $callerMarkers)",
    async ({ provider, state, callerMarkers }) => {
      // Keep the fixture-owned unrelated run occupying the only execution slot.
      // This exercises real heartbeat admission without starting an adapter.
      const f = await fixture();
      const applicationId = randomUUID();
      const connectionId = randomUUID();
      const endpointId = randomUUID();
      const conversationId = randomUUID();
      const originalCommentId = randomUUID();
      const failedCommentId = randomUUID();
      const taskKey = `D${f.companyId.slice(0, 7)}-1`;
      await db
        .update(issues)
        .set({
          identifier: taskKey,
          description: "Original request A: describe the original photo.",
        })
        .where(eq(issues.id, f.issueId));
      await db.insert(toolApplications).values({
        id: applicationId,
        companyId: f.companyId,
        name: "Failed chat retry",
        type: "chat",
      });
      await db.insert(toolConnections).values({
        id: connectionId,
        companyId: f.companyId,
        applicationId,
        name: `${provider} failed chat retry`,
        uid: `chat-retry-${connectionId}`,
        connectionPurpose: "channel",
        transport: "chat_sdk",
        enabled: true,
        status: "active",
      });
      await db.insert(chatEndpoints).values({
        id: endpointId,
        companyId: f.companyId,
        connectionId,
        provider,
        publicId: randomUUID(),
        assignedAgentId: f.agentId,
        status: "active",
      });
      await db.insert(chatConversations).values({
        id: conversationId,
        companyId: f.companyId,
        endpointId,
        issueId: f.issueId,
        externalConversationId: `${provider}-retry-dm`,
        externalThreadId: `${provider}-retry-thread`,
        externalLabel: `${provider} retry fixture`,
        sessionGeneration: 1,
        isDirectMessage: true,
        state: "active",
      });
      await db.insert(issueComments).values([
        {
          id: originalCommentId,
          companyId: f.companyId,
          issueId: f.issueId,
          authorUserId: "board-user",
          body: "Original request A: describe the original photo.",
        },
        {
          id: failedCommentId,
          companyId: f.companyId,
          issueId: f.issueId,
          authorUserId: "board-user",
          body: "Later request B: explain the new queue behavior, not the photo.",
        },
      ]);
      await db.insert(chatMessageLinks).values(
        [originalCommentId, failedCommentId].map((commentId, index) => ({
          companyId: f.companyId,
          endpointId,
          conversationId,
          commentId,
          providerMessageId: `${provider}-retry-${index}`,
          direction: "inbound",
        })),
      );
      const request = f.request(failedCommentId);
      await queueIssueAssignmentWakeup({
        heartbeat: f.heartbeat,
        issue: {
          id: f.issueId,
          assigneeAgentId: f.agentId,
          status: "in_progress",
        },
        reason: "External chat message received",
        mutation: "chat_message_received",
        contextSource: `chat:${provider}`,
        taskKey,
        requestedByActorType: request.requestedByActorType,
        requestedByActorId: request.requestedByActorId,
        wakeCommentId: failedCommentId,
        durableChatRequest: request,
        rethrowOnError: true,
      });
      const [admitted] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.wakeupRequestId, request.id));
      expect(admitted).toMatchObject({
        status: "queued",
        contextSnapshot: {
          taskKey,
          source: `chat:${provider}`,
          wakeCommentId: failedCommentId,
          wakeCommentIds: [failedCommentId],
        },
      });
      // Simulate a transient execution failure, not an integrity fault or a
      // manual edit to any live runner root. The admitted request stays intact.
      await db
        .update(heartbeatRuns)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, admitted.id));
      await db
        .update(agentWakeupRequests)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(agentWakeupRequests.id, request.id));
      await db
        .update(issues)
        .set({
          status: "blocked",
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
        })
        .where(eq(issues.id, f.issueId));
      if (state === "completed") {
        await db
          .update(chatConversations)
          .set({ state: "completed" })
          .where(eq(chatConversations.id, conversationId));
      }
      const snapshot = async () => ({
        runs: await db
          .select()
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.agentId, f.agentId))
          .orderBy(heartbeatRuns.id),
        receipts: await db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.agentId, f.agentId))
          .orderBy(agentWakeupRequests.id),
        issue: await db.select().from(issues).where(eq(issues.id, f.issueId)),
        conversation: await db
          .select()
          .from(chatConversations)
          .where(eq(chatConversations.id, conversationId)),
        publications: await db
          .select()
          .from(chatPublications)
          .where(eq(chatPublications.conversationId, conversationId)),
      });
      const before = await snapshot();
      // This is the existing IssueDetail/Inbox generic wakeup API, deliberately
      // lacking a failed-run ID. It must not silently retry A in a UUID-keyed
      // session after losing B's exact chat comment and admission authority.
      const rejection = await f.heartbeat
        .wakeup(f.agentId, {
          source: "on_demand",
          triggerDetail: "manual",
          reason: "retry_failed_run",
          payload: {
            issueId: f.issueId,
            ...(callerMarkers
              ? {
                  retryOfRunId: admitted.id,
                  taskKey,
                  commentId: failedCommentId,
                }
              : {}),
          },
          ...(callerMarkers
            ? {
                contextSnapshot: {
                  source: `chat:${provider}`,
                  retryOfRunId: admitted.id,
                  wakeCommentId: failedCommentId,
                  wakeCommentIds: [failedCommentId],
                },
              }
            : {}),
          requestedByActorType: "user",
          requestedByActorId: "board-user",
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect.soft(rejection).toMatchObject({
        status: 409,
        details: { code: "chat_failed_run_retry_requires_authorized_context" },
      });
      const after = await snapshot();
      expect.soft(after.receipts).toEqual(before.receipts);
      expect.soft(after.runs).toEqual(before.runs);
      expect.soft(after.issue).toEqual(before.issue);
      expect.soft(after.conversation).toEqual(before.conversation);
      expect.soft(after.publications).toEqual(before.publications);
      expect(f.authorize).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves ordinary non-chat manual retry admission", async () => {
    const f = await fixture();
    const retry = await f.heartbeat.wakeup(f.agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "retry_failed_run",
      payload: { issueId: f.issueId },
      requestedByActorType: "user",
      requestedByActorId: "board-user",
    });
    expect(retry).toMatchObject({
      status: "queued",
      contextSnapshot: {
        issueId: f.issueId,
        taskKey: f.issueId,
        wakeReason: "retry_failed_run",
      },
    });
    const receipts = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, f.agentId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: "queued", runId: retry!.id });
    expect(
      await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, f.agentId)),
    ).toHaveLength(2);
  });
});
