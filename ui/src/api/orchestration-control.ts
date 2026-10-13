import { orchestrationControlViewSchema, orchestrationControlCommandSchema, orchestrationControlReceiptSchema,
  type OrchestrationControlCommand } from "@paperclipai/shared";
import { api } from "./client";
const path = (company: string, principal: string, plan: string) => {
  orchestrationControlViewSchema.shape.companyId.parse(company); orchestrationControlViewSchema.shape.planId.parse(plan);
  return `/companies/${company}/experience/orchestration/${plan}`;
};
const query = (principal: string) => new URLSearchParams({ expectedUserId: principal }).toString();
function receipt(raw: unknown, company: string, plan: string, requestId: string) {
  const value = orchestrationControlReceiptSchema.parse(raw);
  if (value.companyId !== company || value.planId !== plan || value.requestId !== requestId) throw new Error("Original control receipt scope changed");
  return value;
}
export const orchestrationControlApi = {
  get: async (company: string, principal: string, plan: string, signal?: AbortSignal) => {
    const value = orchestrationControlViewSchema.parse(await api.get(`${path(company, principal, plan)}/control?${query(principal)}`, { signal, cache: "no-store" }));
    signal?.throwIfAborted();
    if (value.companyId !== company || value.planId !== plan) throw new Error("Current control scope changed");
    return value;
  },
  request: async (company: string, principal: string, plan: string, raw: OrchestrationControlCommand) => {
    const input = orchestrationControlCommandSchema.parse(raw);
    const value = receipt(await api.post(`${path(company, principal, plan)}/control?${query(principal)}`, input), company, plan, input.requestId);
    if (value.action !== input.action || value.resultingVersion !== input.expectedVersion + 1) throw new Error("Original control admission changed");
    return value;
  },
  receipt: async (company: string, principal: string, plan: string, requestId: string, signal?: AbortSignal) => {
    orchestrationControlReceiptSchema.shape.requestId.parse(requestId);
    const value = receipt(await api.get(`${path(company, principal, plan)}/control-requests/${requestId}?${query(principal)}`, { signal, cache: "no-store" }), company, plan, requestId);
    signal?.throwIfAborted(); return value;
  },
};
