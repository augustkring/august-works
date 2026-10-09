import {
  workflowRunExperienceSchema,
  type WorkflowRunDetail,
  type WorkflowRevision,
  type WorkflowNodeDefinitionDescriptor,
  type WorkflowRunExperience,
} from "@paperclipai/shared";

/** Native attempt metadata only; no inputs, outputs, errors, actor IDs or decisions. */
export function workflowRunReview(
  detail: WorkflowRunDetail,
  revision: WorkflowRevision,
  definitions: WorkflowNodeDefinitionDescriptor[],
): WorkflowRunExperience {
  const { run, steps, waits } = detail;
  if (
    revision.id !== run.workflowRevisionId ||
    revision.companyId !== run.companyId ||
    revision.workflowId !== run.workflowId
  )
    throw new Error("Workflow run revision binding changed");
  const nodes = revision.graph.nodes;
  const withinLimits =
    nodes.length <= 100 &&
    revision.graph.edges.length <= 200 &&
    steps.length <= 500 &&
    waits.length <= 200;
  const checkedNodes = withinLimits ? nodes : [];
  const checkedSteps = withinLimits ? steps : [];
  const ids = new Set(checkedNodes.map((node) => node.id));
  const attemptKeys = new Set(
    checkedSteps.map((step) => `${step.nodeId}:${step.attempt}`),
  );
  const bounded =
    withinLimits &&
    ids.size === nodes.length &&
    new Set(steps.map((step) => step.id)).size === steps.length &&
    attemptKeys.size === steps.length &&
    new Set(waits.map((wait) => wait.id)).size === waits.length &&
    steps.every(
      (step) =>
        step.companyId === run.companyId &&
        step.workflowRunId === run.id &&
        ids.has(step.nodeId),
    ) &&
    waits.every(
      (wait) =>
        wait.companyId === run.companyId &&
        wait.workflowRunId === run.id &&
        ids.has(wait.nodeId) &&
        steps.some((step) => step.nodeId === wait.nodeId),
    );
  const registry = new Map(
    definitions.map((definition) => [definition.type, definition]),
  );
  const nodeMap = new Map(checkedNodes.map((node) => [node.id, node]));
  const trace = bounded
    ? {
        state: "available" as const,
        attempts: steps.map((step) => {
          const node = nodeMap.get(step.nodeId)!;
          return {
            id: step.id,
            name: node.name.slice(0, 160),
            operation:
              registry.get(node.type)?.displayName.slice(0, 160) ??
              "Unknown operation",
            attempt: step.attempt,
            status: step.status,
            execution: step.agentId
              ? ("agent" as const)
              : step.toolInvocationId
                ? ("tool" as const)
                : ("not_recorded" as const),
            approvalCheckpoint: node.type === "human.approval",
            payloadUnavailable: step.payloadDeleted === true,
            waitingFor:
              step.status === "waiting"
                ? [
                    ...new Set(
                      waits
                        .filter(
                          (wait) =>
                            wait.nodeId === step.nodeId &&
                            wait.status === "active",
                        )
                        .map((wait) => wait.kind),
                    ),
                  ]
                : [],
          };
        }),
      }
    : { state: "unavailable" as const };
  return workflowRunExperienceSchema.parse({
    companyId: run.companyId,
    id: run.id,
    workflowId: run.workflowId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    revisionState: revision.state,
    status: run.status,
    trace,
  });
}
