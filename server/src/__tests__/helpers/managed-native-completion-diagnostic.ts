/** Private failure-only projection: closed enums, booleans and counts only. */
const outcomes = ["accepted", "missing", "rejected", "unverifiable"] as const;
const kinds = ["event", "work_product", "approval", "interaction", "attachment", "unknown"] as const;
const claims = ["satisfied", "not_satisfied", "unknown"] as const;
const dispositions = ["done", "blocked", "needs_review", "yielded"] as const;
const verificationStatuses = ["passed", "failed", "not_run"] as const;
const issueStatuses = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled", "preserve"] as const;
const applicationStates = ["proposed", "applied", "shadow"] as const;
const finalizationPhases = ["workspace_finalizing", "ready_for_assessment", "arbitrating", "retryable_failure", "committed", "applied", "terminal_failure"] as const;
const decisionReasons = [
  "terminal_status_preserved", "finalization_failed_claim_preserved", "native_review_unresolved", "native_review_action_finished",
  "cancellation_run_only", "run_failed_partial_evidence_preserved", "governed_response_waiting", "governed_gate_pending",
  "governance_response_continuation_queued", "durable_dependency_blocker_bound", "completion_claim_policy_accepted",
  "completion_contract_satisfied", "actionable_attention_pending", "task_wide_blocker_bound", "current_track_blocker_waiting",
  "external_chat_response_waiting", "external_chat_response_wait_authorization_lost", "board_response_waiting",
  "board_response_wait_superseded", "live_continuation_registered", "prior_status_preserved_no_live_path",
  "completion_evidence_incomplete", "execution_policy_stage_pending", "execution_policy_transition_applied",
] as const;
const assessmentReasons = [
  "durable_run_event_missing", "control_plane_evidence_accepted", "control_plane_evidence_rejected",
  "model_result_event_is_claim_only", "run_event_has_no_authoritative_evidence_verdict", "work_product_missing",
  "work_product_rejected", "work_product_authoritatively_accepted", "work_product_not_yet_accepted", "approval_missing",
  "approval_approved", "approval_rejected", "approval_pending", "interaction_missing", "interaction_resolved",
  "interaction_rejected", "interaction_pending", "attachment_persisted", "attachment_missing",
  "unsupported_evidence_reference", "contract_revision_stale", "criterion_claim_missing", "criterion_reported_not_satisfied",
  "criterion_claim_not_satisfied", "criterion_evidence_missing", "criterion_evidence_rejected", "criterion_evidence_unverifiable",
  "criterion_evidence_accepted", "verification_reported_failed", "verification_not_run",
  "verification_has_no_durable_reference", "verification_evidence_accepted",
] as const;
const safeErrorClasses = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "PostgresError", "DatabaseError", "Error"] as const;
const safeErrorCodes = ["ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_OUT_OF_RANGE"] as const;
const safeSqlStates = ["22007", "22008", "22P02", "23502", "23503", "23505", "23514", "40001", "40P01", "57014"] as const;
const safeOwnerPrefixes = ["native_checkout_not_released", "native_status_decision_not_persisted",
  "native_finalization_coordinator_missing", "native_continuation_cancellation_run_missing",
  "native_pending_effect_target_missing", "native_pending_effect_target_unimplemented", "native_status_reason_code_required"] as const;
const finalizationFailures = ["native_finalization_superseded", "native_finalization_retry_exhausted",
  "native_workspace_sync_out_retry_exhausted", "status_cas_exhausted", "side_effect_planning_failed"] as const;
const verificationReasons = ["environment_unavailable", "tool_unavailable", "dependency_missing", "permission_denied",
  "credential_missing", "policy_restricted", "external_service_unavailable", "budget_exhausted", "other"] as const;
type Closed<T extends readonly string[]> = T[number] | "other" | "missing";
function closed<T extends readonly string[]>(value: unknown, values: T): Closed<T> {
  if (typeof value !== "string") return "missing";
  return (values as readonly string[]).includes(value) ? value as Closed<T> : "other";
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function flag(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function safeSqlState(value: unknown): Closed<typeof safeSqlStates> {
  if (typeof value !== "string" || !/^[0-9A-Z]{5}$/.test(value)) return "missing";
  return closed(value, safeSqlStates);
}
function ref(value: unknown) {
  const item = record(value);
  return { kind: closed(item.kind, kinds), outcome: closed(item.outcome, outcomes),
    reasonCode: closed(item.reasonCode, assessmentReasons) };
}

/** No free-form field from persisted JSON is copied into the diagnostic. */
export function projectManagedNativeCompletionDiagnostic(input: {
  finalization: unknown; decision: unknown; assessment: unknown;
}) {
  const f = record(input.finalization), d = record(input.decision), a = record(input.assessment);
  const criteria = list(a.criterionAssessments);
  const verifications = list(a.verificationAssessments);
  const safeFailure = record(record(f.failureDetail).safeCause);
  const causes = list(safeFailure.causes);
  return {
    finalization: { present: input.finalization != null, phase: closed(f.phase, finalizationPhases),
      failureCode: closed(f.failureCode, finalizationFailures),
      safeFailurePhase: closed(safeFailure.phase, ["status_decision_commit"] as const),
      safeCauses: causes.slice(0, 3).map(value => { const c = record(value); return {
        errorClass: closed(c.errorClass, safeErrorClasses), code: closed(c.code, safeErrorCodes),
        sqlState: safeSqlState(c.sqlState), ownerErrorPrefix: closed(c.ownerErrorPrefix, safeOwnerPrefixes),
      }; }), safeCauseCount: Math.min(causes.length, 3),
    },
    decision: { present: input.decision != null, reasonCode: closed(d.reasonCode, decisionReasons),
      toStatus: closed(d.toStatus, issueStatuses), applicationState: closed(d.applicationState, applicationStates) },
    assessment: {
      present: input.assessment != null,
      reportedDisposition: closed(a.reportedDisposition, dispositions),
      objectiveClaimSatisfied: flag(a.objectiveClaimSatisfied), objectiveSatisfied: flag(a.objectiveSatisfied),
      allCriteriaSatisfied: flag(a.allCriteriaSatisfied), verificationPassed: flag(a.verificationPassed),
      hasFailedVerification: flag(a.hasFailedVerification), hasBlockingRemainingWork: flag(a.hasBlockingRemainingWork),
      contractRevisionMatches: flag(a.contractRevisionMatches), criterionCount: criteria.length,
      criteria: criteria.slice(0, 20).map(value => {
        const c = record(value), refs = list(c.evidenceRefs);
        return { claimStatus: closed(c.claimStatus, claims), outcome: closed(c.outcome, outcomes),
          reasonCode: closed(c.reasonCode, assessmentReasons), evidenceRefCount: refs.length,
          evidence: refs.slice(0, 20).map(ref) };
      }),
      criterionDetailsTruncated: criteria.length > 20,
      verificationCount: verifications.length,
      verifications: verifications.slice(0, 20).map(value => {
        const v = record(value);
        return { claimStatus: closed(v.claimStatus, verificationStatuses), outcome: closed(v.outcome, outcomes),
          reasonCode: closed(v.reasonCode, assessmentReasons), reportedReasonCode: closed(v.reportedReasonCode, verificationReasons),
          evidence: v.evidenceRef == null ? null : ref(v.evidenceRef) };
      }),
      verificationDetailsTruncated: verifications.length > 20,
      attentionRequestCount: list(a.attentionRequests).length,
      ignoredAttentionRequestCount: list(a.ignoredAttentionRequests).length,
      acceptedEvidenceRefCount: list(a.acceptedEvidenceRefs).length,
      missingRequirementCount: list(a.missingRequirements).length,
      rejectedEvidenceCount: list(a.rejectedEvidence).length,
      unverifiableEvidenceCount: list(a.unverifiableEvidence).length,
      verificationCaveatCount: list(a.verificationCaveats).length,
      blockerPresent: a.blocker != null,
    },
  };
}
