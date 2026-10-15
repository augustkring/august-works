import { describe, expect, it } from "vitest";
import { notificationChannelCategorySchema, notificationChannelUpdateSchema,
  notificationChannelPreferenceViewSchema, notificationChannelPreferenceReceiptSchema } from "./notification-channel-policy.js";
const requestId = "10000000-0000-4000-8000-000000000001";
const companyId = "10000000-0000-4000-8000-000000000002";
const identityLinkId = "10000000-0000-4000-8000-000000000003";
const conversationId = "10000000-0000-4000-8000-000000000004";
const command = { requestId, deliveryLocale: "en", expectedVersion: 0, expectedBaselineHash: "a".repeat(64), choice: { channel: "default" } };
describe("Original bound notification preference contract", () => {
  it("cannot use a channel preference to replace mandatory security policy", () => {
    expect(notificationChannelCategorySchema.safeParse("security").success).toBe(false);
    expect(notificationChannelCategorySchema.parse("approval")).toBe("approval");
  });
  it("requires an exact native identity, conversation and source hash for a private channel", () => {
    for (const channel of ["slack", "microsoft-teams"]) {
      expect(notificationChannelUpdateSchema.safeParse({ ...command, choice: { channel } }).success).toBe(false);
      expect(notificationChannelUpdateSchema.safeParse({ ...command, choice: {
        channel, identityLinkId, conversationId, expectedTargetHash: "b".repeat(64),
      } }).success).toBe(true);
    }
    expect(notificationChannelUpdateSchema.safeParse({ ...command, choice: { channel: "email", recipient: "foreign@example.test" } }).success).toBe(false);
    expect(notificationChannelUpdateSchema.safeParse({ ...command, choice: { channel: "default", identityLinkId } }).success).toBe(false);
  });
  it("rejects raw provider destinations, extra authority and unversioned commands", () => {
    for (const extra of [{ externalChannelId: "DPRIVATE" }, { authorityGranted: true }, { notificationText: "PRIVATE" }])
      expect(notificationChannelUpdateSchema.safeParse({ ...command, ...extra }).success).toBe(false);
    expect(notificationChannelUpdateSchema.safeParse({ ...command, expectedVersion: -1 }).success).toBe(false);
    expect(notificationChannelUpdateSchema.safeParse({ ...command, expectedBaselineHash: "stale" }).success).toBe(false);
  });
  it("cannot display a destination as available after its Original source is unavailable", () => {
    const target = { provider: "slack", identityLinkId, conversationId, targetHash: "b".repeat(64), label: "Your linked Slack account" };
    const view = { companyId, userId: "owner", category: "work_update", version: 2, channel: "slack", deliveryLocale: "en", availability: "available", target,
      baselineHash: "a".repeat(64), targets: [target], targetsLimited: false };
    expect(notificationChannelPreferenceViewSchema.safeParse(view).success).toBe(true);
    expect(notificationChannelPreferenceViewSchema.safeParse({ ...view, availability: "unavailable" }).success).toBe(false);
    expect(notificationChannelPreferenceViewSchema.safeParse({ ...view, availability: "unavailable", target: null }).success).toBe(true);
    expect(notificationChannelPreferenceViewSchema.safeParse({ ...view, channel: "microsoft-teams" }).success).toBe(false);
  });
  it("a preference receipt cannot claim a message, grant or execution result", () => {
    const receipt = { companyId, userId: "owner", category: "work_update", requestId, version: 1, channel: "slack",
      preferenceApplied: true, messageSent: false, authorityGranted: false, executionStarted: false };
    expect(notificationChannelPreferenceReceiptSchema.safeParse(receipt).success).toBe(true);
    for (const field of ["messageSent", "authorityGranted", "executionStarted"])
      expect(notificationChannelPreferenceReceiptSchema.safeParse({ ...receipt, [field]: true }).success).toBe(false);
  });
});
