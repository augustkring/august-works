import { and, eq, sql } from "drizzle-orm";
import { chatActions, chatConversations, chatDeliveries, chatEndpointResources, chatEndpoints,
  chatExternalPrincipals, chatIdentityLinks, chatMessageLinks, companyMemberships, issues, toolConnections,
  type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { credentialFingerprint, runtimeGeneration } from "../chat-runtime-fence.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type InboundWakeupAction = typeof chatActions.$inferSelect;
export type CanonicalInboundWakeupDbSource = {
  action: InboundWakeupAction;
  issue: typeof issues.$inferSelect;
  endpoint: typeof chatEndpoints.$inferSelect;
  delivery: typeof chatDeliveries.$inferSelect;
  conversation: typeof chatConversations.$inferSelect;
  responsibleUserId: string | null;
  sourceCommentId: string;
  runtimeGeneration: number;
  runtimeCredentialFingerprint: string;
};

/**
 * DB-only portion shared by chat inbound wake admission and Native continuation
 * currentness. Live SDK callback/runtime identity stays with authorizeInboundWakeup.
 */
export async function readCanonicalInboundWakeupDbSource(db: Db | DbTransaction, input: {
  action: InboundWakeupAction;
  expectedIssueId: string;
  expectedAgentId: string;
  expectedCommentId: string;
  expectedUserId: string | null;
  requireLinkedHuman?: boolean;
  requireNativeAgentEndpoint?: boolean;
  requireProcessedDelivery?: boolean;
  requireCurrentRuntime?: boolean;
  allowHistoricalConversationState?: boolean;
  allowHistoricalDestination?: boolean;
  allowTerminalIssue?: boolean;
  allowHistoricalAssignment?: boolean;
  allowTerminalAction?: boolean;
  allowEarlyAction?: boolean;
  allowDeletedSource?: boolean;
}): Promise<CanonicalInboundWakeupDbSource> {
  const deny = () => forbidden("The accepted inbound chat source is no longer current", {
    code: "chat_action_authorization_changed",
  });
  const { action } = input;
  const payload = action.payload;
  const expectedActorType = input.expectedUserId === null ? "system" : "user";
  const allowedActionStatuses = ["processing", "processed", ...(input.allowEarlyAction ? ["preparing", "issued"] : []),
    ...(input.allowTerminalAction ? ["failed"] : [])];
  if (payload.version !== 1 || payload.issueId !== input.expectedIssueId || payload.agentId !== input.expectedAgentId ||
      payload.commentId !== input.expectedCommentId || payload.requestedByActorType !== expectedActorType ||
      typeof payload.requestedByActorId !== "string" ||
      (input.expectedUserId !== null && payload.requestedByActorId !== input.expectedUserId) ||
      (input.expectedUserId === null && payload.requestedByActorId !== action.principalId) ||
      !action.conversationId || !action.deliveryId || !action.principalId || !allowedActionStatuses.includes(action.status)) throw deny();
  const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, action.companyId), eq(issues.id, input.expectedIssueId))).limit(1);
  if (!issue || issue.originKind !== "chat_channel" || issue.parentId !== null ||
      (!input.allowHistoricalAssignment && issue.assigneeAgentId !== input.expectedAgentId) ||
      (!input.allowTerminalIssue && ["backlog", "done", "cancelled"].includes(issue.status))) throw deny();
  const [endpoint] = await db.select().from(chatEndpoints).where(and(eq(chatEndpoints.companyId, action.companyId),
    eq(chatEndpoints.id, action.endpointId))).limit(1);
  const [delivery] = await db.select().from(chatDeliveries).where(and(eq(chatDeliveries.companyId, action.companyId),
    eq(chatDeliveries.id, action.deliveryId))).limit(1);
  if (!endpoint || (!input.allowHistoricalAssignment && endpoint.assignedAgentId !== input.expectedAgentId) || !delivery ||
      (input.requireProcessedDelivery && delivery.state !== "processed") ||
      delivery.endpointId !== endpoint.id || delivery.conversationId !== action.conversationId ||
      delivery.principalId !== action.principalId) throw deny();
  const conversationId = action.conversationId;
  const [conversation] = await db.select().from(chatConversations).where(and(eq(chatConversations.companyId, action.companyId),
    eq(chatConversations.id, conversationId))).limit(1);
  if (!conversation || conversation.endpointId !== endpoint.id || conversation.issueId !== issue.id ||
      conversation.sessionGeneration !== payload.sessionGeneration ||
      (!input.allowHistoricalConversationState && !["active", "waiting"].includes(conversation.state)) ||
      issue.originId !== `${endpoint.id}:${conversation.externalThreadId}:${conversation.sessionGeneration}`) throw deny();
  const [resource] = conversation.resourceId ? await db.select().from(chatEndpointResources).where(and(
    eq(chatEndpointResources.endpointId, endpoint.id), eq(chatEndpointResources.id, conversation.resourceId))).limit(1) : [];
  const destinationAllowed = conversation.isDirectMessage ? endpoint.allowDirectMessages : Boolean(resource && resource.availability === "available" &&
    (endpoint.provider === "microsoft-teams" && resource.type === "group_chat" ? endpoint.allowGroupChats : resource.enabled));
  if (!input.allowHistoricalDestination && !destinationAllowed) throw deny();
  if (input.requireNativeAgentEndpoint) {
    if (endpoint.status !== "active" || endpoint.externalExecutionPolicy !== "agent" || !endpoint.providerAccountId) throw deny();
    const [connection] = await db.select().from(toolConnections).where(and(eq(toolConnections.companyId, action.companyId),
      eq(toolConnections.id, endpoint.connectionId))).limit(1);
    if (!connection || connection.connectionPurpose !== "channel" || connection.status !== "active" || !connection.enabled ||
        connection.healthStatus !== "healthy") throw deny();
  }
  const [source] = await db.select({ deliveryId: chatMessageLinks.deliveryId, commentId: chatMessageLinks.commentId,
      providerMessageId: chatMessageLinks.providerMessageId, normalizedEvent: chatDeliveries.normalizedEvent,
      principalId: chatExternalPrincipals.id, principalProvider: chatExternalPrincipals.provider,
      principalProviderAccountId: chatExternalPrincipals.providerAccountId,
      principalKind: chatExternalPrincipals.kind, principalIsBot: chatExternalPrincipals.isBot,
      linkStatus: chatIdentityLinks.status, linkedUserId: chatIdentityLinks.paperclipUserId,
      authorUserId: sql<string | null>`(select c.author_user_id from issue_comments c where c.company_id=${action.companyId}::uuid and c.issue_id=${issue.id}::uuid and c.id=${chatMessageLinks.commentId}::uuid)`,
      deletedAt: sql<Date | null>`(select c.deleted_at from issue_comments c where c.company_id=${action.companyId}::uuid and c.issue_id=${issue.id}::uuid and c.id=${chatMessageLinks.commentId}::uuid)`,
    }).from(chatMessageLinks)
    .innerJoin(chatDeliveries, and(eq(chatDeliveries.companyId, chatMessageLinks.companyId), eq(chatDeliveries.id, chatMessageLinks.deliveryId)))
    .innerJoin(chatExternalPrincipals, and(eq(chatExternalPrincipals.companyId, chatDeliveries.companyId), eq(chatExternalPrincipals.id, chatDeliveries.principalId)))
    .leftJoin(chatIdentityLinks, and(eq(chatIdentityLinks.companyId, chatExternalPrincipals.companyId),
      eq(chatIdentityLinks.endpointId, endpoint.id), eq(chatIdentityLinks.principalId, chatExternalPrincipals.id)))
    .where(and(eq(chatMessageLinks.companyId, action.companyId), eq(chatMessageLinks.endpointId, endpoint.id),
      eq(chatMessageLinks.conversationId, conversation.id), eq(chatMessageLinks.deliveryId, delivery.id),
      eq(chatMessageLinks.commentId, input.expectedCommentId), eq(chatMessageLinks.direction, "inbound"),
      input.requireProcessedDelivery ? eq(chatDeliveries.state, "processed") : undefined,
      eq(chatExternalPrincipals.id, action.principalId))).limit(1);
  const expectedUserId = input.expectedUserId;
  if (!source || source.deliveryId !== delivery.id || source.commentId !== input.expectedCommentId ||
      source.authorUserId !== expectedUserId || source.principalProvider !== endpoint.provider ||
      (!input.allowHistoricalAssignment && source.principalProviderAccountId !== endpoint.providerAccountId) ||
      (source.deletedAt && !input.allowDeletedSource) || (input.requireLinkedHuman &&
        (expectedUserId === null || source.principalKind !== "user" || source.principalIsBot ||
         source.linkStatus !== "linked" || source.linkedUserId !== expectedUserId))) throw deny();
  if (input.requireLinkedHuman) {
    const [membership] = await db.select({ status: companyMemberships.status, membershipRole: companyMemberships.membershipRole })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, action.companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, expectedUserId!))).limit(1);
    if (membership?.status !== "active" || membership.membershipRole === "viewer") throw deny();
  }
  const eventRoot = delivery.normalizedEvent && typeof delivery.normalizedEvent === "object" && !Array.isArray(delivery.normalizedEvent)
    ? delivery.normalizedEvent as Record<string, unknown> : {};
  const runtime = eventRoot.runtimeContext && typeof eventRoot.runtimeContext === "object" && !Array.isArray(eventRoot.runtimeContext)
    ? eventRoot.runtimeContext as Record<string, unknown> : {};
  const refs = input.requireNativeAgentEndpoint ? await db.select({ refs: toolConnections.credentialSecretRefs }).from(toolConnections)
    .where(and(eq(toolConnections.companyId, action.companyId), eq(toolConnections.id, endpoint.connectionId))).then(rows => rows[0]?.refs ?? []) : [];
  const currentFingerprint = credentialFingerprint(refs);
  const generation = runtimeGeneration(endpoint.setup);
  if (typeof runtime.credentialFingerprint !== "string" ||
      (input.requireCurrentRuntime && (!Number.isSafeInteger(runtime.generation) || runtime.generation !== generation ||
        runtime.credentialFingerprint !== currentFingerprint))) throw deny();
  const event = eventRoot;
  const eventConversation = event.conversation && typeof event.conversation === "object" ? event.conversation as Record<string, unknown> : {};
  const eventMessage = event.message && typeof event.message === "object" ? event.message as Record<string, unknown> : {};
  if (eventConversation.externalThreadId !== conversation.externalThreadId || eventMessage.providerMessageId !== source.providerMessageId) throw deny();
  return { action, issue, endpoint, delivery, conversation, responsibleUserId: expectedUserId,
    sourceCommentId: input.expectedCommentId, runtimeGeneration: generation,
    runtimeCredentialFingerprint: runtime.credentialFingerprint as string };
}
