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
