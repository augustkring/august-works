import { createHash } from "node:crypto";
import { protocolDigest, validateProtocol } from "./pilot-harness.mjs";

const fail = () => { throw new Error("Invalid V9 attention evaluation artifact"); };
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail();
  return value;
}
function time(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return Date.parse(value);
}
function label(value, prefix) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}-[A-Z0-9]{6}$`).test(value)) fail();
}
function judgment(value) { if (value !== null && typeof value !== "boolean") fail(); }
const rate = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const bucket = duration => duration < 60_000 ? "under_minute" : duration < 300_000 ? "one_to_five_minutes"
  : duration < 1_800_000 ? "five_to_thirty_minutes" : duration < 7_200_000 ? "thirty_minutes_to_two_hours"
  : duration < 86_400_000 ? "two_hours_to_day" : "over_day";

/** Offline, manually annotated bounded samples only. A reviewed condition is a
 * denominator even when no alert was emitted. This does not collect telemetry,
 * discover an exhaustive population, verify a provider or certify Human study. */
export function summarizeAttention(rawPlan, raw, expectedDigest) {
  const plan = validateProtocol(rawPlan), digest = protocolDigest(plan);
  if (digest !== expectedDigest) fail();
  const evidence = object(raw, ["schemaVersion", "protocolSha256", "referenceAt", "coverage", "conditions"]);
  if (evidence.schemaVersion !== 1 || evidence.protocolSha256 !== digest || evidence.coverage !== "bounded_sample") fail();
  const reference = time(evidence.referenceAt), frozen = time(plan.frozenAt), expiry = time(plan.privacy.expiresAt);
  if (reference <= frozen || reference >= expiry || !Array.isArray(evidence.conditions) || evidence.conditions.length > 1000) fail();
  const conditions = new Set(), deliveries = new Set(), groups = new Map();
  for (const rawCondition of evidence.conditions) {
    const c = object(rawCondition, ["conditionLabel", "journeyId", "role", "surface", "assistive", "occurredAt", "actionWindowEndsAt",
      "resolvedAt", "resolutionStatus", "requiresHumanAction", "independentReview", "deliveryInventory", "deliveries"]);
    label(c.conditionLabel, "C");
    if (conditions.has(c.conditionLabel)) fail(); conditions.add(c.conditionLabel);
    const journey = plan.journeys.find(journey => journey.id === c.journeyId);
    if (!journey || !journey.criticalSlices.some(slice => slice.role === c.role && slice.surface === c.surface && slice.assistive === c.assistive)) fail();
    const occurred = time(c.occurredAt), deadline = c.actionWindowEndsAt === null ? null : time(c.actionWindowEndsAt);
    const resolved = c.resolvedAt === null ? null : time(c.resolvedAt);
    if (!["unresolved", "resolved", "unconfirmed"].includes(c.resolutionStatus) || (c.resolutionStatus === "resolved") !== (resolved !== null)) fail();
    if (occurred <= frozen || occurred > reference || deadline !== null && deadline < occurred ||
      resolved !== null && (resolved < occurred || resolved > reference)) fail();
    judgment(c.requiresHumanAction);
    if (typeof c.independentReview !== "boolean" || !["reconciled", "partial"].includes(c.deliveryInventory) ||
      !Array.isArray(c.deliveries) || c.deliveries.length > 32) fail();
    const groupKey = JSON.stringify([c.journeyId, c.role, c.surface, c.assistive, journey.criticality]);
    let g = groups.get(groupKey);
    if (!g) {
      g = { journeyId: c.journeyId, role: c.role, surface: c.surface, assistive: c.assistive, criticality: journey.criticality,
        conditions: 0, unreviewedConditions: 0, requiredConditions: 0, surfacedRequired: 0, missedRequired: 0,
        lateRequired: 0, unknownTimingRequired: 0, unknownRequired: 0, openRequired: 0, missingActionWindow: 0,
        confirmedDeliveries: 0, unconfirmedDeliveries: 0, unauthorizedDeliveries: 0,
        useful: 0, usefulnessJudged: 0, unnecessary: 0, warrantJudged: 0, duplicates: 0, duplicateJudgedDeliveries: 0,
        unresolvedAgeBuckets: {}, overdueUnresolved: 0, unknownResolutionRequired: 0,
        timeToActionableDeliveryBuckets: {}, confirmedLatencyUpperBoundBuckets: {} };
      groups.set(groupKey, g);
    }
    g.conditions++;
    const delivered = [], valueKeys = new Set(); let unknown = c.deliveryInventory === "partial";
    for (const rawDelivery of c.deliveries) {
      const d = object(rawDelivery, ["deliveryLabel", "decisionValueLabel", "outcome", "deliveredAt", "authorized", "actionable", "useful", "warranted"]);
      label(d.deliveryLabel, "D"); label(d.decisionValueLabel, "V");
      if (deliveries.has(d.deliveryLabel)) fail(); deliveries.add(d.deliveryLabel);
      if (!["confirmed_delivered", "confirmed_not_delivered", "unconfirmed"].includes(d.outcome)) fail();
      for (const key of ["authorized", "actionable", "useful", "warranted"]) judgment(d[key]);
      if (d.outcome !== "confirmed_delivered") {
        if (d.deliveredAt !== null || [d.authorized, d.actionable, d.useful, d.warranted].some(value => value !== null)) fail();
        if (d.outcome === "unconfirmed") { g.unconfirmedDeliveries++; unknown = true; }
        continue;
      }
      const at = time(d.deliveredAt);
      if (at < occurred || at > reference) fail();
      delivered.push({ ...d, at }); g.confirmedDeliveries++;
      if (d.authorized === false) g.unauthorizedDeliveries++;
      if (c.independentReview) {
        g.duplicateJudgedDeliveries++;
        if (valueKeys.has(d.decisionValueLabel)) g.duplicates++; else valueKeys.add(d.decisionValueLabel);
        if (d.useful !== null) { g.usefulnessJudged++; if (d.useful) g.useful++; }
        if (d.warranted !== null) { g.warrantJudged++; if (!d.warranted) g.unnecessary++; }
      }
    }
    if (!c.independentReview || c.requiresHumanAction === null) { g.unreviewedConditions++; continue; }
    if (!c.requiresHumanAction) continue;
    g.requiredConditions++;
    if (deadline === null) g.missingActionWindow++;
    const actionable = delivered.filter(d => d.authorized === true && d.actionable === true).sort((a, b) => a.at - b.at);
    const first = actionable[0];
    // A physically delivered message with unresolved authority/actionability
    // cannot establish a miss or successful actionable delivery.
    const unresolvedActionability = delivered.filter(d => d.authorized !== false && d.actionable !== false &&
      (d.authorized === null || d.actionable === null));
    const unknownOutcome = unknown;
    unknown ||= unresolvedActionability.length > 0;
    if (first) {
      g.surfacedRequired++;
      const key = bucket(first.at - occurred);
      const latency = unknownOutcome || unresolvedActionability.some(d => d.at < first.at)
        ? g.confirmedLatencyUpperBoundBuckets : g.timeToActionableDeliveryBuckets;
      latency[key] = (latency[key] ?? 0) + 1;
      if (deadline !== null && first.at > deadline) {
        if (unknownOutcome || unresolvedActionability.some(d => d.at <= deadline)) g.unknownTimingRequired++;
        else g.lateRequired++;
      }
    } else if (unknown) g.unknownRequired++;
    else if (deadline !== null) {
      if (reference < deadline) g.openRequired++;
      else g.missedRequired++;
    }
    if (c.resolutionStatus === "unconfirmed") g.unknownResolutionRequired++;
    if (c.resolutionStatus === "unresolved") {
      const key = bucket(reference - occurred);
      g.unresolvedAgeBuckets[key] = (g.unresolvedAgeBuckets[key] ?? 0) + 1;
      if (deadline !== null && reference > deadline) g.overdueUnresolved++;
    }
  }
  return {
    schemaVersion: 1, contractId: "aw.attention-reviewed-sample.v1", protocolSha256: digest,
    observationsSha256: createHash("sha256").update(JSON.stringify(canonical(evidence))).digest("hex"),
    sourceCommit: plan.sourceCommit, artifactSha256: plan.artifactSha256,
    configurationSha256: plan.configurationSha256, schemaSha256: plan.schemaSha256, policySha256: plan.policySha256,
    modelInventorySha256: plan.modelInventorySha256, toolInventorySha256: plan.toolInventorySha256,
    phase: plan.phase, coverage: "bounded_sample", execution: evidence.conditions.length ? "recorded" : "not_executed",
    claim: "descriptive_reviewed_sample_only", populationRecallAvailable: false, gaAllowed: false,
    findings: [...groups.values()].sort((a, b) => JSON.stringify([a.journeyId, a.role, a.surface, a.assistive]).localeCompare(JSON.stringify([b.journeyId, b.role, b.surface, b.assistive]))).map(g => ({
      ...g,
      actionableAttentionPrecision: rate(g.useful, g.usefulnessJudged),
      // Unknown/open conditions remain in the denominator; the observed ratio
      // is a conservative confirmed fraction, never an exhaustive recall claim.
      confirmedRequiredSurfacing: rate(g.surfacedRequired, g.requiredConditions),
      confirmedMissedRequired: rate(g.missedRequired, g.requiredConditions),
      confirmedLateRequired: rate(g.lateRequired, g.requiredConditions),
      duplicateInterruption: rate(g.duplicates, g.duplicateJudgedDeliveries),
      unnecessaryInterruption: rate(g.unnecessary, g.warrantJudged),
    })),
  };
}
