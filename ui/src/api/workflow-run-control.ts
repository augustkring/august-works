import { workflowRunControlSchema, workflowStopCommandSchema, workflowStopReceiptSchema, type WorkflowStopCommand } from "@paperclipai/shared";
import { api } from "./client";
function path(company: string, principal: string, run: string, suffix: string) {
  workflowRunControlSchema.shape.companyId.parse(company); workflowRunControlSchema.shape.runId.parse(run);
  return `/companies/${company}/workflow-runs/${run}/experience/${suffix}?${new URLSearchParams({ expectedUserId: principal })}`;
}
function receipt(raw: unknown, company: string, workflow: string, run: string, requestId: string) {
  const value = workflowStopReceiptSchema.parse(raw);
  if (value.companyId !== company || value.workflowId !== workflow || value.runId !== run || value.requestId !== requestId)
    throw new Error("The Original run Stop scope changed");
  return value;
}
export const workflowRunControlApi = {
  get: async (company: string, principal: string, workflow: string, run: string, signal?: AbortSignal) => {
    workflowRunControlSchema.shape.workflowId.parse(workflow);
    const value = workflowRunControlSchema.parse(await api.get(path(company, principal, run, "control"), { signal, cache: "no-store" }));
    signal?.throwIfAborted();
    if (value.companyId !== company || value.workflowId !== workflow || value.runId !== run) throw new Error("Current retained run scope changed");
    return value;
  },
  stop: async (company: string, principal: string, workflow: string, run: string, raw: WorkflowStopCommand) => {
    const input = workflowStopCommandSchema.parse(raw);
    if (input.expectedWorkflowId !== workflow) throw new Error("The reviewed retained workflow changed");
    const value = receipt(await api.post(path(company, principal, run, "retained-stop"), input), company, workflow, run, input.requestId);
    if (value.revisionId !== input.expectedRevisionId) throw new Error("The reviewed retained revision changed"); return value;
  },
  receipt: async (company: string, principal: string, workflow: string, run: string, requestId: string, signal?: AbortSignal) => {
    workflowStopReceiptSchema.shape.requestId.parse(requestId);
    const value = receipt(await api.get(path(company, principal, run, `retained-stop-requests/${requestId}`), { signal, cache: "no-store" }), company, workflow, run, requestId);
    signal?.throwIfAborted(); return value;
  },
};
