import { describe, expect, it } from "vitest";
import {
  createSupportCaseSchema, replySupportCaseSchema, deriveSupportCaseSubject,
  SUPPORT_CASE_COPY, SUPPORT_CASE_LIMITS,
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

const command = { idempotencyKey: "c18e87f2-90f2-4cde-8e17-24b6ab5b3545", expectedUserId: "actual-human" };
describe("customer support intake policy", () => {
  it("accepts a description alone and preserves unanswered impact", () => {
    const result = createSupportCaseSchema.parse({ ...command, description: "I cannot open my work" });
    expect(result.category).toBe("other");
    expect(result.impact).toBeNull();
    expect(result.subject).toBeUndefined();
    expect(result.safeContext).toBeUndefined();
    expect(deriveSupportCaseSubject("  Work is unavailable\nMore details  ")).toBe("Work is unavailable");
  });
  it("preserves explicit choices and an edited subject without inferring impact", () => {
    const result = createSupportCaseSchema.parse({ ...command, description: "Cannot connect", category: "apps_connections", subject: "My chosen subject" });
    expect(result.category).toBe("apps_connections");
    expect(result.subject).toBe("My chosen subject");
    expect(result.impact).toBeNull();
    expect(createSupportCaseSchema.parse({ ...result, impact: "blocked" }).impact).toBe("blocked");
  });
  it("rejects unreviewable automatic context and caller-selected authority or status", () => {
    for (const patch of [{ status: "RESOLVED" }, { openedByUserId: "another-human" }, { providerCaseRef: "external" },
      { safeContext: { taskBody: "private task" } }, { safeContext: { url: "https://example.test/?token=secret" } },
      { safeContext: { errorCode: "private exception text" } }, { safeContext: { operationId: "raw log" } }]) {
      expect(createSupportCaseSchema.safeParse({ ...command, description: "Help", ...patch }).success).toBe(false);
    }
    expect(createSupportCaseSchema.parse({ ...command, description: "Help", safeContext: { surface: "work", errorCode: "REQUEST_TIMEOUT" } }).safeContext)
      .toEqual({ surface: "work", errorCode: "REQUEST_TIMEOUT" });
  });
  it("uses the published limits and refuses empty requests and replies", () => {
    expect(createSupportCaseSchema.safeParse({ ...command, description: "  " }).success).toBe(false);
    expect(createSupportCaseSchema.safeParse({ ...command, description: "x".repeat(SUPPORT_CASE_LIMITS.description + 1) }).success).toBe(false);
    expect(replySupportCaseSchema.safeParse({ ...command, body: "  " }).success).toBe(false);
    expect(replySupportCaseSchema.safeParse({ ...command, body: "x".repeat(SUPPORT_CASE_LIMITS.reply + 1) }).success).toBe(false);
    expect(deriveSupportCaseSubject("x".repeat(250))).toHaveLength(SUPPORT_CASE_LIMITS.subject);
  });
  it("uses the prescribed bilingual support wording", () => {
    expect(SUPPORT_CASE_COPY.da.statuses.WAITING_FOR_YOU).toBe("Afventer dit svar");
    expect(SUPPORT_CASE_COPY.da.statuses.CLOSED).toBe("Afsluttet");
    expect(SUPPORT_CASE_COPY.da.impacts.limited).toBe("Jeg kan fortsætte med begrænsninger");
    expect(SUPPORT_CASE_COPY.en.deliveryPending).toBe("Received; delivery pending");
  });
});
