/**
 * APR-E2E-22 (phase A). TypeScript mirror of the release rule that migration
 * 0589 adds to the model reservation triggers (`aw_v7_model_reservation_released`
 * and its uses in the reservation guard, the charge trigger and the plan
 * counter guard). The database is the authority; this mirror documents the
 * rule and is kept in agreement with it by
 * `model-reservation-release.integration.test.ts`.
 *
 * A reservation that provably never reached the provider counts zero against
 * its plan's model budget: `cancelled` (reachable only from `reserved`), or a
 * `failed` worker_model call with no provider wire receipt, response hash or
 * usage (whose transition the guard admits only when the worker attempt's Run
 * holds no wire intent for it). Every other status keeps its full maximum,
 * including `completed` (phase B would settle it to actual usage) and `unknown`.
 */
export type ModelReservationLedgerRow = {
  status: string;
  purpose: string;
  providerWireReceipt: unknown | null;
  providerResponseHash: string | null;
  usage: unknown | null;
  maximumMinor: number;
};

export function modelReservationReleased(row: Omit<ModelReservationLedgerRow, "maximumMinor">): boolean {
  return row.status === "cancelled" || (row.status === "failed" && row.purpose === "worker_model" &&
    row.providerWireReceipt === null && row.providerResponseHash === null && row.usage === null);
}

/** The plan's `model_cost_reserved`: the maxima of its reservations that are not released. */
export function planCountedModelCost(rows: readonly ModelReservationLedgerRow[]): number {
  return rows.reduce((total, row) => total + (modelReservationReleased(row) ? 0 : row.maximumMinor), 0);
}

/** Whether one more reservation of `maximumMinor` fits the plan's model budget (the hard stop). */
export function planModelReservationFits(rows: readonly ModelReservationLedgerRow[], maximumMinor: number,
  maxModelCostMinor: number | null): boolean {
  return maxModelCostMinor === null || planCountedModelCost(rows) + maximumMinor <= maxModelCostMinor;
}
