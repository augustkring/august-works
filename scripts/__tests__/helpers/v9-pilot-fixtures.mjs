import { protocolDigest } from "../../../evals/aw-v9/pilot-harness.mjs";

export function protocol(phase = "exploratory") {
  return { schemaVersion: 1, phase, sourceCommit: "a".repeat(40), artifactSha256: "b".repeat(64), configurationSha256: "c".repeat(64), schemaSha256: "d".repeat(64),
    policySha256: "e".repeat(64), modelInventorySha256: "f".repeat(64), toolInventorySha256: "1".repeat(64), frozenAt: "2026-10-13T00:00:00.000Z",
    privacy: { purposeKey: "v9_usability", policyKey: "test_privacy", retentionKey: "test_retention", lawfulBasisKey: "test_consent",
      approvedByRole: "privacy_owner", expiresAt: "2026-11-13T00:00:00.000Z", sessionReplay: false },
    journeys: [{ id: "first_outcome", roles: ["founder"], surfaces: ["web"], assistive: ["keyboard"], criticality: "C2",
      oracleKey: "first_outcome.current_human_verified", securityPrivacyKeys: ["current_scope"], accessibilityKeys: ["keyboard"],
      effortConfidence: true, criticalSlices: [{ role: "founder", surface: "web", assistive: "keyboard" }],
      sampleRationaleKey: "baseline.enrollment", uncertaintyKey: "baseline.uncertainty", waiverOwnerRole: null, rule: phase === "exploratory" ? null : "all_oracles_no_critical_failures",
      minimumPerSlice: phase === "exploratory" ? null : 1, independenceRequired: true, monitoringKey: "first_outcome.withdrawal" }] };
}
export function observation(plan) {
  return { schemaVersion: 1, protocolSha256: protocolDigest(plan), participantLabel: "P-ABC123", journeyId: "first_outcome", role: "founder",
    surface: "web", assistive: "keyboard", observedAt: "2026-10-13T01:00:00.000Z", outcome: "success", oracle: "satisfied", securityPrivacy: "satisfied", accessibility: "satisfied", timingBaseline: "usable_account", durationMs: 90000,
    censored: false, assistanceCount: 0, incidents: [], effort: 2, confidence: 6, independentReview: true };
}
