import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { authUsers, documentRevisions, foundationChangeProposals, foundationDocuments, type Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { assertV5Authorization } from "./v5-authorization.js";
import { authorizationService } from "./authorization.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { forbidden } from "../errors.js";

export const FOUNDATION_CONVERSATION_SOURCE = "conversation_authoring";
export type FoundationConversationSource = { id: string; companyId: string; sourceType: string; proposedByAgentId: string | null;
  conversationSourceRunId: string | null; conversationResponsibleUserId: string | null };

/** Retained provenance supplies no current read or approval authority. */
export async function assertFoundationConversationSource(db: Db, proposal: FoundationConversationSource, actor?: AuthorizationActor) {
  if (proposal.sourceType !== FOUNDATION_CONVERSATION_SOURCE && !proposal.conversationSourceRunId) return;
  if (!actor || !proposal.proposedByAgentId || !proposal.conversationResponsibleUserId ||
    !z.uuid().safeParse(proposal.conversationSourceRunId).success)
    throw forbidden("The Foundation proposal requires its current source reader");
  const userId = actor.type === "board" ? actor.userId : actor.onBehalfOfUserId;
  if (!userId || actor.type === "board" && actor.source === "local_implicit" || actor.type === "agent" && !actor.runId)
    throw forbidden("A current accountable Foundation reader is required");
  const [account] = await db.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id,userId));
  if (!account?.verified) throw forbidden("Current verified Foundation reading authority is required");
  await assertV5Authorization(db,{type:"board",source:"session",userId,ignoreInstanceAdmin:true},proposal.companyId,"foundation:read");
  if (actor.type === "agent" && !(await authorizationService(db).decide({ actor, action:"foundation:read",
    resource:{type:"company",companyId:proposal.companyId},enforceResponsibleUserIntersection:true })).allowed)
    throw forbidden("Current Agent Foundation reading authority is required");
  const [source] = await db.execute<{ erased: boolean }>(sql`select aw_conversation_foundation_proposal_erased(
    ${proposal.companyId}::uuid,${proposal.id}::uuid) as erased`);
  if (source?.erased !== false) throw forbidden("The Foundation conversation source is unavailable");
  await assertAnalyticalContextPayloadAccess(db, proposal.companyId, actor, { runId: proposal.conversationSourceRunId! });
}

const sourceReview = new AsyncLocalStorage<{ active: Set<string>; deadline: number }>();
/** Exact retained proposal identities follow accepted and subsequent Native
 * revisions. A missing actor, source, cycle or excessive review is withheld. */
export async function assertFoundationRevisionConversationSources(db: Db, companyId: string, revisionId: string, actor?: AuthorizationActor) {
  const [revision] = await db.select({ ids: documentRevisions.conversationFoundationProposalIds, documentId: documentRevisions.documentId }).from(documentRevisions)
    .where(and(eq(documentRevisions.companyId,companyId),eq(documentRevisions.id,revisionId)));
  const [erased]=await db.execute<{erased:boolean}>(sql`select exists(select 1 from memory_deletion_markers m
    where m.company_id=${companyId}::uuid and m.kind='source' and m.key=${`conversation-foundation-revision-erasure:v1:${revisionId}`}) as erased`);
  if(erased?.erased)throw forbidden("The retained Foundation revision was erased");
  if (!revision || !revision.ids.length) return;
  if (revision.ids.length>32 || new Set(revision.ids).size!==revision.ids.length || revision.ids.some(id=>!z.uuid().safeParse(id).success))
    throw forbidden("The complete Foundation revision source review is unavailable");
  const state=sourceReview.getStore()??{active:new Set<string>(),deadline:performance.now()+8000};
  if (state.active.has(revisionId)||performance.now()>state.deadline)
    throw forbidden("The Foundation revision contains cyclic or excessive source dependencies");
  const review=async()=>{
    state.active.add(revisionId);
    try {
      for (const id of revision.ids) {
        if (performance.now()>state.deadline) throw forbidden("The complete Foundation source review exceeded its budget");
        const [proposal]=await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id,id));
        if (!proposal || proposal.companyId!==companyId || proposal.sourceType!==FOUNDATION_CONVERSATION_SOURCE)
          throw forbidden("The exact retained Foundation proposal source is unavailable");
        const [target]=await db.select({documentId:foundationDocuments.documentId}).from(foundationDocuments)
          .where(and(eq(foundationDocuments.companyId,companyId),eq(foundationDocuments.id,proposal.foundationDocumentId)));
        if(target?.documentId!==revision.documentId)throw forbidden("The retained proposal belongs to another Foundation document");
        await assertFoundationConversationSource(db,proposal,actor);
      }
    } finally {state.active.delete(revisionId);}
  };
  return sourceReview.getStore()?review():sourceReview.run(state,review);
}
