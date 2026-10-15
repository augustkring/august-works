import { workflowDraftFlowReviewSchema, workflowDraftFlowCommandSchema, workflowDraftStepReceiptSchema, type WorkflowDraftFlowCommand } from "@paperclipai/shared";
import { api } from "./client";
const base = (company: string, workflow: string, principal: string) => `/companies/${company}/workflows/${workflow}/experience/draft-flow?${new URLSearchParams({ expectedUserId: principal })}`;
export const workflowDraftFlowApi = {
  async review(company: string, workflow: string, principal: string, signal?: AbortSignal) {
    const value = workflowDraftFlowReviewSchema.parse(await api.get(base(company, workflow, principal), { cache: "no-store", signal }));
    signal?.throwIfAborted();
    if (value.companyId !== company || value.workflowId !== workflow) throw new Error("Current draft flow scope changed"); return value;
  },
  async save(company: string, workflow: string, principal: string, raw: WorkflowDraftFlowCommand) {
    const command = workflowDraftFlowCommandSchema.parse(raw);
    if (command.expectedWorkflowId !== workflow) throw new Error("Current draft flow scope changed");
    const receipt = workflowDraftStepReceiptSchema.parse(await api.post(base(company, workflow, principal), command));
    if (receipt.companyId !== company || receipt.workflowId !== workflow || receipt.requestId !== command.requestId || receipt.previousRevisionId !== command.expectedDraftRevisionId)
      throw new Error("Current draft flow receipt scope changed"); return receipt;
  },
};
