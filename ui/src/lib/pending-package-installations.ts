import { pendingPackageInstallationRequestSchema as row, pendingPackageInstallationRequestInventorySchema as inventory } from "@paperclipai/shared";

const key = "aw.v9.pending-package-installation-requests";
function load() {
  const value = window.sessionStorage.getItem(key);
  if (value === null) return [];
  if (value.length > 8192 || new TextEncoder().encode(value).length > 8192) throw new Error("Installation recovery is unavailable");
  return inventory.parse(JSON.parse(value));
}
function save(values: ReturnType<typeof inventory.parse>) {
  const value = JSON.stringify(inventory.parse(values));
  if (new TextEncoder().encode(value).length > 8192) throw new Error("Installation recovery is unavailable");
  if (values.length) window.sessionStorage.setItem(key, value);
  else window.sessionStorage.removeItem(key);
}
/** Per-tab locators only. No configuration, content, reason or result. */
export function readPendingPackageInstallation(companyId: string, principal: string) {
  return load().find(value => value.companyId === companyId && value.principal === principal)?.requestId ?? null;
}
export function retainPendingPackageInstallation(companyId: string, principal: string, requestId: string) {
  const values = load();
  if (values.some(value => value.companyId === companyId && value.principal === principal)) throw new Error("An installation request is already pending");
  save([...values, row.parse({ companyId, principal, requestId })]);
}
export function clearPendingPackageInstallation(companyId: string, principal: string, requestId: string) {
  save(load().filter(value => !(value.companyId === companyId && value.principal === principal && value.requestId === requestId)));
}
