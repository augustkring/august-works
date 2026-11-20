import { describe, expect, it } from "vitest";
import { canonicalNativeJson, nativeSha256 } from "../services/native-runtime/canonical.js";
import {
  EXPERIMENT_OPERATION_BUDGET_CEILING_MS,
  EXPERIMENT_OPERATION_BUDGET_FLOOR_MS,
  experimentOperationBudgetMs,
  experimentOutcomeSourceHash,
  experimentOutcomeSourceHashFromCanonicalSnapshot,
} from "../services/business-experiments/receipts.js";

describe("business experiment receipt hashes", () => {
  it("keeps the original outcome source hash for binary values and canonical snapshot edge cases", () => {
    const snapshot = {
      id: "unit-α-雪",
      projectId: null,
      status: "done",
      optionalNull: null,
      optionalMissing: undefined,
      nested: { label: "café", absent: undefined },
    };
    const snapshotCanonical = canonicalNativeJson(snapshot);
    for (const value of [0, 1]) {
      const metricHash = value === 0 ? "metric-ø" : "metric-雪";
      const inputHash = value === 0 ? "input-null-∅" : "input-λ";
      const expected = nativeSha256({ snapshot, metricHash, inputHash, value });
      expect(experimentOutcomeSourceHash(snapshot, metricHash, inputHash, value)).toBe(expected);
      expect(experimentOutcomeSourceHashFromCanonicalSnapshot(snapshotCanonical, metricHash, inputHash, value)).toBe(expected);
    }
  });
});

describe("PERF-01 experiment operation budget", () => {
  it("keeps the 30 s floor for an operation with no outcomes", () => {
    expect(EXPERIMENT_OPERATION_BUDGET_FLOOR_MS).toBe(30_000);
    expect(experimentOperationBudgetMs(0)).toBe(30_000);
    expect(experimentOperationBudgetMs(-5)).toBe(30_000);
    expect(experimentOperationBudgetMs(Number.NaN)).toBe(30_000);
  });

  it("adds 0.5 ms per outcome", () => {
    expect(experimentOperationBudgetMs(1)).toBe(30_000.5);
    expect(experimentOperationBudgetMs(8_000)).toBe(34_000);
    // The declared maximum: 4,000 units x 17 metrics.
    expect(experimentOperationBudgetMs(4_000 * 17)).toBe(64_000);
  });

  it("never exceeds the 90 s ceiling", () => {
    expect(EXPERIMENT_OPERATION_BUDGET_CEILING_MS).toBe(90_000);
    expect(experimentOperationBudgetMs(120_000)).toBe(90_000);
    expect(experimentOperationBudgetMs(1_000_000)).toBe(90_000);
    expect(experimentOperationBudgetMs(Number.POSITIVE_INFINITY)).toBe(90_000);
  });
});
