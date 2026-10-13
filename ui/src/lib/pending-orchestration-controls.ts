import { pendingOrchestrationControlLocatorsSchema } from "@paperclipai/shared";
const key = "aw.v9.pending-orchestration-control-receipts";
function load() {
  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > 8192) throw new Error("Control recovery storage is invalid");
  return pendingOrchestrationControlLocatorsSchema.parse(JSON.parse(raw));
}
function save(rows: ReturnType<typeof load>) {
  const value = JSON.stringify(pendingOrchestrationControlLocatorsSchema.parse(rows));
  if (new TextEncoder().encode(value).length > 8192) throw new Error("Control recovery storage is full");
  window.sessionStorage.setItem(key, value);
}
const match = (row: ReturnType<typeof load>[number], company: string, principal: string, plan: string) =>
  row.companyId === company && row.principal === principal && row.planId === plan;
export function pendingOrchestrationControl(company: string, principal: string, plan: string) {
  return load().find(row => match(row, company, principal, plan))?.requestId ?? null;
}
export function retainOrchestrationControl(company: string, principal: string, plan: string, requestId: string) {
  const rows = load(); if (rows.some(row => match(row, company, principal, plan))) throw new Error("An Original control request still needs review");
  save([...rows, { companyId: company, principal, planId: plan, requestId }]);
}
export function clearOrchestrationControl(company: string, principal: string, plan: string, requestId: string) {
  save(load().filter(row => !match(row, company, principal, plan) || row.requestId !== requestId));
}
