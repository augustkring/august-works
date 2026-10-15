import { expect, it } from "vitest";
import {
  customerSupportHistorySchema,
  nativeSupportReviewSchema,
} from "./customer-support.js";
import { supportSessionSchema } from "./saas-contracts.js";
const source = {
  companyId: "00000000-0000-4000-8000-000000000001",
  observedAt: "2026-10-10T04:00:00Z",
  hasMore: false,
  entries: [
    {
      sessionId: "00000000-0000-4000-8000-000000000002",
      operatorReference: "operator",
      approvedAt: "2026-10-10T03:50:00Z",
      expiresAt: "2026-10-10T04:20:00Z",
      revokedAt: null,
      state: "recorded",
      scopes: ["status:read"],
      origin: "native_v6_approval",
    },
  ],
};
it("accepts only native recorded metadata, without treating a recorded approval as current authority", () => {
  expect(customerSupportHistorySchema.parse(source).entries[0]?.state).toBe(
    "recorded",
  );
  expect(
    customerSupportHistorySchema.safeParse({ ...source, authorized: true })
      .success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [{ ...source.entries[0], reason: "private reason" }],
    }).success,
  ).toBe(false);
});
it("distinguishes expired and revoked native facts using the supplied source observation", () => {
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      observedAt: "2026-10-10T05:00:00Z",
    }).success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      observedAt: "2026-10-10T05:00:00Z",
      entries: [{ ...source.entries[0], state: "expired" }],
    }).success,
  ).toBe(true);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [
        {
          ...source.entries[0],
          state: "revoked",
          revokedAt: "2026-10-10T03:59:00Z",
        },
      ],
    }).success,
  ).toBe(true);
});
it("rejects duplicate records/scopes, unbounded rows and invented permissions", () => {
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [...source.entries, ...source.entries],
    }).success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [
        { ...source.entries[0], scopes: ["status:read", "status:read"] },
      ],
    }).success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [{ ...source.entries[0], scopes: ["secrets:read"] }],
    }).success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: Array.from({ length: 11 }, () => source.entries[0]),
    }).success,
  ).toBe(false);
});
it("rejects malformed source IDs, control characters and inconsistent original times", () => {
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      companyId: "foreign-value",
    }).success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [{ ...source.entries[0], operatorReference: "operator\nraw" }],
    }).success,
  ).toBe(false);
  expect(
    customerSupportHistorySchema.safeParse({
      ...source,
      entries: [{ ...source.entries[0], expiresAt: "2026-10-10T03:00:00Z" }],
    }).success,
  ).toBe(false);
});

const approvalId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const input = {
  companyId: source.companyId,
  operatorUserId: "configured-operator",
  reason: "Review original scoped access",
  scopes: ["status:read"],
  expiresInMinutes: 30,
};
it("keeps legacy Native input unchanged instead of inventing a reference", () => {
  expect(supportSessionSchema.parse(input)).toEqual(input);
});
it("normalizes an explicit original Native UUID while refusing forged receipt fields", () => {
  expect(supportSessionSchema.parse({ ...input, approvalId }).approvalId).toBe(
    approvalId.toLowerCase(),
  );
  expect(
    supportSessionSchema.safeParse({ ...input, approvalId: "not-a-reference" })
      .success,
  ).toBe(false);
  expect(
    supportSessionSchema.safeParse({
      ...input,
      approvalId,
      approvedByUserId: "forged-owner",
    }).success,
  ).toBe(false);
});
it("keeps pending review metadata strict and excludes private content and access claims", () => {
  const receipt = {
    companyId: source.companyId,
    approvalId: approvalId.toLowerCase(),
    reviewedAt: "2026-10-10T07:00:00.000Z",
    state: "pending",
  };
  expect(nativeSupportReviewSchema.parse(receipt)).toEqual(receipt);
  for (const patch of [
    { reason: "private-reason" },
    { operatorUserId: "private-operator" },
    { requestHash: "a".repeat(64) },
    { scopes: ["runtime:manage"] },
    { state: "active" },
    { enabled: true },
  ])
    expect(
      nativeSupportReviewSchema.safeParse({ ...receipt, ...patch }).success,
    ).toBe(false);
});
