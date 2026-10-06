import type {
  GovernanceChange,
  UseCasePurpose,
  UseCaseAssessment,
  OversightProfile,
} from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

export function classifyGovernanceChange(
  before: UseCasePurpose,
  after: UseCasePurpose,
): GovernanceChange {
  const changedFields = (Object.keys(before) as Array<keyof UseCasePurpose>)
    .filter((key) => nativeSha256(before[key]) !== nativeSha256(after[key]))
    .sort();
  if (!changedFields.length)
    return { classification: "no_material_governance_change", changedFields };
  const regulatory = [
    "peopleDomain",
    "makesRecommendationsAboutPeople",
    "makesDecisionsAboutPeople",
    "materialLegalOrSimilarEffect",
    "specialCategoryDataExpected",
    "riskClass",
  ];
  if (changedFields.some((field) => regulatory.includes(field)))
    return {
      classification: "regulatory_reclassification_required",
      changedFields,
    };
  if (
    changedFields.some((field) =>
      [
        "intendedPurpose",
        "providerRoleFacts",
        "providerInstructionsRefs",
      ].includes(field),
    )
  )
    return {
      classification: "operator_role_reassessment_required",
      changedFields,
    };
  return { classification: "review_required", changedFields };
}

/** No model or human checkbox can qualify a domain-specific deployment that
 * the generic product does not implement. Legal assessments remain evidence
 * for accountable review rather than a statutory compliance certification. */
export function useCaseDeploymentBlockers(
  purpose: UseCasePurpose,
  oversight: OversightProfile,
  assessments: UseCaseAssessment[],
  now = new Date(),
) {
  const reasons: string[] = [];
  if (
    purpose.peopleDomain !== "none" ||
    purpose.makesRecommendationsAboutPeople ||
    purpose.makesDecisionsAboutPeople ||
    purpose.materialLegalOrSimilarEffect ||
    purpose.riskClass === "C4"
  )
    reasons.push("specialized_people_domain_overlay_not_qualified");
  if (
    Number(purpose.riskClass.slice(1)) < (purpose.externalCommunication ? 2 : 0)
  )
    reasons.push("mandatory_action_risk_floor");
  if (new Date(purpose.nextReviewAt) <= now) reasons.push("purpose_review_due");
  if (Number(oversight.riskClass.slice(1)) < Number(purpose.riskClass.slice(1)))
    reasons.push("oversight_risk_floor");
  if (
    Number(purpose.riskClass.slice(1)) >= 2 &&
    oversight.mode === "monitor_only"
  )
    reasons.push("material_action_requires_human_review");
  if (
    Number(purpose.riskClass.slice(1)) >= 3 &&
    !["mandatory_human_decision", "continuous_supervision"].includes(
      oversight.mode,
    )
  )
    reasons.push("high_impact_requires_meaningful_oversight");
  for (const framework of ["eu_ai_act", "gdpr", "company_policy"] as const) {
    const reviewed = assessments.filter(
      (record) =>
        record.framework === framework &&
        !record.reviewRequired &&
        ["not_applicable", "limited_risk", "reviewed"].includes(
          record.classification,
        ),
    );
    if (!reviewed.length) reasons.push(`${framework}_assessment_required`);
  }
  if (
    assessments.some(
      (record) =>
        record.classification === "high_risk" ||
        record.classification === "prohibited",
    )
  )
    reasons.push("deployment_classification_requires_qualified_overlay");
  return [...new Set(reasons)].sort();
}
