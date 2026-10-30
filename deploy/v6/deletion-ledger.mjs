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
    !Array.isArray(ledger.analyticalSources) ||
    !Array.isArray(ledger.feedback) ||
    !Array.isArray(ledger.supportCases) ||
    !Array.isArray(ledger.identityHomes ?? []) ||
    !Array.isArray(ledger.users ?? []) ||
    ledger.companies.length +
      ledger.memory.length +
      ledger.businessEvents.length +
      ledger.analyticalSources.length +
      ledger.feedback.length +
      ledger.supportCases.length +
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
  for (const row of ledger.analyticalSources) {
    if (!uuid.test(row?.company_id ?? "") || !uuid.test(row?.input_ref ?? "") ||
      !["issue", "project", "goal", "document", "document_revision"].includes(row?.input_type) ||
      !Number.isFinite(Date.parse(row.suppressed_at)) || Date.parse(row.suppressed_at) > exportedAt)
      throw Error("Invalid analytical source suppression marker");
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
  for (const row of ledger.feedback) {
    if (!uuid.test(row?.subject_id ?? "") || !uuid.test(row?.company_id ?? "") ||
      !uuid.test(row?.feedback_id ?? "") || !["case", "image"].includes(row?.target_kind) ||
      (row.target_kind === "case" && row.subject_id !== row.feedback_id) ||
      !Number.isFinite(Date.parse(row.erased_at)) || Date.parse(row.erased_at) > exportedAt)
      throw Error("Invalid feedback deletion marker");
  }
  for (const row of ledger.supportCases) {
    const keys = row && typeof row === "object" && !Array.isArray(row)
      ? Object.keys(row).sort()
      : [];
    if (
      keys.join(",") !== "case_id,company_id,erased_at,retain_until,subject_id,target_kind" ||
      typeof row.subject_id !== "string" || typeof row.company_id !== "string" || typeof row.case_id !== "string" ||
      !uuid.test(row?.subject_id ?? "") ||
      !uuid.test(row?.company_id ?? "") ||
      !uuid.test(row?.case_id ?? "") ||
      !["case", "event"].includes(row?.target_kind) ||
      (row.target_kind === "case" && row.subject_id.toLowerCase() !== row.case_id.toLowerCase()) ||
      (row.target_kind === "event" && row.subject_id.toLowerCase() === row.case_id.toLowerCase()) ||
      typeof row.erased_at !== "string" || typeof row.retain_until !== "string" ||
      !Number.isFinite(Date.parse(row.erased_at)) ||
      Date.parse(row.erased_at) > exportedAt ||
      !Number.isFinite(Date.parse(row.retain_until)) ||
      Date.parse(row.retain_until) <= Date.parse(row.erased_at)
    )
      throw Error("Invalid support case deletion marker");
  }
  return ledger;
}
