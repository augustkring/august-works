/** Internal scanner orchestration contract. This worker stores metadata-only
 * pointers; all public resolution happens through current native readers. */
export const RESPONSIBILITY_SCAN_KINDS = [
  "agent", "deployment", "workflow", "workflow_run", "routine", "connector",
  "metric", "experiment", "decision", "approval", "ai_use_case", "tool_policy",
  "skill_policy", "billing", "security_contact", "support_incident_contact", "support_case",
] as const;
export type ResponsibilityScanKind = typeof RESPONSIBILITY_SCAN_KINDS[number];
export const RESPONSIBILITY_SCAN_LIMITS = Object.freeze({ pageSizePerKind: 40, leaseMs: 30_000, cursorTtlMs: 86_400_000, pointerTtlMs: 1_800_000, scanIntervalMs: 300_000, maxAttempts: 4 });

export type ResponsibilityPointer = { kind: ResponsibilityScanKind; id: string; sourceVersion: string };
export type ResponsibilityPage = { pointers: ResponsibilityPointer[]; nextCursor: string | null; complete: boolean };
/** `attempts` is the persisted attempt_count after this lease was claimed. */
export type ResponsibilityLease = { runId: string; companyId: string; owner: string; token: string; cursor: Partial<Record<ResponsibilityScanKind, { after: string | null; complete: boolean }>>; expiresAt: Date; attempts: number };
export type NativeResponsibilityMetadataSource = {
  kind: ResponsibilityScanKind;
  /** Trusted server metadata only. Implementations must use stable keyset order,
   * filter by company, and return no content/owner/credential/ACL fields. */
  readPage(companyId: string, after: string | null, limit: number): Promise<ResponsibilityPage>;
};
export type ResponsibilityScanStore = {
  /** Fair company ordering; at most one live lease per company. Must recover
   * expired leases and issue a fresh fencing token on every successful claim. */
  claimDue(input: { worker: string; now: Date; leaseMs: number; cursorTtlMs: number }): Promise<ResponsibilityLease | null>;
  /** In one DB transaction: verify exact live (run, owner, token) lease, insert
   * pointers idempotently, persist per-kind cursor, and renew cursor expiry.
   * False means a competing worker fenced this caller; callers must stop. */
  commitPage(input: { runId: string; companyId: string; owner: string; token: string; now: Date; kind: ResponsibilityScanKind; pointers: ResponsibilityPointer[]; nextCursor: string | null; complete: boolean; pointerExpiresAt: Date; cursorExpiresAt: Date }): Promise<boolean>;
  /** Relinquish an unfinished scan after persisting one page. Must CAS the
   * exact still-live token, then make this company due immediately for fair
   * re-claim by a later worker invocation. */
  releaseForNextPage(input: { runId: string; owner: string; token: string; now: Date }): Promise<boolean>;
  /** Promote only a still-owned, fully completed scan; the prior complete
   * snapshot remains active until this fenced transaction succeeds. */
  complete(input: { runId: string; owner: string; token: string; now: Date; nextScanAt: Date }): Promise<boolean>;
  /** Sanitized bounded retry. Permanent failures or exhausted retries are
   * abandoned until the next periodic run; no error strings or inputs persist. */
  fail(input: { runId: string; owner: string; token: string; now: Date; code: "source_unavailable" | "transient_store"; retryAt: Date | null; abandoned: boolean }): Promise<boolean>;
};

function validPointer(pageKind: ResponsibilityScanKind, pointer: ResponsibilityPointer): boolean {
  return pointer.kind === pageKind && pointer.id.length > 0 && /^[0-9a-f]{64}$/.test(pointer.sourceVersion);
}

/** Processes one fair company lease and no more than one bounded metadata page
 * per invocation (up to 40 metadata rows). Raw cursors/counts/completion never leave this internal worker. */
export async function runResponsibilityScanOnce(input: {
  store: ResponsibilityScanStore;
  sources: readonly NativeResponsibilityMetadataSource[];
  worker: string;
  now?: () => Date;
}): Promise<"idle" | "fenced" | "progressed" | "complete" | "retrying" | "abandoned"> {
  if (input.sources.length !== RESPONSIBILITY_SCAN_KINDS.length ||
      new Set(input.sources.map(source => source.kind)).size !== RESPONSIBILITY_SCAN_KINDS.length ||
      RESPONSIBILITY_SCAN_KINDS.some(kind => !input.sources.some(source => source.kind === kind)))
    throw new Error("responsibility_scan_adapter_set_invalid");
  const clock = input.now ?? (() => new Date());
  const claimedAt = clock();
  const lease = await input.store.claimDue({ worker: input.worker, now: claimedAt,
    leaseMs: RESPONSIBILITY_SCAN_LIMITS.leaseMs, cursorTtlMs: RESPONSIBILITY_SCAN_LIMITS.cursorTtlMs });
  if (!lease) return "idle";
  try {
    const kind = RESPONSIBILITY_SCAN_KINDS.find(candidate => !lease.cursor[candidate]?.complete);
    if (!kind) {
      const now = clock();
      const complete = await input.store.complete({ runId: lease.runId, owner: lease.owner,
        token: lease.token, now, nextScanAt: new Date(now.getTime() + RESPONSIBILITY_SCAN_LIMITS.scanIntervalMs) });
      return complete ? "complete" : "fenced";
    }
    const state = lease.cursor[kind];
    const source = input.sources.find(item => item.kind === kind)!;
    const page = await source.readPage(lease.companyId, state?.after ?? null, RESPONSIBILITY_SCAN_LIMITS.pageSizePerKind);
    if (page.pointers.length > RESPONSIBILITY_SCAN_LIMITS.pageSizePerKind ||
        page.pointers.some(pointer => !validPointer(kind, pointer)) ||
        (page.complete && page.nextCursor !== null) ||
        (!page.complete && (!page.nextCursor || page.nextCursor === (state?.after ?? null))))
      throw new Error("responsibility_scan_page_contract_invalid");
    const now = clock();
    const committed = await input.store.commitPage({ runId: lease.runId, companyId: lease.companyId,
      owner: lease.owner, token: lease.token, now, kind, pointers: page.pointers,
      nextCursor: page.nextCursor, complete: page.complete,
      pointerExpiresAt: new Date(now.getTime() + RESPONSIBILITY_SCAN_LIMITS.pointerTtlMs),
      cursorExpiresAt: new Date(now.getTime() + RESPONSIBILITY_SCAN_LIMITS.cursorTtlMs) });
    if (!committed) return "fenced";
    if (RESPONSIBILITY_SCAN_KINDS.every(candidate => candidate === kind ? page.complete : lease.cursor[candidate]?.complete)) {
      const completed = await input.store.complete({ runId: lease.runId, owner: lease.owner,
        token: lease.token, now, nextScanAt: new Date(now.getTime() + RESPONSIBILITY_SCAN_LIMITS.scanIntervalMs) });
      return completed ? "complete" : "fenced";
    }
    return await input.store.releaseForNextPage({ runId: lease.runId, owner: lease.owner, token: lease.token, now })
      ? "progressed" : "fenced";
  } catch (error) {
    const permanent = error instanceof Error && error.message === "responsibility_scan_page_contract_invalid";
    const retryable = !permanent;
    // claimDue increments attempt_count atomically and returns that persisted
    // value. Use it directly so maxAttempts means exactly four claims.
    const attempt = lease.attempts;
    const abandoned = permanent || attempt >= RESPONSIBILITY_SCAN_LIMITS.maxAttempts;
    const delay = Math.min(300_000, 5_000 * 2 ** Math.min(attempt - 1, 6));
    const now = clock();
    await input.store.fail({ runId: lease.runId, owner: lease.owner, token: lease.token, now,
      code: retryable ? "source_unavailable" : "transient_store",
      retryAt: abandoned ? null : new Date(now.getTime() + delay), abandoned });
    return abandoned ? "abandoned" : "retrying";
  }
}
