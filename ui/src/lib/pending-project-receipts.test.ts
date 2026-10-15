// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  PENDING_PROJECT_RECEIPTS_KEY as key,
  readPendingProjectReceipt,
  retainPendingProjectReceipt,
  clearPendingProjectReceipt,
  retainProjectReceiptsForPrincipal,
} from "./pending-project-receipts";
const companyId = "10000000-0000-4000-8000-000000000001",
  nonce = "10000000-0000-4000-8000-000000000002";
afterEach(() => sessionStorage.removeItem(key));
it("stores only a bounded exact scope/nonce and cannot replace an unknown attempt", () => {
  retainPendingProjectReceipt(companyId, "owner", nonce);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([
    { schemaVersion: 1, companyId, principal: "owner", idempotencyKey: nonce },
  ]);
  expect(readPendingProjectReceipt(companyId, "owner")).toBe(nonce);
  expect(readPendingProjectReceipt(companyId, "other-owner")).toBeNull();
  expect(
    readPendingProjectReceipt("10000000-0000-4000-8000-000000000099", "owner"),
  ).toBeNull();
  expect(() =>
    retainPendingProjectReceipt(
      companyId,
      "owner",
      "10000000-0000-4000-8000-000000000003",
    ),
  ).toThrow();
  expect(readPendingProjectReceipt(companyId, "owner")).toBe(nonce);
});
it("clears only the current observed receipt, never another nonce or account", () => {
  retainPendingProjectReceipt(companyId, "owner", nonce);
  retainPendingProjectReceipt(companyId, "other-owner", nonce);
  clearPendingProjectReceipt(
    companyId,
    "owner",
    "10000000-0000-4000-8000-000000000099",
  );
  expect(readPendingProjectReceipt(companyId, "owner")).toBe(nonce);
  clearPendingProjectReceipt(companyId, "owner", nonce);
  expect(readPendingProjectReceipt(companyId, "owner")).toBeNull();
  expect(readPendingProjectReceipt(companyId, "other-owner")).toBe(nonce);
});
it("removes prior-account references on a settled switch or logout", () => {
  retainPendingProjectReceipt(companyId, "owner", nonce);
  retainPendingProjectReceipt(companyId, "other-owner", nonce);
  retainProjectReceiptsForPrincipal("other-owner");
  expect(readPendingProjectReceipt(companyId, "owner")).toBeNull();
  expect(readPendingProjectReceipt(companyId, "other-owner")).toBe(nonce);
  retainProjectReceiptsForPrincipal(null);
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
  expect(() => readPendingProjectReceipt(companyId, "owner")).toThrow();
  retainProjectReceiptsForPrincipal("owner");
  expect(sessionStorage.getItem(key)).not.toContain("PRIVATE-CANARY");
  expect(() => readPendingProjectReceipt(companyId, "owner")).toThrow();
});
