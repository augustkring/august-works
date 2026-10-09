import {lockAnalyticalCompany} from "../analytical-privacy.js";
import {assertLearnedAssetAnalyticalSources,learningActorFromPrincipal} from "../learning/learning-analytical-sources.js";
import type {AuthorizationActor} from "../authorization.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  activityLog,
  companyMemberships,
  instanceSettings,
  principalPermissionGrants,
  pipelineStages,
  pipelines,
  projects,
  routines,
  heartbeatRuns,
  toolInvocations,
  workflowStepRuns,
  workflowWaits,
  workflowRuns,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import {
  createWorkflowSchema,
  publishWorkflowSchema,
  updateWorkflowDraftSchema,
  workflowLifecycleCommandSchema,
  workflowLifecycleReceiptSchema,
  v9FeatureEnabled,
  type WorkflowLifecycleCommand,
  type CreateWorkflow,
  type ExecutionPrincipal,
  type PublishWorkflow,
  type UpdateWorkflowDraft,
  type Workflow,
  type WorkflowDetail,
  type WorkflowGraphV1,
  type WorkflowRevision,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { workflowNodeRegistryService } from "./workflow-node-registry.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { persistActivity, publishActivity } from "../activity-log.js";

type WorkflowDb = Db;

export interface WorkflowMutationActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
}

function actorFields(actor: WorkflowMutationActor) {
  return {
    userId: actor.principal.type === "user" ? actor.principal.userId : null,
    agentId: actor.principal.type === "agent" ? actor.principal.agentId : null,
    runId: actor.runId ?? null,
  };
}

async function assertActorCompanyScope(db: WorkflowDb, companyId: string, actor: WorkflowMutationActor) {
  if (actor.principal.type === "system") return;
  if (actor.principal.type === "agent") {
    const agent = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, actor.principal.agentId)))
      .then((rows) => rows[0] ?? null);
    if (!agent) throw forbidden("Agent does not belong to this company", { code: "company_boundary_denied" });
    return;
  }
  const membership = await db.select({ id: companyMemberships.id }).from(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, actor.principal.userId),
      eq(companyMemberships.status, "active"),
    ))
    .then((rows) => rows[0] ?? null);
  if (!membership) throw forbidden("User does not have an active company membership", { code: "company_boundary_denied" });
}

async function assertProjectReference(db: WorkflowDb, companyId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
    .then((rows) => rows[0] ?? null);
  if (!project) throw unprocessable("Workflow project must belong to the company", {
    code: "cross_company_reference",
    resourceType: "project",
    resourceId: projectId,
  });
}

function mapWorkflow(row: typeof workflows.$inferSelect): Workflow {
  return { ...row, status: row.status as Workflow["status"] };
}

function mapRevision(row: typeof workflowRevisions.$inferSelect): WorkflowRevision {
  return { ...row, state: row.state as WorkflowRevision["state"] };
}

async function getWorkflowRow(db: WorkflowDb, companyId: string, workflowId: string) {
  return db.select().from(workflows)
    .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)))
    .then((rows) => rows[0] ?? null);
}

async function getRevisionById(
  db: WorkflowDb,
  companyId: string,
  workflowId: string,
  revisionId: string | null,
  actor?:AuthorizationActor,
) {
  if (!revisionId) return null;
  return db.select().from(workflowRevisions)
    .where(and(
      eq(workflowRevisions.companyId, companyId),
      eq(workflowRevisions.workflowId, workflowId),
      eq(workflowRevisions.id, revisionId),
    ))
    .then(async(rows) => {const row=rows[0]??null;if(row)await assertLearnedAssetAnalyticalSources(db,companyId,"workflow_revision",row.id,actor);return row;});
}

async function getDetail(db: WorkflowDb, companyId: string, workflowId: string, actor?:AuthorizationActor): Promise<WorkflowDetail | null> {
  const workflow = await getWorkflowRow(db, companyId, workflowId);
  if (!workflow) return null;
  const [draft, published] = await Promise.all([
    getRevisionById(db, companyId, workflowId, workflow.draftRevisionId,actor),
    getRevisionById(db, companyId, workflowId, workflow.publishedRevisionId,actor),
  ]);
  return {
    ...mapWorkflow(workflow),
    draftRevision: draft ? mapRevision(draft) : null,
    publishedRevision: published ? mapRevision(published) : null,
  };
}

async function lockWorkflow(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  companyId: string,
  workflowId: string,
) {
  await tx.execute(sql`
    select id
    from ${workflows}
    where ${workflows.companyId} = ${companyId}
      and ${workflows.id} = ${workflowId}
    for update
  `);
  return getWorkflowRow(tx as unknown as Db, companyId, workflowId);
}

function assertMutableWorkflow(workflow: typeof workflows.$inferSelect) {
  if (workflow.status === "archived") {
    throw conflict("Archived workflow cannot be changed", {
      code: "workflow_invalid_transition",
      status: workflow.status,
    });
  }
}

function assertDraftPointer(workflow: typeof workflows.$inferSelect, expectedRevisionId: string) {
  if (workflow.draftRevisionId !== expectedRevisionId) {
    throw conflict("Workflow draft was updated by someone else", {
      code: "revision_conflict",
      currentDraftRevisionId: workflow.draftRevisionId,
      currentPublishedRevisionId: workflow.publishedRevisionId,
    });
  }
}

function assertPublishedPointer(workflow: typeof workflows.$inferSelect, expectedRevisionId: string | null) {
  if (workflow.publishedRevisionId !== expectedRevisionId) {
    throw conflict("Workflow publication state changed elsewhere", {
      code: "revision_conflict",
      currentDraftRevisionId: workflow.draftRevisionId,
      currentPublishedRevisionId: workflow.publishedRevisionId,
    });
  }
}

export function workflowService(db: Db) {
  return {
    lifecycle: async (companyId: string, workflowId: string, rawInput: WorkflowLifecycleCommand, authority: AuthorizationActor) => {
      const input = workflowLifecycleCommandSchema.parse(rawInput);
      const principal = v5HumanActorId(authority);
      const result = await db.transaction(async tx => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb, companyId);
        await lockMemoryPrivacy(txDb, companyId);
        // Hold rollout configuration through commit; a late toggle cannot admit
        // an effect from an earlier enabled snapshot.
        await instanceSettingsService(txDb).getExperimental();
        await txDb.select({ id: instanceSettings.id }).from(instanceSettings).for("share");
        const flags = await instanceSettingsService(txDb).getExperimental();
        if (!flags.enableWorkflowsV1 || !v9FeatureEnabled(flags, "progressive_shell_v9"))
          throw notFound("Workflow controls are not enabled");
        if (authority.source !== "local_implicit") {
          await txDb.select().from(companyMemberships).where(and(
            eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, principal), eq(companyMemberships.status, "active"),
          )).for("share");
          await txDb.select().from(principalPermissionGrants).where(and(
            eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"),
            eq(principalPermissionGrants.principalId, principal),
          )).for("share");
        }
        await assertV5Authorization(txDb, authority, companyId, "workflows:read");
        await assertV5Authorization(txDb, authority, companyId, "workflows:publish");
        const workflow = await lockWorkflow(tx, companyId, workflowId);
        if (!workflow) throw notFound("Workflow not found");
        // Resolve current source admission even when replaying a prior receipt.
        await getRevisionById(txDb, companyId, workflowId, workflow.publishedRevisionId, authority);
        await getRevisionById(txDb, companyId, workflowId, workflow.draftRevisionId, authority);
        const [prior] = await txDb.select().from(activityLog).where(and(
          eq(activityLog.companyId, companyId), eq(activityLog.entityType, "workflow"),
          eq(activityLog.entityId, workflowId), eq(activityLog.action, "workflow.lifecycle_changed"),
          sql`${activityLog.details}->>'requestId' = ${input.requestId}`,
        )).limit(1);
        if (prior) {
          if (prior.actorId !== principal || !isDeepStrictEqual(prior.details?.command, input))
            throw conflict("Original workflow request changed", { code: "workflow_request_conflict" });
          return { receipt: workflowLifecycleReceiptSchema.parse(prior.details?.receipt), publication: null };
        }
        assertMutableWorkflow(workflow);
        if (workflow.status !== input.expectedStatus || workflow.updatedAt.toISOString() !== input.expectedUpdatedAt ||
          workflow.publishedRevisionId !== input.expectedPublishedRevisionId || workflow.draftRevisionId !== input.expectedDraftRevisionId)
          throw conflict("Workflow changed; review the current version", { code: "workflow_lifecycle_conflict" });
        if ((input.action === "pause" && workflow.status !== "active") ||
          (input.action === "resume" && (workflow.status !== "paused" || !workflow.publishedRevisionId)) ||
          (input.action === "retire" && workflow.status !== "paused"))
          throw conflict("Workflow action is unavailable in this state", { code: "workflow_invalid_transition" });
        if (input.action === "resume") await assertSaasDomainAdmission(txDb, companyId, "workflows.use");
        if (input.action === "retire") {
          const [pending] = await txDb.select({ id: workflowRuns.id }).from(workflowRuns).where(and(
            eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowId, workflowId),
            inArray(workflowRuns.status, ["queued", "running", "waiting", "recovering", "cancelling"]),
          )).limit(1);
          if (pending) throw conflict("Existing work must finish before retirement", { code: "workflow_work_pending" });
          const [step] = await txDb.select({ id: workflowStepRuns.id }).from(workflowStepRuns).innerJoin(workflowRuns, and(
            eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.id, workflowStepRuns.workflowRunId),
          )).where(and(eq(workflowStepRuns.companyId, companyId), inArray(workflowStepRuns.status, ["pending", "running", "waiting", "retry_scheduled", "cancelling"]))).limit(1);
          const [wait] = await txDb.select({ id: workflowWaits.id }).from(workflowWaits).innerJoin(workflowRuns, and(
            eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.id, workflowWaits.workflowRunId),
          )).where(and(eq(workflowWaits.companyId, companyId), eq(workflowWaits.status, "active"))).limit(1);
          const [provider] = await txDb.select({ id: heartbeatRuns.id }).from(heartbeatRuns).innerJoin(workflowStepRuns, and(
            eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.heartbeatRunId, heartbeatRuns.id),
          )).innerJoin(workflowRuns, and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.id, workflowStepRuns.workflowRunId)))
            .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, ["queued", "scheduled_retry", "running"]))).limit(1);
          const [tool] = await txDb.select({ id: toolInvocations.id }).from(toolInvocations).innerJoin(workflowRuns, and(
            eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.id, toolInvocations.workflowRunId),
          )).where(and(eq(toolInvocations.companyId, companyId), inArray(toolInvocations.status, ["pending", "authorized", "awaiting_approval", "executing", "failed", "timed_out"]))).limit(1);
          if (step || wait || provider || tool) throw conflict("Existing work must finish or be reconciled before retirement", { code: "workflow_work_pending" });
          const [routine] = await txDb.select({ id: routines.id }).from(routines).where(and(
            eq(routines.companyId, companyId), eq(routines.executionTargetKind, "workflow"), eq(routines.executionTargetRef, workflowId),
          )).limit(1);
          const [stage] = await txDb.select({ id: pipelineStages.id }).from(pipelineStages)
            .innerJoin(pipelines, and(eq(pipelines.id, pipelineStages.pipelineId), eq(pipelines.companyId, companyId)))
            .where(sql`(
              ${pipelineStages.config}#>>'{onEnter,target,workflowId}' = ${workflowId} or
              ${pipelineStages.config}#>>'{automation,targetRef}' = ${workflowId} or
              ${pipelineStages.config}#>>'{automation,workflowId}' = ${workflowId}
            )`).limit(1);
          const [parent] = await txDb.select({ id: workflowRevisions.id }).from(workflowRevisions).innerJoin(workflows, and(
            eq(workflows.companyId, companyId), eq(workflows.id, workflowRevisions.workflowId),
            sql`(${workflows.publishedRevisionId} = ${workflowRevisions.id} or ${workflows.draftRevisionId} = ${workflowRevisions.id})`,
          )).where(and(eq(workflowRevisions.companyId, companyId), sql`${workflows.status} <> 'archived'`,
            sql`${workflowRevisions.graph}->'nodes' @> jsonb_build_array(jsonb_build_object('config', jsonb_build_object('workflowId', ${workflowId}::text)))`,
          )).limit(1);
          if (routine || stage || parent) throw conflict("Remove connected automations before retirement", { code: "workflow_bindings_present" });
          if (workflow.draftRevisionId) await txDb.update(workflowRevisions).set({ state: "discarded" }).where(and(
            eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.workflowId, workflowId),
            eq(workflowRevisions.id, workflow.draftRevisionId), eq(workflowRevisions.state, "draft"),
          ));
        }
        const now = new Date(Math.max(Date.now(), workflow.updatedAt.getTime() + 1));
        const [updated] = await txDb.update(workflows).set({
          status: input.action === "pause" ? "paused" : input.action === "resume" ? "active" : "archived",
          updatedAt: now, ...(input.action === "retire" ? { archivedAt: now, draftRevisionId: null } : {}),
        }).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).returning();
        const receipt = workflowLifecycleReceiptSchema.parse({
          requestId: input.requestId, companyId, workflowId, action: input.action, status: updated!.status,
          updatedAt: now.toISOString(), publishedRevisionId: updated!.publishedRevisionId,
          draftRevisionId: updated!.draftRevisionId, workPolicy: input.workPolicy,
        });
        const { publication } = await persistActivity(txDb, {
          companyId, actorType: authority.source === "local_implicit" ? "system" : "user", actorId: principal,
          action: "workflow.lifecycle_changed", entityType: "workflow", entityId: workflowId,
          responsibleUserIdOverride: authority.source === "local_implicit" ? null : principal,
          details: { requestId: input.requestId, command: input, receipt },
        });
        return { receipt, publication };
      });
      if (result.publication) publishActivity(result.publication);
      return result.receipt;
    },
    list: async (companyId: string) =>
      db.select().from(workflows)
        .where(eq(workflows.companyId, companyId))
        .orderBy(desc(workflows.updatedAt))
        .then((rows) => rows.map(mapWorkflow)),

    get: async (companyId: string, workflowId: string) => {
      const row = await getWorkflowRow(db, companyId, workflowId);
      return row ? mapWorkflow(row) : null;
    },

    getDetail: async (companyId: string, workflowId: string, actor?:AuthorizationActor) => getDetail(db, companyId, workflowId,actor),

    getRevision: async (companyId: string, workflowId: string, revisionId: string, actor?:AuthorizationActor) => {
      const row = await getRevisionById(db, companyId, workflowId, revisionId, actor);
      return row ? mapRevision(row) : null;
    },

    listRevisions: async (companyId: string, workflowId: string, actor?:AuthorizationActor) => {
      if (!(await getWorkflowRow(db, companyId, workflowId))) return null;
      return db.select().from(workflowRevisions)
        .where(and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.workflowId, workflowId)))
        .orderBy(desc(workflowRevisions.revisionNumber))
        .then(async(rows) => {for(const row of rows)await assertLearnedAssetAnalyticalSources(db,companyId,"workflow_revision",row.id,actor);return rows.map(mapRevision);});
    },

    create: async (
      companyId: string,
      rawInput: CreateWorkflow,
      actor: WorkflowMutationActor,
      options: { workflowId?: string } = {},
    ) => {
      const parsed = createWorkflowSchema.safeParse(rawInput);
      if (!parsed.success) throw unprocessable("Invalid workflow", parsed.error.issues);
      const input = parsed.data;
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb,companyId);await lockMemoryPrivacy(txDb, companyId);
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertSaasDomainAdmission(txDb, companyId, "workflows.use");
        await assertProjectReference(txDb, companyId, input.projectId);
        const now = new Date();
        const actorData = actorFields(actor);
        const [workflow] = await txDb.insert(workflows).values({
          ...(options.workflowId ? { id: options.workflowId } : {}),
          companyId,
          projectId: input.projectId ?? null,
          name: input.name,
          description: input.description ?? null,
          status: "active",
          createdByUserId: actorData.userId,
          createdByAgentId: actorData.agentId,
          createdAt: now,
          updatedAt: now,
        }).returning();
        const graph: WorkflowGraphV1 = { version: 1, nodes: [], edges: [], variables: [], settings: {} };
        const [draft] = await txDb.insert(workflowRevisions).values({
          companyId,
          workflowId: workflow!.id,
          revisionNumber: 1,
          state: "draft",
          graph,
          inputSchema: null,
          outputSchema: null,
          changeSummary: "Created workflow draft",
          createdByUserId: actorData.userId,
          createdByAgentId: actorData.agentId,
          createdByRunId: actorData.runId,
          createdAt: now,
        }).returning();
        await txDb.update(workflows)
          .set({ draftRevisionId: draft!.id, updatedAt: now })
          .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflow!.id)));
        const detail = await getDetail(txDb, companyId, workflow!.id,learningActorFromPrincipal(companyId,actor.principal,actor.runId));
        if (!detail) throw new Error("Workflow disappeared after creation");
        return detail;
      });
    },

    updateDraft: async (
      companyId: string,
      workflowId: string,
      rawPatch: UpdateWorkflowDraft,
      actor: WorkflowMutationActor,
    ) => {
      const parsed = updateWorkflowDraftSchema.safeParse(rawPatch);
      if (!parsed.success) throw unprocessable("Invalid workflow draft", parsed.error.issues);
      const patch = parsed.data;
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb,companyId);await lockMemoryPrivacy(txDb, companyId);
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertSaasDomainAdmission(txDb, companyId, "workflows.use");
        const workflow = await lockWorkflow(tx, companyId, workflowId);
        if (!workflow) throw notFound("Workflow not found");
        assertMutableWorkflow(workflow);
        assertDraftPointer(workflow, patch.expectedRevisionId);
        const currentDraft = await getRevisionById(txDb, companyId, workflowId, workflow.draftRevisionId,learningActorFromPrincipal(companyId,actor.principal,actor.runId));
        if (!currentDraft || currentDraft.state !== "draft") {
          throw conflict("Workflow draft pointer is invalid", {
            code: "revision_conflict",
            currentDraftRevisionId: workflow.draftRevisionId,
          });
        }
        await workflowNodeRegistryService(txDb).validateDraftGraph(companyId, patch.graph);
        const nextInputSchema = patch.inputSchema === undefined ? currentDraft.inputSchema : patch.inputSchema;
        const nextOutputSchema = patch.outputSchema === undefined ? currentDraft.outputSchema : patch.outputSchema;
        if (
          isDeepStrictEqual(currentDraft.graph, patch.graph) &&
          isDeepStrictEqual(currentDraft.inputSchema, nextInputSchema) &&
          isDeepStrictEqual(currentDraft.outputSchema, nextOutputSchema)
        ) {
          const detail = await getDetail(txDb, companyId, workflowId,learningActorFromPrincipal(companyId,actor.principal,actor.runId));
          if (!detail) throw new Error("Workflow disappeared after no-op update");
          return detail;
        }
        const now = new Date();
        const actorData = actorFields(actor);
        await txDb.update(workflowRevisions).set({ state: "discarded" }).where(and(
          eq(workflowRevisions.companyId, companyId),
          eq(workflowRevisions.workflowId, workflowId),
          eq(workflowRevisions.id, currentDraft.id),
          eq(workflowRevisions.state, "draft"),
        ));
        const [nextDraft] = await txDb.insert(workflowRevisions).values({
          companyId,
          workflowId,
          revisionNumber: currentDraft.revisionNumber + 1,
          state: "draft",
          graph: patch.graph,
          inputSchema: nextInputSchema,
          outputSchema: nextOutputSchema,
          changeSummary: patch.changeSummary ?? null,
          createdByUserId: actorData.userId,
          createdByAgentId: actorData.agentId,
          createdByRunId: actorData.runId,
          createdAt: now,
        }).returning();
        await txDb.update(workflows)
          .set({ draftRevisionId: nextDraft!.id, updatedAt: now })
          .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)));
        const detail = await getDetail(txDb, companyId, workflowId,learningActorFromPrincipal(companyId,actor.principal,actor.runId));
        if (!detail) throw new Error("Workflow disappeared after draft update");
        return detail;
      });
    },

    publish: async (
      companyId: string,
      workflowId: string,
      rawInput: PublishWorkflow,
      actor: WorkflowMutationActor,
    ) => {
      const parsed = publishWorkflowSchema.safeParse(rawInput);
      if (!parsed.success) throw unprocessable("Invalid workflow publish request", parsed.error.issues);
      const input = parsed.data;
      if (input.approvalId) {
        throw unprocessable(
          "Workflow approval integration is not available until publish policy is implemented",
          { code: "workflow_publish_approval_unsupported", approvalId: input.approvalId },
        );
      }
      const publishedDetail = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb,companyId);await lockMemoryPrivacy(txDb, companyId);
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertSaasDomainAdmission(txDb, companyId, "workflows.use");
        const workflow = await lockWorkflow(tx, companyId, workflowId);
        if (!workflow) throw notFound("Workflow not found");
        assertMutableWorkflow(workflow);
        assertDraftPointer(workflow, input.expectedDraftRevisionId);
        assertPublishedPointer(workflow, input.expectedPublishedRevisionId);
        const draft = await getRevisionById(txDb, companyId, workflowId, workflow.draftRevisionId,learningActorFromPrincipal(companyId,actor.principal,actor.runId));
        if (!draft || draft.state !== "draft") {
          throw conflict("Workflow draft pointer is invalid", {
            code: "revision_conflict",
            currentDraftRevisionId: workflow.draftRevisionId,
          });
        }
        await workflowNodeRegistryService(txDb).validatePublishGraph(companyId, draft.graph, workflowId);
        const previousPublished = await getRevisionById(
          txDb,
          companyId,
          workflowId,
          workflow.publishedRevisionId,
          learningActorFromPrincipal(companyId,actor.principal,actor.runId),
        );
        if (workflow.publishedRevisionId && (!previousPublished || previousPublished.state !== "published")) {
          throw conflict("Workflow published pointer is invalid", {
            code: "revision_conflict",
            currentPublishedRevisionId: workflow.publishedRevisionId,
          });
        }
        const now = new Date();
        const actorData = actorFields(actor);
        if (previousPublished) {
          await txDb.update(workflowRevisions).set({ state: "superseded" }).where(and(
            eq(workflowRevisions.companyId, companyId),
            eq(workflowRevisions.workflowId, workflowId),
            eq(workflowRevisions.id, previousPublished.id),
            eq(workflowRevisions.state, "published"),
          ));
        }
        const [published] = await txDb.update(workflowRevisions)
          .set({ state: "published" })
          .where(and(
            eq(workflowRevisions.companyId, companyId),
            eq(workflowRevisions.workflowId, workflowId),
            eq(workflowRevisions.id, draft.id),
            eq(workflowRevisions.state, "draft"),
          ))
          .returning();
        if (!published) {
          throw conflict("Workflow draft was changed during publication", {
            code: "revision_conflict",
            currentDraftRevisionId: workflow.draftRevisionId,
          });
        }
        const [nextDraft] = await txDb.insert(workflowRevisions).values({
          companyId,
          workflowId,
          revisionNumber: draft.revisionNumber + 1,
          state: "draft",
          graph: draft.graph,
          inputSchema: draft.inputSchema,
          outputSchema: draft.outputSchema,
          changeSummary: `Draft cloned from published revision ${draft.revisionNumber}`,
          createdByUserId: actorData.userId,
          createdByAgentId: actorData.agentId,
          createdByRunId: actorData.runId,
          createdAt: now,
        }).returning();
        await txDb.update(workflows).set({
          publishedRevisionId: published.id,
          draftRevisionId: nextDraft!.id,
          updatedAt: now,
        }).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)));
        const detail = await getDetail(txDb, companyId, workflowId,learningActorFromPrincipal(companyId,actor.principal,actor.runId));
        if (!detail) throw new Error("Workflow disappeared after publish");
        return detail;
      });
      await (await import("../optimizer/optimizer-live-drift.js")).evaluateWorkflowOptimizerDrift(db, companyId, workflowId);
      return publishedDetail;
    },
  };
}
