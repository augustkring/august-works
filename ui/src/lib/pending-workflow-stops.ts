import { pendingWorkflowStopLocatorsSchema } from "@paperclipai/shared";
const key = "aw.v9.pending-workflow-run-stop-receipts";
function load() {
  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > 8192) throw new Error("Run Stop recovery is unavailable");
  return pendingWorkflowStopLocatorsSchema.parse(JSON.parse(raw));
}
function save(rows: ReturnType<typeof load>) {
  const raw = JSON.stringify(pendingWorkflowStopLocatorsSchema.parse(rows));
  if (new TextEncoder().encode(raw).length > 8192) throw new Error("Run Stop recovery is full");
  if (rows.length) window.sessionStorage.setItem(key, raw); else window.sessionStorage.removeItem(key);
}
const same = (row: ReturnType<typeof load>[number], company: string, principal: string, workflow: string, run: string) =>
  row.companyId === company && row.principal === principal && row.workflowId === workflow && row.runId === run;
export function pendingWorkflowStop(company: string, principal: string, workflow: string, run: string) {
  return load().find(row => same(row, company, principal, workflow, run))?.requestId ?? null;
}
export function retainWorkflowStop(company: string, principal: string, workflow: string, run: string, requestId: string) {
  const rows = load();
  if (rows.some(row => row.companyId === company && row.principal === principal && row.runId === run)) throw new Error("The Original run Stop still needs confirmation");
  save([...rows, { companyId: company, principal, workflowId: workflow, runId: run, requestId }]);
}
export function clearWorkflowStop(company: string, principal: string, workflow: string, run: string, requestId: string) {
  save(load().filter(row => !same(row, company, principal, workflow, run) || row.requestId !== requestId));
}
