import { strict as assert } from "node:assert";
import { test } from "node:test";
import { protocolDigest, summarizePilot, validateObservation, validateProtocol } from "../../evals/aw-v9/pilot-harness.mjs";

import { protocol, observation } from "./helpers/v9-pilot-fixtures.mjs";

test("an unexecuted first-outcome funnel has no invented timing or population rate", () => {
  const p = protocol(), result = summarizePilot(p, [], protocolDigest(p));
  const funnel = result.findings[0].firstOutcomeFunnel.overall;
  assert.equal(funnel.observations, 0);
  assert.equal(funnel.usableAccountTimedOutcomes, 0);
  assert.deepEqual(funnel.timeToFirstUsefulOutcome, { status: "not_observed", sampleSize: 0, p50Ms: null, p90Ms: null, quantileMethod: "nearest_rank" });
  assert.equal(result.gaAllowed, false);
});

test("verified results without a usable-account baseline stay outside TTFO", () => {
  const p = protocol(), row = { ...observation(p), timingBaseline: "not_recorded", durationMs: null };
  const funnel = summarizePilot(p, [row], protocolDigest(p)).findings[0].firstOutcomeFunnel.overall;
  assert.equal(funnel.policyReviewedSuccesses, 1);
  assert.equal(funnel.reviewedOutcomesWithoutTimingBaseline, 1);
  assert.equal(funnel.timeToFirstUsefulOutcome.p50Ms, null);
});

test("failed and censored attempts cannot shorten a first useful outcome measurement", () => {
  const p = protocol(), success = observation(p);
  const failure = { ...success, participantLabel: "P-DEF456", outcome: "failure", oracle: "not_satisfied", durationMs: 1000 };
  const censored = { ...failure, participantLabel: "P-GHI789", censored: true };
  const funnel = summarizePilot(p, [success, failure, censored], protocolDigest(p)).findings[0].firstOutcomeFunnel.overall;
  assert.equal(funnel.attempted, 3);
  assert.equal(funnel.recordedSuccesses, 1);
  assert.equal(funnel.censoredAttempts, 1);
  assert.equal(funnel.timeToFirstUsefulOutcome.sampleSize, 1);
  assert.equal(funnel.timeToFirstUsefulOutcome.p50Ms, 90000);
});

test("unchecked privacy/accessibility and missing independent review do not qualify outcome timing", () => {
  const p = protocol(), success = observation(p);
  const rows = [success, { ...success, participantLabel: "P-DEF456", securityPrivacy: "not_checked" },
    { ...success, participantLabel: "P-GHI789", accessibility: "not_checked" },
    { ...success, participantLabel: "P-JKL012", independentReview: false }];
  const funnel = summarizePilot(p, rows, protocolDigest(p)).findings[0].firstOutcomeFunnel.overall;
  assert.equal(funnel.recordedSuccesses, 4);
  assert.equal(funnel.privacyAccessibilityCheckedSuccesses, 2);
  assert.equal(funnel.policyReviewedSuccesses, 1);
  assert.equal(funnel.usableAccountTimedOutcomes, 1);
});

test("critical role slices retain their own empty timing samples", () => {
  const p = protocol();
  p.journeys[0].roles.push("manager");
  p.journeys[0].criticalSlices.push({ role: "manager", surface: "web", assistive: "keyboard" });
  const result = summarizePilot(p, [observation(p)], protocolDigest(p));
  const [founder, manager] = result.findings[0].firstOutcomeFunnel.criticalSlices;
  assert.equal(founder.usableAccountTimedOutcomes, 1);
  assert.equal(manager.observations, 0);
  assert.equal(manager.timeToFirstUsefulOutcome.p50Ms, null);
  assert.ok(!JSON.stringify(result).includes("P-ABC123"));
});

test("observed TTFO uses documented nearest-rank sample quantiles and separates recorded assistance", () => {
  const p = protocol(), a = { ...observation(p), durationMs: 60000 };
  const b = { ...a, participantLabel: "P-DEF456", durationMs: 120000, assistanceCount: 2 };
  const funnel = summarizePilot(p, [a, b], protocolDigest(p)).findings[0].firstOutcomeFunnel.overall;
  assert.equal(funnel.timeToFirstUsefulOutcome.p50Ms, 60000);
  assert.equal(funnel.timeToFirstUsefulOutcome.p90Ms, 120000);
  assert.equal(funnel.reviewedOutcomesWithoutRecordedAssistance, 1);
  assert.equal(funnel.unit, "participant_journey_role_surface_assistive_cell");
});

test("an unexecuted plan produces no usability or GA pass", () => {
  const p = protocol(); const r = summarizePilot(p, [], protocolDigest(p));
  assert.equal(r.execution, "not_executed"); assert.equal(r.gaAllowed, false); assert.equal(r.findings[0].status, "EXPLORATORY");
});
test("exploratory success never becomes confirmatory evidence", () => {
  const p = protocol(); const r = summarizePilot(p, [observation(p)], protocolDigest(p));
  assert.equal(r.findings[0].status, "EXPLORATORY"); assert.equal(r.findings[0].successes, 1); assert.equal(r.gaAllowed, false);
});
test("a post-observation protocol change fails its frozen digest", () => {
  const p = protocol(), row = observation(p), digest = protocolDigest(p); p.journeys[0].roles.push("manager");
  assert.throws(() => summarizePilot(p, [row], digest));
});
test("data recorded before the freeze or after retention approval expiry is rejected", () => {
  const p = protocol(), row = observation(p); row.observedAt = p.frozenAt; assert.throws(() => validateObservation(row, p, protocolDigest(p)));
  row.observedAt = p.privacy.expiresAt; assert.throws(() => validateObservation(row, p, protocolDigest(p)));
});
test("names, tenant IDs, prompts, private URLs and provider payload fields fail closed", () => {
  const p = protocol(); for (const field of ["name", "email", "companyId", "prompt", "url", "replay", "modelOutput", "apiKey"]) {
    const row = { ...observation(p), [field]: "PRIVATE-CREDENTIAL-OR-CONTENT" };
    assert.throws(() => validateObservation(row, p, protocolDigest(p)), error => !error.message.includes("PRIVATE"));
  }
});
test("repeated participant/journey cells cannot inflate enrollment", () => {
  const p = protocol(), row = observation(p); assert.throws(() => summarizePilot(p, [row, row], protocolDigest(p)));
});
test("missing critical role/surface/assistive cells remain inconclusive", () => {
  const p = protocol("confirmatory"); p.journeys[0].roles.push("manager"); p.journeys[0].criticalSlices.push({ role: "manager", surface: "web", assistive: "keyboard" });
  const result = summarizePilot(p, [observation(p)], protocolDigest(p)); assert.equal(result.findings[0].status, "INCONCLUSIVE");
});
test("censored or partial observations cannot count as success", () => {
  const p = protocol("confirmatory"), row = observation(p); row.censored = true; assert.throws(() => validateObservation(row, p, protocolDigest(p)));
  row.outcome = "partial"; row.oracle = "not_checked"; assert.equal(summarizePilot(p, [row], protocolDigest(p)).findings[0].status, "INCONCLUSIVE");
});
test("an independently unreviewed C2 outcome stays inconclusive", () => {
  const p = protocol("confirmatory"), row = observation(p); row.independentReview = false;
  assert.equal(summarizePilot(p, [row], protocolDigest(p)).findings[0].status, "INCONCLUSIVE");
});
test("a material incident fails the frozen rule even with positive confidence", () => {
  const p = protocol("confirmatory"), row = observation(p); row.outcome = "failure"; row.oracle = "not_satisfied"; row.incidents = ["authority_expansion"];
  assert.equal(summarizePilot(p, [row], protocolDigest(p)).findings[0].status, "FAIL");
});
test("a complete confirmatory cell has a scoped pass without certifying GA", () => {
  const p = protocol("confirmatory"), result = summarizePilot(p, [observation(p)], protocolDigest(p));
  assert.equal(result.findings[0].status, "PASS"); assert.equal(result.gaAllowed, false); assert.ok(!JSON.stringify(result).includes("P-ABC123"));
});
test("confirmatory rules and sample counts cannot be left unset", () => {
  const p = protocol("confirmatory"); p.journeys[0].minimumPerSlice = null; assert.throws(() => validateProtocol(p));
});
test("exploratory protocols cannot predeclare invented confirmatory thresholds", () => {
  const p = protocol(); p.journeys[0].minimumPerSlice = 1; assert.throws(() => validateProtocol(p));
});
test("session replay remains unavailable under the pilot data contract", () => {
  const p = protocol(); p.privacy.sessionReplay = true; assert.throws(() => validateProtocol(p));
});

test("unchecked privacy/accessibility cannot pass confirmatory validation", () => {
  const p = protocol("confirmatory"), row = observation(p); row.securityPrivacy = "not_checked";
  assert.equal(summarizePilot(p, [row], protocolDigest(p)).findings[0].status, "INCONCLUSIVE");
});
test("explicit critical slices avoid inventing an unrelated Cartesian population", () => {
  const p = protocol("confirmatory"); p.journeys[0].roles.push("manager"); p.journeys[0].surfaces.push("slack");
  p.journeys[0].criticalSlices.push({ role: "manager", surface: "slack", assistive: "keyboard" });
  const a = observation(p), b = { ...observation(p), participantLabel: "P-DEF456", role: "manager", surface: "slack" };
  assert.equal(summarizePilot(p, [a, b], protocolDigest(p)).findings[0].status, "PASS");
});

test("task start cannot masquerade as a usable-account TTFO baseline", () => {
  const p = protocol(), row = observation(p); row.timingBaseline = "task_start";
  assert.throws(() => validateObservation(row, p, protocolDigest(p)));
});
test("a missing usable-account baseline stays unavailable/inconclusive", () => {
  const p = protocol("confirmatory"), row = observation(p); row.timingBaseline = "not_recorded"; row.durationMs = null;
  const report = summarizePilot(p, [row], protocolDigest(p));
  assert.equal(report.findings[0].status, "INCONCLUSIVE"); assert.equal(report.findings[0].observedDurationP50Ms, null);
});


test("missing effort or confidence promised by the frozen plan remains inconclusive", () => {
  const p = protocol("confirmatory");
  for (const field of ["effort", "confidence"]) {
    const row = { ...observation(p), [field]: null };
    assert.equal(summarizePilot(p, [row], protocolDigest(p)).findings[0].status, "INCONCLUSIVE");
  }
});
test("a privacy incident that prevents task start still fails the frozen finding", () => {
  const p = protocol("confirmatory"), row = { ...observation(p), outcome: "not_attempted", oracle: "not_checked",
    securityPrivacy: "not_checked", accessibility: "not_checked", timingBaseline: "not_recorded", durationMs: null, censored: true,
    incidents: ["privacy_surprise"] };
  assert.equal(summarizePilot(p, [row], protocolDigest(p)).findings[0].status, "FAIL");
});
