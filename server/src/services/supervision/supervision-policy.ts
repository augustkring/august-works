import type { SupervisionAction } from "@paperclipai/shared";
export interface SupervisionSnapshot {
  planStatus: string; featureEnabled: boolean; authorityCurrent: boolean; sourceCurrent: boolean;
  deadlineExpired: boolean; checkBudgetExhausted: boolean; readinessAllows: boolean;
  repeatedFailures: number; repeatedFailureThreshold: number; noProgress: boolean; humanWait: boolean;
  pendingFailedWorker: boolean; retryAvailable: boolean; liveAttempts: number; possibleCompletion: boolean;
  hasVerifiedCompletion: boolean; verifierBudgetAvailable: boolean; independentVerifierRequired: boolean;
}
export interface ArbiterDecision { action: SupervisionAction; reasonCode: string; effect: "none" | "stop" | "dispatch" | "verify" | "reassign"; allowed: boolean; }
/** Only a server-observed snapshot enters this policy. Recommendations never grant authority. */
export function arbitrateSupervision(snapshot: SupervisionSnapshot, recommendation: SupervisionAction | null, humanAuthorized = false): ArbiterDecision {
  const result = (action: SupervisionAction, reasonCode: string, effect: ArbiterDecision["effect"] = "none", allowed = true): ArbiterDecision => ({ action, reasonCode, effect, allowed });
  if (!snapshot.sourceCurrent) return result("STOP", "source_erased", "stop");
  if (!snapshot.authorityCurrent) return result("STOP", "authority_revoked", "stop");
  if (!snapshot.featureEnabled) return result("STOP", "rollout_disabled", "stop");
  if (["completed", "cancelled", "failed"].includes(snapshot.planStatus) && snapshot.liveAttempts > 0) return result("STOP", "plan_terminal", "stop");
  if (snapshot.planStatus !== "running" && snapshot.liveAttempts > 0) return result("PAUSE", "plan_not_running", "stop");
  if (snapshot.deadlineExpired) return result("STOP", "deadline_exceeded", "stop");
  if (snapshot.checkBudgetExhausted) return result("ESCALATE_HUMAN", "supervision_budget_exhausted", "stop");
  if (!snapshot.readinessAllows) return result("PAUSE", "readiness_degraded", "stop");
  if (recommendation === "STOP" && humanAuthorized) return result("STOP", "human_stop", "stop");
  if (recommendation === "PAUSE" && humanAuthorized) return result("PAUSE", "human_pause", "stop");
  if (recommendation === "STEER" && humanAuthorized) return result("PAUSE", "live_steering_unqualified", "stop");
  if (recommendation === "REASSIGN") return snapshot.planStatus === "paused" && snapshot.liveAttempts === 0 && humanAuthorized ? result("REASSIGN", "human_reassignment", "reassign") : result("ESCALATE_HUMAN", "reassignment_requires_stopped_worker", "none", false);
  if (recommendation === "SPAWN_WORKER") return result("ESCALATE_HUMAN", "new_worker_requires_new_accepted_plan", "none", false);
  if (recommendation === "FINISH") return humanAuthorized && snapshot.hasVerifiedCompletion ? result("FINISH", "verified_completion") : result("START_VERIFIER", "completion_requires_authoritative_verification", "none", false);
  if (recommendation === "RETRY") return humanAuthorized && snapshot.pendingFailedWorker && snapshot.retryAvailable && snapshot.liveAttempts === 0 && snapshot.planStatus === "running" ? result("RETRY", "bounded_human_retry", "dispatch") : result("ESCALATE_HUMAN", "retry_not_admissible", "none", false);
  if (snapshot.repeatedFailures >= snapshot.repeatedFailureThreshold) return result("PAUSE", "repeated_identical_failure", "stop");
  if (snapshot.pendingFailedWorker && !snapshot.retryAvailable) return result("ESCALATE_HUMAN", "retry_budget_exhausted", "stop");
  if (snapshot.humanWait) return result("REQUEST_INPUT", "existing_authoritative_human_wait");
  if (snapshot.noProgress) return result("PAUSE", "configured_no_progress", "stop");
  if (recommendation === "START_VERIFIER" || snapshot.possibleCompletion) return snapshot.verifierBudgetAvailable ? result("START_VERIFIER", "completion_needs_independent_review", "verify") : result("ESCALATE_HUMAN", "verifier_budget_exhausted", "none", false);
  if (recommendation && !["CONTINUE", "REQUEST_INPUT", "REQUEST_APPROVAL", "ESCALATE_HUMAN"].includes(recommendation)) return result("ESCALATE_HUMAN", "unsupported_recommendation", "none", false);
  return result(recommendation ?? "CONTINUE", recommendation ? "human_checkpoint" : "bounded_work_healthy");
}
