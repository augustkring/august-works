import type { WorkflowRevision } from "@paperclipai/shared";
import { HttpError } from "../../errors.js";
import {
  validateWorkflowPublishTopology,
  workflowNodeDefinitions,
} from "./workflow-node-registry.js";

// A closed native subset. Generic pure declarations cannot admit child work,
// agent/model calls, network requests, approvals or configurable tool adapters.
const types = new Set([
  "core.manual_trigger",
  "core.condition",
  "core.switch",
  "core.merge",
  "core.parallel",
]);
export function customerWorkflowLaunchReady(
  revision: WorkflowRevision | null,
): boolean {
  return (
    revision?.state === "published" &&
    customerWorkflowInternalGraphReady(revision)
  );
}
export function customerWorkflowTestReady(
  revision: WorkflowRevision | null,
): boolean {
  return (
    revision?.state === "draft" && customerWorkflowInternalGraphReady(revision)
  );
}
/** Native admission/recovery validates the immutable test graph, irrespective
 * of later draft replacement/publication. This predicate grants no authority. */
export function customerWorkflowInternalGraphReady(
  revision: WorkflowRevision | null,
): boolean {
  if (
    !revision ||
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
    if (Buffer.byteLength(JSON.stringify(revision.graph), "utf8") > 65_536)
      return false;
  } catch {
    return false;
  }
  const registry = new Map(
    workflowNodeDefinitions().map((definition) => [
      definition.type,
      definition,
    ]),
  );
  const internal = nodes.every((node) => {
    // Transform nodes can invoke governed Optimizer artifact replacements; the
    // closed customer subset must not infer their effective execution from a
    // pure built-in descriptor. Recovery approvals and delayed retries also
    // require their original review rather than this internal-only command.
    if (
      node.inputSchema !== undefined ||
      node.failurePolicy === "wait_for_human" ||
      (node.retryPolicy && node.retryPolicy.mode !== "none")
    )
      return false;
    const definition = registry.get(node.type);
    return (
      types.has(node.type) &&
      definition?.sideEffectClass === "pure" &&
      definition.riskDefault === "C0" &&
      definition.testMode === "safe"
    );
  });
  if (!internal) return false;
  // Draft saves admit incomplete topology. Do not offer a ready internal Test
  // for a graph that the native admission owner will refuse before enqueue.
  try {
    validateWorkflowPublishTopology(revision.graph);
  } catch (error) {
    if (error instanceof HttpError && error.status === 422) return false;
    throw error;
  }
  return true;
}
