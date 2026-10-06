import { describe, expect, it } from "vitest";
import { readinessCriterionSchema, type EvidenceItem } from "@paperclipai/shared";
import { evaluateReadiness, mandatoryReadinessPolicy } from "./readiness-policy.js";
const now = new Date("2026-10-05T12:00:00Z");
function evidence(domain: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return { id: domain, companyId: "company", sourceClass: "foundation", sourceProvider: "aw", sourceType: "approved_foundation",
    sourceRef: `foundation://${domain}`, sourceVersion: "revision-1", title: domain, excerpt: "Reviewed company knowledge",
    sourceUpdatedAt: now.toISOString(), observedAt: now.toISOString(), validFrom: null, validUntil: null,
    authorityDomain: domain, trustLevel: "high", sensitivity: "internal", citation: { label: domain },
    metadata: { verificationState: "human_verified", conflictState: "none" }, ...overrides };
}
describe("action-specific readiness", () => {
  it("permits an advisory internal draft while blocking a material action against the same incomplete company", () => {
    const draft = evaluateReadiness({ action: "internal_draft", requirements: mandatoryReadinessPolicy("internal_draft"), evidence: [], now });
    const send = evaluateReadiness({ action: "external_communication", requirements: mandatoryReadinessPolicy("external_communication"), evidence: [], now });
    expect(draft.status).toBe("ready_with_warnings");
    expect(send.status).toBe("blocked");
    expect(send.requirements.every((criterion) => criterion.dimensions.length === 13)).toBe(true);
    expect(send).not.toHaveProperty("score");
  });
  it("uses approved source updates rather than a fresh retrieval timestamp", () => {
    const stale = evidence("company_profile", { sourceUpdatedAt: "2025-01-01T00:00:00Z" });
    const value = evaluateReadiness({ action: "external_communication", requirements: mandatoryReadinessPolicy("external_communication"), evidence: [stale, evidence("governance")], now });
    expect(value.status).toBe("blocked");
    expect(value.requirements[0]!.dimensions.find((item) => item.dimension === "freshness")?.state).toBe("failed");
  });
  it("requires current approved authoritative evidence and retains unresolved conflicts", () => {
    const complete = [evidence("company_profile"), evidence("governance")];
    expect(evaluateReadiness({ action: "external_communication", requirements: mandatoryReadinessPolicy("external_communication"), evidence: complete, now }).status).toBe("ready");
    for (const override of [
      { sourceClass: "external_untrusted" as const }, { validUntil: now.toISOString() },
      { validFrom: "2027-01-01T00:00:00Z" }, { sourceVersion: null },
      { metadata: { conflictState: "unresolved", verificationState: "human_verified" } },
      { metadata: { conflictState: "none", verificationState: "unverified" } },
    ]) {
      const value = evaluateReadiness({ action: "external_communication", requirements: mandatoryReadinessPolicy("external_communication"), evidence: [evidence("company_profile", override), complete[1]!], now });
      expect(value.status).toBe("blocked");
    }
  });
  it("does not combine source properties to invent a qualifying authority", () => {
    const sources = [
      evidence("company_profile", { sourceUpdatedAt: "2025-01-01T00:00:00Z" }),
      evidence("company_profile", { metadata: { verificationState: "unverified", conflictState: "none" } }),
      evidence("governance"),
    ];
    expect(evaluateReadiness({ action: "external_communication", requirements: mandatoryReadinessPolicy("external_communication"), evidence: sources, now }).status).toBe("blocked");
  });
  it("keeps purpose approval separate from technical retrieval", () => {
    const sources = [evidence("company_profile"), evidence("governance")];
    const value = evaluateReadiness({ action: "person_decision", requirements: mandatoryReadinessPolicy("person_decision"), evidence: sources, now });
    expect(value.status).toBe("blocked");
    expect(value.requirements[0]!.dimensions.find((item) => item.dimension === "purpose_compatibility")?.state).toBe("unknown");
  });
  it("allows reviewed escalation requirements but cannot turn mandatory evidence into a warning", () => {
    expect(() => readinessCriterionSchema.parse({ key: "company", domain: "company_profile", sourceClasses: ["foundation"], allowedPurposes: ["internal_draft"], mandatory: true, failureBehavior: "warn" })).toThrow();
    const criterion = readinessCriterionSchema.parse({ key: "company", domain: "company_profile", sourceClasses: ["foundation"], allowedPurposes: ["internal_draft"], failureBehavior: "require_human" });
    const value = evaluateReadiness({ action: "internal_draft", requirements: [{ key: "company.review", version: 1, criteria: [criterion] }], evidence: [], now });
    expect(value.status).toBe("review_required");
  });
});
