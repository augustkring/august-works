import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SUCCESS_MEASUREMENT_PACK,
  customerProblemEvidencePointerSchema,
  projectFeedbackProblemEvidence,
  projectSupportProblemEvidence,
} from "./customer-success-quality.js";

describe("customer success quality contracts", () => {
  it("keeps evidence provenance as a company-scoped pointer and source facts native", () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const issueId = "33333333-3333-4333-8333-333333333333";
    expect(customerProblemEvidencePointerSchema.parse({ companyId, source: "support_case", sourceId, issueId }))
      .toEqual({ companyId, source: "support_case", sourceId, issueId });
    expect(projectFeedbackProblemEvidence({ companyId, sourceId, category: "BUG", internalState: "ACTIONABLE", blocksWork: true,
      linkedIssueIds: [issueId], linkCoverage: "complete" })).toMatchObject({ source: "product_feedback", nativeCategory: "BUG",
      nativeLifecycle: "ACTIONABLE", reportedImpact: "blocked", classification: "unknown", linkedIssueIds: [issueId] });
    expect(projectSupportProblemEvidence({ companyId, sourceId, category: "not_working", status: "INVESTIGATING", impact: "blocked",
      linkedIssueId: issueId, linkCoverage: "complete" })).toMatchObject({ source: "support_case", nativeCategory: "not_working",
      nativeLifecycle: "INVESTIGATING", reportedImpact: "blocked", classification: "unknown", linkedIssueIds: [issueId] });
  });

  it("keeps independent customer proxies and their missingness limits visible", () => {
    expect(CUSTOMER_SUCCESS_MEASUREMENT_PACK.proxies.map(proxy => proxy.id)).toEqual([
      "activation_first_value", "optional_product_feedback", "support_case_resolution",
    ]);
    expect(CUSTOMER_SUCCESS_MEASUREMENT_PACK.proxies[1]!.denominator).toContain("unavailable");
    expect(CUSTOMER_SUCCESS_MEASUREMENT_PACK.proxies[2]!.coverage).toContain("no post-resolution rating");
    expect(CUSTOMER_SUCCESS_MEASUREMENT_PACK.dimensions.effort).toContain("never inferred");
  });
});
