import {
  workflowExperienceSchema,
  type WorkflowDetail,
  type WorkflowNodeDefinitionDescriptor,
  type WorkflowRevision,
  type WorkflowExperienceRevision,
} from "@paperclipai/shared";
import { workflowComparison } from "./workflow-comparison.js";
import { customerWorkflowLaunchReady } from "../workflows/workflow-customer-launch.js";

/** Native graph projection only. Config, prompts, schemas, variables and results never leave here. */
export function workflowReview(
  detail: WorkflowDetail,
  definitions: WorkflowNodeDefinitionDescriptor[],
  canEdit: boolean,
  canOperate = false,
  canRequestRun = false,
) {
  if (
    Boolean(detail.draftRevisionId) !== Boolean(detail.draftRevision) ||
    Boolean(detail.publishedRevisionId) !== Boolean(detail.publishedRevision)
  )
    throw new Error("Workflow revision binding changed");
  const registry = new Map(
    definitions.map((definition) => [definition.type, definition]),
  );
  let draftNodeOrder: string[] = [];
  function revision(
    source: WorkflowRevision | null,
    state: "draft" | "published",
  ): WorkflowExperienceRevision | null {
    if (!source) return null;
    if (
      source.companyId !== detail.companyId ||
      source.workflowId !== detail.id ||
      source.state !== state ||
      source.id !==
        (state === "draft"
          ? detail.draftRevisionId
          : detail.publishedRevisionId)
    )
      throw new Error("Workflow revision binding changed");
    const { nodes, edges } = source.graph;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const bounded =
      nodes.length <= 100 &&
      edges.length <= 200 &&
      nodeIds.size === nodes.length &&
      new Set(edges.map((edge) => edge.id)).size === edges.length &&
      edges.every(
        (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
      );
    const ordered: typeof nodes = [];
    if (bounded) {
      const incoming = new Map(nodes.map((node) => [node.id, 0]));
      for (const edge of edges)
        incoming.set(edge.target, incoming.get(edge.target)! + 1);
      const remaining = new Set(nodeIds);
      while (remaining.size) {
        const ready = nodes.find(
          (node) => remaining.has(node.id) && incoming.get(node.id) === 0,
        );
        if (!ready) break; // Cyclic drafts are not a readable ordered flow.
        remaining.delete(ready.id);
        ordered.push(ready);
        for (const edge of edges)
          if (edge.source === ready.id)
            incoming.set(edge.target, incoming.get(edge.target)! - 1);
      }
    }
    const available = bounded && ordered.length === nodes.length;
    if (state === "draft" && available)
      draftNodeOrder = ordered.map((node) => node.id);
    const positions = new Map(
      ordered.map((node, index) => [node.id, index + 1]),
    );
    return {
      id: source.id,
      version: source.revisionNumber,
      state,
      coverage: available ? "complete" : "flow_unavailable",
      steps: available
        ? ordered.map((node, index) => {
            const definition = registry.get(node.type);
            const retry = node.retryPolicy ?? definition?.retryPolicyDefault;
            return {
              number: index + 1,
              name: node.name.slice(0, 160),
              operation:
                definition?.displayName.slice(0, 160) ?? "Unknown operation",
              effect: definition?.sideEffectClass ?? "unknown",
              testMode: definition?.testMode ?? "unavailable",
              approval:
                node.type === "human.approval" ? "checkpoint" : "not_verified",
              retry: !retry
                ? "unknown"
                : retry.mode === "none"
                  ? "none"
                  : "declared",
              next: edges
                .filter((edge) => edge.source === node.id)
                .map((edge) => ({
                  number: positions.get(edge.target)!,
                  label: edge.label?.slice(0, 160) ?? null,
                  output: edge.sourceHandle?.slice(0, 160) ?? null,
                })),
            };
          })
        : [],
    };
  }
  const draft = revision(detail.draftRevision, "draft"),
    active = revision(detail.publishedRevision, "published");
  return workflowExperienceSchema.parse({
    companyId: detail.companyId,
    id: detail.id,
    name: detail.name.slice(0, 160),
    description: detail.description?.slice(0, 600) ?? null,
    // Native create keeps status=active before first publication. Do not present that as live.
    status:
      detail.status === "active" && !detail.publishedRevisionId
        ? "draft"
        : detail.status,
    canEdit: canEdit && detail.status !== "archived",
    canOperate,
    canRequestRun,
    runAvailability:
      detail.status !== "active" || !detail.publishedRevisionId
        ? "not_active"
        : customerWorkflowLaunchReady(detail.publishedRevision)
          ? "internal_ready"
          : "review_required",
    updatedAt: detail.updatedAt.toISOString(),
    draft,
    active,
    comparison: workflowComparison(
      detail.publishedRevision,
      detail.draftRevision,
      active,
      draft,
      draftNodeOrder,
    ),
  });
}
