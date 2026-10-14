import {
  workflowExperienceIndexSchema, workflowIntentDraftCommandSchema, workflowIntentDraftReceiptSchema,
  workflowDraftAuthorsSchema, workflowDraftAuthorLocatorSchema,
  type WorkflowIntentDraftCommand,
} from "@paperclipai/shared";
import { api } from "./client";

const base = (company: string, principal: string) => {
  workflowIntentDraftReceiptSchema.shape.companyId.parse(company);
  return { path: `/companies/${company}/experience`, query: new URLSearchParams({ expectedUserId: principal }).toString() };
};
function receipt(raw: unknown, company: string, requestId: string) {
  const value = workflowIntentDraftReceiptSchema.parse(raw);
  if (value.companyId !== company || value.requestId !== requestId) throw new Error("Workflow draft receipt scope changed");
  return value;
}
export const workflowAuthoringExperienceApi = {
  authors: async (company: string, workflow: string, principal: string, signal?: AbortSignal) => {
    workflowDraftAuthorLocatorSchema.shape.workflowId.parse(workflow);
    workflowIntentDraftReceiptSchema.shape.companyId.parse(company);
    const query = new URLSearchParams({ expectedUserId: principal });
    const value = workflowDraftAuthorsSchema.parse(await api.get(`/companies/${company}/workflows/${workflow}/experience/authors?${query}`, { signal, cache: "no-store" }));
    signal?.throwIfAborted();
    if (value.companyId !== company || value.workflowId !== workflow) throw new Error("Current workflow author scope changed");
    return value;
  },
  index: async (company: string, principal: string, signal?: AbortSignal) => {
    const { path, query } = base(company, principal);
    const value = workflowExperienceIndexSchema.parse(await api.get(`${path}/workflows?${query}`, { signal, cache: "no-store" }));
    signal?.throwIfAborted();
    if (value.companyId !== company) throw new Error("Workflow index scope changed");
    return value;
  },
  create: async (company: string, principal: string, raw: WorkflowIntentDraftCommand) => {
    const command = workflowIntentDraftCommandSchema.parse(raw), { path, query } = base(company, principal);
    return receipt(await api.post(`${path}/workflow-drafts?${query}`, command), company, command.requestId);
  },
  receipt: async (company: string, principal: string, requestId: string, signal?: AbortSignal) => {
    workflowIntentDraftReceiptSchema.shape.requestId.parse(requestId);
    const { path, query } = base(company, principal);
    const value = receipt(await api.get(`${path}/workflow-draft-requests/${requestId}?${query}`, { signal, cache: "no-store" }), company, requestId);
    signal?.throwIfAborted(); return value;
  },
};
