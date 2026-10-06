import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateV7PilotReadiness,
  validateV7PilotManifest,
} from "./check-aw-v7-pilot-readiness.mjs";
const context = {
  sourceSha: "a".repeat(40),
  protectedEvidenceOrigin: "https://protected.test.invalid",
  now: new Date("2026-10-05T12:00:00Z"),
};
const companyId = "11111111-1111-4111-8111-111111111111";
const entry = (id) => ({
  id,
  result: "pass",
  evidenceKind: "protected_live_report",
  sourceSha: context.sourceSha,
  companyId,
  artifactUri: `https://protected.test.invalid/qualification/${id}`,
  sha256: "b".repeat(64),
  testedAt: "2026-10-05T11:00:00Z",
  expiresAt: "2026-10-06T11:00:00Z",
});
const report = () => ({
  version: 1,
  evidenceKind: "live_customer_pilot",
  sourceSha: context.sourceSha,
  companyId,
  evidence: validateV7PilotManifest().journey.map(entry),
});
test("local passing suites and fixture labels cannot substitute for a live integrated pilot", () => {
  const input = report();
  input.evidenceKind = "local_fixture";
  input.evidence[0].evidenceKind = "local_fixture";
  const result = evaluateV7PilotReadiness(input, context);
  assert.equal(result.readyForOperatorReview, false);
  assert.ok(result.failures.includes("live_customer_pilot_evidence_required"));
  assert.ok(result.missingEvidence.includes("runtime_host_loss"));
});
test("rejects stale scope, future/expired evidence, duplicate identity and credential-bearing references", () => {
  const input = report(),
    first = input.evidence[0];
  first.sourceSha = "c".repeat(40);
  first.companyId = "22222222-2222-4222-8222-222222222222";
  first.artifactUri += "?api_key=fixture-only";
  first.expiresAt = context.now.toISOString();
  input.evidence.push(first);
  const result = evaluateV7PilotReadiness(input, context);
  for (const expected of [
    "scope_or_revision_changed",
    "protected_digest_reference_required",
    "current_finite_evidence_required",
    "duplicate_evidence",
  ])
    assert.ok(result.failures.some((item) => item.startsWith(expected)));
});
test("all claimed external passes still cannot hide incomplete native integration", () => {
  const config = validateV7PilotManifest(),
    input = report();
  input.evidence = [
    "journey",
    "faults",
    "compoundCases",
    "operatingEvidence",
  ].flatMap((group) => config[group].map(entry));
  const result = evaluateV7PilotReadiness(input, context);
  assert.deepEqual(result.missingEvidence, []);
  assert.deepEqual(result.failures, []);
  assert.equal(result.readyForOperatorReview, false);
  assert.ok(
    result.implementationBlockers.includes(
      "credential_use_broker_and_revocation",
    ),
  );
});
