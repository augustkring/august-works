import { expect, it } from "vitest";
import { memoryMaintenanceHistorySchema } from "./memory-maintenance-history.js";

const entry = {
  jobId: "11111111-1111-4111-8111-111111111111", maintenanceClass: "M1",
  attemptNumber: 1, submittedAt: "2026-10-11T00:00:00Z", startedAt: "2026-10-11T00:00:01Z",
  finishedAt: "2026-10-11T00:00:02Z", leaseExpiresAt: null,
  outcome: "verified_index_check", receiptId: "22222222-2222-4222-8222-222222222222", indexedRecordCount: 1,
};
const view = { companyId: "33333333-3333-4333-8333-333333333333", observedAt: "2026-10-11T00:00:05Z", hasMore: false, entries: [entry] };
it("rejects unbounded, duplicated, misclassified and private index history", () => {
  expect(memoryMaintenanceHistorySchema.parse(view)).toEqual(view);
  for (const change of [
    { entries: Array(11).fill(entry) }, { entries: [entry, entry] },
    { entries: [{ ...entry, maintenanceClass: "M2" }] },
    { entries: [{ ...entry, rawResult: { privatePrompt: "secret" } }] },
    { providerConfiguration: "secret" },
  ]) expect(memoryMaintenanceHistorySchema.safeParse({ ...view, ...change }).success).toBe(false);
});
it("requires a terminal native receipt for a verified result and prevents future history", () => {
  for (const change of [
    { receiptId: null }, { indexedRecordCount: null }, { indexedRecordCount: 65 },
    { startedAt: null }, { finishedAt: null }, { finishedAt: "2026-10-11T00:00:06Z" },
    { leaseExpiresAt: "2026-10-11T00:00:10Z" }, { submittedAt: "2026-10-11T00:00:02Z" },
    { outcome: "verification_unavailable" },
  ]) expect(memoryMaintenanceHistorySchema.safeParse({ ...view, entries: [{ ...entry, ...change }] }).success).toBe(false);
});
it("separates an active native lease from an expired unconfirmed attempt", () => {
  const running = { ...entry, outcome: "running", receiptId: null, indexedRecordCount: null, finishedAt: null, leaseExpiresAt: "2026-10-11T00:00:06Z" };
  expect(memoryMaintenanceHistorySchema.safeParse({ ...view, entries: [running] }).success).toBe(true);
  expect(memoryMaintenanceHistorySchema.safeParse({ ...view, entries: [{ ...running, outcome: "unconfirmed" }] }).success).toBe(false);
  const expired = { ...running, leaseExpiresAt: view.observedAt };
  expect(memoryMaintenanceHistorySchema.safeParse({ ...view, entries: [expired] }).success).toBe(false);
  expect(memoryMaintenanceHistorySchema.safeParse({ ...view, entries: [{ ...expired, outcome: "unconfirmed" }] }).success).toBe(true);
});
