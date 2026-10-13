import { and, eq, isNull, sql } from "drizzle-orm";
import { issues, workflows, type Db } from "@paperclipai/db";
import { conversationAuthoringViewSchema } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { workflowService } from "../workflows/workflow-service.js";
import { workflowNodeRegistryService } from "../workflows/workflow-node-registry.js";
import { projectWorkflowRevisionFlow } from "./workflow-flow.js";
import { workflowComparison } from "./workflow-comparison.js";
import { forbidden, notFound, conflict } from "../../errors.js";

/** Read saved Original authoring results, never model-generated claimed links.
 * No prompt/result prose, credentials, policy writes or model calls occur. */
export function conversationAuthoringService(db: Db) {
  async function owner(tx: Db, actor: AuthorizationActor, companyId: string, conversationId: string) {
    const userId = v5HumanActorId(actor), current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
    if (current.source === "local_implicit") throw forbidden("Current authenticated conversation authority is required");
    await assertV5Authorization(tx, current, companyId, "company_scope:read");
    const [conversation] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, conversationId),
      eq(issues.conversationUserId, userId), isNull(issues.conversationRetiredAt), sql`${issues.conversationAgentId} is not null`,
      sql`not aw_workflow_memory_erased(${companyId}::uuid, null, ${issues.id})`)).for("share");
    if (!conversation) throw notFound("The current owned conversation is unavailable");
    await assertV5Authorization(tx, current, companyId, "agent:read", { type: "agent", companyId, agentId: conversation.conversationAgentId! });
    const readable = await authorizationService(tx).decide({ actor: current, action: "issue:read", resource: { type: "issue", companyId,
      issueId: conversation.id, projectId: conversation.projectId, parentIssueId: conversation.parentId, status: conversation.status,
      assigneeAgentId: conversation.assigneeAgentId, assigneeUserId: conversation.assigneeUserId } });
    if (!readable.allowed) throw forbidden("Current conversation read authority is required");
    await assertAnalyticalContextPayloadAccess(tx, companyId, current, { issueId: conversation.id });
    await assertV5Authorization(tx, current, companyId, "workflows:read");
    return { conversation, userId, current };
  }
  return {
    get: (actor: AuthorizationActor, companyId: string, conversationId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId);
      const initial = await owner(tx, actor, companyId, conversationId);
      // The Original revision's author/run relation establishes provenance.
      // Current conversation generation and responsible user exclude earlier
      // chats, resets, foreign runs and model-supplied arbitrary references.
      const candidates = await tx.execute<{ id: string; revision_id: string; revision_number: number }>(sql`
        select id,revision_id,revision_number from (
          select distinct on(r.workflow_id) r.workflow_id as id,r.id as revision_id,r.revision_number,r.created_at
          from workflow_revisions r join heartbeat_runs h on h.company_id=r.company_id and h.id=r.created_by_run_id
          where r.company_id=${companyId}::uuid and r.created_by_agent_id=${initial.conversation.conversationAgentId}::uuid
            and h.agent_id=${initial.conversation.conversationAgentId}::uuid and h.responsible_user_id=${initial.userId}
            and (h.native_issue_id=${conversationId}::uuid or (h.native_issue_id is null and coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')=${conversationId}))
            and coalesce(h.context_snapshot->>'conversationSessionGeneration','0')=${String(initial.conversation.conversationSessionGeneration)}
          order by r.workflow_id,r.revision_number desc,r.id desc
        ) owned order by created_at desc,revision_id desc limit 11`);
      const workflowOwner = workflowService(tx), registry = workflowNodeRegistryService(tx).list();
      const triggerTypes = new Set(registry.filter(node => node.category === "trigger").map(node => node.type));
      const proposals = [];
      for (const candidate of candidates.slice(0, 10)) {
        // Match the Original mutation's privacy -> workflow lock order. Keep
        // the current name/version pointers stable through final read checks.
        const [ownedWorkflow] = await tx.select({ id: workflows.id }).from(workflows)
          .where(and(eq(workflows.companyId, companyId), eq(workflows.id, candidate.id))).for("share");
        if (!ownedWorkflow) throw conflict("The saved conversation workflow is no longer available");
        const detail = await workflowOwner.getDetail(companyId, candidate.id, initial.current);
        const revision = await workflowOwner.getRevision(companyId, candidate.id, candidate.revision_id, initial.current);
        if (!detail || !revision || revision.createdByAgentId !== initial.conversation.conversationAgentId || revision.revisionNumber !== candidate.revision_number)
          throw conflict("The Original conversation proposal changed; refresh its current owner");
        const authoredFlow = projectWorkflowRevisionFlow(revision, registry);
        const currentFlow = detail.draftRevision ? projectWorkflowRevisionFlow(detail.draftRevision, registry) : null;
        const comparison = detail.draftRevision?.id !== revision.id
          ? workflowComparison(revision, detail.draftRevision, authoredFlow.flow, currentFlow?.flow ?? null, currentFlow?.nodeOrder ?? [])
          : null;
        const triggerCount = revision.graph.nodes.filter(node => triggerTypes.has(node.type)).length;
        proposals.push({ kind: "workflow" as const, id: detail.id, name: detail.name,
          authoredRevisionId: revision.id, authoredRevisionNumber: revision.revisionNumber,
          currentDraftRevisionId: detail.draftRevisionId, currentPublishedRevisionId: detail.publishedRevisionId,
          state: detail.draftRevisionId === revision.id ? "draft" as const : detail.publishedRevisionId === revision.id ? "published" as const
            : detail.draftRevisionId ? "changed" as const : "superseded" as const,
          stepCount: revision.graph.nodes.length - triggerCount, triggerCount, preview: authoredFlow.flow, comparison, href: `/workflows/${detail.id}` });
      }
      const final = await owner(tx, actor, companyId, conversationId);
      if (final.conversation.conversationAgentId !== initial.conversation.conversationAgentId ||
        final.conversation.conversationSessionGeneration !== initial.conversation.conversationSessionGeneration)
        throw conflict("The current conversation changed; reload its saved proposals");
      return conversationAuthoringViewSchema.parse({ companyId, conversationId, agentId: initial.conversation.conversationAgentId,
        generation: initial.conversation.conversationSessionGeneration, observedAt: new Date().toISOString(), hasMore: candidates.length > 10,
        proposals, modelCalled: false });
    }),
  };
}
