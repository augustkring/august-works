import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, is, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { authUsers, heartbeatRuns, issues, workflowRuns, workflowStepRuns, workflowRevisions, workflows, type Db } from "@paperclipai/db";
import { z } from "zod";
import { forbidden } from "../../errors.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { assertV5Authorization } from "../v5-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import type { NativeReadScope } from "../analytical-reader.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy, canActorReadMemorySources } from "../memory/memory-privacy.js";

const sources = z.array(z.uuid()).max(32);
const memorySources = z.array(z.uuid()).max(256);
const review = new AsyncLocalStorage<{ active: Set<string>; deadline: number }>();

/** Compose a bounded batch of Original Source reads without restarting its
 * existing recursion/deadline owner for every retained copy reference. */
export function withWorkflowAuthoringSourceReview<T>(work: () => Promise<T>): Promise<T> {
  return review.getStore() ? work() : review.run({ active: new Set<string>(), deadline: performance.now() + 8000 }, work);
}


/** Actual Native authoring runs remain private sources after Human edits,
 * publication and run removal. Provenance supplies no current reader grant. */
export async function assertWorkflowAuthoringSources(db: Db, companyId: string, workflowId: string,
  actor?: AuthorizationActor, readScope?: NativeReadScope) {
  const [workflow] = await db.select({ ids: workflows.authoringSourceRunIds }).from(workflows)
    .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)));
  if (!workflow) throw forbidden("The workflow source owner is unavailable");
  const ids = sources.safeParse(workflow.ids);
  if (!ids.success || new Set(ids.data).size !== ids.data.length)
    throw forbidden("Complete workflow authoring provenance is unavailable");
  const [marker] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_authoring_source_erased(${companyId}::uuid,${workflowId}::uuid) as erased`);
  if (marker?.erased !== false) throw forbidden("The workflow authoring source was erased or withdrawn");
  if (!ids.data.length) return;
  if (actor?.type === "agent") {
    if (actor.source !== "agent_jwt" || actor.keyId || actor.keyScope)
      throw forbidden("Private workflow sources require the current run reader boundary");
    // Internal Native authors supply their Agent/run, never a claimed Human.
    // Resolve its active responsible user before intersecting source authority.
    const [active] = actor.runId ? await db.select({ userId: heartbeatRuns.responsibleUserId }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId),
        eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.status, "running"))) : [];
    if (actor.companyId !== companyId || !active?.userId || actor.onBehalfOfUserId && actor.onBehalfOfUserId !== active.userId)
      throw forbidden("The current Native workflow source reader changed");
    actor = { ...actor, onBehalfOfUserId: active.userId };
  }
  const userId = actor?.type === "board" ? actor.userId : actor?.onBehalfOfUserId;
  if (!actor || !userId || actor.source === "local_implicit")
    throw forbidden("A current accountable workflow source reader is required");
  const [user] = await db.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId));
  if (!user?.verified) throw forbidden("A current verified workflow source reader is required", { code: "workflow_authoring_account_unavailable" });
  await assertV5Authorization(db, { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true }, companyId, "workflows:read");
  const state = review.getStore() ?? { active: new Set<string>(), deadline: performance.now() + 8000 };
  const key = `${companyId}:${workflowId}`;
  if (state.active.has(key) || performance.now() > state.deadline)
    throw forbidden("Complete workflow source review is cyclic or excessive");
  const inspect = async () => {
    state.active.add(key);
    try {
      for (const id of ids.data) {
        if (performance.now() > state.deadline) throw forbidden("Complete workflow source review exceeded its budget");
        const [origin] = await db.select({ runId: heartbeatRuns.id, agentId: heartbeatRuns.agentId,
          userId: heartbeatRuns.responsibleUserId, issue: issues }).from(heartbeatRuns)
          .innerJoin(issues, and(eq(issues.companyId, heartbeatRuns.companyId), sql`${issues.id}=coalesce(${heartbeatRuns.nativeIssueId},case
            when coalesce(${heartbeatRuns.contextSnapshot}->>'issueId',${heartbeatRuns.contextSnapshot}->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then coalesce(${heartbeatRuns.contextSnapshot}->>'issueId',${heartbeatRuns.contextSnapshot}->>'taskId')::uuid else null end)`))
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, id)));
        if (!origin || origin.userId !== userId || origin.issue.conversationUserId !== userId ||
          origin.issue.conversationAgentId !== origin.agentId || origin.issue.conversationRetiredAt || origin.issue.hiddenAt)
          throw forbidden("The private workflow source requires its current owned conversation");
        const current = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
        await assertV5Authorization(db, current, companyId, "company_scope:read");
        await assertV5Authorization(db, current, companyId, "issue:read", { type: "issue", companyId,
          issueId: origin.issue.id, projectId: origin.issue.projectId, parentIssueId: origin.issue.parentId,
          status: origin.issue.status, assigneeAgentId: origin.issue.assigneeAgentId, assigneeUserId: origin.issue.assigneeUserId });
        await assertV5Authorization(db, current, companyId, "agent:read", { type: "agent", companyId, agentId: origin.agentId });
        await assertAnalyticalContextPayloadAccess(db, companyId, current, { runId: id }, readScope);
      }
      const [current] = await db.select({ ids: workflows.authoringSourceRunIds }).from(workflows)
        .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)));
      const [final] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_authoring_source_erased(${companyId}::uuid,${workflowId}::uuid) as erased`);
      if (JSON.stringify(current?.ids) !== JSON.stringify(ids.data) || final?.erased !== false)
        throw forbidden("Current workflow source provenance changed");
      const [account] = await db.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId));
      if (!account?.verified) throw forbidden("Current workflow source account changed", { code: "workflow_authoring_account_unavailable" });
      if (actor.type === "agent") {
        const [active] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId!), eq(heartbeatRuns.agentId, actor.agentId!),
          eq(heartbeatRuns.responsibleUserId, userId), eq(heartbeatRuns.status, "running")));
        if (!active) throw forbidden("Current Native workflow source reader changed");
      }
      await assertV5Authorization(db, { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true }, companyId, "company_scope:read");
      await assertV5Authorization(db, { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true }, companyId, "workflows:read");
    } finally { state.active.delete(key); }
  };
  return review.getStore() ? inspect() : review.run(state, inspect);
}

/** A public parent can hold a private child's result. Follow the actual Native
 * copy references retained on that run, including after child-run removal. */
export async function assertWorkflowRunAuthoringSources(db: Db, companyId: string, runId: string,
  actor?: AuthorizationActor, readScope?: NativeReadScope) {
  const [run] = await db.select({ ids: workflowRuns.authoringSourceWorkflowIds }).from(workflowRuns)
    .where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId)));
  if (!run) throw forbidden("The workflow run copy owner is unavailable");
  const [marker] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_run_authoring_source_erased(${companyId}::uuid,${runId}::uuid) as erased`);
  if (marker?.erased !== false) throw forbidden("The workflow run's private copy source was erased or withdrawn");
  const parsed = sources.safeParse(run.ids);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length)
    throw forbidden("Complete workflow run copy provenance is unavailable");
  const state = review.getStore() ?? { active: new Set<string>(), deadline: performance.now() + 8000 };
  const inspect = async () => {
    for (const id of parsed.data) {
      if (performance.now() > state.deadline) throw forbidden("Complete workflow run source review exceeded its budget");
      await assertWorkflowAuthoringSources(db, companyId, id, actor, readScope);
    }
  };
  if (review.getStore()) await inspect(); else await review.run(state, inspect);
  const [current] = await db.select({ ids: workflowRuns.authoringSourceWorkflowIds }).from(workflowRuns)
    .where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId)));
  if (JSON.stringify(current?.ids) !== JSON.stringify(parsed.data)) throw forbidden("Current workflow run copy provenance changed");
}

/** Current authorization for the exact workflow-run edge that a Task/Run is
 * about to read. The callback capability alone is not enough: every stored
 * run/step Memory reference and the exact executed revision are revalidated. */
export async function assertWorkflowRunPayloadSourceAccess(db: Db, companyId: string, runId: string,
  actor: AuthorizationActor, readScope?: NativeReadScope) {
  const state = review.getStore() ?? { active: new Set<string>(), deadline: performance.now() + 8000 };
  const key = `run:${companyId}:${runId}`;
  if (state.active.has(key) || performance.now() > state.deadline)
    throw forbidden("Workflow source review is cyclic or exceeds its budget");
  return review.run(state, async () => {
    state.active.add(key);
    try { await inspectWorkflowRunPayloadSourceAccess(db, companyId, runId, actor, readScope); }
    finally { state.active.delete(key); }
  });
}

async function inspectWorkflowRunPayloadSourceAccess(db: Db, companyId: string, runId: string,
  actor: AuthorizationActor, readScope?: NativeReadScope) {
  if (!is(db, PgTransaction)) throw forbidden("Workflow source reads require a native transaction");
  await db.execute(sql`set local statement_timeout='8s'`);
  await lockAnalyticalCompany(db, companyId);
  await lockMemoryPrivacy(db, companyId);
  const markerBefore = await db.execute<{ erased: boolean }>(sql`select aw_workflow_run_authoring_source_erased(${companyId}::uuid,${runId}::uuid) as erased`);
  if (markerBefore[0]?.erased !== false) throw forbidden("The workflow run source was erased or withdrawn");
  const [run] = await db.select({ id: workflowRuns.id, companyId: workflowRuns.companyId, workflowId: workflowRuns.workflowId,
    revisionId: workflowRuns.workflowRevisionId,
    authoringSourceWorkflowIds: workflowRuns.authoringSourceWorkflowIds, memoryRecordIds: workflowRuns.memoryRecordIds })
    .from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId))).for("share", { noWait: true });
  if (!run) throw forbidden("The workflow run source owner is unavailable");
  const authoringIds = sources.safeParse(run.authoringSourceWorkflowIds);
  const runMemoryIds = memorySources.safeParse(run.memoryRecordIds);
  if (!authoringIds.success || new Set(authoringIds.data).size !== authoringIds.data.length ||
    !runMemoryIds.success || new Set(runMemoryIds.data).size !== runMemoryIds.data.length)
    throw forbidden("The complete workflow run source population is unavailable");
  const [workflow] = await db.select({ id: workflows.id, authoringSourceRunIds: workflows.authoringSourceRunIds })
    .from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, run.workflowId))).for("share", { noWait: true });
  const [revision] = await db.select({ id: workflowRevisions.id, workflowId: workflowRevisions.workflowId })
    .from(workflowRevisions).where(and(eq(workflowRevisions.companyId, companyId),
      eq(workflowRevisions.workflowId, run.workflowId), eq(workflowRevisions.id, run.revisionId))).for("share", { noWait: true });
  if (!workflow || !revision) throw forbidden("The exact workflow revision is unavailable");
  const stepRows = await db.select({ id: workflowStepRuns.id, memoryRecordIds: workflowStepRuns.memoryRecordIds })
    .from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.workflowRunId, runId)))
    .orderBy(workflowStepRuns.id).limit(257).for("share", { noWait: true });
  if (stepRows.length > 256) throw forbidden("The complete workflow run source population exceeds its bound");
  const stepMemoryIds = stepRows.map(step => memorySources.safeParse(step.memoryRecordIds));
  if (stepMemoryIds.some(ids => !ids.success || new Set(ids.data).size !== ids.data.length))
    throw forbidden("The complete workflow step source population is unavailable");
  const allMemoryIds = [...new Set([...runMemoryIds.data, ...stepMemoryIds.flatMap(ids => ids.success ? ids.data : [])])];
  if (allMemoryIds.length > 256) throw forbidden("The complete workflow Memory source population exceeds its bound");

  // Pin the exact workflow roots. NOWAIT row locks fail closed on concurrent edits.
  await assertWorkflowAuthoringSources(db, companyId, run.workflowId, actor, readScope);
  for (const id of authoringIds.data) await assertWorkflowAuthoringSources(db, companyId, id, actor, readScope);
  const { assertLearnedAssetAnalyticalSources } = await import("../learning/learning-analytical-sources.js");
  await assertLearnedAssetAnalyticalSources(db, companyId, "workflow_revision", revision.id, actor, readScope);
  for (const id of allMemoryIds) {
    if (performance.now() > (review.getStore()?.deadline ?? 0) || !await canActorReadMemorySources(db, companyId, actor, id))
      throw forbidden("A current reader cannot access every Workflow Memory source");
  }
  const [currentRun] = await db.select({ authoringSourceWorkflowIds: workflowRuns.authoringSourceWorkflowIds,
    memoryRecordIds: workflowRuns.memoryRecordIds, revisionId: workflowRuns.workflowRevisionId })
    .from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId)));
  const currentSteps = await db.select({ id: workflowStepRuns.id, memoryRecordIds: workflowStepRuns.memoryRecordIds })
    .from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.workflowRunId, runId)))
    .orderBy(workflowStepRuns.id).limit(257);
  const [markerAfter] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_run_authoring_source_erased(${companyId}::uuid,${runId}::uuid) as erased`);
  if (markerAfter?.erased !== false || currentRun?.revisionId !== run.revisionId ||
    JSON.stringify(currentRun?.authoringSourceWorkflowIds) !== JSON.stringify(authoringIds.data) ||
    JSON.stringify(currentRun?.memoryRecordIds) !== JSON.stringify(runMemoryIds.data) ||
    JSON.stringify(currentSteps) !== JSON.stringify(stepRows))
    throw forbidden("Workflow run source provenance changed during authorization");
}
