import type { WorkflowRevision } from "@paperclipai/shared";
import { workflowNodeDefinitions } from "./workflow-node-registry.js";

// A closed native subset. Generic pure declarations cannot admit child work,
// agent/model calls, network requests, approvals or configurable tool adapters.
const types = new Set([
  "core.manual_trigger",
  "core.transform",
  "core.condition",
  "core.switch",
  "core.merge",
  "core.parallel",
]);
export function customerWorkflowLaunchReady(
  revision: WorkflowRevision | null,
): boolean {
  if (
    !revision ||
    revision.state !== "published" ||
    revision.inputSchema !== null ||
    revision.outputSchema !== null
  )
    return false;
  const { nodes, edges, variables } = revision.graph;
  const deadline = revision.graph.settings.totalDeadlineSeconds;
  if (!deadline || deadline < 1 || deadline > 60) return false;
  if (
    nodes.length < 1 ||
    nodes.length > 20 ||
    edges.length > 40 ||
    variables.length > 0
  )
    return false;
  try {
    if (JSON.stringify(revision.graph).length > 65_536) return false;
  } catch {
    return false;
  }
  const registry = new Map(
    workflowNodeDefinitions().map((definition) => [
      definition.type,
      definition,
    ]),
  );
  return nodes.every((node) => {
    const definition = registry.get(node.type);
    return (
      types.has(node.type) &&
      definition?.sideEffectClass === "pure" &&
      definition.riskDefault === "C0" &&
      definition.testMode === "safe"
    );
  });
}
