// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  PENDING_TASK_RECEIPTS_KEY as key,
  readPendingTaskReceipt,
  retainPendingTaskReceipt,
  clearPendingTaskReceipt,
  retainTaskReceiptsForPrincipal,
} from "./pending-task-receipts";
const companyId = "10000000-0000-4000-8000-000000000001",
  nonce = "10000000-0000-4000-8000-000000000002";
afterEach(() => sessionStorage.removeItem(key));
it("stores only a bounded exact scope/nonce and cannot replace an unknown attempt", () => {
  retainPendingTaskReceipt(companyId, "owner", nonce);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([
    { schemaVersion: 1, companyId, principal: "owner", idempotencyKey: nonce },
  ]);
  expect(readPendingTaskReceipt(companyId, "owner")).toBe(nonce);
  expect(readPendingTaskReceipt(companyId, "other-owner")).toBeNull();
  expect(
    readPendingTaskReceipt("10000000-0000-4000-8000-000000000099", "owner"),
  ).toBeNull();
  expect(() =>
    retainPendingTaskReceipt(
      companyId,
      "owner",
      "10000000-0000-4000-8000-000000000003",
    ),
  ).toThrow();
  expect(readPendingTaskReceipt(companyId, "owner")).toBe(nonce);
});
it("clears only the current observed receipt, never another nonce or account", () => {
  retainPendingTaskReceipt(companyId, "owner", nonce);
  retainPendingTaskReceipt(companyId, "other-owner", nonce);
  clearPendingTaskReceipt(
    companyId,
    "owner",
    "10000000-0000-4000-8000-000000000099",
  );
  expect(readPendingTaskReceipt(companyId, "owner")).toBe(nonce);
  clearPendingTaskReceipt(companyId, "owner", nonce);
  expect(readPendingTaskReceipt(companyId, "owner")).toBeNull();
  expect(readPendingTaskReceipt(companyId, "other-owner")).toBe(nonce);
});
it("removes prior-account references on a settled switch or logout", () => {
  retainPendingTaskReceipt(companyId, "owner", nonce);
  retainPendingTaskReceipt(companyId, "other-owner", nonce);
  retainTaskReceiptsForPrincipal("other-owner");
  expect(readPendingTaskReceipt(companyId, "owner")).toBeNull();
  expect(readPendingTaskReceipt(companyId, "other-owner")).toBe(nonce);
  retainTaskReceiptsForPrincipal(null);
  expect(sessionStorage.getItem(key)).toBeNull();
});
it.each([
  "not-json",
  JSON.stringify([
    {
      schemaVersion: 1,
      companyId,
      principal: "owner",
      idempotencyKey: nonce,
      title: "PRIVATE-CANARY",
    },
  ]),
  "x".repeat(8193),
])("refuses invalid recovery data without inferring no prior effect", (raw) => {
  sessionStorage.setItem(key, raw);
  expect(() => readPendingTaskReceipt(companyId, "owner")).toThrow();
  retainTaskReceiptsForPrincipal("owner");
  expect(sessionStorage.getItem(key)).not.toContain("PRIVATE-CANARY");
  expect(() => readPendingTaskReceipt(companyId, "owner")).toThrow();
});
