// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { PENDING_ACCOUNT_DELETION_KEY as key, readPendingAccountDeletion, retainPendingAccountDeletion,
  clearPendingAccountDeletion, retainAccountDeletionForPrincipal } from "./pending-account-deletion";
const nonce = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
afterEach(() => { vi.restoreAllMocks(); sessionStorage.removeItem(key); });
it("stores only one exact account/UUID locator and cannot retarget an unknown request", () => {
  retainPendingAccountDeletion("owner", nonce); retainPendingAccountDeletion("owner", nonce);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([{ schemaVersion: 1, principal: "owner", idempotencyKey: nonce }]);
  expect(readPendingAccountDeletion("other-owner")).toBeNull();
  expect(() => retainPendingAccountDeletion("owner", other)).toThrow();
  expect(readPendingAccountDeletion("owner")).toBe(nonce);
});
it("removes only the exact observed locator and prunes other accounts only after a settled decision", () => {
  retainPendingAccountDeletion("owner", nonce); retainPendingAccountDeletion("other-owner", other);
  clearPendingAccountDeletion("owner", other); expect(readPendingAccountDeletion("owner")).toBe(nonce);
  retainAccountDeletionForPrincipal("other-owner"); expect(readPendingAccountDeletion("owner")).toBeNull();
  expect(readPendingAccountDeletion("other-owner")).toBe(other);
  retainAccountDeletionForPrincipal(null); expect(sessionStorage.getItem(key)).toBeNull();
});
it.each([
  "not-json", "x".repeat(8193),
  JSON.stringify([{ schemaVersion: 1, principal: "owner", idempotencyKey: nonce, password: "PRIVATE-PASSWORD-CANARY" }]),
  JSON.stringify([{ schemaVersion: 1, principal: "owner", idempotencyKey: nonce }, { schemaVersion: 1, principal: "owner", idempotencyKey: other }]),
])("refuses invalid recovery inventory without manufacturing a new nonce", raw => {
  sessionStorage.setItem(key, raw);
  expect(() => readPendingAccountDeletion("owner")).toThrow();
  retainAccountDeletionForPrincipal("owner");
  expect(sessionStorage.getItem(key)).not.toContain("PRIVATE-PASSWORD-CANARY");
  expect(() => readPendingAccountDeletion("owner")).toThrow();
});
it("cannot admit a request when per-tab storage cannot write its locator", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  expect(() => retainPendingAccountDeletion("owner", nonce)).toThrow();
  expect(readPendingAccountDeletion("owner")).toBeNull();
});
