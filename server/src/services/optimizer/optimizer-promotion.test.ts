import { describe, expect, it, vi } from "vitest";
import type {
  OptimizerPromotionEvidence,
  OptimizerPromotionPolicy,
  OptimizerReplayEvaluation,
  OptimizerShadowEvaluation,
} from "@paperclipai/shared";

import {
  evaluateOptimizerPromotion,
  executeOptimizerCanaryWithFallback,
  selectOptimizerCanaryRoute,
} from "./optimizer-promotion.js";

function replay(
  overrides: Partial<OptimizerReplayEvaluation> = {},
): OptimizerReplayEvaluation {
  return {
    status: "passed",
    reasonCode: "optimizer_replay_passed",
    criticalInvariantFailure: false,
    requiredCategories: ["representative", "boundary", "shape_variant"],
    missingCategories: [],
    caseResults: [],
    passedCaseCount: 3,
    failedCaseCount: 0,
    unsupportedCaseCount: 0,
    totalDurationMs: 3,
    totalCostEstimate: 0,
    ...overrides,
  };
}

function shadow(
  overrides: Partial<OptimizerShadowEvaluation> = {},
): OptimizerShadowEvaluation {
  return {
    status: "passed",
    reasonCode: "optimizer_shadow_passed",
    trustedPathAuthoritative: true,
    criticalInvariantFailure: false,
    observationResults: [],
    passedObservationCount: 3,
    failedObservationCount: 0,
    unsupportedObservationCount: 0,
    totalCandidateDurationMs: 3,
    totalCandidateCostEstimate: 0,
    ...overrides,
  };
}

const policy: OptimizerPromotionPolicy = {
  allowLowRiskAutoPromotion: true,
  fallbackKind: "agent",
};

function evidence(
  overrides: Partial<OptimizerPromotionEvidence> = {},
): OptimizerPromotionEvidence {
  return {
    replayEvaluation: replay(),
    shadowEvaluation: shadow(),
    rollbackAvailable: true,
    driftGuardAvailable: true,
    humanApproved: false,
    canaryPassed: false,
    ...overrides,
  };
}

describe("optimizer promotion policy", () => {
  it("allows low-risk pure candidates into canary only when replay, shadow, rollback and drift gates pass", () => {
    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "pure",
        policy,
        evidence: evidence(),
      }),
    ).toMatchObject({
      status: "canary_ready",
      humanApprovalRequired: false,
      canaryRequired: true,
      fallbackKind: "agent",
    });

    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "pure",
        policy,
        evidence: evidence({ rollbackAvailable: false }),
      }),
    ).toMatchObject({
      status: "denied",
      reasonCode: "optimizer_promotion_rollback_required",
    });

    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "pure",
        policy,
        evidence: evidence({ driftGuardAvailable: false }),
      }),
    ).toMatchObject({
      status: "denied",
      reasonCode: "optimizer_promotion_drift_guard_required",
    });
  });

  it("requires human approval for C2 and C3 and rejects C4", () => {
    for (const [riskClass, sideEffectClass] of [
      ["C2", "write"],
      ["C3", "external_communication"],
    ] as const) {
      expect(
        evaluateOptimizerPromotion({
          riskClass,
          sideEffectClass,
          policy,
          evidence: evidence(),
        }),
      ).toMatchObject({
        status: "approval_required",
        humanApprovalRequired: true,
      });

      expect(
        evaluateOptimizerPromotion({
          riskClass,
          sideEffectClass,
          policy,
          evidence: evidence({ humanApproved: true }),
        }),
      ).toMatchObject({
        status: "canary_ready",
        humanApprovalRequired: true,
      });
    }

    expect(
      evaluateOptimizerPromotion({
        riskClass: "C4",
        sideEffectClass: "privileged",
        policy,
        evidence: evidence({ humanApproved: true, canaryPassed: true }),
      }),
    ).toMatchObject({
      status: "denied",
      reasonCode: "optimizer_promotion_c4_unsupported",
    });
  });

  it("never weakens the risk class below the observed side effect", () => {
    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "write",
        policy,
        evidence: evidence({ humanApproved: true }),
      }),
    ).toMatchObject({
      status: "denied",
      reasonCode: "optimizer_promotion_risk_classification_mismatch",
    });
  });

  it("requires a successful canary before final promotion eligibility", () => {
    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "read",
        policy,
        evidence: evidence({ canaryPassed: true }),
      }),
    ).toMatchObject({
      status: "promotion_ready",
      reasonCode: "optimizer_promotion_gates_passed",
    });
  });

  it("blocks replay, shadow, and critical-invariant failures before canary", () => {
    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "pure",
        policy,
        evidence: evidence({
          replayEvaluation: replay({ status: "failed" }),
        }),
      }).reasonCode,
    ).toBe("optimizer_promotion_replay_gate_required");

    expect(
      evaluateOptimizerPromotion({
        riskClass: "C1",
        sideEffectClass: "pure",
        policy,
        evidence: evidence({
          shadowEvaluation: shadow({ criticalInvariantFailure: true }),
        }),
      }).reasonCode,
    ).toBe("optimizer_promotion_shadow_gate_required");
  });
});

describe("optimizer canary routing and fallback", () => {
  it("assigns the same routing key deterministically and honors 0/100 percent boundaries", () => {
    const base = {
      companyId: "00000000-0000-4000-8000-000000000001",
      promotionKey: "suggestion:version",
      routingKey: "task-123",
    };
    const first = selectOptimizerCanaryRoute({
      ...base,
      candidateTrafficPercent: 25,
    });
    const second = selectOptimizerCanaryRoute({
      ...base,
      candidateTrafficPercent: 25,
    });
    expect(second).toEqual(first);
    expect(first.bucketBasisPoints).toBeGreaterThanOrEqual(0);
    expect(first.bucketBasisPoints).toBeLessThan(10_000);

    expect(
      selectOptimizerCanaryRoute({
        ...base,
        candidateTrafficPercent: 0,
      }).route,
    ).toBe("trusted");
    expect(
      selectOptimizerCanaryRoute({
        ...base,
        candidateTrafficPercent: 100,
      }).route,
    ).toBe("candidate");
  });

  it("falls back to the trusted path on guard, output, or candidate execution failure", async () => {
    const decision = evaluateOptimizerPromotion({
      riskClass: "C1",
      sideEffectClass: "pure",
      policy,
      evidence: evidence(),
    });
    const trusted = vi.fn(async () => "trusted");

    const guarded = await executeOptimizerCanaryWithFallback({
      decision,
      companyId: "00000000-0000-4000-8000-000000000001",
      promotionKey: "promotion",
      routingKey: "guard",
      candidateTrafficPercent: 100,
      guard: async () => ({ passed: false, reasonCode: "input_contract_changed" }),
      executeCandidate: async () => "candidate",
      executeTrusted: trusted,
      validateCandidateOutput: async () => ({ valid: true }),
    });
    expect(guarded).toMatchObject({
      path: "trusted",
      fallbackTriggered: true,
      reasonCode: "input_contract_changed",
      output: "trusted",
    });

    const invalid = await executeOptimizerCanaryWithFallback({
      decision,
      companyId: "00000000-0000-4000-8000-000000000001",
      promotionKey: "promotion",
      routingKey: "invalid",
      candidateTrafficPercent: 100,
      guard: async () => ({ passed: true }),
      executeCandidate: async () => "candidate",
      executeTrusted: trusted,
      validateCandidateOutput: async () => ({
        valid: false,
        reasonCode: "business_invariant_failed",
      }),
    });
    expect(invalid.reasonCode).toBe("business_invariant_failed");

    const failed = await executeOptimizerCanaryWithFallback({
      decision,
      companyId: "00000000-0000-4000-8000-000000000001",
      promotionKey: "promotion",
      routingKey: "throw",
      candidateTrafficPercent: 100,
      guard: async () => ({ passed: true }),
      executeCandidate: async () => {
        throw new Error("candidate failed");
      },
      executeTrusted: trusted,
      validateCandidateOutput: async () => ({ valid: true }),
    });
    expect(failed).toMatchObject({
      path: "trusted",
      fallbackTriggered: true,
      reasonCode: "optimizer_canary_candidate_execution_failed",
    });
  });

  it("uses candidate output only after the canary guard and output validator pass", async () => {
    const decision = evaluateOptimizerPromotion({
      riskClass: "C1",
      sideEffectClass: "pure",
      policy,
      evidence: evidence(),
    });
    const trusted = vi.fn(async () => ({ value: "trusted" }));
    const result = await executeOptimizerCanaryWithFallback({
      decision,
      companyId: "00000000-0000-4000-8000-000000000001",
      promotionKey: "promotion",
      routingKey: "candidate",
      candidateTrafficPercent: 100,
      guard: async () => ({ passed: true }),
      executeCandidate: async () => ({ value: "candidate" }),
      executeTrusted: trusted,
      validateCandidateOutput: async () => ({ valid: true }),
    });
    expect(result).toMatchObject({
      path: "candidate",
      fallbackTriggered: false,
      output: { value: "candidate" },
    });
    expect(trusted).not.toHaveBeenCalled();
  });
});
