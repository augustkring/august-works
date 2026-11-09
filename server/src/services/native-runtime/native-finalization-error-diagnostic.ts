const ERROR_CLASSES = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "PostgresError", "DatabaseError", "Error"] as const;
const ERROR_CODES = ["ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_OUT_OF_RANGE"] as const;
const SQL_STATES = ["22007", "22008", "22P02", "23502", "23503", "23505", "23514", "40001", "40P01", "57014"] as const;
const OWNER_ERROR_PREFIXES = [
  "native_checkout_not_released",
  "native_status_decision_not_persisted",
  "native_finalization_coordinator_missing",
  "native_continuation_cancellation_run_missing",
  "native_pending_effect_target_missing",
  "native_pending_effect_target_unimplemented",
  "native_status_reason_code_required",
] as const;

type Closed<T extends readonly string[]> = T[number] | "other" | "missing";
function closed<T extends readonly string[]>(value: unknown, allowed: T): Closed<T> {
  if (typeof value !== "string") return "missing";
  return (allowed as readonly string[]).includes(value) ? value as Closed<T> : "other";
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function sqlState(value: unknown): Closed<typeof SQL_STATES> {
  if (typeof value !== "string" || !/^[0-9A-Z]{5}$/.test(value)) return "missing";
  return closed(value, SQL_STATES);
}
function ownerErrorPrefix(message: unknown): Closed<typeof OWNER_ERROR_PREFIXES> {
  if (typeof message !== "string") return "missing";
  const prefix = OWNER_ERROR_PREFIXES.find(value => message === value || message.startsWith(`${value}:`));
  return prefix ?? "other";
}

/** Failure-only, closed diagnostic; never persists raw messages, SQL, params, or identifiers. */
export function projectNativeFinalizationError(error: unknown) {
  const causes: Array<{ errorClass: Closed<typeof ERROR_CLASSES>; code: Closed<typeof ERROR_CODES>;
    sqlState: Closed<typeof SQL_STATES>; ownerErrorPrefix: Closed<typeof OWNER_ERROR_PREFIXES> }> = [];
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current != null; depth++) {
    if ((typeof current !== "object" && typeof current !== "function") || seen.has(current as object)) break;
    seen.add(current as object);
    const item = record(current);
    const code = typeof item.code === "string" ? item.code : undefined;
    causes.push({
      errorClass: closed(item.name, ERROR_CLASSES),
      code: closed(code, ERROR_CODES),
      sqlState: sqlState(code),
      ownerErrorPrefix: ownerErrorPrefix(item.message),
    });
    current = item.cause;
  }
  return { phase: "status_decision_commit" as const, causes };
}
