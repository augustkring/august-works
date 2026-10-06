import { describe, expect, it } from "vitest";
import { evaluateReleasePromotion, V8_HOSTING_PREDECESSOR_GATES, type AnalyticalReleaseIdentity, type AssuranceEvidence } from "./v8-assurance.js";

const release: AnalyticalReleaseIdentity = { sourceSha: "a".repeat(40), artifactDigest: "b".repeat(64), configurationHash: "c".repeat(64), schemaVersion: "0360", environmentClass: "staging", profile: "read_only_analytics" };
const evidence = (claimId: string, lane: AssuranceEvidence["lane"], kind: AssuranceEvidence["kind"]): AssuranceEvidence => ({
  id: claimId, claimId, release, lane, kind, status: "passed", evidenceRefs: ["retained-receipt"], owner: "platform", reviewer: "security", verifiedAt: "2026-10-06T00:00:00Z", expiresAt: "2026-10-07T00:00:00Z", revalidationTriggers: ["release_change"], limitations: [],
});
const base = () => ({ from: "R1_SOURCE_VERIFIED" as const, to: "R2_STAGING_QUALIFIED" as const, release,
  claims: [{ id: "source-checks", lane: "source" as const }, { id: "host-enforcement", lane: "staging" as const }],
  evidence: [evidence("source-checks", "source", "deterministic_test"), evidence("host-enforcement", "staging", "operator_drill")],
  predecessorGates: V8_HOSTING_PREDECESSOR_GATES.map((id) => ({ id, status: "passed" as const })), acceptedBy: "operations-owner", now: new Date("2026-10-06T12:00:00Z") });

describe("release assurance", () => {
  it("requires actual current environment-bound evidence for hosted promotion", () => {
    expect(evaluateReleasePromotion(base()).allowed).toBe(true);
    const fixture = base(); fixture.evidence[1]!.kind = "fixture";
    expect(evaluateReleasePromotion(fixture).reasons).toContain("unproven_claim:host-enforcement");
    const drift = base(); drift.evidence[1]!.release = { ...release, configurationHash: "d".repeat(64) };
    expect(evaluateReleasePromotion(drift).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), now: new Date("2026-10-08") }).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), predecessorGates: [{ id: "H7-01", status: "open" }] }).reasons).toContain("predecessor_gate:H7-01");
  });

  it("cannot promote with empty claims, accepted risk or skipped stages", () => {
    expect(evaluateReleasePromotion({ ...base(), claims: [] }).allowed).toBe(false);
    const risk = base(); risk.evidence[1]!.status = "accepted_risk";
    expect(evaluateReleasePromotion(risk).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), from: "R0_SPECIFIED" }).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), acceptedBy: null }).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), predecessorGates: [] }).reasons).toContain("predecessor_gate:H7-03");
    expect(evaluateReleasePromotion({ ...base(), predecessorGates: [...base().predecessorGates, { id: "H7-01", status: "passed" }] }).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), now: new Date("invalid") }).allowed).toBe(false);
  });

  it("does not qualify independent self-review or future-dated evidence", () => {
    const review = base(); review.evidence[1]!.kind = "independent_review"; review.evidence[1]!.reviewer = "platform";
    expect(evaluateReleasePromotion(review).allowed).toBe(false);
    expect(evaluateReleasePromotion({ ...base(), now: new Date("2026-10-05") }).allowed).toBe(false);
  });
});
