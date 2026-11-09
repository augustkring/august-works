import { describe, expect, it } from "vitest";
import { projectManagedNativeCompletionDiagnostic } from "./managed-native-completion-diagnostic.js";
import { projectNativeFinalizationError } from "../../services/native-runtime/native-finalization-error-diagnostic.js";

describe("managed native completion failure projection", () => {
  it("keeps only closed enums, booleans and counts from persisted model/evidence fields", () => {
    const privateSentinel = "private-user-text-token-command-ref";
    const diagnostic = projectManagedNativeCompletionDiagnostic({
      finalization: { phase: "committed", failureCode: privateSentinel, assessmentId: privateSentinel, decisionId: privateSentinel },
      decision: { reasonCode: "completion_evidence_incomplete", toStatus: "in_progress", applicationState: "applied", decisionJson: privateSentinel },
      assessment: {
        reportedDisposition: "done", objectiveClaimSatisfied: true, objectiveSatisfied: false,
        allCriteriaSatisfied: false, verificationPassed: false, hasFailedVerification: false,
        hasBlockingRemainingWork: false, contractRevisionMatches: true,
        summary: privateSentinel, continuation: { summary: privateSentinel }, acceptedEvidenceRefs: [privateSentinel],
        criterionAssessments: [{ criterionId: privateSentinel, claimStatus: "satisfied", outcome: "unverifiable",
          reasonCode: "criterion_evidence_unverifiable", evidenceRefs: [{ ref: privateSentinel,
            kind: "work_product", outcome: "unverifiable", reasonCode: "work_product_not_yet_accepted",
            durableRecordId: privateSentinel }] }],
        verificationAssessments: [{ commandOrCheck: privateSentinel, claimStatus: "passed", outcome: "accepted",
          reasonCode: "verification_evidence_accepted", reportedReasonCode: null,
          detail: privateSentinel, evidenceRef: { ref: privateSentinel, kind: "work_product",
            outcome: "accepted", reasonCode: "work_product_authoritatively_accepted", durableRecordId: privateSentinel } }],
        attentionRequests: [], ignoredAttentionRequests: [], missingRequirements: [privateSentinel],
        rejectedEvidence: [], unverifiableEvidence: [privateSentinel], verificationCaveats: [privateSentinel],
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(privateSentinel);
    expect(diagnostic).toMatchObject({
      finalization: { phase: "committed", failureCode: "other" },
      assessment: {
        reportedDisposition: "done", objectiveSatisfied: false, criterionCount: 1,
        criteria: [{ outcome: "unverifiable", reasonCode: "criterion_evidence_unverifiable",
          evidence: [{ kind: "work_product", outcome: "unverifiable", reasonCode: "work_product_not_yet_accepted" }] }],
        verifications: [{ outcome: "accepted", reasonCode: "verification_evidence_accepted" }],
        acceptedEvidenceRefCount: 1,
      },
      decision: { reasonCode: "completion_evidence_incomplete", toStatus: "in_progress", applicationState: "applied" },
    });
  });

  it("bounds and sanitizes a real nested TypeError and PostgreSQL error", () => {
    const secret = "private-statement-parameters-date-value-9a2c";
    const deepest = Object.assign(new Error(secret), { code: secret });
    const postgres = Object.assign(new Error(`native_checkout_not_released: ${secret}`), { code: "23514", cause: deepest });
    const root = Object.assign(new TypeError(`The string parameter received a Date ${secret}`), {
      code: "ERR_INVALID_ARG_TYPE", cause: postgres,
    });
    const diagnostic = projectNativeFinalizationError(root);
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
    expect(diagnostic).toEqual({ phase: "status_decision_commit", causes: [
      { errorClass: "TypeError", code: "ERR_INVALID_ARG_TYPE", sqlState: "missing", ownerErrorPrefix: "other" },
      { errorClass: "Error", code: "other", sqlState: "23514", ownerErrorPrefix: "native_checkout_not_released" },
      { errorClass: "Error", code: "other", sqlState: "missing", ownerErrorPrefix: "other" },
    ] });
  });

  it("projects only closed cause facts from a persisted finalization failure", () => {
    const secret = "private-sql-and-date-parameter-8c9e";
    const diagnostic = projectManagedNativeCompletionDiagnostic({
      finalization: { phase: "retryable_failure", failureCode: "side_effect_planning_failed", failureDetail: {
        safeCause: { phase: "status_decision_commit", causes: [
          { errorClass: "TypeError", code: "ERR_INVALID_ARG_TYPE", sqlState: "missing", ownerErrorPrefix: "other" },
          { errorClass: "PostgresError", code: "other", sqlState: "23514", ownerErrorPrefix: "native_checkout_not_released" },
          { errorClass: "Error", code: "other", sqlState: "other", ownerErrorPrefix: "other", message: secret, sql: secret },
          { errorClass: "Error", code: secret, sqlState: secret, ownerErrorPrefix: secret },
        ], message: secret, params: [secret] }, message: secret, sql: secret, params: [secret],
      } }, decision: null, assessment: null,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
    expect(diagnostic.finalization).toMatchObject({ safeFailurePhase: "status_decision_commit", safeCauseCount: 3,
      safeCauses: [
        { errorClass: "TypeError", code: "ERR_INVALID_ARG_TYPE", sqlState: "missing", ownerErrorPrefix: "other" },
        { errorClass: "PostgresError", code: "other", sqlState: "23514", ownerErrorPrefix: "native_checkout_not_released" },
        { errorClass: "Error", code: "other", sqlState: "missing", ownerErrorPrefix: "other" },
      ] });
  });

  it("reduces unknown future values to other and missing fields to missing", () => {
    const diagnostic = projectManagedNativeCompletionDiagnostic({
      finalization: { phase: "private phrase" }, decision: { reasonCode: "private phrase" },
      assessment: { reportedDisposition: "private phrase", criterionAssessments: [{ outcome: "private phrase", reasonCode: "private phrase" }] },
    });
    expect(diagnostic).toMatchObject({
      finalization: { phase: "other", failureCode: "missing" },
      assessment: { reportedDisposition: "other", criteria: [{ outcome: "other", reasonCode: "other" }] },
      decision: { reasonCode: "other", toStatus: "missing", applicationState: "missing" },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private phrase");
  });
});
