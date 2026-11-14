import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reviewModelBindingSchema } from "./worker-model-gateway.js";

// native_run_results.canonical_sha256 has two writers: the ControlPlanePort
// stores a plain lower-hex digest (nativeSha256) and the durable coordinator
// stores it with a "sha256:" prefix. The review binding copies the stored value
// verbatim and migration 0576's trigger compares them for equality, so the
// binding and the reservation CHECK (migration 0581) must accept both forms.
// Accepting only the prefixed form made every ControlPlanePort review fail.
const digest = createHash("sha256").update("{}", "utf8").digest("hex");

function binding(sourceResultCanonicalSha256: string) {
  return {
    planId: randomUUID(), issueId: randomUUID(), interactionId: randomUUID(), decisionId: randomUUID(),
    sourceRunId: randomUUID(), sourceWorkerId: randomUUID(), sourceAgentId: randomUUID(), sourceAttemptId: randomUUID(),
    sourceResultId: randomUUID(), sourceReceiptDigest: "a".repeat(64), sourceResultCanonicalSha256,
    reviewerAgentId: randomUUID(), reviewerRunId: randomUUID(), executionManifestId: randomUUID(), expectedPlanVersion: 1,
  };
}

describe("review model binding", () => {
  it("accepts both stored Native result hash forms verbatim", () => {
    expect(reviewModelBindingSchema.safeParse(binding(digest)).success).toBe(true);
    expect(reviewModelBindingSchema.safeParse(binding(`sha256:${digest}`)).success).toBe(true);
  });

  it("rejects other prefixes, uppercase and short hashes", () => {
    for (const value of [`sha512:${digest}`, `sha256:sha256:${digest}`, digest.toUpperCase(), digest.slice(1)])
      expect(reviewModelBindingSchema.safeParse(binding(value)).success).toBe(false);
  });
});
