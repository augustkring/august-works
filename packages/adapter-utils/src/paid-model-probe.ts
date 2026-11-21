import type { AdapterEnvironmentCheck } from "./types.js";

/** No generic CLI hello probe has a qualified company-purpose reservation
 * route. Keep non-paid command/auth/model discovery, but refuse inference.
 * Caller config, credentials or an external payer cannot enable this phase. */
export function admitPaidModelProbe(checks: AdapterEnvironmentCheck[]): false {
  checks.push({
    code: "paid_transport_unqualified",
    level: "error",
    message: "This runtime is not available for managed model calls. Choose an available runtime in Runtime settings.",
    detail: "configuration_incomplete; owner: Managed model gateway owner",
  });
  return false;
}
