import { describe, expect, it } from "vitest";
import { projectManagedNativeCompletionDiagnostic } from "./managed-native-completion-diagnostic.js";

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
