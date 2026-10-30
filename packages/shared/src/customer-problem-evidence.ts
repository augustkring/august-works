import { z } from "zod";

export const CUSTOMER_PROBLEM_EVIDENCE_SOURCES = [
  "product_feedback",
  "support_case",
  "operational_incident",
  "usability_study",
  "accessibility_finding",
  "customer_effort_measure",
  "activation_first_value",
  "connection_maintenance_failure",
  "support_minutes",
  "product_analytics",
  "security_privacy_incident",
  "enterprise_procurement_friction",
  "churn_cancellation_reason",
  "business_product_outcome",
] as const;

/** Shared safe fields for source-owner detail projections. */
export const customerProblemEvidenceProjectionBaseSchema = z.strictObject({
  companyId: z.uuid(),
  source: z.enum(CUSTOMER_PROBLEM_EVIDENCE_SOURCES),
  sourceId: z.uuid(),
  classification: z.literal("unknown"),
  linkedIssueIds: z.array(z.uuid()).max(100),
  linkCoverage: z.enum(["complete", "current_page"]),
});
