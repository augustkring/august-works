import { describe, expect, it } from "vitest";
import type { OptimizerDriftPolicy, OptimizerDriftWindow } from "@paperclipai/shared";

import { evaluateOptimizerDrift } from "./optimizer-drift.js";

const policy: OptimizerDriftPolicy = {
  minimumExecutions: 10,
  degradedFailureRate: 0.05,
  reviewFailureRate: 0.2,
  degradedFallbackRate: 0.1,
  reviewFallbackRate: 0.3,
  degradedHumanOverrideRate: 0.05,
  reviewHumanOverrideRate: 0.2,
  degradedNewInputShapeRate: 0.1,
  reviewNewInputShapeRate: 0.4,
};

function window(
  overrides: Partial<OptimizerDriftWindow> = {},
): OptimizerDriftWindow {
  return {
    totalExecutions: 100,
    candidateFailures: 0,
    fallbacks: 0,
    newInputShapes: 0,
    humanOverrides: 0,
    invariantFailures: 0,
    connectorOrToolChanged: false,
    workflowChanged: false,
    foundationOrPolicyChanged: false,
    ...overrides,
  };
}

describe("optimizer drift evaluation", () => {
  it("reports healthy metrics without retaining execution payloads", () => {
    const result = evaluateOptimizerDrift(window(), policy, {
      now: new Date("2026-10-01T09:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "healthy",
      reasonCodes: ["optimizer_drift_healthy"],
      failureRate: 0,
      fallbackRate: 0,
      newInputShapeRate: 0,
      humanOverrideRate: 0,
      invariantFailureCount: 0,
      totalExecutions: 100,
      evaluatedAt: "2026-10-01T09:00:00.000Z",
    });
  });

  it("distinguishes degraded rates from review-required rates", () => {
    expect(
      evaluateOptimizerDrift(
        window({ candidateFailures: 6 }),
        policy,
      ),
    ).toMatchObject({
      status: "degraded",
      reasonCodes: expect.arrayContaining([
        "optimizer_drift_failure_rate_degraded",
      ]),
    });

    expect(
      evaluateOptimizerDrift(
        window({ candidateFailures: 20 }),
        policy,
      ),
    ).toMatchObject({
      status: "review_required",
      reasonCodes: expect.arrayContaining([
        "optimizer_drift_failure_rate_review",
      ]),
    });
  });

  it("immediately requires review for invariants and authority-changing dependencies", () => {
    for (const changed of [
      { invariantFailures: 1 },
      { connectorOrToolChanged: true },
      { workflowChanged: true },
      { foundationOrPolicyChanged: true },
    ]) {
      expect(
        evaluateOptimizerDrift(window(changed), policy),
      ).toMatchObject({ status: "review_required" });
    }
  });

  it("keeps low-sample windows non-healthy instead of inferring stability", () => {
    expect(
      evaluateOptimizerDrift(
        window({ totalExecutions: 5 }),
        policy,
      ),
    ).toMatchObject({
      status: "insufficient_data",
      reasonCodes: ["optimizer_drift_insufficient_data"],
    });
  });

  it("fails closed on impossible counters", () => {
    expect(
      evaluateOptimizerDrift(
        window({
          totalExecutions: 5,
          fallbacks: 6,
        }),
        policy,
      ),
    ).toMatchObject({
      status: "review_required",
      reasonCodes: ["optimizer_drift_window_invalid"],
    });
  });

  it("rejects invalid threshold policies", () => {
    expect(() =>
      evaluateOptimizerDrift(window(), {
        ...policy,
        degradedFailureRate: 0.5,
        reviewFailureRate: 0.2,
      }),
    ).toThrow("optimizer_drift_policy_invalid");
  });
});
