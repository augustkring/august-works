import { describe, expect, it } from "vitest";
import { canonicalNativeJson, nativeSha256 } from "../services/native-runtime/canonical.js";
import { experimentOutcomeSourceHash, experimentOutcomeSourceHashFromCanonicalSnapshot } from "../services/business-experiments/receipts.js";

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
