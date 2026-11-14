import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import { agentWakeupRequests, chatActions, chatExternalPrincipals, chatIdentityLinks,
  chatMessageLinks, chatPublications, heartbeatRuns, issues, nativeRunFinalizations, nativeRunResults, statusDecisions,
  type Db } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { chatChannelService } from "../../services/chat-channels.js";
import { orchestrationService } from "../../services/orchestration/orchestration-service.js";
import type { heartbeatService } from "../../services/heartbeat.js";
import { withManagedNativeHeartbeatFixture } from "./managed-native-heartbeat-fixture.js";

type DispatchObserver = NonNullable<NonNullable<Parameters<typeof heartbeatService>[1]>["beforeChatControlRecoveryCheck"]>;
type ManagedInput = Parameters<typeof withManagedNativeHeartbeatFixture>[0];

/** Real source producer, controlled Slack/model wire: no manually accepted Run/Source/control rows. */
export async function withManagedChannelCloseSource(input: {
  db: Db; root: string; opencodeBinary: string;
  drive(context: {
    heartbeat: ReturnType<typeof heartbeatService>; sourceRun: typeof heartbeatRuns.$inferSelect;
    companyId: string; agentId: string; issueId: string; actorUserId: string;
    setObserver(observer: DispatchObserver): void;
    publishClose(): Promise<void>;
    providerCalls(): number;
    sourceProviderCalls: number;
  }): Promise<void>;
  /** Seed or inspect the true current-Human task before its first original wake. */
  beforeFirstSourceWake?: (facts: { companyId: string; agentId: string; issueId: string; actorUserId: string }) => Promise<void>;
  /** Read-only observation of the exact execution input carried by the real managed model wire. */
  observeProviderExecution?: (facts: { execution: import("../../vendor/paperclip-runner/index.js").NativeExecutionInput;
    runId: string; issueId: string | null; callIndex: number }) => void;
}) {
  const { db } = input;
  let observe: DispatchObserver | undefined;
  let callbacks: { onMessage?: (input: unknown) => Promise<unknown> } | null = null;
  let closing = false, sourceReady = false, postIsWaiting = false;
  let closeError: unknown;
  let releasePost!: () => void;
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  let closePromise: Promise<unknown> | undefined;
  let providerSourceRunId: string | undefined;
  const endpoints = new Map<string, unknown>();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const team = `T${suffix}`, bot = `U${suffix}`, user = `U${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const channel = `D${suffix}`;
  const signingSecret = `controlled-source-signing-${suffix}`;
  const post = async (threadId: string) => {
    if (closing) { postIsWaiting = true; await postGate; }
    return { id: randomUUID(), threadId };
  };
  const threadFor = (threadId: string) => ({
    id: threadId, channelId: channel, isDM: true, channel: { id: channel, name: "controlled-source" },
    adapter: { addReaction: async () => undefined, removeReaction: async () => undefined,
      editMessage: async (_threadId: string, id: string) => ({ id, threadId }) },
    startTyping: async () => undefined, subscribe: async () => undefined,
    post: async () => post(threadId),
    postEphemeral: async () => ({ ...await post(threadId), usedFallback: false }),
  });
  // Same original runtime transport contract as durable-chat-wakeup's real channel source.
  const runtime = {
    get: (id: string) => endpoints.get(id) ?? null,
    replaceEndpoint: async (options: { endpointId: string; callbacks: unknown; providerConfig: { provider: string } }) => {
      callbacks = options.callbacks as typeof callbacks;
      const endpoint = { provider: options.providerConfig.provider, initialize: async () => undefined,
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
        thread: threadFor, applySlackReceiptReaction: async () => undefined,
        post, edit: async (_thread: string, id: string) => ({ id }),
        addReaction: async () => undefined, removeReaction: async () => undefined,
        startTyping: async () => undefined, subscribe: async () => undefined,
        postEphemeral: async (threadId: string) => ({ ...await post(threadId), usedFallback: false }) };
      endpoints.set(options.endpointId, endpoint); return endpoint;
    },
    removeEndpoint: async (id: string) => { endpoints.delete(id); return true; },
    shutdown: async () => { endpoints.clear(); },
  };
  const slackFetch = async (value: string | URL | Request, init?: RequestInit) => {
    const url = String(value);
    if (url === "https://slack.com/api/auth.test") return Response.json({ ok: true,
      team_id: team, team: "Controlled channel source", user_id: bot, user: "maya" }, { headers: {
      "x-oauth-scopes": "app_mentions:read,assistant:write,channels:history,channels:read,chat:write,commands,files:read,files:write,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,reactions:read,reactions:write,users:read" } });
    if (url.startsWith("https://slack.com/api/conversations.list")) return Response.json({ ok: true,
      channels: [], response_metadata: { next_cursor: "" } });
    if (url.startsWith("https://slack.com/api/conversations.info")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      return Response.json({ ok: true, channel: { id: new URL(url).searchParams.get("channel") ?? body.get("channel") ?? channel,
        name: "controlled-source", is_im: true, is_member: true, is_archived: false } });
    }
    if (url === "https://slack.com/api/users.info") return Response.json({ ok: true, user: { id: user, team_id: team } });
    if (url === "https://slack.com/api/agents.sessions.setStatus") return Response.json({ ok: true });
    throw new Error("managed_close_source_unexpected_slack_request");
  };
  const reply: ManagedInput["providerReply"] = ({ body, callIndex, execution, runId, issueId }) => {
    input.observeProviderExecution?.({ execution, runId, issueId, callIndex });
    const tools = body.tools as Array<{ name: string }>;
    const tool = (name: string) => {
      const found = tools.find(value => value.name === name ||
        ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${name}`));
      if (!found) throw new Error(`managed_close_source_tool_missing_${name}`);
      return found.name;
    };
    if (providerSourceRunId === undefined) providerSourceRunId = runId;
    if (sourceReady || runId !== providerSourceRunId || callIndex > 3)
      throw new Error("managed_close_source_unrequested_provider_replay");
    // The SDK may consume one final answer after the accepted finish tool.
    // No further tools/effects are supplied on this bounded third request.
    if (callIndex === 3) return { stop_reason: "end_turn", content: [{ type: "text",
      text: "The bounded original request has a retained response." }] };
    if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "source-write",
      name: tool("write_document"), input: { idempotencyKey: "channel-source-result", key: "channel-source-result",
        title: "Original channel response", body: "The bounded original request has a retained response.", baseRevisionId: null } }] };
    return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "source-finish",
      name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "yielded",
        summary: "The bounded original request has a retained response.", completionClaim: {
          contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: false,
          criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
            status: "unknown", evidenceRefs: [] })), remainingWork: [] },
        evidence: [], verification: [], attentionRequests: [], artifacts: [],
        continuation: { kind: "response_wake", summary: "Wait for the next authenticated channel request.",
          idempotencyKey: "channel-source-response-wait" } } }] };
  };
  await withManagedNativeHeartbeatFixture({ db, root: input.root, opencodeBinary: input.opencodeBinary,
    timeoutSec: 300, schedulerMode: "serial", providerReply: reply,
    beforeChatControlRecoveryCheck: async facts => { if (sourceReady) await observe?.(facts); },
    driveScheduler: async ({ heartbeat, companyId, agentId, actor, facts, factsForRun, closeManagedAgentHostForRun }) => {
      if (!actor.userId) throw new Error("managed_close_source_current_human_missing");
      let planPrepared = false;
      const service = chatChannelService(db, { runtime: runtime as never, fetch: slackFetch,
        publicBaseUrl: "https://fixture.invalid", heartbeat: { cancelRun: heartbeat.cancelRun,
          wakeup: async (target, wake) => {
            if (!planPrepared) {
              const issueId = wake?.contextSnapshot?.issueId;
              if (typeof issueId !== "string") throw new Error("managed_close_source_task_missing");
              const [task] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
              if (!task) throw new Error("managed_close_source_task_missing");
              if (!actor.userId) throw new Error("managed_close_source_current_human_missing");
              await input.beforeFirstSourceWake?.({ companyId, agentId, issueId, actorUserId: actor.userId });
              const plans = orchestrationService(db);
              const plan = await plans.create(actor, companyId, { issueId,
                expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
                completionContract: { objective: "Retain the authenticated request response and wait for the next message",
                  requiredOutputs: [{ kind: "task_document", key: "channel-source-result" }],
                  businessInvariants: ["No unrequested follow-up or external mutation"] },
                budgets: { maxModelCostMinor: 10, maxToolActions: 10 }, workers: [{ key: "source-writer", issueId }] });
              await plans.decide(actor, companyId, plan.id, { expectedVersion: plan.version,
                action: "start", rationale: "Current Human admits the bounded actual channel source producer" });
              planPrepared = true;
            }
            return heartbeat.wakeup(target, wake);
          } },
      });
      try {
        const endpoint = await service.create(companyId, { provider: "slack", assignedAgentId: agentId,
          name: `Managed channel source ${suffix}` }, actor.userId);
        await service.update(endpoint.id, { allowUnlinkedPeople: false }, actor.userId);
        await service.configure(endpoint.id, { action: "configure", credentials: {
          botToken: `xoxb-controlled-source-${suffix}`, signingSecret } }, actor.userId);
        const challengeBody = JSON.stringify({ type: "url_verification", challenge: `challenge-${suffix}` });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${challengeBody}`).digest("hex")}`;
        const verified = await service.handleWebhook(endpoint.publicId, "slack", new Request(
          `https://fixture.invalid/api/chat-webhooks/${endpoint.publicId}/slack`, { method: "POST",
            headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp,
              "x-slack-signature": signature }, body: challengeBody }));
        expect(verified.status).toBe(200);
        expect(await verified.json()).toEqual({ challenge: `challenge-${suffix}` });
        await service.configure(endpoint.id, { action: "verify" }, actor.userId);
        const [principal] = await db.insert(chatExternalPrincipals).values({ companyId, provider: "slack",
          providerAccountId: team, externalId: user, kind: "user", displayName: "Current channel Human" }).returning();
        if (!principal) throw new Error("managed_close_source_principal_missing");
        await db.insert(chatIdentityLinks).values({ companyId, endpointId: endpoint.id, principalId: principal.id,
          paperclipUserId: actor.userId, status: "linked", confirmedAt: new Date() });
        const currentCallbacks = (() => callbacks as { onMessage?: (input: unknown) => Promise<unknown> } | null)();
        if (!currentCallbacks?.onMessage) throw new Error("managed_close_source_callback_missing");
        const onMessage = currentCallbacks.onMessage;
        const threadId = `slack:${channel}:1789000000.100001`;
        const thread = threadFor(threadId);
        const message = (id: string, text: string) => ({ id, raw: {}, text, isMention: false, attachments: [],
          metadata: { dateSent: new Date(), edited: false }, author: { userId: user, userName: "owner",
            fullName: "Current channel Human", isBot: false, isMe: false, isSystem: false } });
        await onMessage({ endpointId: endpoint.id, provider: "slack", thread,
          message: message("1789000000.100001", "@maya retain one bounded response, then wait for my next message"), trigger: "direct_message" });
        const [action] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, endpoint.id), eq(chatActions.kind, "inbound_wakeup")));
        if (!action) throw new Error("managed_close_source_original_action_missing");
        let sourceRun: typeof heartbeatRuns.$inferSelect | undefined;
        const deadline = Date.now() + 240_000;
        while (Date.now() < deadline) {
          const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action.id));
          if (wake?.runId) {
            const [candidate] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.runId));
            if (candidate?.status === "succeeded" && candidate.nativePhase === "committed") { sourceRun = candidate; break; }
            // Run terminalization can precede async coordinator commitment.
            // A succeeded Run must remain observable until its committed phase.
            if (candidate && ["failed", "timed_out", "cancelled", "interrupted", "superseded"].includes(candidate.status))
              throw new Error("managed_close_source_real_native_run_not_successful");
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!sourceRun) throw new Error("managed_close_source_native_completion_deadline");
        await heartbeat.drainActiveRunExecutions();
        await closeManagedAgentHostForRun(sourceRun.id);
        const [settled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, sourceRun.id));
        if (!settled) throw new Error("managed_close_source_settled_run_missing");
        sourceRun = settled;
        expect(sourceRun).toMatchObject({ status: "succeeded", runtimeMode: "native", nativePhase: "committed",
          nativeInputSourceProtocolVersion: 1, nativeProcessCleanupPending: false, responsibleUserId: actor.userId });
        expect(nativeRunInputSourceReceiptSchema.safeParse(sourceRun.runnerProfileJson?.nativeInputSourceReceipt).success).toBe(true);
        const [coordinator] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, sourceRun.id));
        expect(coordinator).toMatchObject({ phase: "committed", leaseOwner: null, failureCode: null, resultId: expect.any(String) });
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.id, coordinator!.resultId!)))
          .toEqual([expect.objectContaining({ runId: sourceRun.id, schemaStatus: "accepted" })]);
        expect(await db.select().from(statusDecisions).where(eq(statusDecisions.id, coordinator!.decisionId!)))
          .toEqual([expect.objectContaining({ runId: sourceRun.id, applicationState: "applied", reasonCode: "external_chat_response_waiting" })]);
        expect(providerSourceRunId).toBe(sourceRun.id);
        const sourceProviderCalls = factsForRun(sourceRun.id).providerCallCount;
        expect([2, 3]).toContain(sourceProviderCalls);
        const issueId = action.payload.issueId;
        if (typeof issueId !== "string" || !action.conversationId) throw new Error("managed_close_source_issue_binding_missing");
        expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0]).toMatchObject({ status: "in_progress" });
        sourceReady = true;
        // Exercise the interval after the genuine result commits and before
        // its publication settles the Slack Task into its waiting status.
        // The real /close producer and publication flush own both receipts;
        // hold their controlled wire ACKs until the requested gate observation.
        closing = true;
        closePromise = onMessage({ endpointId: endpoint.id, provider: "slack", thread,
          message: message("1789000000.100002", "/close"), trigger: "direct_message" }).then(() => service.processPendingPublications()).catch(error => { closeError = error; });
        await vi.waitFor(() => {
          if (closeError) throw closeError;
          expect(postIsWaiting).toBe(true);
        }, { timeout: 20_000, interval: 25 });
        const publishClose = async () => {
          releasePost(); await closePromise;
          if (closeError) throw closeError;
          await service.processPendingPublications();
          const [control] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, endpoint.id),
            eq(chatActions.kind, "task_control_authorization")));
          expect(control).toMatchObject({ status: "processed", result: { code: "task_control_authorized_and_sent" } });
          const publicationId = control?.payload.publicationId;
          if (typeof publicationId !== "string") throw new Error("managed_close_source_publication_missing");
          expect((await db.select().from(chatPublications).where(eq(chatPublications.id, publicationId)))[0])
            .toMatchObject({ state: "published", providerMessageId: expect.any(String) });
          expect(await db.select().from(chatMessageLinks).where(eq(chatMessageLinks.publicationId, publicationId)))
            .toContainEqual(expect.objectContaining({ conversationId: action.conversationId, direction: "outbound" }));
        };
        await input.drive({ heartbeat, sourceRun, companyId, agentId, issueId, actorUserId: actor.userId,
          setObserver: observer => { observe = observer; }, publishClose, providerCalls: () => facts().providerCallCount, sourceProviderCalls });
        expect(facts().providerCallCount).toBe(sourceProviderCalls);
      } finally {
        releasePost(); await closePromise?.catch(() => undefined);
        await heartbeat.drainActiveRunExecutions();
        await service.shutdown();
      }
    },
  });
}
