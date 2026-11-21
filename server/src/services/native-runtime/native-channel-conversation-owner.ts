import { and, eq, sql } from "drizzle-orm";
import { chatActions, issues, type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { readCanonicalInboundWakeupDbSource } from "./chat-inbound-wakeup-owner.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type NativeChannelConversationScope = {
  kind: "chat_channel_conversation";
  companyId: string;
  issueId: string;
  agentId: string;
  responsibleUserId: string;
  runId: string;
  conversationId: string;
  endpointId: string;
  deliveryId: string;
  principalId: string;
  sourceCommentId: string;
  sessionGeneration: number;
  provider: string;
  consumer: NativeChannelConversationConsumer;
};

export type NativeChannelConversationConsumer = "run_admission" | "live_token" | "live_tool_boundary" | "workspace" | "settlement" | "history_replay" | "retained_source";

export type NativeChannelConversationScopeInput = {
  companyId: string;
  issueId: string;
  agentId: string;
  responsibleUserId: string;
  runId: string;
  sessionGeneration: number;
  sourceCommentId: string;
  consumer: NativeChannelConversationConsumer;
};

/** Current Native projection of the same persisted inbound-wakeup DB owner used by chat admission. */
export async function readNativeChannelConversationScope(db: Db | DbTransaction,
  input: NativeChannelConversationScopeInput): Promise<NativeChannelConversationScope> {
  const deny = () => forbidden("The current linked-Human Native channel conversation is unavailable");
  if (!Number.isSafeInteger(input.sessionGeneration) || input.sessionGeneration < 1 || !input.responsibleUserId ||
      !input.sourceCommentId) throw deny();
  const actions = await db.select().from(chatActions).where(and(
    eq(chatActions.companyId, input.companyId), eq(chatActions.kind, "inbound_wakeup"),
    sql`${chatActions.payload}->>'issueId' = ${input.issueId}`,
    sql`${chatActions.payload}->>'agentId' = ${input.agentId}`,
    sql`${chatActions.payload}->>'commentId' = ${input.sourceCommentId}`,
    sql`${chatActions.payload}->>'sessionGeneration' = ${String(input.sessionGeneration)}`,
    sql`${chatActions.payload}->>'requestedByActorType' = 'user'`,
    sql`${chatActions.payload}->>'requestedByActorId' = ${input.responsibleUserId}`,
  )).limit(2);
  if (actions.length !== 1) throw deny();
  let owner;
  try {
    owner = await readCanonicalInboundWakeupDbSource(db, {
      action: actions[0]!, expectedIssueId: input.issueId, expectedAgentId: input.agentId,
      expectedCommentId: input.sourceCommentId, expectedUserId: input.responsibleUserId,
      requireLinkedHuman: true, requireNativeAgentEndpoint: input.consumer !== "retained_source",
      requireProcessedDelivery: true, requireCurrentRuntime: input.consumer !== "retained_source",
      allowHistoricalConversationState: input.consumer === "retained_source",
      allowHistoricalDestination: input.consumer === "retained_source",
      allowTerminalIssue: input.consumer === "retained_source",
      allowHistoricalAssignment: input.consumer === "retained_source",
    });
  } catch { throw deny(); }
  const mustBeCurrentRun = input.consumer !== "retained_source";
  if ((mustBeCurrentRun && owner.issue.executionRunId !== input.runId) ||
      owner.conversation.sessionGeneration !== input.sessionGeneration ||
      (input.consumer !== "retained_source" && owner.conversation.state !== "active" && owner.conversation.state !== "waiting")) throw deny();
  return { kind: "chat_channel_conversation", companyId: input.companyId, issueId: input.issueId,
    agentId: input.agentId, responsibleUserId: input.responsibleUserId, runId: input.runId,
    conversationId: owner.conversation.id, endpointId: owner.endpoint.id, deliveryId: owner.delivery.id,
    principalId: owner.action.principalId!, sourceCommentId: input.sourceCommentId,
    sessionGeneration: input.sessionGeneration, provider: owner.endpoint.provider, consumer: input.consumer };
}
