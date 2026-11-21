import { and, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  chatActions,
  chatExternalPrincipals,
  chatIdentityLinks,
  companyMemberships,
  heartbeatRuns,
  issues,
  issueComments,
  runIdentityContexts,
  type chatEndpoints,
  type chatConversations,
  type chatPublications,
  type Db,
} from "@paperclipai/db";
import { HttpError } from "../errors.js";
import { canActorReadIssuePrivacy, pinCurrentBoardActor } from "./authorization.js";
import { authorizeSlackChannel } from "./connectors/slack-access.js";
import { slackClient } from "./connectors/slack-client.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Pick<Db | DbTransaction, "select" | "transaction">;
type Endpoint = typeof chatEndpoints.$inferSelect;

export async function slackBoardAuthor(db: Pick<Db | DbTransaction, "select">, endpoint: Endpoint, userId: string) {
  const links = await db
    .select({ principal: chatExternalPrincipals })
    .from(chatIdentityLinks)
    .innerJoin(chatExternalPrincipals, and(
      eq(chatExternalPrincipals.id, chatIdentityLinks.principalId),
      eq(chatExternalPrincipals.companyId, endpoint.companyId),
      eq(chatExternalPrincipals.provider, "slack"),
      eq(chatExternalPrincipals.providerAccountId, endpoint.providerAccountId ?? ""),
      eq(chatExternalPrincipals.isBot, false),
    ))
    .innerJoin(companyMemberships, and(
      eq(companyMemberships.companyId, endpoint.companyId),
      eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId),
      eq(companyMemberships.status, "active"),
      ne(companyMemberships.membershipRole, "viewer"),
    ))
    .where(and(
      eq(chatIdentityLinks.companyId, endpoint.companyId),
      eq(chatIdentityLinks.endpointId, endpoint.id),
      eq(chatIdentityLinks.paperclipUserId, userId),
      eq(chatIdentityLinks.status, "linked"),
      isNull(chatIdentityLinks.revokedAt),
    ))
    .limit(2);
  return links.length === 1 ? links[0]!.principal : null;
}

/** Recheck the author of a durable Board receipt immediately before transport.
 * The source comment/run supplies identity; publication text never does. */
export async function authorizeSlackBoardPublication(
  db: Reader,
  endpoint: Endpoint,
  conversation: typeof chatConversations.$inferSelect,
  publication: typeof chatPublications.$inferSelect,
  botToken: string,
  fetchImpl: typeof fetch,
  options: { allowDeletedSource?: boolean } = {},
) {
  if (!publication.commentId) return true;
  const [source] = await db
    .select({ comment: issueComments, run: heartbeatRuns })
    .from(issueComments)
    .leftJoin(heartbeatRuns, and(
      eq(heartbeatRuns.id, issueComments.createdByRunId),
      eq(heartbeatRuns.companyId, endpoint.companyId),
    ))
    .where(and(
      eq(issueComments.id, publication.commentId),
      eq(issueComments.companyId, endpoint.companyId),
      eq(issueComments.issueId, publication.issueId),
    ));
  if (!source) return false;
  let userId = source.comment.authorUserId;
  let commentIds = [source.comment.id];
  if (source.comment.authorType !== "user") {
    if (source.run) {
      // Use immutable attribution as of this response, not the run's mutable
      // current user or a newer Board receipt on the same task. Recovery contexts
      // inherit their original message through parentContextId.
      let [identity] = await db.select().from(runIdentityContexts).where(and(
        eq(runIdentityContexts.companyId, endpoint.companyId),
        eq(runIdentityContexts.runId, source.run.id),
        eq(runIdentityContexts.status, "accepted"),
        lte(runIdentityContexts.createdAt, source.comment.createdAt),
      )).orderBy(desc(runIdentityContexts.revision)).limit(1);
      userId = identity?.responsibleUserId ?? source.run.responsibleUserId;
      commentIds = [];
      for (let depth = 0; identity && depth < 32; depth++) {
        if (identity.responsibleUserId !== userId) break;
        if (identity.messageId) { commentIds.push(identity.messageId); break; }
        if (!identity.parentContextId) break;
        [identity] = await db.select().from(runIdentityContexts).where(and(
          eq(runIdentityContexts.id, identity.parentContextId),
          eq(runIdentityContexts.companyId, endpoint.companyId),
          eq(runIdentityContexts.status, "accepted"),
        )).limit(1);
      }
      if (!commentIds.length) {
        const snapshot = source.run.contextSnapshot ?? {};
        commentIds = [snapshot.wakeCommentId, snapshot.commentId, ...(Array.isArray(snapshot.wakeCommentIds) ? snapshot.wakeCommentIds : [])]
          .filter((id): id is string => typeof id === "string");
      }
    }
  }
  let receipt: { payload: typeof chatActions.$inferSelect.payload; status: string } | undefined;
  if (userId && commentIds.length) {
    [receipt] = await db
      .select({ payload: chatActions.payload, status: chatActions.status })
      .from(chatActions)
      .where(and(
        eq(chatActions.companyId, endpoint.companyId),
        eq(chatActions.endpointId, endpoint.id),
        eq(chatActions.conversationId, conversation.id),
        eq(chatActions.kind, "slack_board_message"),
        eq(sql<string>`${chatActions.payload}->>'userId'`, userId),
        eq(sql<string>`${chatActions.payload}->>'issueId'`, publication.issueId),
        inArray(sql<string>`${chatActions.payload}->>'commentId'`, commentIds),
      ))
      .orderBy(desc(chatActions.createdAt))
      .limit(1);
  }
  if (receipt?.status === "cancelled" || (source.comment.deletedAt && !options.allowDeletedSource)) return false;
  const [task] = await db
    .select({ id: issues.id, companyId: issues.companyId })
    .from(issues)
    .where(and(
      eq(issues.id, publication.issueId),
      eq(issues.companyId, endpoint.companyId),
    ))
    .limit(1);
  if (!task) return false;
  const publiclyReadable = await canActorReadIssuePrivacy(db as Db, { type: "none" }, task);
  let principal: Awaited<ReturnType<typeof slackBoardAuthor>> = null;
  if (!publiclyReadable || receipt) {
    if (!userId) return false;
    principal = await slackBoardAuthor(db, endpoint, userId);
    if (!principal || (receipt && receipt.payload.principalId !== principal.id) || (receipt && !botToken)) return false;
    const linkedActor = { type: "board" as const, source: "chat_link" as const, userId,
      companyIds: [endpoint.companyId], chatLink: {
        companyId: endpoint.companyId, endpointId: endpoint.id, principalId: principal.id, provider: "slack" as const,
      } };
    const readableByLinkedHuman = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTransaction;
      const pinned = await pinCurrentBoardActor(tx as unknown as Db, linkedActor);
      return Boolean(pinned && await canActorReadIssuePrivacy(tx as unknown as Db, pinned.actor, task));
    });
    if (!readableByLinkedHuman) return false;
  }
  if (!receipt) return true;
  if (!principal || !botToken) return false;
  try {
    await authorizeSlackChannel(
      { endpoint, slackUserId: principal.externalId },
      slackClient(botToken, fetchImpl),
      conversation.externalConversationId.replace(/^slack:/, ""),
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return false;
    throw error;
  }
  return true;
}
