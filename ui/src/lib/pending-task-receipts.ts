import { experiencePendingTaskReceiptSchema as row, experiencePendingTaskReceiptInventorySchema as inventory } from "@paperclipai/shared";

// Core recovery locator only, per tab. Native keys and current read guards own
// every outcome. No title, description, result, credential or write body here.
export const PENDING_TASK_RECEIPTS_KEY = "aw.v9.pending-task-receipts";
type Receipt = ReturnType<typeof row.parse>;
function storage(): Storage {
  return window.sessionStorage;
}
function load(): Receipt[] {
  const raw = storage().getItem(PENDING_TASK_RECEIPTS_KEY);
  if (raw === null) return [];
  if (raw.length > 8192 || new TextEncoder().encode(raw).length > 8192)
    throw new Error("Task recovery is unavailable");
  return inventory.parse(JSON.parse(raw));
}
function persist(rows: Receipt[]): void {
  const validated = inventory.parse(rows),
    raw = JSON.stringify(validated);
  if (new TextEncoder().encode(raw).length > 8192)
    throw new Error("Task recovery is unavailable");
  if (validated.length) storage().setItem(PENDING_TASK_RECEIPTS_KEY, raw);
  else storage().removeItem(PENDING_TASK_RECEIPTS_KEY);
}
export function readPendingTaskReceipt(
  companyId: string,
  principal: string,
): string | null {
  const matches = load().filter(
    (value) => value.companyId === companyId && value.principal === principal,
  );
  if (matches.length > 1) throw new Error("Task recovery is unavailable");
  return matches[0]?.idempotencyKey ?? null;
}
export function retainPendingTaskReceipt(
  companyId: string,
  principal: string,
  idempotencyKey: string,
): void {
  const receipt = row.parse({
    schemaVersion: 1,
    companyId,
    principal,
    idempotencyKey,
  });
  const existing = load();
  if (
    existing.some(
      (value) => value.companyId === companyId && value.principal === principal,
    )
  )
    throw new Error("A task receipt is already pending");
  persist([...existing, receipt]);
}
export function clearPendingTaskReceipt(
  companyId: string,
  principal: string,
  idempotencyKey: string,
): void {
  persist(
    load().filter(
      (value) =>
        !(
          value.companyId === companyId &&
          value.principal === principal &&
          value.idempotencyKey === idempotencyKey
        ),
    ),
  );
}
/** Only a settled account decision may remove prior-account per-tab locators. */
export function retainTaskReceiptsForPrincipal(principal: string | null): void {
  try {
    persist(
      principal === null
        ? []
        : load().filter((value) => value.principal === principal),
    );
  } catch {
    // Drop any malformed private bytes, but preserve an anonymous refusal so a
    // failed recovery inventory cannot silently enable another create.
    try {
      storage().setItem(
        PENDING_TASK_RECEIPTS_KEY,
        JSON.stringify({ schemaVersion: 1, recoveryUnavailable: true }),
      );
    } catch {
      /* The draft refuses all creates when recovery storage is unavailable. */
    }
  }
}
