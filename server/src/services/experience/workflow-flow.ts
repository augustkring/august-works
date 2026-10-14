import type { WorkflowNodeDefinitionDescriptor, WorkflowRevision, WorkflowExperienceRevision } from "@paperclipai/shared";

/** Reuse the Original bounded flow projection for current or historical
 * revisions already read through their canonical privacy/authority owner.
 * Version state belongs to the caller; this projection invents none. */
export function projectWorkflowRevisionFlow(source: WorkflowRevision, definitions: WorkflowNodeDefinitionDescriptor[]): {
  nodeOrder: string[]; flow: Omit<WorkflowExperienceRevision, "state">;
} {
  const registry = new Map(definitions.map(definition => [definition.type, definition]));
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

  const positions = new Map(
    ordered.map((node, index) => [node.id, index + 1]),
  );
  return { nodeOrder: ordered.map(node => node.id), flow: {
    id: source.id,
    version: source.revisionNumber,
    coverage: available ? "complete" : "flow_unavailable",
    steps: available
      ? ordered.map((node, index) => {
          const definition = registry.get(node.type);
          const retry = node.retryPolicy ?? definition?.retryPolicyDefault;
          return {
            nodeId: node.id,
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
  } };
}
