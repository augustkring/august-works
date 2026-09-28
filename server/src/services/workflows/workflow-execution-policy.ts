import { createHash } from "node:crypto";
import type {
  WorkflowNodeDefinitionDescriptor,
  WorkflowNodeIdempotencyStrategy,
  WorkflowRetryPolicy,
} from "@paperclipai/shared";

export type WorkflowRetryDecisionReason =
  | "retry"
  | "policy_disabled"
  | "attempt_budget_exhausted"
  | "error_not_retryable"
  | "side_effect_not_repeat_safe"
  | "deadline_exhausted"
  | "parent_cancelled"
  | "provider_retry_disallowed";

export interface WorkflowRetryDecision {
  retry: boolean;
  delayMs: number | null;
  reason: WorkflowRetryDecisionReason;
}

export function workflowStepIdempotencyKey(
  workflowRunId: string,
  nodeId: string,
): string {
  const nodeHash = createHash("sha256").update(nodeId, "utf8").digest("hex").slice(0, 32);
  return `workflow-step:${workflowRunId}:${nodeHash}`;
}

export function effectiveWorkflowRetryPolicy(
  override: WorkflowRetryPolicy | undefined,
  descriptor: WorkflowNodeDefinitionDescriptor,
): WorkflowRetryPolicy {
  return override ?? descriptor.retryPolicyDefault;
}

export function workflowRetryDelayMs(
  policy: WorkflowRetryPolicy,
  nextAttempt: number,
): number | null {
  if (
    policy.mode === "none" ||
    nextAttempt <= 1 ||
    nextAttempt > policy.maxAttempts
  ) {
    return null;
  }
  if (policy.mode === "fixed") {
    return Math.min(policy.initialDelayMs, policy.maxDelayMs);
  }

  const exponent = Math.max(0, nextAttempt - 2);
  const factor = 2 ** Math.min(exponent, 30);
  return Math.min(policy.initialDelayMs * factor, policy.maxDelayMs);
}

export function idempotencyStrategySupportsRetry(
  strategy: WorkflowNodeIdempotencyStrategy,
): boolean {
  return (
    strategy === "workflow_step_key" ||
    strategy === "provider_passthrough" ||
    strategy === "durable_receipt"
  );
}

export function descriptorRetryIsStructurallySafe(
  descriptor: WorkflowNodeDefinitionDescriptor,
  policy: WorkflowRetryPolicy,
): boolean {
  if (policy.maxAttempts <= 1 || policy.mode === "none") return true;
  if (descriptor.sideEffectClass === "pure" || descriptor.sideEffectClass === "read") {
    return true;
  }
  return idempotencyStrategySupportsRetry(descriptor.idempotencyStrategy);
}

export function decideWorkflowRetry(input: {
  policy: WorkflowRetryPolicy;
  currentAttempt: number;
  errorRetryable: boolean;
  sideEffectSafeToRepeat: boolean;
  remainingDeadlineMs: number | null;
  parentCancelled: boolean;
  providerAllowsRetry: boolean;
}): WorkflowRetryDecision {
  const {
    policy,
    currentAttempt,
    errorRetryable,
    sideEffectSafeToRepeat,
    remainingDeadlineMs,
    parentCancelled,
    providerAllowsRetry,
  } = input;

  if (policy.mode === "none") {
    return { retry: false, delayMs: null, reason: "policy_disabled" };
  }
  const nextAttempt = currentAttempt + 1;
  if (nextAttempt > policy.maxAttempts) {
    return { retry: false, delayMs: null, reason: "attempt_budget_exhausted" };
  }
  if (!errorRetryable) {
    return { retry: false, delayMs: null, reason: "error_not_retryable" };
  }
  if (!sideEffectSafeToRepeat) {
    return { retry: false, delayMs: null, reason: "side_effect_not_repeat_safe" };
  }
  if (parentCancelled) {
    return { retry: false, delayMs: null, reason: "parent_cancelled" };
  }
  if (!providerAllowsRetry) {
    return { retry: false, delayMs: null, reason: "provider_retry_disallowed" };
  }

  const delayMs = workflowRetryDelayMs(policy, nextAttempt);
  if (delayMs === null) {
    return { retry: false, delayMs: null, reason: "attempt_budget_exhausted" };
  }
  if (remainingDeadlineMs !== null && remainingDeadlineMs < delayMs) {
    return { retry: false, delayMs: null, reason: "deadline_exhausted" };
  }
  return { retry: true, delayMs, reason: "retry" };
}
