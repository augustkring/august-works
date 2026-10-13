import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { heartbeatRuns, issues, routineRevisions, routines, workflows, type Db } from "@paperclipai/db";
import { conversationAuthoringViewSchema } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { workflowService } from "../workflows/workflow-service.js";
import { workflowNodeRegistryService } from "../workflows/workflow-node-registry.js";
import { ExperienceOverloadError } from "./projection.js";
import { withExperienceAdmission } from "./admission.js";
import { projectWorkflowRevisionFlow } from "./workflow-flow.js";
import { workflowComparison } from "./workflow-comparison.js";
import { assertRoutineSourceAccess } from "../routine-source-authority.js";
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
    return { conversation, userId, current };
  }
  return {
    get: (actor: AuthorizationActor, companyId: string, conversationId: string, signal?: AbortSignal) => withExperienceAdmission(async (currentSignal, remainingMs) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db;
      await tx.execute(sql`select set_config('statement_timeout', ${String(remainingMs()) + 'ms'}, true), set_config('lock_timeout', '1000ms', true)`);
      currentSignal.throwIfAborted(); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
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
      if (candidates.length) await assertV5Authorization(tx, initial.current, companyId, "workflows:read");
      const triggerTypes = new Set(registry.filter(node => node.category === "trigger").map(node => node.type));
      const proposals = [];
      for (const candidate of candidates.slice(0, 10)) {
        currentSignal.throwIfAborted();
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
      // Original Native create_task writes provenance atomically with its
      // mutation receipt. Neither model prose nor an arbitrary task link is
      // a saved result. Match the exact current conversation/run generation.
      const tasks = await tx.execute<{ id: string; run_id: string }>(sql`
        select t.id,h.id as run_id from issues t join heartbeat_runs h
          on h.company_id=t.company_id and h.id::text=t.origin_run_id
        where t.company_id=${companyId}::uuid and t.created_by_agent_id=${initial.conversation.conversationAgentId}::uuid
          and t.origin_kind='manual' and t.origin_id like ${`paperclip-runner:create-task:${conversationId}:%`}
          and h.runtime_mode='native' and h.native_issue_id=${conversationId}::uuid
          and h.agent_id=${initial.conversation.conversationAgentId}::uuid and h.responsible_user_id=${initial.userId}
          and coalesce(h.context_snapshot->>'conversationSessionGeneration','0')=${String(initial.conversation.conversationSessionGeneration)}
          and h.result_json->'semanticToolReceipts'->substr(t.origin_id,length(${`paperclip-runner:create-task:${conversationId}:`})+1)->>'operationId'='create_task'
          and h.result_json->'semanticToolReceipts'->substr(t.origin_id,length(${`paperclip-runner:create-task:${conversationId}:`})+1)->'result'->'task'->>'id'=t.id::text
          and t.conversation_agent_id is null and t.conversation_retired_at is null and t.hidden_at is null
        order by t.created_at desc,t.id desc limit 11`);
      const savedTasks = [];
      const readTask = async (candidate: { id: string; run_id: string }) => {
        currentSignal.throwIfAborted();
        const [origin] = await tx.select({ id: heartbeatRuns.id, receipts: heartbeatRuns.resultJson }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, candidate.run_id),
          eq(heartbeatRuns.agentId, initial.conversation.conversationAgentId!), eq(heartbeatRuns.responsibleUserId, initial.userId),
          eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativeIssueId, conversationId),
          sql`coalesce(${heartbeatRuns.contextSnapshot}->>'conversationSessionGeneration','0')=${String(initial.conversation.conversationSessionGeneration)}`,
        )).for("share");
        if (!origin) throw conflict("The saved task's conversation provenance changed");
        const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, candidate.id),
          isNull(issues.hiddenAt), isNull(issues.conversationAgentId), isNull(issues.conversationRetiredAt),
          eq(issues.createdByAgentId, initial.conversation.conversationAgentId!), eq(issues.originKind, "manual"),
          sql`${issues.originId} like ${`paperclip-runner:create-task:${conversationId}:%`}`,
          eq(issues.originRunId, candidate.run_id))).for("share");
        if (!task) throw conflict("The saved conversation task changed; refresh its current owner");
        const receiptKey = task.originId!.slice(`paperclip-runner:create-task:${conversationId}:`.length);
        const receipts = origin.receipts?.semanticToolReceipts;
        const receipt = receipts && typeof receipts === "object" && !Array.isArray(receipts)
          ? (receipts as Record<string, unknown>)[receiptKey] : undefined;
        if (!z.object({ operationId: z.literal("create_task"), result: z.object({ task: z.object({ id: z.literal(task.id) }) }) }).safeParse(receipt).success)
          throw conflict("The Original saved task receipt is unavailable");
        const access = await authorizationService(tx).decide({ actor: initial.current, action: "issue:read", resource: {
          type: "issue", companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId,
          status: task.status, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId,
        } });
        if (!access.allowed) throw forbidden("Current saved task read authority is required");
        // The new projection inherits both the created task and originating
        // run's current source authority; it stores no copied task body.
        await assertAnalyticalContextPayloadAccess(tx, companyId, initial.current, { runId: candidate.run_id });
        await assertAnalyticalContextPayloadAccess(tx, companyId, initial.current, { issueId: task.id });
        return task;
      };
      for (const candidate of tasks.slice(0, 10)) {
        const task = await readTask(candidate);
        savedTasks.push({ kind: "task" as const, id: task.id, title: task.title.slice(0, 400), titleTruncated: task.title.length > 400,
          status: task.status, statusVersion: task.statusVersion,
          executionStarted: !!(task.startedAt || task.executionRunId), href: `/issues/${task.id}` });
      }
      const routineCandidates = await tx.execute<{ id: string; revision_id: string; run_id: string }>(sql`
        select r.id,v.id as revision_id,h.id as run_id from routines r
        join routine_revisions v on v.company_id=r.company_id and v.routine_id=r.id and v.revision_number=1
        join heartbeat_runs h on h.company_id=r.company_id and h.id=v.created_by_run_id
        where r.company_id=${companyId}::uuid and r.origin_kind='conversation_draft' and r.origin_id=h.id::text
          and r.created_by_agent_id=${initial.conversation.conversationAgentId}::uuid
          and h.agent_id=${initial.conversation.conversationAgentId}::uuid and h.responsible_user_id=${initial.userId}
          and (h.native_issue_id=${conversationId}::uuid or (h.native_issue_id is null and coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')=${conversationId}))
          and coalesce(h.context_snapshot->>'conversationSessionGeneration','0')=${String(initial.conversation.conversationSessionGeneration)}
        order by r.created_at desc,r.id desc limit 11`);
      const readRoutine = async (candidate: { id: string; revision_id: string; run_id: string }) => {
        currentSignal.throwIfAborted();
        const [origin] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, candidate.run_id),
          eq(heartbeatRuns.agentId, initial.conversation.conversationAgentId!), eq(heartbeatRuns.responsibleUserId, initial.userId),
          sql`(${heartbeatRuns.nativeIssueId}=${conversationId}::uuid or (${heartbeatRuns.nativeIssueId} is null and coalesce(${heartbeatRuns.contextSnapshot}->>'issueId',${heartbeatRuns.contextSnapshot}->>'taskId')=${conversationId}))`,
          sql`coalesce(${heartbeatRuns.contextSnapshot}->>'conversationSessionGeneration','0')=${String(initial.conversation.conversationSessionGeneration)}`,
        )).for("share");
        if (!origin) throw conflict("The saved routine conversation provenance changed");
        const [routine] = await tx.select().from(routines).where(and(eq(routines.companyId, companyId), eq(routines.id, candidate.id),
          eq(routines.originKind, "conversation_draft"), eq(routines.originId, candidate.run_id),
          eq(routines.createdByAgentId, initial.conversation.conversationAgentId!), eq(routines.responsibleUserId, initial.userId))).for("share");
        const [authored] = await tx.select().from(routineRevisions).where(and(eq(routineRevisions.companyId, companyId),
          eq(routineRevisions.routineId, candidate.id), eq(routineRevisions.id, candidate.revision_id),
          eq(routineRevisions.createdByRunId, candidate.run_id), eq(routineRevisions.revisionNumber, 1))).for("share");
        if (!routine || !authored || !routine.latestRevisionId) throw conflict("The saved conversation routine changed");
        await assertRoutineSourceAccess(tx, routine, initial.current);
        const [counts] = await tx.execute<{ total: number; enabled: number }>(sql`
          select count(*)::integer as total,count(*) filter(where enabled)::integer as enabled from routine_triggers
          where company_id=${companyId}::uuid and routine_id=${routine.id}::uuid and not archived`);
        return { kind: "routine" as const, id: routine.id, title: routine.title,
          authoredRevisionId: authored.id, authoredRevisionNumber: authored.revisionNumber,
          currentRevisionId: routine.latestRevisionId, currentRevisionNumber: routine.latestRevisionNumber,
          status: routine.status, executionConfigured: !!routine.executionTargetRef,
          triggerCount: counts?.total ?? 0, enabledTriggerCount: counts?.enabled ?? 0, href: `/routines/${routine.id}` };
      };
      const savedRoutines = [];
      for (const candidate of routineCandidates.slice(0, 10)) savedRoutines.push(await readRoutine(candidate));
      currentSignal.throwIfAborted();
      const final = await owner(tx, actor, companyId, conversationId);
      currentSignal.throwIfAborted();
      if (final.conversation.conversationAgentId !== initial.conversation.conversationAgentId ||
        final.conversation.conversationSessionGeneration !== initial.conversation.conversationSessionGeneration)
        throw conflict("The current conversation changed; reload its saved proposals");
      if (candidates.length) await assertV5Authorization(tx, final.current, companyId, "workflows:read");
      for (const candidate of tasks.slice(0, 10)) await readTask(candidate);
      for (const candidate of routineCandidates.slice(0, 10)) await readRoutine(candidate);
      return conversationAuthoringViewSchema.parse({ companyId, conversationId, agentId: initial.conversation.conversationAgentId,
        generation: initial.conversation.conversationSessionGeneration, observedAt: new Date().toISOString(), hasMore: candidates.length > 10,
        proposals, savedTasks, hasMoreTasks: tasks.length > 10, savedRoutines, hasMoreRoutines: routineCandidates.length > 10, modelCalled: false });
    }).catch(error => {
      let cause: unknown = error;
      for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
        const failure = cause as { code?: unknown; cause?: unknown };
        if (failure.code === "55P03" || failure.code === "57014")
          throw new ExperienceOverloadError("The current conversation read could not complete within its budget");
        cause = failure.cause;
      }
      throw error;
    }), { signal }),
  };
}
