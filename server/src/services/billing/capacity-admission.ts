/** Database admission leaves saturated work queued. It does not cancel or
 * restart provider work to manufacture a free slot. */
export function isCompanyCapacityWait(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    const row = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      row.code === "23514" &&
      row.message === "free_core_company_concurrency_limit"
    )
      return true;
    current = row.cause;
  }
  return false;
}
