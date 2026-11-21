import { and, eq, sql } from "drizzle-orm";
import { chatActions, chatConversations, chatDeliveries, chatEndpointResources, chatEndpoints,
  chatExternalPrincipals, chatIdentityLinks, chatMessageLinks, chatGitHubResourceMigrations, companyMemberships, issues, toolConnections,
  type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { credentialFingerprint, runtimeGeneration } from "../chat-runtime-fence.js";
import { canonicalTeamsThreadId } from "../chat-control-chronology.js";
import { parseGitHubReviewThreadIdentity } from "../chat-github-thread-id.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function sameThreadIdentity(provider: string, left: string, right: string): boolean {
  if (left === right) return true;
  if (provider !== "microsoft-teams") return false;
  const canonicalLeft = canonicalTeamsThreadId(left);
  return canonicalLeft !== null && canonicalLeft === canonicalTeamsThreadId(right);
}

// A processed Telegram migration lifecycle delivery is the durable provider
// receipt for this exact old-resource -> new-resource edge. Bound traversal
// and refuse ambiguous branches; never infer aliases from resource metadata.
async function telegramMigrationLineageMatches(
  db: Db | DbTransaction,
  companyId: string,
  endpointId: string,
  oldThreadId: string,
  currentThreadId: string,
): Promise<boolean> {
  const parse = (value: string) => {
    const match = /^telegram:([^:]+)(.*)$/.exec(value);
    if (!match || (match[2] !== "" && !match[2].startsWith(":"))) return null;
    return { resourceId: match[1]!, suffix: match[2] };
  };
  const oldIdentity = parse(oldThreadId);
  const currentIdentity = parse(currentThreadId);
  if (!oldIdentity || !currentIdentity || oldIdentity.suffix !== currentIdentity.suffix) return false;
  if (oldIdentity.resourceId === currentIdentity.resourceId) return true;

  let resourceId = oldIdentity.resourceId;
  const visited = new Set<string>();
  for (let hop = 0; hop < 32; hop += 1) {
    if (visited.has(resourceId)) return false;
    visited.add(resourceId);
    const edges = await db.selectDistinct({
      target: sql<string>`${chatDeliveries.normalizedEvent}->'lifecycle'->>'providerResourceId'`,
    }).from(chatDeliveries).where(and(
      eq(chatDeliveries.companyId, companyId),
      eq(chatDeliveries.endpointId, endpointId),
      eq(chatDeliveries.state, "processed"),
      eq(chatDeliveries.eventKind, "installation"),
      sql`${chatDeliveries.normalizedEvent}->'lifecycle'->>'provider' = 'telegram'`,
      sql`${chatDeliveries.normalizedEvent}->'lifecycle'->>'kind' = 'resource'`,
      sql`${chatDeliveries.normalizedEvent}->'lifecycle'->>'resourceType' = 'chat'`,
      sql`${chatDeliveries.normalizedEvent}->'lifecycle'->>'previousProviderResourceId' = ${resourceId}`,
    )).limit(2);
    if (edges.length !== 1 || typeof edges[0]!.target !== "string" ||
        edges[0]!.target.length === 0 || edges[0]!.target.includes(":")) return false;
    resourceId = edges[0]!.target;
    if (resourceId === currentIdentity.resourceId) return true;
  }
  return false;
}

async function githubRepositoryMigrationLineageMatches(
  db: Db | DbTransaction,
  input: { companyId: string; endpointId: string; resourceId: string; oldRepository: string; currentRepository: string },
): Promise<boolean> {
  const coordinate = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  if (!coordinate.test(input.oldRepository) || !coordinate.test(input.currentRepository)) return false;
  const [resource] = await db.select({
    endpointId: chatEndpointResources.endpointId,
    type: chatEndpointResources.type,
    providerResourceId: chatEndpointResources.providerResourceId,
    providerRepositoryId: sql<string | null>`${chatEndpointResources.metadata}->>'providerRepositoryId'`,
  }).from(chatEndpointResources).where(and(
    eq(chatEndpointResources.companyId, input.companyId),
    eq(chatEndpointResources.endpointId, input.endpointId),
    eq(chatEndpointResources.id, input.resourceId),
  )).limit(1);
  if (!resource || resource.type !== "repository" ||
      resource.providerRepositoryId === null || !/^[0-9]+$/.test(resource.providerRepositoryId) ||
      resource.providerResourceId.toLowerCase() !== input.currentRepository.toLowerCase()) return false;
  let repository = input.oldRepository.toLowerCase();
  const target = input.currentRepository.toLowerCase();
  const visited = new Set<string>();
  for (let hop = 0; hop < 32; hop += 1) {
    if (visited.has(repository)) return false;
    visited.add(repository);
    const edges = await db.selectDistinct({
      target: sql<string>`lower(${chatGitHubResourceMigrations.toRepository})`,
    }).from(chatGitHubResourceMigrations).where(and(
      eq(chatGitHubResourceMigrations.companyId, input.companyId),
      eq(chatGitHubResourceMigrations.endpointId, input.endpointId),
      eq(chatGitHubResourceMigrations.resourceId, input.resourceId),
      eq(chatGitHubResourceMigrations.providerRepositoryId, resource.providerRepositoryId),
      sql`lower(${chatGitHubResourceMigrations.fromRepository}) = ${repository}`,
    )).limit(2);
    if (edges.length !== 1 || typeof edges[0]!.target !== "string" || !coordinate.test(edges[0]!.target)) return false;
    repository = edges[0]!.target.toLowerCase();
    if (repository === target) return true;
  }
  return false;
}

async function githubThreadMigrationLineageMatches(
  db: Db | DbTransaction, companyId: string, endpointId: string, resourceId: string,
  oldThreadId: string, currentThreadId: string,
): Promise<boolean> {
  const parse = (value: string) => {
    const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(:.*)?$/.exec(value);
    return match ? { repository: match[1]!, suffix: match[2] ?? "" } : null;
  };
  const oldIdentity = parse(oldThreadId);
  const currentIdentity = parse(currentThreadId);
  if (!oldIdentity || !currentIdentity || oldIdentity.suffix !== currentIdentity.suffix) return false;
  return githubRepositoryMigrationLineageMatches(db, {
    companyId, endpointId, resourceId, oldRepository: oldIdentity.repository,
    currentRepository: currentIdentity.repository,
  });
}

function issueOriginThreadId(originId: string | null, endpointId: string, generation: number): string | null {
  const prefix = `${endpointId}:`;
  const suffix = `:${generation}`;
  if (!originId?.startsWith(prefix) || !originId.endsWith(suffix) || originId.length <= prefix.length + suffix.length) return null;
  return originId.slice(prefix.length, -suffix.length);
}

// The provider-owned publication lease commits this child row and returned URL
// together. Check that earliest durable mapping, before later review projections.
async function githubFindingThreadHasPublishedOwner(db: Db | DbTransaction, input: {
  companyId: string;
  endpointId: string;
  issueId: string;
  resourceId: string | null;
  externalConversationId: string;
  sessionGeneration: number;
  issueOriginId: string | null;
  childThreadId: string;
  providerUrl: string | null;
  allowHistoricalConversationState: boolean;
}): Promise<boolean | null> {
  const child = parseGitHubReviewThreadIdentity(input.childThreadId);
  if (!child?.reviewCommentId) return null;
  if (child.issue || !input.resourceId || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(child.repository) ||
      !Number.isSafeInteger(Number(child.number)) || !Number.isSafeInteger(Number(child.reviewCommentId))) return false;
  const [resource] = await db.select({ id: chatEndpointResources.id, providerResourceId: chatEndpointResources.providerResourceId })
    .from(chatEndpointResources).where(and(eq(chatEndpointResources.companyId, input.companyId),
      eq(chatEndpointResources.endpointId, input.endpointId), eq(chatEndpointResources.id, input.resourceId),
      eq(chatEndpointResources.type, "repository"))).limit(1);
  if (!resource || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(resource.providerResourceId)) return false;
  const rootThreadId = `github:${resource.providerResourceId}:${child.number}`;
  const rootCandidates = await db.select({
    id: chatConversations.id,
    resourceId: chatConversations.resourceId,
    externalConversationId: chatConversations.externalConversationId,
    sessionGeneration: chatConversations.sessionGeneration,
    state: chatConversations.state,
  }).from(chatConversations).where(and(
    eq(chatConversations.companyId, input.companyId),
    eq(chatConversations.endpointId, input.endpointId),
    eq(chatConversations.issueId, input.issueId),
    sql`lower(${chatConversations.externalThreadId}) = ${rootThreadId.toLowerCase()}`,
  )).limit(2);
  // A PR comment can start its own chat task. Only apply child-thread lineage
  // rules when this exact Paperclip issue also owns the parent conversation.
  if (!rootCandidates.length) return null;
  if (rootCandidates.length > 1) return false;
  const rootConversation = rootCandidates.find((root) => root.resourceId === input.resourceId &&
    root.externalConversationId === input.externalConversationId && root.sessionGeneration === input.sessionGeneration &&
    (input.allowHistoricalConversationState || ["active", "waiting"].includes(root.state)));
  if (!rootConversation || child.repository.toLowerCase() !== resource.providerResourceId.toLowerCase()) return false;
  let providerUrl: URL;
  try { providerUrl = new URL(input.providerUrl ?? ""); } catch { return false; }
  const expectedPath = `/${resource.providerResourceId}/pull/${child.number}`;
  if (providerUrl.protocol !== "https:" || providerUrl.hostname !== "github.com" || providerUrl.port ||
      providerUrl.username || providerUrl.password || providerUrl.search || providerUrl.pathname.toLowerCase() !== expectedPath.toLowerCase() ||
      providerUrl.hash !== `#discussion_r${child.reviewCommentId}` ||
      issueOriginThreadId(input.issueOriginId, input.endpointId, input.sessionGeneration)?.toLowerCase() !== rootThreadId.toLowerCase()) return false;
  return true;
}

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
      (!input.allowHistoricalConversationState && !["active", "waiting"].includes(conversation.state))) throw deny();
  const originThreadId = issueOriginThreadId(issue.originId, endpoint.id, conversation.sessionGeneration);
  const originMatches = originThreadId === conversation.externalThreadId ||
    (endpoint.provider === "microsoft-teams" && sameThreadIdentity(endpoint.provider, originThreadId ?? "", conversation.externalThreadId));
  const findingThreadOwner = endpoint.provider === "github"
    ? await githubFindingThreadHasPublishedOwner(db, {
        companyId: action.companyId, endpointId: endpoint.id, issueId: issue.id, resourceId: conversation.resourceId,
        externalConversationId: conversation.externalConversationId, sessionGeneration: conversation.sessionGeneration,
        issueOriginId: issue.originId, childThreadId: conversation.externalThreadId, providerUrl: conversation.providerUrl,
        allowHistoricalConversationState: input.allowHistoricalConversationState === true,
      })
    : null;
  if (findingThreadOwner === false || (!originMatches && findingThreadOwner !== true)) throw deny();
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
  const eventThreadId = eventConversation.externalThreadId;
  const sameThread = typeof eventThreadId === "string" &&
    sameThreadIdentity(endpoint.provider, eventThreadId, conversation.externalThreadId);
  const migratedTelegramThread = !sameThread && endpoint.provider === "telegram" &&
    typeof eventThreadId === "string" && await telegramMigrationLineageMatches(
      db, action.companyId, endpoint.id, eventThreadId, conversation.externalThreadId,
    );
  const migratedGitHubThread = !sameThread && endpoint.provider === "github" &&
    typeof eventThreadId === "string" && conversation.resourceId !== null &&
    await githubThreadMigrationLineageMatches(db, action.companyId, endpoint.id, conversation.resourceId,
      eventThreadId, conversation.externalThreadId);
  if (typeof eventThreadId !== "string" || (!sameThread && !migratedTelegramThread && !migratedGitHubThread) ||
      eventMessage.providerMessageId !== source.providerMessageId) throw deny();
  return { action, issue, endpoint, delivery, conversation, responsibleUserId: expectedUserId,
    sourceCommentId: input.expectedCommentId, runtimeGeneration: generation,
    runtimeCredentialFingerprint: runtime.credentialFingerprint as string };
}
