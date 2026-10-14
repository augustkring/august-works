import { workflowDraftStepReviewSchema, workflowDraftStepCommandSchema, workflowDraftStepReceiptSchema,
  workflowEditableNodeIdSchema, type WorkflowDraftStepCommand } from "@paperclipai/shared";
import { api } from "./client";

const base = (company: string, workflow: string, principal: string) => `/companies/${company}/workflows/${workflow}/experience/draft-steps?${new URLSearchParams({ expectedUserId: principal })}`;
export const workflowDraftEditApi = {
  async review(company: string, workflow: string, principal: string, nodeId: string, signal?: AbortSignal) {
    workflowEditableNodeIdSchema.parse(nodeId);
    const value = workflowDraftStepReviewSchema.parse(await api.get(`/companies/${company}/workflows/${workflow}/experience/draft-steps/${encodeURIComponent(nodeId)}?${new URLSearchParams({ expectedUserId: principal })}`, { cache: "no-store", signal }));
    signal?.throwIfAborted();
    if (value.companyId !== company || value.workflowId !== workflow || value.nodeId !== nodeId) throw new Error("Current draft step scope changed");
    return value;
  },
  async save(company: string, workflow: string, principal: string, raw: WorkflowDraftStepCommand) {
    const command = workflowDraftStepCommandSchema.parse(raw);
    if (command.expectedWorkflowId !== workflow) throw new Error("Current draft step scope changed");
    const receipt = workflowDraftStepReceiptSchema.parse(await api.post(base(company, workflow, principal), command));
    if (receipt.companyId !== company || receipt.workflowId !== workflow || receipt.requestId !== command.requestId ||
      receipt.previousRevisionId !== command.expectedDraftRevisionId) throw new Error("Current draft receipt scope changed");
    return receipt;
  },
};
