import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { activationConnectionConsentCommandSchema, activationConnectionConsentReceiptSchema, activationConnectionPermissionPreviewSchema } from "./activation-connection-consent.js";

describe("Onboarding connection consent boundaries", () => {
  it("requires a separate explicit current review and refuses client authority", () => {
    const command = { requestKey: randomUUID(), confirmConnectionAuthorization: true, expectedReviewHash: "a".repeat(64) };
    expect(activationConnectionConsentCommandSchema.parse(command)).toEqual(command);
    for (const extra of [{ confirmConnectionAuthorization: false }, { expectedReviewHash: "invented" }, { grantKind: "organization" },
      { agentIds: [randomUUID()] }, { providerScopes: ["all"] }, { requestKey: command.requestKey.toUpperCase() }])
      expect(activationConnectionConsentCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
  });
  it("keeps all eight material explanations distinct, bounded and nonempty", () => {
    const preview = { neededNow: ["Personal read scope"], why: "Prepare an internal draft", usedBy: "Selected capability",
      canRead: ["Selected provider scope"], canChange: ["No AW changes"], notRequested: ["No Agent access"],
      automatic: ["No Agent execution"], asksFirst: ["Separate purpose and Safe Test"] };
    expect(activationConnectionPermissionPreviewSchema.parse(preview)).toEqual(preview);
    for (const field of Object.keys(preview)) {
      const missing = { ...preview } as Record<string, unknown>; delete missing[field];
      expect(activationConnectionPermissionPreviewSchema.safeParse(missing).success).toBe(false);
      expect(activationConnectionPermissionPreviewSchema.safeParse({ ...preview, [field]: " " }).success).toBe(false);
    }
  });
  it("never labels a reserved UUID as a positive allocation or connection", () => {
    const receipt = { id: randomUUID(), companyId: randomUUID(), onboardingRunId: randomUUID(), packageVersionId: randomUUID(),
      applicationId: randomUUID(), requestKey: randomUUID(), status: "allocating", connectionId: null,
      requestedAt: new Date().toISOString(), connectedAt: null };
    expect(activationConnectionConsentReceiptSchema.parse(receipt)).toEqual(receipt);
    for (const extra of [{ connectionId: randomUUID() }, { status: "allocated" }, { status: "connected" },
      { reservedConnectionId: randomUUID() }, { credential: "private" }])
      expect(activationConnectionConsentReceiptSchema.safeParse({ ...receipt, ...extra }).success).toBe(false);
    const connected = { ...receipt, status: "connected", connectionId: randomUUID(), connectedAt: new Date().toISOString() };
    expect(activationConnectionConsentReceiptSchema.parse(connected)).toEqual(connected);
    expect(activationConnectionConsentReceiptSchema.parse({ ...connected, status: "withdrawn" }).connectedAt).toBe(connected.connectedAt);
  });
});
