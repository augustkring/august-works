import {
  workflowRunExperienceSchema,
  type WorkflowRunDetail,
  type WorkflowRevision,
  type WorkflowNodeDefinitionDescriptor,
  type WorkflowRunExperience,
  type WorkflowStepRun,
  type WorkflowGraphV1,
  type WorkflowStopReceipt,
} from "@paperclipai/shared";

type BranchChoice = Extract<
  WorkflowRunExperience["trace"],
  { state: "available" }
>["attempts"][number]["branchChoice"];

/** Read only the executor's completed control checkpoint. Never infer a branch
 * from another node's attempt: parallel paths and merges make that ambiguous.
 * Return the bound revision's next-step name, never the private switch value. */
function branchChoice(
  step: WorkflowStepRun,
  node: WorkflowGraphV1["nodes"][number],
  graph: WorkflowGraphV1,
): BranchChoice {
  const recovery = ["follow_failure_branch", "wait_for_human"].includes(
    node.failurePolicy ?? "fail_workflow",
  );
  if (
    !recovery &&
    node.type !== "core.condition" &&
    node.type !== "core.switch"
  )
    return { state: "not_applicable" };
  if (
    recovery ||
    step.status !== "succeeded" ||
    step.failureResolution?.resolved ||
    step.payloadDeleted ||
    !step.outputJson ||
    typeof step.outputJson !== "object" ||
    Array.isArray(step.outputJson)
  )
    return { state: "not_recorded" };
  const output = step.outputJson as Record<string, unknown>;
  const key =
    node.type === "core.condition"
      ? typeof output.result === "boolean"
        ? String(output.result)
        : null
      : typeof output.branchKey === "string"
        ? output.branchKey
        : null;
  if (key === null) return { state: "not_recorded" };
  const selected = graph.edges.filter(
    (edge) =>
      edge.source === node.id &&
      (node.type === "core.condition"
        ? (edge.sourceHandle ?? edge.label ?? "").trim().toLowerCase()
        : (edge.sourceHandle ?? edge.label ?? "").trim()) === key,
  );
  if (selected.length !== 1) return { state: "not_recorded" };
  const target = graph.nodes.find(
    (candidate) => candidate.id === selected[0].target,
  );
  return target
    ? { state: "selected", nextStep: target.name.slice(0, 160) }
    : { state: "not_recorded" };
}

/** Native attempt metadata and bounded control checkpoints only; no raw payloads,
 * errors, actor identities, approval decisions or independent verification. */
export function workflowRunReview(
  detail: WorkflowRunDetail,
  revision: WorkflowRevision,
  definitions: WorkflowNodeDefinitionDescriptor[],
  canRequestStop = false,
  stopReceipt: WorkflowStopReceipt | null = null,
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
    new Set(revision.graph.edges.map((edge) => edge.id)).size ===
      revision.graph.edges.length &&
    revision.graph.edges.every(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    ) &&
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
            branchChoice: branchChoice(step, node, revision.graph),
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
    updatedAt: run.updatedAt.toISOString(),
    canRequestStop,
    stopReceipt,
    trace,
  });
}
