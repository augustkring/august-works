/** Closed, content-free reasons that an operator can use to reconcile a
 * pending cleanup. Never persist arbitrary provider error details as codes. */
export const REMOTE_ASSET_ERASURE_ERRORS = {
  stop: "native_asset_erasure_stop_pending",
  locator: "native_asset_erasure_locator_changed",
  job: "native_asset_erasure_job_authority",
  purgeBinding: "native_asset_erasure_purge_binding",
  purge: "native_asset_erasure_purge_pending",
  finalization: "native_asset_erasure_finalization_pending",
  lease: "native_asset_erasure_lease_pending",
  coOwner: "native_asset_erasure_retained_coowner",
  target: "native_asset_erasure_target_unqualified",
  reconciliation: "native_asset_erasure_reconciliation_pending",
  relay: "native_asset_erasure_relay_failed",
  result: "native_asset_erasure_result_invalid",
} as const;
const allowedCodes = new Set<string>(Object.values(REMOTE_ASSET_ERASURE_ERRORS));
export function isRemoteAssetErasureErrorCode(value: unknown): value is string {
  return typeof value === "string" && allowedCodes.has(value);
}
