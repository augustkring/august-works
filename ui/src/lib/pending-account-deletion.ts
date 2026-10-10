// Per-tab Core recovery locator. This is neither a receipt nor an access grant;
// the original authenticated Native deletion owner mediates every explicit retry.
// Password, consent text, email and mutation bodies must never be stored here.
export const PENDING_ACCOUNT_DELETION_KEY = "aw.v9.pending-account-deletion";
type Locator = { schemaVersion: 1; principal: string; idempotencyKey: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseRow(input: unknown): Locator {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Account deletion recovery is unavailable");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || value.schemaVersion !== 1 ||
    typeof value.principal !== "string" || !value.principal.length || value.principal.length > 255 ||
    typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey))
    throw new Error("Account deletion recovery is unavailable");
  return { schemaVersion: 1, principal: value.principal, idempotencyKey: value.idempotencyKey };
}
function parseInventory(input: unknown): Locator[] {
  if (!Array.isArray(input) || input.length > 16) throw new Error("Account deletion recovery is unavailable");
  const rows = input.map(parseRow);
  if (new Set(rows.map(value => value.principal)).size !== rows.length) throw new Error("Account deletion recovery is unavailable");
  return rows;
}
function load(): Locator[] {
  const raw = window.sessionStorage.getItem(PENDING_ACCOUNT_DELETION_KEY);
  if (raw === null) return [];
  if (raw.length > 8192 || new TextEncoder().encode(raw).length > 8192) throw new Error("Account deletion recovery is unavailable");
  return parseInventory(JSON.parse(raw));
}
function persist(rows: Locator[]) {
  const valid = parseInventory(rows), raw = JSON.stringify(valid);
  if (new TextEncoder().encode(raw).length > 8192) throw new Error("Account deletion recovery is unavailable");
  if (valid.length) window.sessionStorage.setItem(PENDING_ACCOUNT_DELETION_KEY, raw);
  else window.sessionStorage.removeItem(PENDING_ACCOUNT_DELETION_KEY);
}
export function readPendingAccountDeletion(principal: string): string | null {
  const matches = load().filter(value => value.principal === principal);
  if (matches.length > 1) throw new Error("Account deletion recovery is unavailable");
  return matches[0]?.idempotencyKey ?? null;
}
export function retainPendingAccountDeletion(principal: string, idempotencyKey: string) {
  const value = parseRow({ schemaVersion: 1, principal, idempotencyKey }), rows = load();
  const existing = rows.filter(item => item.principal === principal);
  if (existing.length > 1 || existing.length === 1 && existing[0]!.idempotencyKey !== idempotencyKey)
    throw new Error("An account deletion request is already unresolved");
  if (!existing.length) persist([...rows, value]);
  if (readPendingAccountDeletion(principal) !== idempotencyKey) throw new Error("Account deletion recovery is unavailable");
}
export function clearPendingAccountDeletion(principal: string, idempotencyKey: string) {
  persist(load().filter(value => value.principal !== principal || value.idempotencyKey !== idempotencyKey));
}
/** Called only after the original session owner settles successfully. */
export function retainAccountDeletionForPrincipal(principal: string | null) {
  try { persist(principal === null ? [] : load().filter(value => value.principal === principal)); }
  catch {
    // Remove malformed private bytes, retaining refusal rather than inferring
    // that no prior irreversible request exists.
    try { window.sessionStorage.setItem(PENDING_ACCOUNT_DELETION_KEY, JSON.stringify({ schemaVersion: 1, recoveryUnavailable: true })); }
    catch { /* The account form refuses transport when storage is unavailable. */ }
  }
}
