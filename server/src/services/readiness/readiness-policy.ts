import {
  READINESS_DIMENSIONS, readinessCriterionSchema,
  type EvidenceItem, type ReadinessAction, type ReadinessCriterion,
  type ReadinessDimension, type ReadinessDimensionResult, type ReadinessDimensionState,
  type ReadinessEvaluation, type ReadinessRequirementResult,
} from "@paperclipai/shared";
import { evidenceIsTemporallyApplicable, evidenceWithinSensitivityCeiling } from "../context/context-authority.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

export const READINESS_POLICY_VERSION = "aw-v7-readiness-1";
export function readinessHash(value: unknown): string {
  return nativeSha256(value);
}
export interface ReadinessPolicyRequirement { key: string; version: number; criteria: ReadinessCriterion[] }

export function mandatoryReadinessPolicy(action: ReadinessAction): ReadinessPolicyRequirement[] {
  const material = action !== "internal_draft";
  const domains = material ? ["company_profile", "governance"] : ["company_profile"];
  return [{ key: `system.${action}`, version: 1, criteria: domains.map((domain) => readinessCriterionSchema.parse({
    key: domain, domain, sourceClasses: ["foundation"], mandatory: material,
    failureBehavior: material ? "block" : "warn", maxAgeSeconds: material ? 90 * 86400 : null,
    allowedPurposes: [action], requirePurposeEvidence: action === "person_decision" || action === "restricted_processing",
  })) }];
}

function evaluateCriterion(requirement: ReadinessPolicyRequirement, criterion: ReadinessCriterion, evidence: EvidenceItem[], action: ReadinessAction, now: Date): ReadinessRequirementResult {
  const candidates = evidence.filter((item) => item.authorityDomain === criterion.domain);
  const dimensions = new Map<ReadinessDimension, ReadinessDimensionResult>();
  const set = (dimension: ReadinessDimension, state: ReadinessDimensionState, reason: string) => dimensions.set(dimension, { dimension, state, reason });
  for (const dimension of READINESS_DIMENSIONS) set(dimension, "unknown", "Evidence has not established this dimension");
  const valid = candidates.filter((item) => criterion.sourceClasses.includes(item.sourceClass)
    && evidenceIsTemporallyApplicable(item, now) && evidenceWithinSensitivityCeiling(item, criterion.sensitivityCeiling));
  set("coverage", candidates.length ? "satisfied" : "missing", candidates.length ? "Authorized domain evidence exists" : "Required domain evidence is unavailable");
  set("source_authority", candidates.some((item) => criterion.sourceClasses.includes(item.sourceClass)) ? "satisfied" : "failed", "Evidence must come from a permitted authority class");
  set("validity_interval", candidates.some((item) => evidenceIsTemporallyApplicable(item, now)) ? "satisfied" : "failed", "Source validity must include the assessment time");
  set("sensitivity", candidates.some((item) => evidenceWithinSensitivityCeiling(item, criterion.sensitivityCeiling)) ? "satisfied" : "failed", "Evidence must satisfy the sensitivity ceiling");
  // Permission is established by the server's authorized source retrieval, never by a score.
  set("permission_compatibility", valid.length ? "satisfied" : "unknown", "Only freshly authorized source projections are considered");
  const qualifies = (item: EvidenceItem) => {
    const verification = item.metadata.verificationState;
    const confidence = item.metadata.confidenceScore;
    const updated = item.sourceUpdatedAt ? Date.parse(item.sourceUpdatedAt) : NaN;
    return Boolean(item.sourceRef && item.sourceVersion && item.excerpt.trim())
      && (!criterion.requireVerification || verification === "human_verified" || verification === "system_verified")
      && (criterion.maxAgeSeconds === null || (Number.isFinite(updated) && updated <= now.getTime() && now.getTime() - updated <= criterion.maxAgeSeconds * 1000))
      && (item.metadata.nextReviewAt == null || Date.parse(String(item.metadata.nextReviewAt)) > now.getTime())
      && (!criterion.requireSupportingEvidence || (Array.isArray(item.metadata.evidenceRefs) && item.metadata.evidenceRefs.length > 0))
      && (!criterion.noOpenConflict || item.metadata.conflictState === "none")
      && (criterion.minConfidence === null || (typeof confidence === "number" && confidence >= criterion.minConfidence))
      && criterion.allowedPurposes.includes(action)
      && (!criterion.requirePurposeEvidence || (Array.isArray(item.metadata.purposeRefs) && item.metadata.purposeRefs.includes(action)));
  };
  // All material properties must hold for the SAME source. Properties cannot be
  // pooled from a stale authoritative source and a fresh untrusted source.
  const witnesses = valid.filter(qualifies);
  const pool = witnesses.length ? witnesses : valid;
  set("provenance", pool.some((item) => item.sourceRef && item.sourceVersion) ? "satisfied" : "unknown", "Source identity and immutable version are required");
  set("completeness", pool.some((item) => item.excerpt.trim().length > 0) ? "satisfied" : "missing", "Empty source content does not establish the required knowledge");
  set("verification_state", !criterion.requireVerification ? "not_applicable" : pool.some((item) => ["human_verified", "system_verified"].includes(String(item.metadata.verificationState))) ? "satisfied" : "unknown", "Verification is a retained source fact");
  set("supporting_evidence", !criterion.requireSupportingEvidence ? "not_applicable" : pool.some((item) => Array.isArray(item.metadata.evidenceRefs) && item.metadata.evidenceRefs.length > 0) ? "satisfied" : "missing", "Supporting evidence must be retained");
  set("freshness", criterion.maxAgeSeconds === null ? "not_applicable" : pool.some((item) => {
    const time = item.sourceUpdatedAt ? Date.parse(item.sourceUpdatedAt) : NaN;
    return Number.isFinite(time) && time <= now.getTime() && now.getTime() - time <= criterion.maxAgeSeconds! * 1000
      && (item.metadata.nextReviewAt == null || Date.parse(String(item.metadata.nextReviewAt)) > now.getTime());
  }) ? "satisfied" : "failed", "Freshness uses source update/review time, not retrieval time");
  const unresolved = candidates.some((item) => item.metadata.conflictState === "unresolved");
  set("conflict_state", !criterion.noOpenConflict ? "not_applicable" : unresolved ? "failed" : pool.some((item) => item.metadata.conflictState === "none") ? "satisfied" : "unknown", "Unresolved conflicts remain visible");
  set("confidence", criterion.minConfidence === null ? "not_applicable" : pool.some((item) => typeof item.metadata.confidenceScore === "number" && item.metadata.confidenceScore >= criterion.minConfidence!) ? "satisfied" : "unknown", "Confidence does not replace authority or verification");
  set("purpose_compatibility", !criterion.allowedPurposes.includes(action) ? "failed" : !criterion.requirePurposeEvidence ? "satisfied" : pool.some((item) => Array.isArray(item.metadata.purposeRefs) && item.metadata.purposeRefs.includes(action)) ? "satisfied" : "unknown", "Purpose approval is separate from technical read permission");
  return {
    requirementKey: requirement.key, criterionKey: criterion.key, domain: criterion.domain,
    mandatory: criterion.mandatory, failureBehavior: criterion.failureBehavior,
    dimensions: READINESS_DIMENSIONS.map((dimension) => dimensions.get(dimension)!),
    evidenceRefs: pool.map((item) => ({ sourceRef: item.sourceRef, sourceVersion: item.sourceVersion, contentHash: readinessHash(item.excerpt) })),
    satisfied: witnesses.length > 0 && (!criterion.noOpenConflict || !unresolved),
  };
}

export function evaluateReadiness(input: { action: ReadinessAction; requirements: ReadinessPolicyRequirement[]; evidence: EvidenceItem[]; now?: Date }): ReadinessEvaluation {
  const now = input.now ?? new Date();
  const requirements = input.requirements.flatMap((requirement) => requirement.criteria.map((criterion) => evaluateCriterion(requirement, criterion, input.evidence, input.action, now)));
  const failed = requirements.filter((requirement) => !requirement.satisfied);
  const hard = failed.filter((requirement) => requirement.mandatory);
  const blocked = hard.some((requirement) => requirement.failureBehavior === "block" || requirement.failureBehavior === "reduce_capability");
  return {
    status: blocked ? "blocked" : hard.length ? "review_required" : failed.length ? "ready_with_warnings" : "ready",
    actionClass: input.action,
    riskClass: input.action === "internal_draft" ? "low" : ["financial_commitment", "person_decision", "destructive_action", "restricted_processing"].includes(input.action) ? "high" : "material",
    requirements,
    assessedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.action === "internal_draft" ? 3600 : 300) * 1000).toISOString(),
  };
}
