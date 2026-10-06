import { createHmac, timingSafeEqual } from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function authenticateDeletionLedger(
  envelope,
  signingKey,
  environment,
  now = Date.now(),
) {
  if (
    !/^[a-f0-9]{64}$/i.test(signingKey ?? "") ||
    typeof envelope?.payload !== "string" ||
    Buffer.byteLength(envelope.payload) > 16 * 1024 ** 2 ||
    !/^[a-f0-9]{64}$/i.test(envelope.signature ?? "")
  )
    throw Error("Invalid deletion ledger envelope");
  const expected = createHmac("sha256", Buffer.from(signingKey, "hex"))
    .update(envelope.payload)
    .digest();
  if (!timingSafeEqual(Buffer.from(envelope.signature, "hex"), expected))
    throw Error("Deletion ledger authentication failed");
  const ledger = JSON.parse(envelope.payload),
    exportedAt = Date.parse(ledger.exportedAt);
  if (
    ledger.environment !== environment ||
    !Number.isFinite(exportedAt) ||
    exportedAt < now - 86400000 ||
    exportedAt > now + 60000 ||
    !Array.isArray(ledger.companies) ||
    !Array.isArray(ledger.memory) ||
    !Array.isArray(ledger.businessEvents) ||
    !Array.isArray(ledger.identityHomes ?? []) ||
    !Array.isArray(ledger.users ?? []) ||
    ledger.companies.length +
      ledger.memory.length +
      ledger.businessEvents.length +
      (ledger.identityHomes?.length ?? 0) +
      (ledger.users?.length ?? 0) >
      100000
  )
    throw Error("Fresh bounded same-environment deletion ledger required");
  for (const row of ledger.companies)
    if (!uuid.test(row?.company_id ?? ""))
      throw Error("Invalid deletion company scope");
  for (const row of ledger.memory) {
    if (
      !uuid.test(row?.company_id ?? "") ||
      (row.kind === "record"
        ? !uuid.test(row?.record_id ?? "")
        : row.record_id !== null) ||
      typeof row.key !== "string" ||
      row.key.length < 1 ||
      row.key.length > 2048 ||
      !["record", "operation", "source"].includes(row.kind) ||
      !Number.isFinite(Date.parse(row.deleted_at)) ||
      Date.parse(row.deleted_at) > exportedAt
    )
      throw Error("Invalid memory deletion marker");
  }
  for (const row of ledger.identityHomes ?? [])
    if (!uuid.test(row?.id ?? "") || !uuid.test(row?.home_company_id ?? ""))
      throw Error("Invalid identity home ledger");
  for (const row of ledger.businessEvents) {
    if (!uuid.test(row?.company_id ?? "") || !uuid.test(row?.source_ref ?? "") ||
      !Number.isFinite(Date.parse(row.suppressed_at)) || Date.parse(row.suppressed_at) > exportedAt)
      throw Error("Invalid Business Events suppression marker");
  }
  for (const row of ledger.users ?? [])
    if (
      !uuid.test(row?.id ?? "") ||
      typeof row.user_id !== "string" ||
      row.user_id.length < 1 ||
      row.user_id.length > 200 ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      Date.parse(row.created_at) > exportedAt
    )
      throw Error("Invalid account deletion ledger");
  return ledger;
}
