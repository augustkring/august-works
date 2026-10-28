import { describe, expect, it } from "vitest";
import { trustDocumentAcceptanceCommandSchema } from "@paperclipai/shared";
import {
  currentHumanMembershipAllows,
  isCurrentHumanSession,
  isCurrentReviewedPublicTrustDocument,
  isStandaloneHumanOwnedDocument,
} from "../services/trust-documents.js";

const now = new Date("2026-10-28T12:00:00.000Z");
const currentPublic = {
  customerVisibility: "public",
  ndaRequired: false,
  effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
  lastReviewedAt: new Date("2026-10-27T00:00:00.000Z"),
  expiresAt: null,
  supersededBy: null,
  acceptanceRequired: true,
};

describe("Trust document lifecycle gates", () => {
  it("serves and accepts only the current reviewed public exact version", () => {
    expect(isCurrentReviewedPublicTrustDocument(currentPublic, now)).toBe(true);
    expect(isCurrentReviewedPublicTrustDocument(currentPublic, now, true)).toBe(true);
    expect(isCurrentReviewedPublicTrustDocument({ ...currentPublic, acceptanceRequired: false }, now, true)).toBe(false);
  });

  it("withholds future, expired, unreviewed, superseded, gated, NDA and internal evidence", () => {
    const withheld = [
      { effectiveAt: new Date("2026-10-29T00:00:00.000Z") },
      { expiresAt: new Date("2026-10-28T11:59:59.000Z") },
      { lastReviewedAt: null },
      { lastReviewedAt: new Date("2026-10-29T00:00:00.000Z") },
      { supersededBy: "registry-entry" },
      { customerVisibility: "gated" },
      { ndaRequired: true },
      { customerVisibility: "internal" },
    ];
    for (const change of withheld)
      expect(isCurrentReviewedPublicTrustDocument({ ...currentPublic, ...change }, now)).toBe(false);
  });

  it("requires an explicit current account, exact registry version and surface", () => {
    const input = {
      expectedUserId: "human-1",
      requestId: "2c2dd6ae-2be3-4b41-8837-e5e4e684a508",
      registryEntryId: "2c2dd6ae-2be3-4b41-8837-e5e4e684a508",
      version: "4",
      surface: "contract-review",
    };
    expect(trustDocumentAcceptanceCommandSchema.parse(input)).toEqual(input);
    expect(trustDocumentAcceptanceCommandSchema.safeParse({ ...input, principal: "forged-user" }).success).toBe(false);
    expect(trustDocumentAcceptanceCommandSchema.safeParse({ ...input, version: "" }).success).toBe(false);
  });

  it("rejects a session or company role revoked before the transaction recheck", () => {
    const databaseSession = { id: "session-1", userId: "human-1", expiresAt: new Date("2026-10-28T11:59:59.000Z") };
    expect(isCurrentHumanSession({ source: "session", actorUserId: "human-1", actorSessionId: "session-1",
      expectedUserId: "human-1", databaseSession, now })).toBe(false);
    expect(currentHumanMembershipAllows({ principalType: "user", principalId: "human-1", status: "revoked", membershipRole: "owner" }, "human-1", true)).toBe(false);
    expect(currentHumanMembershipAllows({ principalType: "user", principalId: "human-1", status: "active", membershipRole: "member" }, "human-1", true)).toBe(false);
  });

  it("refuses private or differently owned document sources for publication", () => {
    const ownedStandalone = {
      documentCreatedByUserId: "human-1", documentCreatedByAgentId: null,
      documentUpdatedByUserId: "human-1", documentUpdatedByAgentId: null,
      revisionCreatedByUserId: "human-1", revisionCreatedByAgentId: null,
      revisionCreatedByRunId: null,
      hasPrivateOwnerLink: false, hasInheritedSources: false, hasMutableSourceTrust: false,
    };
    expect(isStandaloneHumanOwnedDocument(ownedStandalone, "human-1")).toBe(true);
    expect(isStandaloneHumanOwnedDocument({ ...ownedStandalone, hasPrivateOwnerLink: true }, "human-1")).toBe(false);
    expect(isStandaloneHumanOwnedDocument({ ...ownedStandalone, hasInheritedSources: true }, "human-1")).toBe(false);
    expect(isStandaloneHumanOwnedDocument({ ...ownedStandalone, hasMutableSourceTrust: true }, "human-1")).toBe(false);
    expect(isStandaloneHumanOwnedDocument({ ...ownedStandalone, revisionCreatedByUserId: "another-human" }, "human-1")).toBe(false);
    expect(isStandaloneHumanOwnedDocument({ ...ownedStandalone, revisionCreatedByRunId: "run-1" }, "human-1")).toBe(false);
  });

  it("rechecks a previously published document when a private source link is added", () => {
    const previouslyPublishedSource = {
      documentCreatedByUserId: "human-1", documentCreatedByAgentId: null,
      documentUpdatedByUserId: "human-1", documentUpdatedByAgentId: null,
      revisionCreatedByUserId: "human-1", revisionCreatedByAgentId: null,
      revisionCreatedByRunId: null,
      hasPrivateOwnerLink: false, hasInheritedSources: false, hasMutableSourceTrust: false,
    };
    expect(isStandaloneHumanOwnedDocument(previouslyPublishedSource, "human-1")).toBe(true);
    // Registration metadata remains unchanged; LIST and ACCEPT must derive
    // this current source condition again rather than trusting that old result.
    expect(isStandaloneHumanOwnedDocument({ ...previouslyPublishedSource, hasPrivateOwnerLink: true }, "human-1")).toBe(false);
  });
});
