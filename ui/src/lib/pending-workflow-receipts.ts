import { pendingWorkflowReceiptSchema as row, pendingWorkflowReceiptInventorySchema as inventory } from "@paperclipai/shared";

const key = "aw.v9.pending-workflow-draft-receipts";
function load() {
  const value = window.sessionStorage.getItem(key);
  if (value === null) return [];
  if (value.length > 8192 || new TextEncoder().encode(value).length > 8192) throw new Error("Workflow recovery is unavailable");
  return inventory.parse(JSON.parse(value));
}
function save(values: ReturnType<typeof inventory.parse>) {
  const value = JSON.stringify(inventory.parse(values));
  if (new TextEncoder().encode(value).length > 8192) throw new Error("Workflow recovery is unavailable");
  if (values.length) window.sessionStorage.setItem(key, value);
  else window.sessionStorage.removeItem(key);
}
/** Per-tab original request locators only. No intent, result or credentials. */
export function readPendingWorkflowReceipt(companyId: string, principal: string) {
  return load().find(value => value.companyId === companyId && value.principal === principal)?.requestId ?? null;
}
export function retainPendingWorkflowReceipt(companyId: string, principal: string, requestId: string) {
  const values = load();
  if (values.some(value => value.companyId === companyId && value.principal === principal)) throw new Error("A workflow request is already pending");
  save([...values, row.parse({ companyId, principal, requestId })]);
}
export function clearPendingWorkflowReceipt(companyId: string, principal: string, requestId: string) {
  save(load().filter(value => !(value.companyId === companyId && value.principal === principal && value.requestId === requestId)));
}
