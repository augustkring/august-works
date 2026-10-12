import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateDeletionLedger } from "./deletion-ledger.mjs";
const key = "b".repeat(64),
  now = Date.parse("2026-10-05T12:00:00Z");
const base = {
  environment: "staging",
  exportedAt: new Date(now).toISOString(),
  companies: [{ company_id: "00000000-0000-4000-8000-000000000001" }],
  memory: [],
  businessEvents: [], analyticalSources: [], feedback: [],
};
function sign(value) {
  const payload = JSON.stringify(value);
  return {
    payload,
    signature: createHmac("sha256", Buffer.from(key, "hex"))
      .update(payload)
      .digest("hex"),
  };
}
test("V9 restore requires exact bounded authenticated feedback erasure identities", () => {
  const marker = { subject_id: "00000000-0000-4000-8000-000000000002", company_id: base.companies[0].company_id,
    feedback_id: "00000000-0000-4000-8000-000000000002", target_kind: "case", erased_at: base.exportedAt };
  const valid = { ...base, feedback: [marker] };
  assert.deepEqual(authenticateDeletionLedger(sign(valid), key, "staging", now), valid);
  const { feedback, ...legacy } = base;
  for (const invalid of [legacy, { ...base, feedback: {} },
    { ...base, feedback: [{ ...marker, subject_id: "invalid" }] },
    { ...base, feedback: [{ ...marker, company_id: "invalid" }] },
    { ...base, feedback: [{ ...marker, feedback_id: "invalid" }] },
    { ...base, feedback: [{ ...marker, target_kind: "other" }] },
    { ...base, feedback: [{ ...marker, subject_id: base.companies[0].company_id }] },
    { ...base, feedback: [{ ...marker, erased_at: "invalid" }] },
    { ...base, feedback: [{ ...marker, erased_at: new Date(now + 1).toISOString() }] },
    { ...base, feedback: Array(100001).fill(marker) },
  ]) assert.throws(() => authenticateDeletionLedger(sign(invalid), key, "staging", now));
  assert.deepEqual(authenticateDeletionLedger(sign({ ...base, feedback: [{ ...marker, target_kind: "image",
    feedback_id: base.companies[0].company_id }] }), key, "staging", now).feedback[0].target_kind, "image");
});
test("restore rejects forged, stale, cross-environment and invalid-date ledgers", () => {
  assert.deepEqual(
    authenticateDeletionLedger(sign(base), key, "staging", now),
    base,
  );
  for (const value of [
    { ...base, exportedAt: "invalid" },
    { ...base, exportedAt: new Date(now - 86400001).toISOString() },
    { ...base, environment: "production" },
    { ...base, companies: [{ company_id: "other" }] },
    {
      ...base,
      users: [{ id: "bad", user_id: "actor", created_at: base.exportedAt }],
    },
    {
      ...base,
      users: [
        {
          id: base.companies[0].company_id,
          user_id: "",
          created_at: base.exportedAt,
        },
      ],
    },
    {
      ...base,
      users: [
        {
          id: base.companies[0].company_id,
          user_id: "actor",
          created_at: "invalid",
        },
      ],
    },
    {
      ...base,
      memory: [
        {
          company_id: base.companies[0].company_id,
          record_id: "bad",
          key: "private",
          kind: "record",
          deleted_at: base.exportedAt,
        },
      ],
    },
  ])
    assert.throws(() =>
      authenticateDeletionLedger(sign(value), key, "staging", now),
    );
  assert.throws(() =>
    authenticateDeletionLedger(
      { ...sign(base), signature: "a".repeat(64) },
      key,
      "staging",
      now,
    ),
  );
});

test("V8 restore requires a bounded, authenticated suppression section with exact company and source identities", () => {
  const marker = { company_id: base.companies[0].company_id, source_ref: "00000000-0000-4000-8000-000000000002", suppressed_at: base.exportedAt };
  const valid = { ...base, businessEvents: [marker] };
  assert.deepEqual(authenticateDeletionLedger(sign(valid), key, "staging", now), valid);
  const { businessEvents, ...legacy } = base;
  for (const invalid of [legacy,
    { ...base, businessEvents: {} },
    { ...base, businessEvents: [{ ...marker, company_id: "foreign" }] },
    { ...base, businessEvents: [{ ...marker, source_ref: "bad" }] },
    { ...base, businessEvents: [{ ...marker, suppressed_at: "invalid" }] },
    { ...base, businessEvents: [{ ...marker, suppressed_at: new Date(now + 1).toISOString() }] },
    { ...base, businessEvents: Array(100001).fill(marker) },
  ]) assert.throws(() => authenticateDeletionLedger(sign(invalid), key, "staging", now));
});

test("analytical restore requires native object guards even when no event was projected", () => {
  const marker = { company_id: base.companies[0].company_id, input_type: "issue", input_ref: "00000000-0000-4000-8000-000000000002", suppressed_at: base.exportedAt };
  const valid = { ...base, analyticalSources: [marker] };
  assert.deepEqual(authenticateDeletionLedger(sign(valid), key, "staging", now), valid);
  const goalGuard = { ...base, analyticalSources: [{ ...marker, input_type: "goal" }] };
  assert.deepEqual(authenticateDeletionLedger(sign(goalGuard), key, "staging", now), goalGuard);
  for (const input_type of ["document", "document_revision"]) {
    const guard = { ...base, analyticalSources: [{ ...marker, input_type }] };
    assert.deepEqual(authenticateDeletionLedger(sign(guard), key, "staging", now), guard);
  }
  const { analyticalSources, ...legacy } = base;
  for (const invalid of [legacy, { ...base, analyticalSources: {} },
    { ...base, analyticalSources: [{ ...marker, input_type: "employee" }] },
    { ...base, analyticalSources: [{ ...marker, input_ref: "invalid" }] },
    { ...base, analyticalSources: [{ ...marker, company_id: "other" }] },
    { ...base, analyticalSources: [{ ...marker, suppressed_at: "invalid" }] },
    { ...base, analyticalSources: [{ ...marker, suppressed_at: new Date(now + 1).toISOString() }] },
    { ...base, analyticalSources: Array(100001).fill(marker) },
  ]) assert.throws(() => authenticateDeletionLedger(sign(invalid), key, "staging", now));
});
