import { expect, it } from "vitest";
import { governanceObligationSchema, useCaseAssessmentSchema, useCasePurposeSchema } from "./ai-governance.js";
import { packageComponentSchema } from "./agent-packages.js";
import { enterpriseIdentityConfigurationSchema } from "./enterprise.js";
import { securityEventExportConfigurationSchema } from "./security-events.js";

const obligation = {
  framework: "company_policy",
  authority: "Company accountable owner",
  citation: "Reviewed campaign policy",
  jurisdictionOrScope: "This company and its governed campaign Tasks",
  applicabilityFacts: "Campaign purpose needs current company review",
  applicabilityState: "review_required",
  effectiveFrom: "2026-10-06T00:00:00.000Z",
  effectiveUntil: null,
  requiredControl: "Review intended purpose before activation",
  evidenceRequired: ["Human purpose review"],
  controlRefs: ["AI use-case registry"],
  nextReviewAt: "2026-10-07T00:00:00.000Z",
  reviewTrigger: "Material purpose or authority changes",
  sourceVersionOrDate: "2026-10-06",
  sourceUrl: "https://example.com/company-policy",
};

it.each(["", "https://", "/company-policy", "not a URL", "http://example.com/policy", "https://user:password@example.com/policy", "https://example.com/policy?token=secret", "https://example.com/policy#section", "javascript:alert(1)"])(
  "returns validation issues for unfinished or unsafe references: %s",
  (sourceUrl) => {
    // These are shared by real browser forms and server request validation.
    const parsed = governanceObligationSchema.safeParse({ ...obligation, sourceUrl });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path[0] === "sourceUrl")).toBe(true);
    expect(useCasePurposeSchema.shape.providerInstructionsRefs.safeParse([sourceUrl]).success).toBe(false);
    expect(useCaseAssessmentSchema.shape.evidenceRefs.safeParse([sourceUrl]).success).toBe(false);
    expect(packageComponentSchema.shape.source.safeParse({ uri: sourceUrl, sha256: "a".repeat(64) }).success).toBe(false);
    expect(enterpriseIdentityConfigurationSchema.safeParse({ protocol: "oidc", issuer: sourceUrl, domain: "example.com", clientId: "browser-fixture", discoveryEndpoint: "https://example.com/.well-known/openid-configuration", privateKeySecretId: "11111111-1111-4111-8111-111111111111", privateKeySecretVersion: 1 }).success).toBe(false);
    expect(securityEventExportConfigurationSchema.shape.endpoint.safeParse(sourceUrl).success).toBe(false);
  },
);

it("preserves valid HTTPS provenance and a successfully parsed obligation", () => {
  expect(governanceObligationSchema.parse(obligation)).toEqual(obligation);
  expect(packageComponentSchema.shape.source.parse({ uri: obligation.sourceUrl, sha256: "a".repeat(64) }).uri).toBe(obligation.sourceUrl);
});
