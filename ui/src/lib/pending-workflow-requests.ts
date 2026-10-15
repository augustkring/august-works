import { pendingWorkflowRequestLocatorsSchema, workflowRequestLocatorSchema, type WorkflowRequestKind, type WorkflowRequestLocator } from "@paperclipai/shared";
const key = "aw.v9.pending-workflow-request-receipts";
export const WORKFLOW_REQUEST_LOCATORS_CHANGED = "aw:workflow-request-locators-changed";
function load() {
  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > 8192) throw new Error("Workflow request recovery is unavailable");
  return pendingWorkflowRequestLocatorsSchema.parse(JSON.parse(raw));
}
function save(rows: WorkflowRequestLocator[]) {
  const raw = JSON.stringify(pendingWorkflowRequestLocatorsSchema.parse(rows));
  if (new TextEncoder().encode(raw).length > 8192) throw new Error("Workflow request recovery is full");
  if (rows.length) window.sessionStorage.setItem(key, raw); else window.sessionStorage.removeItem(key);
  window.dispatchEvent(new Event(WORKFLOW_REQUEST_LOCATORS_CHANGED));
}
const same = (row: WorkflowRequestLocator, companyId: string, principal: string, workflowId: string, kind?: WorkflowRequestKind) =>
  row.companyId === companyId && row.principal === principal && row.workflowId === workflowId && (kind === undefined || row.kind === kind);
export const isWorkflowDraftRequest = (kind: WorkflowRequestKind) => kind === "draft_edit" || kind === "draft_build";
export function pendingWorkflowRequests(companyId: string, principal: string, workflowId: string) {
  return load().filter(row => same(row, companyId, principal, workflowId));
}
/** Per-tab locators only: no intent, input, result, reason, prompt or credential.
 * Existing explicit idempotent retry may retain its identical nonce; it cannot
 * replace an unconfirmed request with a fresh identity after reload. */
export function retainWorkflowRequest(raw: WorkflowRequestLocator) {
  const row = workflowRequestLocatorSchema.parse(raw), rows = load();
  const prior = rows.find(value => same(value, row.companyId, row.principal, row.workflowId) &&
    (value.kind === row.kind || isWorkflowDraftRequest(value.kind) && isWorkflowDraftRequest(row.kind)));
  if (prior) {
    if (prior.kind !== row.kind || prior.requestId !== row.requestId) throw new Error("The Original workflow request still needs confirmation");
    return;
  }
  save([...rows, row]);
}
export function clearWorkflowRequest(row: WorkflowRequestLocator) {
  workflowRequestLocatorSchema.parse(row);
  save(load().filter(value => !same(value, row.companyId, row.principal, row.workflowId, row.kind) || value.requestId !== row.requestId));
}
