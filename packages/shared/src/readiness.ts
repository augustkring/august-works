import { z } from "zod";
import { EVIDENCE_SENSITIVITIES, EVIDENCE_SOURCE_CLASSES } from "./types/context.js";

export const READINESS_ACTIONS = ["internal_draft", "external_communication", "data_mutation", "financial_commitment", "person_decision", "destructive_action", "restricted_processing"] as const;
export const READINESS_DIMENSIONS = ["coverage", "source_authority", "provenance", "supporting_evidence", "verification_state", "freshness", "validity_interval", "conflict_state", "confidence", "sensitivity", "purpose_compatibility", "permission_compatibility", "completeness"] as const;
export const READINESS_STATUSES = ["ready", "ready_with_warnings", "review_required", "blocked", "unknown"] as const;
export type ReadinessAction = typeof READINESS_ACTIONS[number];
export type ReadinessStatus = typeof READINESS_STATUSES[number];
export type ReadinessDimension = typeof READINESS_DIMENSIONS[number];
export type ReadinessDimensionState = "satisfied" | "missing" | "unknown" | "failed" | "not_applicable";

export const readinessCriterionSchema = z.object({
  key: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(1).max(120),
  sourceClasses: z.array(z.enum(EVIDENCE_SOURCE_CLASSES)).min(1).max(8),
  mandatory: z.boolean().default(true),
  failureBehavior: z.enum(["warn", "block", "require_human", "require_verifier", "reduce_capability"]).default("block"),
  maxAgeSeconds: z.number().int().positive().max(31536000).nullable().default(null),
  requireVerification: z.boolean().default(true),
  requireSupportingEvidence: z.boolean().default(false),
  noOpenConflict: z.boolean().default(true),
  minConfidence: z.number().min(0).max(1).nullable().default(null),
  sensitivityCeiling: z.enum(EVIDENCE_SENSITIVITIES).default("internal"),
  allowedPurposes: z.array(z.enum(READINESS_ACTIONS)).min(1).max(7),
  requirePurposeEvidence: z.boolean().default(false),
}).strict().refine((value) => !value.mandatory || value.failureBehavior !== "warn", "Mandatory requirements cannot warn only");
export type ReadinessCriterion = z.infer<typeof readinessCriterionSchema>;
export const createReadinessRequirementSchema = z.object({
  requirementKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  name: z.string().trim().min(1).max(240),
  actionClass: z.enum(READINESS_ACTIONS),
  expectedVersion: z.number().int().nonnegative(),
  criteria: z.array(readinessCriterionSchema).min(1).max(32),
}).strict().refine((value) => new Set(value.criteria.map((criterion) => criterion.key)).size === value.criteria.length, "Criterion keys must be unique");
export const assessReadinessSchema = z.object({
  agentId: z.string().uuid(),
  actionClass: z.enum(READINESS_ACTIONS),
  subjectType: z.enum(["agent", "task", "workflow", "agent_package"]).default("agent"),
  subjectId: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(500),
}).strict();
export const resolveReadinessFindingSchema = z.object({
  expectedStatus: z.enum(["open", "acknowledged"]),
  resolutionAssessmentId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export interface ReadinessDimensionResult {
  dimension: ReadinessDimension;
  state: ReadinessDimensionState;
  reason: string;
}
export interface ReadinessRequirementResult {
  requirementKey: string;
  criterionKey: string;
  domain: string;
  mandatory: boolean;
  failureBehavior: ReadinessCriterion["failureBehavior"];
  dimensions: ReadinessDimensionResult[];
  evidenceRefs: Array<{ sourceRef: string; sourceVersion: string | null; contentHash: string }>;
  satisfied: boolean;
}
export interface ReadinessEvaluation {
  status: ReadinessStatus;
  actionClass: ReadinessAction;
  riskClass: "low" | "material" | "high";
  requirements: ReadinessRequirementResult[];
  assessedAt: string;
  expiresAt: string;
}
export type CreateReadinessRequirement = z.infer<typeof createReadinessRequirementSchema>;
export type AssessReadiness = z.infer<typeof assessReadinessSchema>;
export interface ReadinessAssessmentView {
  id: string;
  companyId: string;
  agentId: string;
  principalId: string;
  actionClass: ReadinessAction;
  status: ReadinessStatus;
  assessment: ReadinessEvaluation;
  requirementSnapshotHash: string;
  policySnapshotHash: string;
  assessedAt: string;
  expiresAt: string;
}
