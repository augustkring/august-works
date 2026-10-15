// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { saasApi } from "./saas";
afterEach(() => vi.restoreAllMocks());
const input = {
  operatorUserId: "operator",
  reason: "Review the Native runtime",
  scopes: ["status:read"],
  expiresInMinutes: 30,
};
const receipt = {
  id: "00000000-0000-4000-8000-000000000001",
  companyId: "company",
  approvedByUserId: "owner",
  ...input,
  createdAt: "2026-10-10T06:00:00Z",
  expiresAt: "2026-10-10T06:30:00Z",
  revokedAt: null,
};
it("uses the original account-bound read with cancellation and no HTTP cache", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue([receipt]);
  const signal = new AbortController().signal;
  await expect(
    saasApi.supportSessions("company", "owner", signal),
  ).resolves.toEqual([receipt]);
  expect(get).toHaveBeenCalledWith(
    "/companies/company/support-sessions?expectedUserId=owner",
    { signal, cache: "no-store" },
  );
});
it("refuses a foreign Native session response", async () => {
  vi.spyOn(api, "get").mockResolvedValue([{ ...receipt, companyId: "other" }]);
  await expect(saasApi.supportSessions("company", "owner")).rejects.toThrow(
    "Support context changed",
  );
});
it.each([
  { companyId: "other" },
  { approvedByUserId: "other" },
  { operatorUserId: "other" },
  { reason: "Changed original review" },
  { scopes: ["runtime:manage"] },
])(
  "refuses an acknowledgement that does not match the reviewed approval %j",
  async (patch) => {
    vi.spyOn(api, "post").mockResolvedValue({ ...receipt, ...patch });
    await expect(
      saasApi.approveSupport("company", "owner", input),
    ).rejects.toThrow("Support acknowledgement could not be confirmed");
  },
);
it("freezes the original approval snapshot while an acknowledgement is pending", async () => {
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(api, "post").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const mutable = { ...input, scopes: [...input.scopes] };
  const submitted = saasApi.approveSupport("company", "owner", mutable);
  mutable.operatorUserId = "changed";
  mutable.scopes.push("runtime:manage");
  resolve(receipt);
  await expect(submitted).resolves.toEqual(receipt);
  expect(post).toHaveBeenCalledWith(
    "/companies/company/support-sessions?expectedUserId=owner",
    { ...input, companyId: "company" },
  );
});

it("binds a Native approval acknowledgement to the exact immutable original reference", async () => {
  vi.spyOn(api, "post").mockResolvedValue(receipt);
  await expect(
    saasApi.approveSupport("company", "owner", {
      ...input,
      approvalId: "00000000-0000-4000-8000-000000000099",
    }),
  ).rejects.toThrow("Support acknowledgement could not be confirmed");
});
it("reconciles the original reviewed reference using only an account-bound uncached read", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(receipt);
  const post = vi.spyOn(api, "post");
  const signal = new AbortController().signal;
  await expect(
    saasApi.supportApproval(
      "company",
      "owner",
      { ...input, approvalId: receipt.id },
      signal,
    ),
  ).resolves.toEqual(receipt);
  expect(get).toHaveBeenCalledWith(
    `/companies/company/support-sessions/${receipt.id}?expectedUserId=owner`,
    { signal, cache: "no-store" },
  );
  expect(post).not.toHaveBeenCalled();
});

const nativeCompany = "00000000-0000-4000-8000-000000000010";
const review = {
  companyId: nativeCompany,
  approvalId: receipt.id,
  reviewedAt: "2026-10-10T07:00:00.000Z",
  state: "pending",
};
it("prepares only a frozen original Native review, with no approval API invocation", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue(review);
  await expect(
    saasApi.prepareSupportApproval(nativeCompany, "owner", {
      ...input,
      approvalId: receipt.id,
    }),
  ).resolves.toEqual(review);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(
    `/companies/${nativeCompany}/support-sessions/reviews?expectedUserId=owner`,
    { ...input, approvalId: receipt.id, companyId: nativeCompany },
  );
});
it("rejects an unexpected reference, foreign company or forged private pending metadata", async () => {
  const get = vi.spyOn(api, "get");
  for (const patch of [
    { companyId: "00000000-0000-4000-8000-000000000099" },
    { state: "recorded" },
    { reason: "private" },
    { requestHash: "a".repeat(64) },
  ]) {
    get.mockResolvedValue({ ...review, ...patch });
    await expect(
      saasApi.pendingSupportApproval(nativeCompany, "owner"),
    ).rejects.toBeInstanceOf(Error);
  }
  vi.spyOn(api, "post").mockResolvedValue({
    ...review,
    approvalId: "00000000-0000-4000-8000-000000000099",
  });
  await expect(
    saasApi.prepareSupportApproval(nativeCompany, "owner", {
      ...input,
      approvalId: receipt.id,
    }),
  ).rejects.toThrow("Original support review could not be confirmed");
});
it("reads pending command metadata with cancellation and no cache", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(review);
  const signal = new AbortController().signal;
  await expect(
    saasApi.pendingSupportApproval(nativeCompany, "owner", signal),
  ).resolves.toEqual(review);
  expect(get).toHaveBeenCalledWith(
    `/companies/${nativeCompany}/support-sessions/pending-review?expectedUserId=owner`,
    { signal, cache: "no-store" },
  );
});
it("does not turn a recorded original grant into a revocation when cancelling its review", async () => {
  const recorded = { ...review, state: "recorded" };
  const del = vi.spyOn(api, "delete").mockResolvedValue(recorded);
  await expect(
    saasApi.cancelSupportApproval(nativeCompany, "owner", receipt.id),
  ).resolves.toEqual(recorded);
  expect(del).toHaveBeenCalledWith(
    `/companies/${nativeCompany}/support-sessions/reviews/${receipt.id}?expectedUserId=owner`,
  );
});
