import {
  workflowExperienceSchema,
  type WorkflowDetail,
  type WorkflowNodeDefinitionDescriptor,
  type WorkflowRevision,
  type WorkflowExperienceRevision,
  type WorkflowTestReceipt,
} from "@paperclipai/shared";
import { projectWorkflowRevisionFlow } from "./workflow-flow.js";
import { workflowComparison } from "./workflow-comparison.js";
import {
  customerWorkflowLaunchReady,
  customerWorkflowTestReady,
} from "../workflows/workflow-customer-launch.js";

/** Native graph projection only. Config, prompts, schemas, variables and results never leave here. */
export function workflowReview(
  detail: WorkflowDetail,
  definitions: WorkflowNodeDefinitionDescriptor[],
  canEdit: boolean,
  canOperate = false,
  canRequestRun = false,
  canRequestTest = false,
  testReceipt: WorkflowTestReceipt | null = null,
) {
  if (
    Boolean(detail.draftRevisionId) !== Boolean(detail.draftRevision) ||
    Boolean(detail.publishedRevisionId) !== Boolean(detail.publishedRevision)
  )
    throw new Error("Workflow revision binding changed");
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
    const { flow, nodeOrder } = projectWorkflowRevisionFlow(source, definitions);
    if (state === "draft" && flow.coverage === "complete") draftNodeOrder = nodeOrder;
    return { ...flow, state };
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
    canRequestTest,
    testReceipt,
    testAvailability:
      detail.status !== "active"
        ? "not_active"
        : !detail.draftRevision
          ? "no_draft"
          : customerWorkflowTestReady(detail.draftRevision)
            ? "internal_ready"
            : "review_required",
    testDeadlineSeconds:
      detail.status === "active" &&
      customerWorkflowTestReady(detail.draftRevision)
        ? detail.draftRevision!.graph.settings.totalDeadlineSeconds
        : null,
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
