import { createHash } from "node:crypto";

export const JOURNEYS = Object.freeze([
  "first_outcome", "hire_agent", "connect_required_app", "channel_outcome",
  "material_approval", "correct_result", "workflow_publish", "connection_recovery",
  "blocked_agent", "stop_work", "manager_decision", "restrict_permission",
  "downgrade_free", "assistive_completion",
]);
export const ROLES = Object.freeze(["founder", "manager", "employee", "ai_admin", "security_admin"]);
const SURFACES = ["web", "slack", "teams"];
const ASSISTIVE = ["none", "keyboard", "screen_reader", "zoom_200", "zoom_400"];
const INCIDENTS = ["wrong_scope", "privacy_surprise", "unintended_effect", "authority_expansion",
  "lost_input", "blocked_navigation", "unknown_outcome", "inaccessible_control", "wrong_result", "late_attention"];
const OUTCOMES = ["success", "partial", "failure", "not_attempted"];
const ORACLES = ["satisfied", "not_satisfied", "not_checked"];
const sha = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, key = /^[a-z][a-z0-9_.-]{0,127}$/;
const fail = () => { throw new Error("Invalid V9 pilot artifact"); };
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) fail();
  return value;
}
function member(value, values) { if (!values.includes(value)) fail(); return value; }
function match(value, pattern) { if (typeof value !== "string" || !pattern.test(value)) fail(); return value; }
function integer(value, max) { if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(); return value; }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return Date.parse(value);
}
function distinct(values, allowed) {
  if (!Array.isArray(values) || !values.length || values.length > allowed.length || new Set(values).size !== values.length) fail();
  values.forEach(value => member(value, allowed)); return values;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function protocolDigest(plan) {
  return createHash("sha256").update(JSON.stringify(canonical(validateProtocol(plan)))).digest("hex");
}

/** Validate a preregistration artifact, not a claim that a study happened. */
export function validateProtocol(raw) {
  const plan = object(raw, ["schemaVersion", "phase", "sourceCommit", "artifactSha256", "configurationSha256", "schemaSha256", "policySha256", "modelInventorySha256", "toolInventorySha256", "frozenAt", "privacy", "journeys"]);
  if (plan.schemaVersion !== 1) fail(); member(plan.phase, ["exploratory", "confirmatory"]);
  match(plan.sourceCommit, commit);
  for (const field of ["artifactSha256", "configurationSha256", "schemaSha256", "policySha256", "modelInventorySha256", "toolInventorySha256"]) match(plan[field], sha);
  const frozenAt = timestamp(plan.frozenAt);
  const privacy = object(plan.privacy, ["purposeKey", "policyKey", "retentionKey", "lawfulBasisKey", "approvedByRole", "expiresAt", "sessionReplay"]);
  for (const field of ["purposeKey", "policyKey", "retentionKey", "lawfulBasisKey"]) match(privacy[field], key);
  if (privacy.approvedByRole !== "privacy_owner" || privacy.sessionReplay !== false || timestamp(privacy.expiresAt) <= frozenAt) fail();
  if (!Array.isArray(plan.journeys) || !plan.journeys.length || plan.journeys.length > JOURNEYS.length) fail();
  const seen = new Set();
  for (const rawJourney of plan.journeys) {
    const journey = object(rawJourney, ["id", "roles", "surfaces", "assistive", "criticality", "oracleKey", "securityPrivacyKeys",
      "accessibilityKeys", "effortConfidence", "criticalSlices", "sampleRationaleKey", "uncertaintyKey", "waiverOwnerRole", "rule", "minimumPerSlice", "independenceRequired", "monitoringKey"]);
    member(journey.id, JOURNEYS); if (seen.has(journey.id)) fail(); seen.add(journey.id);
    distinct(journey.roles, ROLES); distinct(journey.surfaces, SURFACES); distinct(journey.assistive, ASSISTIVE);
    member(journey.criticality, ["C0", "C1", "C2", "C3", "C4"]); match(journey.oracleKey, key); match(journey.monitoringKey, key);
    for (const field of ["securityPrivacyKeys", "accessibilityKeys"]) {
      if (!Array.isArray(journey[field]) || !journey[field].length || journey[field].length > 32 || new Set(journey[field]).size !== journey[field].length) fail();
      journey[field].forEach(value => match(value, key));
    }
    match(journey.sampleRationaleKey, key); match(journey.uncertaintyKey, key);
    if (journey.waiverOwnerRole !== null) member(journey.waiverOwnerRole, ["product_owner", "security_owner", "privacy_owner"]);
    if (!Array.isArray(journey.criticalSlices) || !journey.criticalSlices.length || journey.criticalSlices.length > 100) fail();
    const cells = new Set();
    for (const value of journey.criticalSlices) {
      const cell = object(value, ["role", "surface", "assistive"]);
      member(cell.role, journey.roles); member(cell.surface, journey.surfaces); member(cell.assistive, journey.assistive);
      const identity = `${cell.role}:${cell.surface}:${cell.assistive}`;
      if (cells.has(identity)) fail(); cells.add(identity);
    }
    if (journey.roles.some(role => !journey.criticalSlices.some(cell => cell.role === role)) ||
      journey.surfaces.some(surface => !journey.criticalSlices.some(cell => cell.surface === surface)) ||
      journey.assistive.some(assistive => !journey.criticalSlices.some(cell => cell.assistive === assistive))) fail();
    if (typeof journey.effortConfidence !== "boolean" || typeof journey.independenceRequired !== "boolean") fail();
    if (["C2", "C3", "C4"].includes(journey.criticality) && !journey.independenceRequired) fail();
    if (plan.phase === "exploratory") {
      if (journey.rule !== null || journey.minimumPerSlice !== null) fail();
    } else {
      // Numeric enrollment is chosen from pilot evidence, never defaulted here.
      if (journey.rule !== "all_oracles_no_critical_failures") fail();
      integer(journey.minimumPerSlice, 10000); if (!journey.minimumPerSlice) fail();
    }
  }
  return plan;
}

/** Manual observations accept only pseudonymous labels and typed facts. No
 * prompts, names, URLs, company IDs, content or replay payloads are accepted. */
export function validateObservation(raw, protocol, expectedDigest) {
  const plan = validateProtocol(protocol), digest = protocolDigest(plan);
  if (!sha.test(expectedDigest) || digest !== expectedDigest) fail();
  const row = object(raw, ["schemaVersion", "protocolSha256", "participantLabel", "journeyId", "role", "surface", "assistive",
    "observedAt", "outcome", "oracle", "securityPrivacy", "accessibility", "timingBaseline", "durationMs", "censored", "assistanceCount", "incidents", "effort", "confidence", "independentReview"]);
  if (row.schemaVersion !== 1 || row.protocolSha256 !== digest) fail(); match(row.participantLabel, /^P-[A-Z0-9]{6}$/);
  const journey = plan.journeys.find(item => item.id === row.journeyId); if (!journey) fail();
  member(row.role, journey.roles); member(row.surface, journey.surfaces); member(row.assistive, journey.assistive);
  const observedAt = timestamp(row.observedAt);
  if (observedAt <= timestamp(plan.frozenAt) || observedAt >= timestamp(plan.privacy.expiresAt)) fail();
  member(row.outcome, OUTCOMES); member(row.oracle, ORACLES); member(row.securityPrivacy, ORACLES); member(row.accessibility, ORACLES);
  member(row.timingBaseline, ["usable_account", "task_start", "not_recorded"]);
  if (row.journeyId === "first_outcome" && row.timingBaseline === "task_start") fail();
  if (row.journeyId !== "first_outcome" && row.timingBaseline === "usable_account") fail();
  if (typeof row.censored !== "boolean" || typeof row.independentReview !== "boolean") fail();
  integer(row.assistanceCount, 100);
  if (!Array.isArray(row.incidents) || row.incidents.length > INCIDENTS.length || new Set(row.incidents).size !== row.incidents.length) fail();
  row.incidents.forEach(value => member(value, INCIDENTS));
  if (row.outcome === "not_attempted") {
    if (row.timingBaseline !== "not_recorded" || row.durationMs !== null || row.oracle !== "not_checked" || row.securityPrivacy !== "not_checked" || row.accessibility !== "not_checked" || !row.censored) fail();
  } else if (row.timingBaseline === "not_recorded") { if (row.durationMs !== null) fail(); }
  else integer(row.durationMs, 14_400_000);
  if (row.outcome === "success" && (row.oracle !== "satisfied" || row.securityPrivacy === "not_satisfied" || row.accessibility === "not_satisfied" || row.censored || row.incidents.length)) fail();
  for (const field of ["effort", "confidence"]) {
    if (row[field] !== null) { integer(row[field], 7); if (!row[field]) fail(); }
    if (!journey.effortConfidence && row[field] !== null) fail();
  }
  return row;
}

/** A descriptive funnel over already validated, privacy-scoped observations.
 * A failed attempt's duration must never become Time to First Useful Outcome.
 * Counts refer to observation cells, not distinct people or population rates. */
function firstOutcomeFunnel(journey, selected) {
  const attempted = selected.filter(row => row.outcome !== "not_attempted");
  const succeeded = attempted.filter(row => row.outcome === "success");
  const checked = succeeded.filter(row => row.securityPrivacy === "satisfied" && row.accessibility === "satisfied");
  const reviewed = checked.filter(row => !journey.independenceRequired || row.independentReview);
  const timed = reviewed.filter(row => row.timingBaseline === "usable_account" && row.durationMs !== null);
  const durations = timed.map(row => row.durationMs).sort((a, b) => a - b);
  const percentile = fraction => durations.length ? durations[Math.ceil(durations.length * fraction) - 1] : null;
  return {
    unit: "participant_journey_role_surface_assistive_cell",
    observations: selected.length,
    attempted: attempted.length,
    recordedSuccesses: succeeded.length,
    privacyAccessibilityCheckedSuccesses: checked.length,
    policyReviewedSuccesses: reviewed.length,
    independenceRequired: journey.independenceRequired,
    usableAccountTimedOutcomes: timed.length,
    reviewedOutcomesWithoutTimingBaseline: reviewed.length - timed.length,
    reviewedOutcomesWithoutRecordedAssistance: reviewed.filter(row => row.assistanceCount === 0).length,
    censoredAttempts: attempted.filter(row => row.censored).length,
    timeToFirstUsefulOutcome: {
      status: durations.length ? "observed_sample" : "not_observed",
      sampleSize: durations.length,
      p50Ms: percentile(0.5),
      p90Ms: percentile(0.9),
      quantileMethod: "nearest_rank",
    },
  };
}

/** No mutation of readiness.json and no GA certificate. Confirmatory findings
 * require frozen rules and every predeclared role/surface/assistive slice. */
export function summarizePilot(protocol, observations, expectedDigest) {
  const plan = validateProtocol(protocol);
  if (!Array.isArray(observations) || observations.length > 100000) fail();
  if (protocolDigest(plan) !== expectedDigest) fail();
  const rows = observations.map(row => validateObservation(row, plan, expectedDigest)), seen = new Set();
  for (const row of rows) {
    const identity = `${row.participantLabel}:${row.journeyId}:${row.role}:${row.surface}:${row.assistive}`;
    if (seen.has(identity)) fail(); seen.add(identity);
  }
  const findings = plan.journeys.map(journey => {
    const selected = rows.filter(row => row.journeyId === journey.id);
    const attempted = selected.filter(row => row.outcome !== "not_attempted");
    let status = plan.phase === "exploratory" ? "EXPLORATORY" : "PASS";
    if (plan.phase === "confirmatory") {
      if (selected.some(row => row.outcome === "failure" || row.oracle === "not_satisfied" || row.securityPrivacy === "not_satisfied" || row.accessibility === "not_satisfied" || row.incidents.length)) status = "FAIL";
      else if (selected.some(row => row.outcome !== "success" || row.censored || row.oracle !== "satisfied" || row.securityPrivacy !== "satisfied" || row.accessibility !== "satisfied" ||
        journey.independenceRequired && !row.independentReview || journey.effortConfidence && (row.effort === null || row.confidence === null) || journey.id === "first_outcome" && row.timingBaseline !== "usable_account")) status = "INCONCLUSIVE";
      for (const { role, surface, assistive } of journey.criticalSlices) {
        const cell = attempted.filter(row => row.role === role && row.surface === surface && row.assistive === assistive);
        if (cell.length < journey.minimumPerSlice && status !== "FAIL") status = "INCONCLUSIVE";
      }
    }
    const durations = attempted.filter(row => !row.censored && row.durationMs !== null).map(row => row.durationMs).sort((a, b) => a - b);
    const median = values => { const ordered = values.filter(value => value !== null).sort((a, b) => a - b);
      return ordered.length ? ordered[Math.floor((ordered.length - 1) / 2)] : null; };
    return { journeyId: journey.id, status, observations: selected.length, attempted: attempted.length,
      successes: attempted.filter(row => row.outcome === "success").length, censored: selected.filter(row => row.censored).length,
      measuredDurations: durations.length, observedDurationP50Ms: durations.length ? durations[Math.ceil(durations.length * 0.5) - 1] : null,
      observedDurationP90Ms: durations.length ? durations[Math.ceil(durations.length * 0.9) - 1] : null,
      effortObservedMedian: median(attempted.map(row => row.effort)), confidenceObservedMedian: median(attempted.map(row => row.confidence)),
      assistanceCount: attempted.reduce((sum, row) => sum + row.assistanceCount, 0), incidents: selected.reduce((sum, row) => sum + row.incidents.length, 0),
      ...(journey.id === "first_outcome" ? { firstOutcomeFunnel: {
        overall: firstOutcomeFunnel(journey, selected),
        criticalSlices: journey.criticalSlices.map(slice => ({ ...slice,
          ...firstOutcomeFunnel(journey, selected.filter(row => row.role === slice.role && row.surface === slice.surface && row.assistive === slice.assistive)),
        })),
      } } : {}),
    };
  });
  return { schemaVersion: 1, phase: plan.phase, protocolSha256: expectedDigest, sourceCommit: plan.sourceCommit,
    artifactSha256: plan.artifactSha256, configurationSha256: plan.configurationSha256, schemaSha256: plan.schemaSha256,
    policySha256: plan.policySha256, modelInventorySha256: plan.modelInventorySha256, toolInventorySha256: plan.toolInventorySha256, execution: rows.length ? "recorded" : "not_executed", gaAllowed: false, findings };
}
