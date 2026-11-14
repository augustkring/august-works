import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentWakeupRequests, chatActions, chatConversations, chatExternalPrincipals, chatIdentityLinks,
  chatMessageLinks, chatPublications, createDb, heartbeatRuns, issueComments, issues,
  orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { withManagedNativeHeartbeatFixture } from "../../__tests__/helpers/managed-native-heartbeat-fixture.js";
import { chatChannelService } from "../chat-channels.js";
import { issueService } from "../issues.js";
import { qualifiedOpenCodeBinary } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let root = "";

function message(id: string, text: string, userId: string, userName: string) {
  return { id, raw: {}, text, isMention: false, attachments: [], metadata: { dateSent: new Date(), edited: false },
    author: { userId, userName, fullName: "Current channel Human", isBot: false, isMe: false, isSystem: false } };
}

async function waitForRun(actionId: string) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, actionId)).limit(1);
    if (wake?.runId) {
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.runId)).limit(1);
      if (run?.status === "succeeded" && run.nativePhase === "committed") return { wake, run };
      if (run && ["failed", "timed_out", "cancelled", "interrupted", "superseded"].includes(run.status))
        throw new Error(`managed_channel_conversation_run_${run.status}_${run.errorCode ?? "unknown"}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("managed_channel_conversation_run_deadline");
}

describe("managed Native channel conversation", () => {
  let preserveFailure = false;
  beforeAll(async () => {
    if (!qualifiedOpenCodeBinary()) throw new Error("qualified_opencode_binary_unavailable_for_managed_channel_conversation");
    root = await mkdtemp(join(tmpdir(), "managed-native-channel-conversation-home-"));
    database = await startEmbeddedPostgresTestDatabase("managed-native-channel-conversation-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterEach(context => { if (context.task.result?.state === "fail") preserveFailure = true; });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root) { await makeConversationFixtureTreeWritable(root); if (!preserveFailure) await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it("admits two managed Slack callback turns into conversation_model, deduplicates a delivery, and stops dispatch after link revocation", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const endpoints = new Map<string, unknown>();
    let callbacks: { onMessage?: (input: unknown) => Promise<unknown> } | null = null;
    let providerCallCount = 0;
    let privateHistoryExcluded = false;
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const team = `T${suffix}`, bot = `U${suffix}`;
    const externalUser = `U${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const channel = `D${suffix}`;
    const signingSecret = `managed-channel-conversation-${suffix}`;
    const threadId = `slack:${channel}:1789000000.100001`;
    const secondText = "Now continue from the same private conversation and give one brief update.";
    const privateMarker = "PRIVATE_COMMENT_NOT_LINKED_TO_CHANNEL";
    const publicationPosts: Array<{ threadId: string; text: string }> = [];
    const post = async (targetThread: string, content?: unknown) => {
      const text = typeof content === "string" ? content
        : content && typeof content === "object" && !Array.isArray(content) &&
            typeof (content as Record<string, unknown>).markdown === "string"
          ? (content as Record<string, string>).markdown : null;
      if (text !== null) publicationPosts.push({ threadId: targetThread, text });
      return { id: randomUUID(), threadId: targetThread };
    };
    const threadFor = (targetThread: string) => ({ id: targetThread, channelId: channel, isDM: true,
      channel: { id: channel, name: "native-conversation" },
      adapter: { addReaction: async () => undefined, removeReaction: async () => undefined,
        editMessage: async (_thread: string, id: string) => ({ id, threadId: targetThread }) },
      startTyping: async () => undefined, subscribe: async () => undefined, post: async (content: unknown) => post(targetThread, content),
      postEphemeral: async () => ({ ...await post(targetThread), usedFallback: false }) });
    const runtime = {
      get: (id: string) => endpoints.get(id) ?? null,
      replaceEndpoint: async (options: { endpointId: string; callbacks: unknown; providerConfig: { provider: string } }) => {
        callbacks = options.callbacks as typeof callbacks;
        const endpoint = { provider: options.providerConfig.provider, initialize: async () => undefined, shutdown: async () => undefined,
          handleWebhook: async (request: Request) => {
            const body = await request.text(), timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
            const signature = request.headers.get("x-slack-signature") ?? "";
            const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
            if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
                Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
                !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return new Response("invalid signature", { status: 401 });
            const payload = JSON.parse(body) as { type?: unknown; challenge?: unknown };
            return payload.type === "url_verification" && typeof payload.challenge === "string"
              ? Response.json({ challenge: payload.challenge }) : new Response("unexpected webhook", { status: 422 });
          },
          acceptsProviderScope: (raw: unknown) => Boolean(raw && typeof raw === "object" &&
            (raw as { type?: unknown }).type === "url_verification"),
          thread: threadFor, applySlackReceiptReaction: async () => undefined, post,
          edit: async (_thread: string, id: string) => ({ id }), addReaction: async () => undefined,
          removeReaction: async () => undefined, startTyping: async () => undefined, subscribe: async () => undefined,
          postEphemeral: async (targetThread: string) => ({ ...await post(targetThread), usedFallback: false }) };
        endpoints.set(options.endpointId, endpoint); return endpoint;
      },
      removeEndpoint: async (id: string) => { endpoints.delete(id); return true; },
      shutdown: async () => { endpoints.clear(); },
    };
    const slackFetch = async (value: string | URL | Request, init?: RequestInit) => {
      const url = String(value);
      if (url === "https://slack.com/api/auth.test") return Response.json({ ok: true, team_id: team,
        team: "Managed conversation fixture", user_id: bot, user: "maya" }, { headers: { "x-oauth-scopes":
          "app_mentions:read,assistant:write,channels:history,channels:read,chat:write,commands,files:read,files:write,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,reactions:read,reactions:write,users:read" } });
      if (url.startsWith("https://slack.com/api/conversations.list")) return Response.json({ ok: true, channels: [], response_metadata: { next_cursor: "" } });
      if (url.startsWith("https://slack.com/api/conversations.info")) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        return Response.json({ ok: true, channel: { id: new URL(url).searchParams.get("channel") ?? body.get("channel") ?? channel,
          name: "native-conversation", is_im: true, is_member: true, is_archived: false } });
      }
      if (url === "https://slack.com/api/users.info") return Response.json({ ok: true, user: { id: externalUser, team_id: team } });
      if (url === "https://slack.com/api/agents.sessions.setStatus") return Response.json({ ok: true });
      throw new Error("managed_channel_conversation_unexpected_slack_request");
    };

    const replies = new Map<string, number>();
    let currentActor: import("../authorization.js").AuthorizationActor | null = null;
    let privateCommentAdded = false;
    await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: binary, schedulerMode: "serial", timeoutSec: 300,
      beforeManagedModelRequest: async ({ issueId }) => {
        if (privateCommentAdded || !issueId || !currentActor?.userId) return;
        await issueService(db).addComment(issueId, privateMarker, { userId: currentActor.userId },
          { clientRequestId: randomUUID(), manualInputActor: currentActor });
        privateCommentAdded = true;
      },
      providerReply: ({ body, runId }) => {
        providerCallCount++;
        const modelInput = JSON.stringify(body.messages ?? []);
        if (modelInput.includes(secondText)) {
          if (modelInput.includes(privateMarker)) throw new Error("managed_channel_conversation_private_comment_leaked");
          privateHistoryExcluded = true;
        }
        const runTurn = (replies.get(runId) ?? 0) + 1; replies.set(runId, runTurn);
        return { stop_reason: "end_turn", content: [{ type: "text", text: `Native channel reply ${providerCallCount}.` }] };
      },
      driveScheduler: async ({ heartbeat, companyId, agentId, actor, closeManagedAgentHostForRun, factsForRun }) => {
        if (!actor.userId) throw new Error("managed_channel_conversation_human_missing");
        currentActor = actor;
        const service = chatChannelService(db, { runtime: runtime as never, fetch: slackFetch,
          publicBaseUrl: "https://fixture.invalid", heartbeat: { cancelRun: heartbeat.cancelRun,
            wakeup: (target, wake) => heartbeat.wakeup(target, wake) } });
        try {
          const endpoint = await service.create(companyId, { provider: "slack", assignedAgentId: agentId,
            name: `Managed Native conversation ${suffix}` }, actor.userId);
          await service.update(endpoint.id, { allowUnlinkedPeople: false, allowDirectMessages: true }, actor.userId);
          await service.configure(endpoint.id, { action: "configure", credentials: {
            botToken: `xoxb-managed-channel-${suffix}`, signingSecret } }, actor.userId);
          // The controlled runtime signs only this URL-verification handshake. Message events below call the
          // registered production onMessage callback directly; this fixture does not claim signed Slack event ingress.
          const challenge = `challenge-${suffix}`, body = JSON.stringify({ type: "url_verification", challenge });
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
          const verified = await service.handleWebhook(endpoint.publicId, "slack", new Request(
            `https://fixture.invalid/api/chat-webhooks/${endpoint.publicId}/slack`, { method: "POST",
              headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, body }));
          expect(verified.status).toBe(200); expect(await verified.json()).toEqual({ challenge });
          await service.configure(endpoint.id, { action: "verify" }, actor.userId);
          const [principal] = await db.insert(chatExternalPrincipals).values({ companyId, provider: "slack",
            providerAccountId: team, externalId: externalUser, kind: "user", displayName: "Current channel Human" }).returning();
          if (!principal) throw new Error("managed_channel_conversation_principal_missing");
          const [identityLink] = await db.insert(chatIdentityLinks).values({ companyId, endpointId: endpoint.id,
            principalId: principal.id, paperclipUserId: actor.userId, status: "linked", confirmedAt: new Date() }).returning();
          if (!identityLink) throw new Error("managed_channel_conversation_identity_link_missing");
          const callback = callbacks?.onMessage;
          if (!callback) throw new Error("managed_channel_conversation_callback_missing");
          const send = (id: string, text: string) => callback({ endpointId: endpoint.id, provider: "slack",
            thread: threadFor(threadId), message: message(id, text, externalUser, "owner"), trigger: "direct_message" });
          const firstText = "Please reply briefly to the first linked channel Human message.";
          await send("1789000000.100101", firstText);
          const [firstLink] = await db.select().from(chatMessageLinks).where(and(eq(chatMessageLinks.endpointId, endpoint.id),
            eq(chatMessageLinks.providerMessageId, "1789000000.100101"), eq(chatMessageLinks.direction, "inbound"))).limit(1);
          if (!firstLink) throw new Error("managed_channel_conversation_first_source_missing");
          const [firstAction] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, endpoint.id),
            eq(chatActions.kind, "inbound_wakeup"), sql`${chatActions.payload}->>'commentId' = ${firstLink.commentId}`)).limit(1);
          if (!firstAction) throw new Error("managed_channel_conversation_first_action_missing");
          expect(firstLink.conversationId).toBe(firstAction.conversationId);
          expect(identityLink).toMatchObject({ principalId: principal.id, paperclipUserId: actor.userId, status: "linked" });
          expect(firstAction.principalId).toBe(principal.id);
          expect(firstAction.payload).toMatchObject({ commentId: firstLink.commentId,
            requestedByActorType: "user", requestedByActorId: actor.userId });
          const [firstSourceComment] = await db.select({ authorType: issueComments.authorType, authorUserId: issueComments.authorUserId })
            .from(issueComments).where(eq(issueComments.id, firstLink.commentId!)).limit(1);
          expect(firstSourceComment).toEqual({ authorType: "user", authorUserId: actor.userId });
          const first = await waitForRun(firstAction.id);
          await heartbeat.drainActiveRunExecutions(); await closeManagedAgentHostForRun(first.run.id);
          expect(first.run).toMatchObject({ status: "succeeded", runtimeMode: "native", nativePhase: "committed",
            responsibleUserId: actor.userId, nativeInputSourceProtocolVersion: 1 });
          expect((await factsForRun(first.run.id)).issuerFacts).toContainEqual(expect.objectContaining({
            scope: "conversation_model", runId: first.run.id }));
          const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, firstAction.payload.issueId as string))).limit(1);
          expect(issue).toMatchObject({ originKind: "chat_channel", conversationAgentId: null, conversationUserId: null,
            executionRunId: null, status: "in_review" });
          await service.processPendingPublications();
          // This ordinary Human comment was inserted before the first model request but has no provider message link.
          // It must neither keep this channel session active at settlement nor enter the next turn's history.
          expect(privateCommentAdded).toBe(true);
          const [settledConversation] = await db.select().from(chatConversations).where(and(
            eq(chatConversations.companyId, companyId), eq(chatConversations.id, firstAction.conversationId!))).limit(1);
          expect(settledConversation).toMatchObject({ state: "waiting", sessionGeneration: expect.any(Number) });
          expect(await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId),
            eq(orchestrationPlans.issueId, issue!.id)))).toHaveLength(0);
          const issueAttempts = await db.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts)
            .innerJoin(orchestrationPlans, and(eq(orchestrationPlans.companyId, orchestrationWorkerAttempts.companyId),
              eq(orchestrationPlans.id, orchestrationWorkerAttempts.planId)))
            .where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationPlans.issueId, issue!.id)));
          expect(issueAttempts).toHaveLength(0);

          // A redelivery of the exact provider event remains one durable inbound source and no new Run.
          const beforeDuplicateCalls = providerCallCount;
          await send("1789000000.100101", firstText);
          expect(providerCallCount).toBe(beforeDuplicateCalls);
          const duplicateLinks = await db.select().from(chatMessageLinks).where(and(eq(chatMessageLinks.endpointId, endpoint.id),
            eq(chatMessageLinks.providerMessageId, "1789000000.100101"), eq(chatMessageLinks.direction, "inbound")));
          expect(duplicateLinks).toHaveLength(1);

          await send("1789000000.100102", secondText);
          const [secondLink] = await db.select().from(chatMessageLinks).where(and(eq(chatMessageLinks.endpointId, endpoint.id),
            eq(chatMessageLinks.providerMessageId, "1789000000.100102"), eq(chatMessageLinks.direction, "inbound"))).limit(1);
          if (!secondLink) throw new Error("managed_channel_conversation_second_source_missing");
          const [secondAction] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, endpoint.id),
            eq(chatActions.kind, "inbound_wakeup"), sql`${chatActions.payload}->>'commentId' = ${secondLink.commentId}`)).limit(1);
          if (!secondAction) throw new Error("managed_channel_conversation_second_action_missing");
          expect(secondLink.conversationId).toBe(secondAction.conversationId);
          expect(secondAction.principalId).toBe(principal.id);
          expect(secondAction.payload).toMatchObject({ commentId: secondLink.commentId,
            requestedByActorType: "user", requestedByActorId: actor.userId });
          const [secondSourceComment] = await db.select({ authorType: issueComments.authorType, authorUserId: issueComments.authorUserId })
            .from(issueComments).where(eq(issueComments.id, secondLink.commentId!)).limit(1);
          expect(secondSourceComment).toEqual({ authorType: "user", authorUserId: actor.userId });
          const second = await waitForRun(secondAction.id);
          await heartbeat.drainActiveRunExecutions(); await closeManagedAgentHostForRun(second.run.id);
          expect(second.run.id).not.toBe(first.run.id);
          expect(privateHistoryExcluded).toBe(true);
          expect(second.run).toMatchObject({ status: "succeeded", runtimeMode: "native", nativePhase: "committed",
            responsibleUserId: actor.userId, nativeInputSourceProtocolVersion: 1 });
          expect((await factsForRun(second.run.id)).issuerFacts).toContainEqual(expect.objectContaining({
            scope: "conversation_model", runId: second.run.id }));
          await service.processPendingPublications();
          const reservations = await db.select().from(orchestrationModelReservations).where(and(
            eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.conversationRunId, first.run.id)));
          expect(reservations).toHaveLength(1);
          expect(reservations[0]).toMatchObject({ purpose: "conversation_model", status: "completed",
            conversationRunId: first.run.id, conversationIssueId: issue!.id,
            usage: { inputTokens: 100, outputTokens: 32 }, maximumMinor: expect.any(Number) });
          const secondReservations = await db.select().from(orchestrationModelReservations).where(and(
            eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.conversationRunId, second.run.id)));
          expect(secondReservations).toHaveLength(1);
          expect(secondReservations[0]).toMatchObject({ purpose: "conversation_model", status: "completed",
            conversationRunId: second.run.id, conversationIssueId: issue!.id,
            usage: { inputTokens: 100, outputTokens: 32 }, maximumMinor: expect.any(Number) });
          expect(providerCallCount).toBe(2);
          expect(replies).toEqual(new Map([[first.run.id, 1], [second.run.id, 1]]));
          const finalComments = await db.select({ id: issueComments.id, createdByRunId: issueComments.createdByRunId,
            body: issueComments.body, metadata: issueComments.metadata }).from(issueComments).where(and(
            eq(issueComments.companyId, companyId), eq(issueComments.issueId, issue!.id), eq(issueComments.authorType, "agent")));
          expect(finalComments).toHaveLength(2);
          expect(finalComments.map(({ createdByRunId, body }) => ({ createdByRunId, body })).sort((a, b) =>
            String(a.createdByRunId).localeCompare(String(b.createdByRunId)))).toEqual([
              { createdByRunId: first.run.id, body: "Native channel reply 1." },
              { createdByRunId: second.run.id, body: "Native channel reply 2." },
            ].sort((a, b) => a.createdByRunId.localeCompare(b.createdByRunId)));
          for (const final of finalComments) {
            expect(final.metadata).toMatchObject({ authorizationReason: "allow_chat_run_presentation" });
            const publications = await db.select().from(chatPublications).where(and(
              eq(chatPublications.companyId, companyId), eq(chatPublications.commentId, final.id)));
            expect(publications).toHaveLength(1);
            expect(publications[0]).toMatchObject({ state: "published", payload: { text: final.body } });
          }
          expect(publicationPosts.filter(value => value.text.startsWith("Native channel reply ")).sort((a, b) =>
            a.text.localeCompare(b.text))).toEqual([
              { threadId, text: "Native channel reply 1." },
              { threadId, text: "Native channel reply 2." },
            ]);

          // Revocation is a source-admission denial: the input may be retained, but it must not reserve or dispatch a model turn.
          await db.update(chatIdentityLinks).set({ status: "revoked", updatedAt: new Date() }).where(eq(chatIdentityLinks.id, identityLink.id));
          const beforeRevoked = providerCallCount;
          await send("1789000000.100103", "This revoked identity must not start a Native turn.");
          const revokeDeadline = Date.now() + 10_000;
          let thirdLink: typeof firstLink | undefined;
          while (Date.now() < revokeDeadline) {
            [thirdLink] = await db.select().from(chatMessageLinks).where(and(eq(chatMessageLinks.endpointId, endpoint.id),
              eq(chatMessageLinks.providerMessageId, "1789000000.100103"), eq(chatMessageLinks.direction, "inbound"))).limit(1);
            if (thirdLink) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          let thirdAction: typeof firstAction | undefined;
          if (thirdLink) {
            [thirdAction] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, endpoint.id),
              eq(chatActions.kind, "inbound_wakeup"), sql`${chatActions.payload}->>'commentId' = ${thirdLink.commentId}`)).limit(1);
            expect(thirdAction?.status).toBe("failed");
            const [thirdWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, thirdAction!.id)).limit(1);
            expect(thirdWake?.runId).toBeNull();
          }
          expect(providerCallCount).toBe(beforeRevoked);
          const issueRuns = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.nativeIssueId, issue!.id)));
          expect(issueRuns.map(run => run.id).sort()).toEqual([first.run.id, second.run.id].sort());
          const issueReservations = await db.select().from(orchestrationModelReservations).where(and(
            eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.conversationIssueId, issue!.id)));
          expect(issueReservations.map(reservation => reservation.conversationRunId).sort()).toEqual([first.run.id, second.run.id].sort());
        } finally {
          await heartbeat.drainActiveRunExecutions(); await service.shutdown();
        }
      },
    });
  }, 360_000);
});
