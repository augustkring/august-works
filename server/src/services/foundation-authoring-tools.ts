import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { documents, foundationChangeProposals, foundationDocuments, type Db } from "@paperclipai/db";
import { foundationAuthoringProposeInputSchema } from "@paperclipai/shared";
import { assertConversationRoutineAuthoring } from "./routine-authoring-authority.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { authorizationService } from "./authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { approvedFoundationView, foundationService } from "./foundation/foundation-service.js";
import { FOUNDATION_CONVERSATION_SOURCE, assertFoundationConversationSource } from "./foundation-authoring-source.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "./v7-mutations.js";
import { conflict, forbidden, notFound } from "../errors.js";

/** Pending Original proposals only. The Human review does not happen here. */
export function foundationAuthoringToolsService(db: Db) {
  return { propose: async (context: { companyId: string; agentId: string; runId: string }, raw: unknown) => {
    const input = foundationAuthoringProposeInputSchema.parse(raw);
    return withV7ActivityTransaction(db, async (tx, publications) => {
      await lockAnalyticalCompany(tx, context.companyId); await lockMemoryPrivacy(tx, context.companyId);
      if ((await instanceSettingsService(tx).getExperimental()).enableFoundationV1 !== true) throw notFound("Foundation is not enabled");
      const current = await assertConversationRoutineAuthoring(tx, context, "foundation:propose");
      const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: context.companyId,
        agentId: context.agentId, runId: context.runId, onBehalfOfUserId: current.responsibleUserId };
      await assertV5Authorization(tx, { type: "board", source: "session", userId: current.responsibleUserId,
        ignoreInstanceAdmin: true }, context.companyId, "foundation:read");
      if (!(await authorizationService(tx).decide({ actor, action: "foundation:read",
        resource: { type: "company", companyId: context.companyId }, enforceResponsibleUserIntersection: true })).allowed)
        throw forbidden("Current Foundation reading authority is required");
      const [target] = await tx.select({ id: foundationDocuments.id, documentId: documents.id, revisionId: documents.latestRevisionId })
        .from(foundationDocuments).innerJoin(documents, and(eq(documents.companyId, foundationDocuments.companyId),
          eq(documents.id, foundationDocuments.documentId)))
        .where(and(eq(foundationDocuments.companyId, context.companyId), eq(foundationDocuments.id, input.foundationDocumentId))).for("share");
      if (!target) throw notFound("The Original Foundation document is unavailable");
      const view = await foundationService(tx).get(context.companyId, target.id, actor);
      const approved = view ? approvedFoundationView(view) : null;
      if (!approved) throw forbidden("Conversation proposals require the currently approved Foundation view");
      const hex = createHash("sha256").update(JSON.stringify(["aw-conversation-foundation-v1", context.companyId,
        context.agentId, current.conversation.id, current.conversation.conversationSessionGeneration, input.idempotencyKey])).digest("hex").slice(0,32);
      const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${((parseInt(hex[16]!,16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20)}`;
      const [previous] = await tx.select().from(foundationChangeProposals).where(and(
        eq(foundationChangeProposals.companyId, context.companyId), eq(foundationChangeProposals.id, id))).for("share");
      let proposal = previous;
      if (previous) {
        if (previous.sourceType !== FOUNDATION_CONVERSATION_SOURCE || previous.proposedByAgentId !== context.agentId ||
          previous.conversationResponsibleUserId !== current.responsibleUserId || previous.foundationDocumentId !== target.id ||
          previous.baseRevisionId !== input.baseRevisionId || previous.proposedBody !== input.proposedBody ||
          previous.changeSummary !== input.changeSummary || previous.reason !== input.reason)
          throw conflict("The Foundation proposal request changed; use a new request identity");
        await assertFoundationConversationSource(tx, previous, actor);
      } else {
        if (target.revisionId !== input.baseRevisionId || approved.latestRevisionId !== input.baseRevisionId)
          throw conflict("Review the current Foundation revision before proposing this change");
        proposal = await foundationService(tx).createProposal(context.companyId, target.id, {
          sourceType: FOUNDATION_CONVERSATION_SOURCE, sourceId: context.runId, baseRevisionId: input.baseRevisionId,
          proposedBody: input.proposedBody, changeSummary: input.changeSummary, reason: input.reason,
        }, { principal: { type: "agent", agentId: context.agentId, responsibleUserId: current.responsibleUserId }, runId: context.runId },
          { idOverride: id, conversationDraftRunId: context.runId });
        await logActivity(tx, { companyId: context.companyId, actorType: "agent", actorId: context.agentId,
          agentId: context.agentId, runId: context.runId, action: "foundation.conversation_proposal_created",
          entityType: "foundation_change_proposal", entityId: id, details: { foundationDocumentId: target.id,
            baseRevisionId: input.baseRevisionId, status: "pending", canonicalChanged: false } }, publications);
      }
      await assertConversationRoutineAuthoring(tx, context, "foundation:propose");
      if (!proposal) throw conflict("The Original Foundation proposal was not saved");
      await assertFoundationConversationSource(tx, proposal, actor);
      return { status: previous ? "replayed" as const : "created" as const, proposalId: proposal.id,
        foundationDocumentId: target.id, baseRevisionId: proposal.baseRevisionId, proposalStatus: proposal.status,
        title: approved.title, requiresHumanReview: proposal.status === "pending", canonicalChanged: false as const,
        href: `/foundation/${target.id}` };
    });
  } };
}
