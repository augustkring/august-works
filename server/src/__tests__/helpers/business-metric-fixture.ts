import { businessMetricDefinitionSchema, governanceObligationSchema } from "@paperclipai/shared";
export function metricDefinition(governanceObligationId: string) {
  return businessMetricDefinitionSchema.parse({
    name: "Created issue completion", description: "Share of created issues currently complete",
    businessQuestion: "What share of the created population is currently complete?", decisionUse: "Review the backlog",
    populationDescription: "Company issues created in the selected window", inclusions: ["Created in the window"], exclusions: ["Other company objects"],
    authorityMode: "aw_native", valueType: "ratio", unit: "ratio", currency: null,
    grain: "issue", timeGrain: "window", timezone: "UTC", timeSemantics: "created_in_window_current_state", dimensions: ["status", "project"],
    calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: ["done"], projectId: null }, denominator: { entity: "issue", statuses: ["todo", "done"], projectId: null } },
    ownerUserId: "local-board", reviewFrequencyDays: 30, freshnessSeconds: 3600, missingPolicy: "explicit_unknown",
    goodhartRisk: "Completion status does not establish useful outcomes", purpose: "management_intelligence", sensitivity: "internal",
    governanceObligationRefs: [governanceObligationId], retentionDays: 30,
  });
}
export function analyticalPurpose() {
  return governanceObligationSchema.parse({
    framework: "company_policy", authority: "Test board", citation: "Controlled test policy",
    jurisdictionOrScope: "Company business objects", applicabilityFacts: "Advisory operational review", applicabilityState: "applicable",
    effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, requiredControl: "Company-scoped source access",
    evidenceRequired: ["source lineage"], controlRefs: ["native access controls"], nextReviewAt: "2099-01-01T00:00:00Z",
    reviewTrigger: "Purpose or population change", sourceVersionOrDate: "test/v1", sourceUrl: "https://example.test/policy",
    analyticalPurpose: { status: "approved", purpose: "management_intelligence", capabilities: ["metrics"], populationUnits: "business_objects",
      peopleImpact: "none", decisionBoundary: "advisory_only", maxRetentionDays: 30, permittedSensitivity: ["internal"],
      prohibitedUses: ["Employee ranking or automated people decisions"], approvalRationale: "Test-only approved advisory business-object analysis" },
  });
}
