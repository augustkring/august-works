import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import {
  workflowAuthoringAddStepInputSchema,
  workflowAuthoringAddTriggerInputSchema,
  workflowAuthoringConnectStepsInputSchema,
  workflowAuthoringCreateInputSchema,
  workflowAuthoringPublishInputSchema,
  workflowAuthoringRemoveStepInputSchema,
  workflowAuthoringTestStepInputSchema,
  workflowAuthoringUpdateStepInputSchema,
  type WorkflowAuthoringUpdateStepInput,
  type WorkflowDetail,
  type WorkflowGraphV1,
  type WorkflowNodeV1,
} from "@paperclipai/shared";

import {
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from "../../errors.js";
import { authorizationService } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { workflowNodeRegistryService } from "./workflow-node-registry.js";
import { workflowService } from "./workflow-service.js";

export interface WorkflowAuthoringContext {
  companyId: string;
  agentId: string;
  runId: string;
  projectId?: string | null;
}

type DraftMutationResult = {
  status: "updated" | "replayed";
  workflow: WorkflowDetail;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deterministicWorkflowId(
  companyId: string,
  agentId: string,
  runId: string,
  idempotencyKey: string,
): string {
  const hex = createHash("sha256")
    .update(
      JSON.stringify([
        "aw-workflow-authoring-v1",
        companyId,
        agentId,
        runId,
        idempotencyKey,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13)}`;
  const variantNibble = (
    (Number.parseInt(versioned[16] ?? "0", 16) & 0x3) |
    0x8
  ).toString(16);
  const variant = `${versioned.slice(0, 16)}${variantNibble}${versioned.slice(17)}`;
  return [
    variant.slice(0, 8),
    variant.slice(8, 12),
    variant.slice(12, 16),
    variant.slice(16, 20),
    variant.slice(20, 32),
  ].join("-");
}

function authoringActor(context: WorkflowAuthoringContext) {
  return {
    principal: { type: "agent" as const, agentId: context.agentId },
    runId: context.runId,
  };
}

function currentDraft(detail: WorkflowDetail) {
  if (!detail.draftRevision || detail.draftRevision.id !== detail.draftRevisionId) {
    throw conflict("Workflow draft pointer is unavailable", {
      code: "workflow_revision_conflict",
      currentDraftRevisionId: detail.draftRevisionId,
    });
  }
  return detail.draftRevision;
}

function assertExpectedRevision(
  detail: WorkflowDetail,
  expectedRevisionId: string,
): void {
  if (detail.draftRevisionId !== expectedRevisionId) {
    throw conflict("Workflow draft changed before the authoring mutation", {
      code: "workflow_revision_conflict",
      expectedRevisionId,
      currentDraftRevisionId: detail.draftRevisionId,
      currentPublishedRevisionId: detail.publishedRevisionId,
    });
  }
}

function nodeMatchesUpdates(
  node: WorkflowNodeV1,
  updates: WorkflowAuthoringUpdateStepInput["updates"],
): boolean {
  if (updates.name !== undefined && node.name !== updates.name) return false;
  if (
    updates.position !== undefined &&
    !isDeepStrictEqual(node.position, updates.position)
  ) {
    return false;
  }
  if ("config" in updates && !isDeepStrictEqual(node.config, updates.config)) {
    return false;
  }
  if (
    updates.retryPolicy !== undefined &&
    !isDeepStrictEqual(node.retryPolicy, updates.retryPolicy)
  ) {
    return false;
  }
  if (
    updates.timeoutSeconds !== undefined &&
    (node.timeoutSeconds ?? null) !== updates.timeoutSeconds
  ) {
    return false;
  }
  if (
    updates.continueOnFailure !== undefined &&
    (node.continueOnFailure ?? null) !== updates.continueOnFailure
  ) {
    return false;
  }
  return true;
}

function applyNodeUpdates(
  node: WorkflowNodeV1,
  updates: WorkflowAuthoringUpdateStepInput["updates"],
): WorkflowNodeV1 {
  const next: WorkflowNodeV1 = {
    ...node,
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.position !== undefined ? { position: updates.position } : {}),
    ...("config" in updates ? { config: updates.config } : {}),
    ...(updates.retryPolicy !== undefined
      ? { retryPolicy: updates.retryPolicy }
      : {}),
  };

  if (updates.timeoutSeconds === null) delete next.timeoutSeconds;
  else if (updates.timeoutSeconds !== undefined) {
    next.timeoutSeconds = updates.timeoutSeconds;
  }

  if (updates.continueOnFailure === null) delete next.continueOnFailure;
  else if (updates.continueOnFailure !== undefined) {
    next.continueOnFailure = updates.continueOnFailure;
  }

  return next;
}

export function workflowAuthoringToolsService(db: Db) {
  const workflows = workflowService(db);
  const registry = workflowNodeRegistryService(db);
  const authorization = authorizationService(db);
  const settings = instanceSettingsService(db);

  async function assertEnabled(): Promise<void> {
    const experimental = await settings.getExperimental();
    if (
      experimental.enableWorkflowsV1 !== true ||
      experimental.enableWorkflowBuilderV1 !== true ||
      experimental.enableAiWorkflowAuthoring !== true
    ) {
      throw notFound("AI workflow authoring is not enabled", {
        code: "workflow_authoring_disabled",
      });
    }
  }

  async function resolveContext(context: WorkflowAuthoringContext) {
    await assertEnabled();
    const run = await db
      .select({
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        status: heartbeatRuns.status,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.id, context.runId),
          eq(heartbeatRuns.companyId, context.companyId),
          eq(heartbeatRuns.agentId, context.agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!run || run.status !== "running") {
      throw forbidden("Workflow authoring requires the active agent run", {
        code: "workflow_authoring_run_required",
      });
    }
    const snapshot = asRecord(run.contextSnapshot);
    const snapshotProjectId =
      typeof snapshot.projectId === "string" && snapshot.projectId.length > 0
        ? snapshot.projectId
        : null;
    if (
      snapshotProjectId &&
      context.projectId &&
      snapshotProjectId !== context.projectId
    ) {
      throw forbidden("Workflow authoring project context changed", {
        code: "workflow_authoring_project_mismatch",
      });
    }
    return {
      projectId: snapshotProjectId ?? context.projectId ?? null,
    };
  }

  async function assertPermission(
    context: WorkflowAuthoringContext,
    action: "workflows:edit" | "workflows:publish",
  ) {
    const decision = await authorization.decide({
      actor: {
        type: "agent",
        agentId: context.agentId,
        companyId: context.companyId,
        runId: context.runId,
      },
      action,
      resource: { type: "company", companyId: context.companyId },
    });
    if (!decision.allowed) {
      throw forbidden(decision.explanation, {
        code: "permission_denied",
        permission: action,
        reason: decision.reason,
      });
    }
  }

  async function loadEditable(
    context: WorkflowAuthoringContext,
    workflowId: string,
  ) {
    const scope = await resolveContext(context);
    await assertPermission(context, "workflows:edit");
    const detail = await workflows.getDetail(context.companyId, workflowId);
    if (!detail) throw notFound("Workflow not found");
    if (
      scope.projectId &&
      detail.projectId !== scope.projectId
    ) {
      throw forbidden("Workflow is outside the active project context", {
        code: "workflow_authoring_project_mismatch",
        workflowId,
      });
    }
    return detail;
  }

  async function saveGraph(
    context: WorkflowAuthoringContext,
    detail: WorkflowDetail,
    expectedRevisionId: string,
    graph: WorkflowGraphV1,
    changeSummary: string,
  ): Promise<WorkflowDetail> {
    assertExpectedRevision(detail, expectedRevisionId);
    const draft = currentDraft(detail);
    return workflows.updateDraft(
      context.companyId,
      detail.id,
      {
        expectedRevisionId,
        graph,
        inputSchema: draft.inputSchema,
        outputSchema: draft.outputSchema,
        changeSummary,
      },
      authoringActor(context),
    );
  }

  async function create(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
  ) {
    const parsed = workflowAuthoringCreateInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring create input", parsed.error.issues);
    }
    const scope = await resolveContext(context);
    await assertPermission(context, "workflows:edit");
    const requestedProjectId = parsed.data.projectId ?? scope.projectId;
    if (
      scope.projectId &&
      requestedProjectId &&
      requestedProjectId !== scope.projectId
    ) {
      throw forbidden("Workflow creation is outside the active project context", {
        code: "workflow_authoring_project_mismatch",
      });
    }

    const workflowId = deterministicWorkflowId(
      context.companyId,
      context.agentId,
      context.runId,
      parsed.data.idempotencyKey,
    );
    const existing = await workflows.getDetail(context.companyId, workflowId);
    if (existing) {
      const sameRequest =
        existing.projectId === (requestedProjectId ?? null) &&
        existing.name === parsed.data.name &&
        existing.description === (parsed.data.description ?? null);
      if (!sameRequest) {
        throw conflict("Workflow authoring idempotency key was reused", {
          code: "workflow_authoring_idempotency_conflict",
          workflowId,
        });
      }
      return { status: "replayed" as const, workflow: existing };
    }

    const workflow = await workflows.create(
      context.companyId,
      {
        projectId: requestedProjectId ?? null,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      },
      authoringActor(context),
      { workflowId },
    );
    return { status: "created" as const, workflow };
  }

  async function addNode(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
    category: "trigger" | "step",
  ): Promise<DraftMutationResult> {
    const schema =
      category === "trigger"
        ? workflowAuthoringAddTriggerInputSchema
        : workflowAuthoringAddStepInputSchema;
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring node input", parsed.error.issues);
    }
    const detail = await loadEditable(context, parsed.data.workflowId);
    const draft = currentDraft(detail);
    const descriptor = registry.get(parsed.data.node.type);
    if (!descriptor) {
      throw unprocessable("Workflow node type is not registered", {
        code: "workflow_node_type_unregistered",
        nodeType: parsed.data.node.type,
      });
    }
    if (category === "trigger" && descriptor.category !== "trigger") {
      throw unprocessable("add_trigger requires a trigger node type", {
        code: "workflow_authoring_category_mismatch",
        nodeType: parsed.data.node.type,
      });
    }
    if (category === "step" && descriptor.category === "trigger") {
      throw unprocessable("Trigger nodes must be added with add_trigger", {
        code: "workflow_authoring_category_mismatch",
        nodeType: parsed.data.node.type,
      });
    }

    const existing = draft.graph.nodes.find(
      (node) => node.id === parsed.data.node.id,
    );
    if (existing) {
      if (
        detail.draftRevisionId !== parsed.data.expectedRevisionId &&
        isDeepStrictEqual(existing, parsed.data.node)
      ) {
        return { status: "replayed", workflow: detail };
      }
      throw conflict("Workflow node id already exists", {
        code: "workflow_authoring_node_conflict",
        nodeId: parsed.data.node.id,
        currentDraftRevisionId: detail.draftRevisionId,
      });
    }
    assertExpectedRevision(detail, parsed.data.expectedRevisionId);

    if (category === "trigger") {
      const triggerIds = draft.graph.nodes
        .filter((node) => registry.get(node.type)?.category === "trigger")
        .map((node) => node.id);
      if (triggerIds.length > 0) {
        throw conflict("Workflow draft already has a trigger", {
          code: "workflow_authoring_trigger_exists",
          triggerIds,
        });
      }
    }

    await registry.validateDraftNode(context.companyId, parsed.data.node);
    const graph = {
      ...draft.graph,
      nodes: [...draft.graph.nodes, parsed.data.node],
    };
    await registry.validateDraftGraph(context.companyId, graph);
    return {
      status: "updated",
      workflow: await saveGraph(
        context,
        detail,
        parsed.data.expectedRevisionId,
        graph,
        category === "trigger"
          ? `AI authoring: add trigger ${parsed.data.node.id}`
          : `AI authoring: add step ${parsed.data.node.id}`,
      ),
    };
  }

  async function updateStep(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
  ): Promise<DraftMutationResult> {
    const parsed = workflowAuthoringUpdateStepInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring update input", parsed.error.issues);
    }
    const detail = await loadEditable(context, parsed.data.workflowId);
    const draft = currentDraft(detail);
    const index = draft.graph.nodes.findIndex(
      (node) => node.id === parsed.data.nodeId,
    );
    if (index < 0) throw notFound("Workflow step not found");
    const existing = draft.graph.nodes[index]!;
    if (
      detail.draftRevisionId !== parsed.data.expectedRevisionId &&
      nodeMatchesUpdates(existing, parsed.data.updates)
    ) {
      return { status: "replayed", workflow: detail };
    }
    assertExpectedRevision(detail, parsed.data.expectedRevisionId);

    const updated = applyNodeUpdates(existing, parsed.data.updates);
    await registry.validateDraftNode(context.companyId, updated);
    const nodes = [...draft.graph.nodes];
    nodes[index] = updated;
    const graph = { ...draft.graph, nodes };
    await registry.validateDraftGraph(context.companyId, graph);
    return {
      status: "updated",
      workflow: await saveGraph(
        context,
        detail,
        parsed.data.expectedRevisionId,
        graph,
        `AI authoring: update step ${parsed.data.nodeId}`,
      ),
    };
  }

  async function connectSteps(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
  ): Promise<DraftMutationResult> {
    const parsed = workflowAuthoringConnectStepsInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring edge input", parsed.error.issues);
    }
    const detail = await loadEditable(context, parsed.data.workflowId);
    const draft = currentDraft(detail);
    const existing = draft.graph.edges.find(
      (edge) => edge.id === parsed.data.edge.id,
    );
    if (existing) {
      if (
        detail.draftRevisionId !== parsed.data.expectedRevisionId &&
        isDeepStrictEqual(existing, parsed.data.edge)
      ) {
        return { status: "replayed", workflow: detail };
      }
      throw conflict("Workflow edge id already exists", {
        code: "workflow_authoring_edge_conflict",
        edgeId: parsed.data.edge.id,
        currentDraftRevisionId: detail.draftRevisionId,
      });
    }
    assertExpectedRevision(detail, parsed.data.expectedRevisionId);
    const graph = {
      ...draft.graph,
      edges: [...draft.graph.edges, parsed.data.edge],
    };
    await registry.validateDraftGraph(context.companyId, graph);
    return {
      status: "updated",
      workflow: await saveGraph(
        context,
        detail,
        parsed.data.expectedRevisionId,
        graph,
        `AI authoring: connect ${parsed.data.edge.source} to ${parsed.data.edge.target}`,
      ),
    };
  }

  async function removeStep(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
  ): Promise<DraftMutationResult> {
    const parsed = workflowAuthoringRemoveStepInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring remove input", parsed.error.issues);
    }
    const detail = await loadEditable(context, parsed.data.workflowId);
    const draft = currentDraft(detail);
    const existing = draft.graph.nodes.find(
      (node) => node.id === parsed.data.nodeId,
    );
    if (!existing) {
      if (detail.draftRevisionId !== parsed.data.expectedRevisionId) {
        return { status: "replayed", workflow: detail };
      }
      throw notFound("Workflow step not found");
    }
    assertExpectedRevision(detail, parsed.data.expectedRevisionId);
    const graph = {
      ...draft.graph,
      nodes: draft.graph.nodes.filter((node) => node.id !== parsed.data.nodeId),
      edges: draft.graph.edges.filter(
        (edge) =>
          edge.source !== parsed.data.nodeId &&
          edge.target !== parsed.data.nodeId,
      ),
    };
    await registry.validateDraftGraph(context.companyId, graph);
    return {
      status: "updated",
      workflow: await saveGraph(
        context,
        detail,
        parsed.data.expectedRevisionId,
        graph,
        `AI authoring: remove step ${parsed.data.nodeId}`,
      ),
    };
  }

  async function testStep(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
  ) {
    const parsed = workflowAuthoringTestStepInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring test input", parsed.error.issues);
    }
    const detail = await loadEditable(context, parsed.data.workflowId);
    const draft = currentDraft(detail);
    const node = draft.graph.nodes.find((candidate) => candidate.id === parsed.data.nodeId);
    if (!node) throw notFound("Workflow step not found");
    await registry.validateDraftNode(context.companyId, node);
    const descriptor = registry.get(node.type);
    if (!descriptor) {
      throw unprocessable("Workflow node type is not registered", {
        code: "workflow_node_type_unregistered",
        nodeType: node.type,
      });
    }
    return {
      status: "validated" as const,
      workflowId: detail.id,
      draftRevisionId: draft.id,
      nodeId: node.id,
      nodeType: node.type,
      validationPassed: true,
      executionPerformed: false,
      testMode: descriptor.testMode,
      publishState: descriptor.publishState,
      publishBlockedReason: descriptor.publishBlockedReason,
    };
  }

  async function preparePublish(
    context: WorkflowAuthoringContext,
    rawInput: unknown,
  ) {
    const parsed = workflowAuthoringPublishInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw unprocessable("Invalid workflow authoring publish input", parsed.error.issues);
    }
    const scope = await resolveContext(context);
    await assertPermission(context, "workflows:publish");
    const detail = await workflows.getDetail(context.companyId, parsed.data.workflowId);
    if (!detail) throw notFound("Workflow not found");
    if (scope.projectId && detail.projectId !== scope.projectId) {
      throw forbidden("Workflow is outside the active project context", {
        code: "workflow_authoring_project_mismatch",
      });
    }
    if (
      detail.draftRevisionId !== parsed.data.expectedDraftRevisionId ||
      detail.publishedRevisionId !== parsed.data.expectedPublishedRevisionId
    ) {
      throw conflict("Workflow publication state changed before validation", {
        code: "workflow_revision_conflict",
        currentDraftRevisionId: detail.draftRevisionId,
        currentPublishedRevisionId: detail.publishedRevisionId,
      });
    }
    const draft = currentDraft(detail);
    await registry.validatePublishGraph(context.companyId, draft.graph);

    // Deliberately no workflowService.publish() call here. PR 50 gives the
    // authoring agent typed draft tools and publish assistance, while the
    // existing human/governed publish path remains authoritative.
    return {
      status: "ready_for_human_publish" as const,
      workflowId: detail.id,
      draftRevisionId: draft.id,
      publishedRevisionId: detail.publishedRevisionId,
      publishReady: true,
      requiresHumanPublish: true,
      publishRequest: {
        expectedDraftRevisionId: draft.id,
        expectedPublishedRevisionId: detail.publishedRevisionId,
      },
    };
  }

  return {
    create,
    addTrigger: (
      context: WorkflowAuthoringContext,
      input: unknown,
    ) => addNode(context, input, "trigger"),
    addStep: (
      context: WorkflowAuthoringContext,
      input: unknown,
    ) => addNode(context, input, "step"),
    updateStep,
    connectSteps,
    removeStep,
    testStep,
    preparePublish,
  };
}
