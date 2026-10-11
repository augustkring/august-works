import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { activationConnectionConsentCommandSchema, activationConnectionConsentReceiptSchema, activationConnectionPermissionPreviewSchema, activationConnectionReviewSchema } from "./activation-connection-consent.js";

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
      reviewHash: "a".repeat(64), onboardingVersion: 1,
      requestedAt: new Date().toISOString(), connectedAt: null };
    expect(activationConnectionConsentReceiptSchema.parse(receipt)).toEqual(receipt);
    for (const extra of [{ connectionId: randomUUID() }, { status: "allocated" }, { status: "connected" },
      { reservedConnectionId: randomUUID() }, { credential: "private" }])
      expect(activationConnectionConsentReceiptSchema.safeParse({ ...receipt, ...extra }).success).toBe(false);
    const connected = { ...receipt, status: "connected", connectionId: randomUUID(), connectedAt: new Date().toISOString() };
    expect(activationConnectionConsentReceiptSchema.parse(connected)).toEqual(connected);
    expect(activationConnectionConsentReceiptSchema.parse({ ...connected, status: "withdrawn" }).connectedAt).toBe(connected.connectedAt);
  });
  it("allows pending retained validation only with an exact predecessor and never a client qualification claim", () => {
    const id = randomUUID(), preview = { neededNow: ["Personal sign-in required"], why: "Prepare a draft", usedBy: "Draft capability",
      canRead: ["Provider account"], canChange: ["No AW changes"], notRequested: ["No Agent access"], automatic: ["No execution"], asksFirst: ["Separate review"] };
    const reviewed = { companyId: id, onboardingRunId: id, onboardingVersion: 1, packageVersionId: id, packageContentHash: "a".repeat(64),
      applicationId: id, applicationKey: "gmail", applicationName: "Gmail", galleryKey: "gmail", connectionMethodKey: "paperclip-read",
      methodHash: "b".repeat(64), providerScopes: ["https://www.googleapis.com/auth/gmail.readonly"], scopeProfile: "gmail.read",
      grantKind: "user", deferAgentAccess: true, preview, supersedesConsentId: id,
      explanation: { providerName: "Gmail", resource: "https://gmailmcp.googleapis.com/mcp/v1", capabilityName: "Draft capability", providerWriteTools: [] },
      existingConnection: { id, name: "Retained Gmail", setupHash: "c".repeat(64), needsValidation: true }, reviewHash: "d".repeat(64) };
    expect(activationConnectionReviewSchema.parse(reviewed)).toEqual(reviewed);
    expect(activationConnectionReviewSchema.safeParse({ ...reviewed, supersedesConsentId: null }).success).toBe(false);
    expect(activationConnectionReviewSchema.safeParse({ ...reviewed, existingConnection: { ...reviewed.existingConnection, needsValidation: false } }).success).toBe(false);
    expect(activationConnectionReviewSchema.safeParse({ ...reviewed, existingConnection: { ...reviewed.existingConnection, validated: true } }).success).toBe(false);
  });
});
