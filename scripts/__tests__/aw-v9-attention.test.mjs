import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { protocol } from "./helpers/v9-pilot-fixtures.mjs";
import { protocolDigest } from "../../evals/aw-v9/pilot-harness.mjs";
import { summarizeAttention } from "../../evals/aw-v9/attention-harness.mjs";

// Deliberately synthetic annotations exercise mathematics and refusal paths.
// They are not participant, provider or population evidence.
const at = minute => `2026-10-13T01:${String(minute).padStart(2, "0")}:00.000Z`;
const id = n => String(n).padStart(6, "0");
function condition(n = 1, deliveries = []) {
  return { conditionLabel: `C-${id(n)}`, journeyId: "first_outcome", role: "founder", surface: "web", assistive: "keyboard",
    occurredAt: at(0), actionWindowEndsAt: at(5), resolvedAt: null, resolutionStatus: "unresolved", requiresHumanAction: true,
    independentReview: true, deliveryInventory: "reconciled", deliveries };
}
function delivery(n = 1, minute = 1) {
  return { deliveryLabel: `D-${id(n)}`, decisionValueLabel: `V-${id(n)}`, outcome: "confirmed_delivered", deliveredAt: at(minute),
    authorized: true, actionable: true, useful: true, warranted: true };
}
function summarize(conditions, plan = protocol()) {
  return summarizeAttention(plan, { schemaVersion: 1, protocolSha256: protocolDigest(plan), referenceAt: at(30), coverage: "bounded_sample", conditions }, protocolDigest(plan));
}
test("silencing every alert cannot produce perfect precision or hide required conditions", () => {
  const result = summarize([condition()]), [finding] = result.findings;
  assert.equal(finding.actionableAttentionPrecision.value, null);
  assert.deepEqual(finding.confirmedRequiredSurfacing, { numerator: 0, denominator: 1, value: 0 });
  assert.equal(finding.confirmedMissedRequired.value, 1);
  assert.equal(result.gaAllowed, false); assert.equal(result.populationRecallAvailable, false);
});
test("keeps first actionable delivery, late conditions and new decision value distinct", () => {
  const duplicate = { ...delivery(2, 2), decisionValueLabel: "V-000001", useful: false, warranted: false };
  const resolved = { ...condition(2, [delivery(1), duplicate, delivery(3, 3)]), resolvedAt: at(4), resolutionStatus: "resolved" };
  const [f] = summarize([condition(), resolved, condition(3, [delivery(4, 6)])]).findings;
  assert.equal(f.actionableAttentionPrecision.value, 0.75);
  assert.equal(f.confirmedRequiredSurfacing.value, 2 / 3); assert.equal(f.confirmedMissedRequired.value, 1 / 3);
  assert.equal(f.confirmedLateRequired.value, 1 / 3); assert.equal(f.duplicateInterruption.value, 0.25);
  assert.equal(f.unnecessaryInterruption.value, 0.25); assert.equal(f.overdueUnresolved, 2);
  assert.deepEqual(f.timeToActionableDeliveryBuckets, { one_to_five_minutes: 1, five_to_thirty_minutes: 1 });
});
test("unconfirmed, partial, open and missing-window observations cannot be called confirmed misses", () => {
  const unknown = { ...delivery(), outcome: "unconfirmed", deliveredAt: null, authorized: null, actionable: null, useful: null, warranted: null };
  const [f] = summarize([condition(1, [unknown]), { ...condition(2), deliveryInventory: "partial" },
    { ...condition(3), actionWindowEndsAt: null }, { ...condition(4), actionWindowEndsAt: at(40) }]).findings;
  assert.equal(f.missedRequired, 0); assert.equal(f.unknownRequired, 2);
  assert.equal(f.missingActionWindow, 1); assert.equal(f.openRequired, 1); assert.equal(f.requiredConditions, 4);
});
test("late confirmed delivery does not prove the first delivery was late when an earlier outcome is unknown", () => {
  const unknown = { ...delivery(1), authorized: null };
  const [f] = summarize([condition(1, [unknown, delivery(2, 6)])]).findings;
  assert.equal(f.surfacedRequired, 1); assert.equal(f.lateRequired, 0); assert.equal(f.unknownTimingRequired, 1);
  assert.deepEqual(f.timeToActionableDeliveryBuckets, {});
  assert.deepEqual(f.confirmedLatencyUpperBoundBuckets, { five_to_thirty_minutes: 1 });
});
test("unauthorized physical delivery does not satisfy required actionable delivery", () => {
  const [f] = summarize([condition(1, [{ ...delivery(), authorized: false }])]).findings;
  assert.equal(f.confirmedDeliveries, 1); assert.equal(f.unauthorizedDeliveries, 1);
  assert.equal(f.surfacedRequired, 0); assert.equal(f.missedRequired, 1);
});
test("unreviewed annotations cannot supply usefulness or critical denominators", () => {
  const [f] = summarize([{ ...condition(1, [delivery(), { ...delivery(2), decisionValueLabel: "V-000001" }]), independentReview: false }]).findings;
  assert.equal(f.unreviewedConditions, 1); assert.equal(f.requiredConditions, 0);
  assert.equal(f.actionableAttentionPrecision.value, null); assert.equal(f.duplicateInterruption.value, null);
});
test("critical consequence slices are never averaged away by successful lower-consequence cases", () => {
  const plan = protocol(); plan.journeys.push({ ...structuredClone(plan.journeys[0]), id: "material_approval", criticality: "C3" });
  const result = summarize([condition(1, [delivery()]), { ...condition(2), journeyId: "material_approval" }], plan);
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings.find(f => f.criticality === "C3").confirmedMissedRequired.value, 1);
  assert.ok(!Object.hasOwn(result, "score"));
});
test("empty samples remain unexecuted and aggregate receipts contain no condition, delivery or value labels", () => {
  assert.equal(summarize([]).execution, "not_executed");
  const result = JSON.stringify(summarize([condition(1, [delivery()])]));
  for (const secret of ["C-000001", "D-000001", "V-000001", at(0), at(1)]) assert.ok(!result.includes(secret));
});
test("rejects duplicate condition/delivery identities, private fields, out-of-slice data and inconsistent chronology", () => {
  assert.throws(() => summarize([condition(), condition()]));
  assert.throws(() => summarize([condition(1, [delivery()]), condition(2, [delivery()])]));
  assert.throws(() => summarize([{ ...condition(), rawPrompt: "PRIVATE_CANARY" }]), /Invalid V9 attention evaluation artifact/);
  assert.throws(() => summarize([{ ...condition(), surface: "slack" }]));
  assert.throws(() => summarize([{ ...condition(), resolvedAt: "2026-10-13T00:00:00.000Z" }]));
  assert.throws(() => summarize([condition(1, [{ ...delivery(), deliveredAt: at(31) }])]));
  assert.throws(() => summarize([condition(1, [{ ...delivery(), outcome: "unconfirmed" }])]));
});
test("requires the exact frozen protocol identity and bounded input", () => {
  const plan = protocol(), bundle = { schemaVersion: 1, protocolSha256: protocolDigest(plan), referenceAt: at(30), coverage: "bounded_sample", conditions: [] };
  assert.throws(() => summarizeAttention(plan, bundle, "f".repeat(64)));
  assert.throws(() => summarizeAttention(plan, { ...bundle, coverage: "population" }, protocolDigest(plan)));
  assert.throws(() => summarize(Array.from({ length: 1001 }, (_, n) => condition(n))));
});
test("canonical observation identity ignores object-key order but changes with actual evidence", () => {
  const plan = protocol(), bundle = { schemaVersion: 1, protocolSha256: protocolDigest(plan), referenceAt: at(30), coverage: "bounded_sample", conditions: [condition(1, [delivery()])] };
  const first = summarizeAttention(plan, bundle, protocolDigest(plan));
  const reordered = Object.fromEntries(Object.entries(bundle).reverse());
  assert.equal(summarizeAttention(plan, reordered, protocolDigest(plan)).observationsSha256, first.observationsSha256);
  bundle.conditions[0].deliveries[0].useful = false;
  assert.notEqual(summarizeAttention(plan, bundle, protocolDigest(plan)).observationsSha256, first.observationsSha256);
});
test("unconfirmed resolution and missing windows remain separate from confirmed unresolved age", () => {
  const [f] = summarize([{ ...condition(), resolutionStatus: "unconfirmed", actionWindowEndsAt: null, deliveryInventory: "partial" }]).findings;
  assert.equal(f.unknownResolutionRequired, 1); assert.deepEqual(f.unresolvedAgeBuckets, {});
  assert.equal(f.overdueUnresolved, 0); assert.equal(f.unknownRequired, 1); assert.equal(f.missingActionWindow, 1);
  assert.throws(() => summarize([{ ...condition(), resolutionStatus: "resolved" }]));
});
test("the retained blank template cannot fabricate an executed study", () => {
  const template = JSON.parse(readFileSync(new URL("../../evals/aw-v9/attention-observations.template.json", import.meta.url), "utf8"));
  const plan = protocol(); assert.deepEqual(template.conditions, []);
  assert.throws(() => summarizeAttention(plan, template, protocolDigest(plan)));
});
