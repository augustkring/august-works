import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  projects,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import {
  createWorkflowSchema,
  publishWorkflowSchema,
  updateWorkflowDraftSchema,
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
) {
  if (!revisionId) return null;
  return db.select().from(workflowRevisions)
    .where(and(
      eq(workflowRevisions.companyId, companyId),
      eq(workflowRevisions.workflowId, workflowId),
      eq(workflowRevisions.id, revisionId),
    ))
    .then((rows) => rows[0] ?? null);
}

async function getDetail(db: WorkflowDb, companyId: string, workflowId: string): Promise<WorkflowDetail | null> {
  const workflow = await getWorkflowRow(db, companyId, workflowId);
  if (!workflow) return null;
  const [draft, published] = await Promise.all([
    getRevisionById(db, companyId, workflowId, workflow.draftRevisionId),
    getRevisionById(db, companyId, workflowId, workflow.publishedRevisionId),
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
    list: async (companyId: string) =>
      db.select().from(workflows)
        .where(eq(workflows.companyId, companyId))
        .orderBy(desc(workflows.updatedAt))
        .then((rows) => rows.map(mapWorkflow)),

    get: async (companyId: string, workflowId: string) => {
      const row = await getWorkflowRow(db, companyId, workflowId);
      return row ? mapWorkflow(row) : null;
    },

    getDetail: async (companyId: string, workflowId: string) => getDetail(db, companyId, workflowId),

    listRevisions: async (companyId: string, workflowId: string) => {
      if (!(await getWorkflowRow(db, companyId, workflowId))) return null;
      return db.select().from(workflowRevisions)
        .where(and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.workflowId, workflowId)))
        .orderBy(desc(workflowRevisions.revisionNumber))
        .then((rows) => rows.map(mapRevision));
    },

    create: async (companyId: string, rawInput: CreateWorkflow, actor: WorkflowMutationActor) => {
      const parsed = createWorkflowSchema.safeParse(rawInput);
      if (!parsed.success) throw unprocessable("Invalid workflow", parsed.error.issues);
      const input = parsed.data;
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertProjectReference(txDb, companyId, input.projectId);
        const now = new Date();
        const actorData = actorFields(actor);
        const [workflow] = await txDb.insert(workflows).values({
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
        const detail = await getDetail(txDb, companyId, workflow!.id);
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
        await assertActorCompanyScope(txDb, companyId, actor);
        const workflow = await lockWorkflow(tx, companyId, workflowId);
        if (!workflow) throw notFound("Workflow not found");
        assertMutableWorkflow(workflow);
        assertDraftPointer(workflow, patch.expectedRevisionId);
        const currentDraft = await getRevisionById(txDb, companyId, workflowId, workflow.draftRevisionId);
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
          const detail = await getDetail(txDb, companyId, workflowId);
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
        const detail = await getDetail(txDb, companyId, workflowId);
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
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const workflow = await lockWorkflow(tx, companyId, workflowId);
        if (!workflow) throw notFound("Workflow not found");
        assertMutableWorkflow(workflow);
        assertDraftPointer(workflow, input.expectedDraftRevisionId);
        assertPublishedPointer(workflow, input.expectedPublishedRevisionId);
        const draft = await getRevisionById(txDb, companyId, workflowId, workflow.draftRevisionId);
        if (!draft || draft.state !== "draft") {
          throw conflict("Workflow draft pointer is invalid", {
            code: "revision_conflict",
            currentDraftRevisionId: workflow.draftRevisionId,
          });
        }
        await workflowNodeRegistryService(txDb).validatePublishGraph(companyId, draft.graph);
        const previousPublished = await getRevisionById(
          txDb,
          companyId,
          workflowId,
          workflow.publishedRevisionId,
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
        const detail = await getDetail(txDb, companyId, workflowId);
        if (!detail) throw new Error("Workflow disappeared after publish");
        return detail;
      });
    },
  };
}
