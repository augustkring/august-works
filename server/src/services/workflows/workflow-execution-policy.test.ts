import { describe, expect, it } from "vitest";
import type {
  WorkflowNodeDefinitionDescriptor,
  WorkflowRetryPolicy,
} from "@paperclipai/shared";
import {
  decideWorkflowRetry,
  descriptorRetryIsStructurallySafe,
  workflowRetryDelayMs,
  workflowStepIdempotencyKey,
} from "./workflow-execution-policy.js";

const fixed: WorkflowRetryPolicy = {
  mode: "fixed",
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 5_000,
};

const exponential: WorkflowRetryPolicy = {
  mode: "exponential",
  maxAttempts: 6,
  initialDelayMs: 500,
  maxDelayMs: 4_000,
};

function descriptor(
  overrides: Partial<WorkflowNodeDefinitionDescriptor>,
): WorkflowNodeDefinitionDescriptor {
  return {
    type: "test.node",
    version: 1,
    category: "native",
    displayName: "Test node",
    description: "Test",
    inputSchema: null,
    outputSchema: null,
    configSchema: {},
    sideEffectClass: "pure",
    riskDefault: "C0",
    authorizationRequirements: [],
    timeoutDefaultSeconds: null,
    retryPolicyDefault: fixed,
    idempotencyStrategy: "not_required",
    cancellationSupport: "none",
    testMode: "safe",
    failureOutputs: [],
    auditEvents: [],
    uiComponent: "test",
    accessibilityContract: {
      label: "Test",
      description: "Test",
      supportsKeyboardInsert: true,
      supportsOutlineEdit: true,
    },
    publishState: "ready",
    publishBlockedReason: null,
    ...overrides,
  };
}

describe("workflow execution policy", () => {
  it("derives one stable side-effect identity across attempts", () => {
    const first = workflowStepIdempotencyKey(
      "11111111-1111-4111-8111-111111111111",
      "send-email",
    );
    expect(first).toBe(
      workflowStepIdempotencyKey(
        "11111111-1111-4111-8111-111111111111",
        "send-email",
      ),
    );
    expect(first).not.toBe(
      workflowStepIdempotencyKey(
        "11111111-1111-4111-8111-111111111111",
        "update-crm",
      ),
    );
  });

  it("computes fixed and capped exponential delays by next attempt", () => {
    expect(workflowRetryDelayMs(fixed, 1)).toBeNull();
    expect(workflowRetryDelayMs(fixed, 2)).toBe(1_000);
    expect(workflowRetryDelayMs(fixed, 3)).toBe(1_000);
    expect(workflowRetryDelayMs(fixed, 4)).toBeNull();

    expect(workflowRetryDelayMs(exponential, 2)).toBe(500);
    expect(workflowRetryDelayMs(exponential, 3)).toBe(1_000);
    expect(workflowRetryDelayMs(exponential, 4)).toBe(2_000);
    expect(workflowRetryDelayMs(exponential, 5)).toBe(4_000);
    expect(workflowRetryDelayMs(exponential, 6)).toBe(4_000);
  });

  it("requires explicit deduplication semantics before retrying side effects", () => {
    expect(
      descriptorRetryIsStructurallySafe(
        descriptor({
          sideEffectClass: "write",
          idempotencyStrategy: "not_required",
        }),
        fixed,
      ),
    ).toBe(false);
    expect(
      descriptorRetryIsStructurallySafe(
        descriptor({
          sideEffectClass: "write",
          idempotencyStrategy: "workflow_step_key",
        }),
        fixed,
      ),
    ).toBe(true);
  });

  it("retries only when every runtime guard permits it", () => {
    expect(
      decideWorkflowRetry({
        policy: fixed,
        currentAttempt: 1,
        errorRetryable: true,
        sideEffectSafeToRepeat: true,
        remainingDeadlineMs: 10_000,
        parentCancelled: false,
        providerAllowsRetry: true,
      }),
    ).toEqual({ retry: true, delayMs: 1_000, reason: "retry" });

    expect(
      decideWorkflowRetry({
        policy: fixed,
        currentAttempt: 1,
        errorRetryable: true,
        sideEffectSafeToRepeat: false,
        remainingDeadlineMs: 10_000,
        parentCancelled: false,
        providerAllowsRetry: true,
      }),
    ).toMatchObject({ retry: false, reason: "side_effect_not_repeat_safe" });

    expect(
      decideWorkflowRetry({
        policy: fixed,
        currentAttempt: 1,
        errorRetryable: true,
        sideEffectSafeToRepeat: true,
        remainingDeadlineMs: 500,
        parentCancelled: false,
        providerAllowsRetry: true,
      }),
    ).toMatchObject({ retry: false, reason: "deadline_exhausted" });
  });
});
