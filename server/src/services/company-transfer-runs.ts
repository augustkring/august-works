import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, companyTransferRuns } from "@paperclipai/db";
import { conflict } from "../errors.js";

// Durable run ledger for chunked company transfers. A run tracks one export
// publish or import apply of a transfer container. Progress is recorded per
// container part (chunk or blob name) as each part finishes processing and
// verification, so an interrupted run — process restart, dropped connection,
// failed part — resumes from the parts it already completed. The transfer
// manifest's content-derived idempotency key ties retries of the same content
// to the same run instead of starting over.
//
// Status machine — every transition site, in one place:
//
//   (insert)                                  -> pending    resumeOrCreate
//   pending|running|failed  --start---------> running
//   pending|running|failed  --claimApply----> applying     exactly one winner of concurrent applies
//   applying                --complete------> completed    terminal; no path ever reopens it
//   applying                --releaseApplyClaim-> failed   guarded on "applying", so a cleanup error
//                                                          after complete() is a no-op release
//   applying                --markApplyOutcomeUnknown/recoverStrandedApplyingRuns-> needs_reconciliation
//                                                          unknown is not permission to replay
//   pending|running (idle)  --cancelIfIdle--> cancelled    sweep claim; also guarded on a stale updatedAt
//   pending|running|failed  --cancel--------> cancelled
//   pending|running|failed   --fail----------> failed       pre-apply failures only; no effect replay inferred
//
//   needs_reconciliation: same run remains discoverable, never claimable.
//   failed:    retryable — in the resume lookup and claimable by claimApply.
//   completed: terminal — resumeOrCreate short-circuits with alreadyCompleted.
//   cancelled: terminal and unclaimable — excluded from the resume lookup, so
//              redeclaring the same content after a sweep starts a fresh run.
//              An original export owner may still settle its exact allocated
//              key after cancellation; this only records evidence/cleanup.
//   completePart records parts only under pending|running — never onto an
//   applying or terminal run.

export type CompanyTransferDirection = "export" | "import";
export type CompanyTransferRunStatus =
  | "pending"
  | "running"
  | "applying"
  | "needs_reconciliation"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Minimal structural view of a transfer manifest's part index: the ledger only
 * ever needs part names and counts, so it stays decoupled from any particular
 * container format. Manifests without this shape (e.g. the chunked zip-upload
 * manifest, which carries its own part list) pass explicit counts to
 * `recordManifest` and track parts by their own names.
 */
export interface CompanyTransferPartsIndex {
  chunks: Array<{ name: string }>;
  blobs: Array<{ name: string }>;
}

function asPartsIndex(manifest: unknown): CompanyTransferPartsIndex | null {
  if (typeof manifest !== "object" || manifest === null) return null;
  const { chunks, blobs } = manifest as { chunks?: unknown; blobs?: unknown };
  const named = (value: unknown): value is Array<{ name: string }> =>
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { name?: unknown }).name === "string",
    );
  if (!named(chunks) || !named(blobs)) return null;
  return { chunks, blobs };
}

const RESUMABLE_STATUSES: CompanyTransferRunStatus[] = ["pending", "running", "failed"];
/** Statuses under which container parts may still be recorded as completed. */
const PART_UPLOAD_STATUSES: CompanyTransferRunStatus[] = ["pending", "running"];

export interface CompanyTransferRunRow {
  id: string;
  companyId: string | null;
  direction: CompanyTransferDirection;
  status: CompanyTransferRunStatus;
  actorKey: string;
  containerRef: unknown;
  idempotencyKey: string;
  manifestSha256: string | null;
  manifest: unknown;
  chunkCount: number;
  blobCount: number;
  completedParts: string[];
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResumeOrCreateTransferRunInput {
  direction: CompanyTransferDirection;
  actorKey: string;
  idempotencyKey: string;
  /** Credential-free container location descriptor. Never put secrets here. */
  containerRef: unknown;
  companyId?: string | null;
  /** Optional immutable, owner-validated input snapshot for native export runs. */
  manifest?: unknown;
  manifestSha256?: string;
}

export interface ResumeOrCreateTransferRunResult {
  run: CompanyTransferRunRow;
  /** True when an existing run for the same content was picked up. */
  resumed: boolean;
  /** True when that existing run already finished — the caller can short-circuit. */
  alreadyCompleted: boolean;
}

function rowFromRecord(record: typeof companyTransferRuns.$inferSelect): CompanyTransferRunRow {
  return {
    ...record,
    direction: record.direction as CompanyTransferDirection,
    status: record.status as CompanyTransferRunStatus,
    manifest: record.manifest ?? null,
    completedParts: Array.isArray(record.completedParts) ? (record.completedParts as string[]) : [],
  };
}

async function getRun(db: Db, runId: string): Promise<CompanyTransferRunRow | null> {
  const [record] = await db
    .select()
    .from(companyTransferRuns)
    .where(eq(companyTransferRuns.id, runId))
    .limit(1);
  return record ? rowFromRecord(record) : null;
}

function assertExportNamespace(rows: Array<{ containerRef: unknown }>, storageScopeId?: string) {
  for (const row of rows) {
    const ref = row.containerRef as { artifact?: { state?: string; storageScopeId?: string } | null } | null;
    if (ref?.artifact && ref.artifact.state !== "deleted" &&
        (!/^[a-f0-9]{64}$/.test(storageScopeId ?? "") || ref.artifact.storageScopeId !== storageScopeId))
      throw conflict("The original export storage namespace requires reconciliation before company erasure", { code: "company_export_storage_scope_changed" });
  }
}

export const companyTransferRunService = {
  getRun,

  /**
   * Company erasure and export admission share the company row lock. A
   * terminal ledger row is not proof its object is gone; only a deleted
   * artifact tombstone (or no allocation) is safe to remove.
   */
  async assertCompanyExportErasureComplete(db: Db, companyId: string): Promise<void> {
    const tx = db as unknown as Db;
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
    const rows = await tx.select({ status: companyTransferRuns.status, containerRef: companyTransferRuns.containerRef })
      .from(companyTransferRuns).where(and(eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export")));
    for (const row of rows) {
      if (["pending", "running"].includes(row.status))
        throw conflict("Company export work or an unresolved storage outcome must settle before company removal");
      const ref = row.containerRef && typeof row.containerRef === "object" ? row.containerRef as Record<string, unknown> : null;
      const artifact = ref?.artifact && typeof ref.artifact === "object" ? ref.artifact as Record<string, unknown> : null;
      if (row.status === "failed" && artifact?.state === "allocated")
        throw conflict("Company export has an unknown provider outcome and requires storage reconciliation");
      if (artifact && artifact.state !== "deleted")
        throw conflict("Company export artifact erasure must be confirmed before company removal");
    }
  },

  /** Fence new admissions and wait for all already accepted export workers. */
  async prepareCompanyExportErasure(db: Db, companyId: string, storageScopeId?: string): Promise<void> {
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      const [company] = await tx.select({ id: companies.id, status: companies.status })
        .from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company || company.status === "active")
        throw conflict("Company must be archived before export erasure can start");
      const owned = await tx.select({ containerRef: companyTransferRuns.containerRef }).from(companyTransferRuns)
        .where(and(eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export")));
      assertExportNamespace(owned, storageScopeId);
      await tx.update(companyTransferRuns).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export"),
          inArray(companyTransferRuns.status, ["pending", "failed"]),
          sql`coalesce(${companyTransferRuns.containerRef}->'artifact' = 'null'::jsonb, true)`));
      const active = await tx.select({ id: companyTransferRuns.id }).from(companyTransferRuns).where(and(
        eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export"),
        inArray(companyTransferRuns.status, ["pending", "running"]),
      )).limit(1);
      if (active.length) throw conflict("Accepted company export workers must settle before provider erasure");
      const uncertain = await tx.select({ id: companyTransferRuns.id }).from(companyTransferRuns).where(and(
        eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export"),
        sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'allocated'`,
      )).limit(1);
      if (uncertain.length) throw conflict("Company export has an unknown provider outcome and requires storage reconciliation");
    });
  },

  /** Called only after the canonical company prefix erasure owner succeeds. */
  async confirmCompanyExportPrefixErased(db: Db, companyId: string, storageScopeId?: string): Promise<void> {
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      const [company] = await tx.select({ id: companies.id, status: companies.status })
        .from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company || company.status === "active")
        throw conflict("Company export prefix erasure requires an archived company");
      const owned = await tx.select({ containerRef: companyTransferRuns.containerRef }).from(companyTransferRuns)
        .where(and(eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export")));
      assertExportNamespace(owned, storageScopeId);
      const active = await tx.select({ id: companyTransferRuns.id }).from(companyTransferRuns).where(and(
        eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export"),
        inArray(companyTransferRuns.status, ["pending", "running"]),
      )).limit(1);
      if (active.length) throw conflict("Accepted company export workers must settle before artifact erasure can be recorded");
      const uncertain = await tx.select({ id: companyTransferRuns.id }).from(companyTransferRuns).where(and(
        eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export"),
        sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'allocated'`,
      )).limit(1);
      if (uncertain.length) throw conflict("Company export has an unknown provider outcome and requires storage reconciliation");
      await tx.update(companyTransferRuns).set({
        containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{artifact,state}', '"deleted"'::jsonb, false)`,
        updatedAt: new Date(),
      }).where(and(eq(companyTransferRuns.companyId, companyId), eq(companyTransferRuns.direction, "export"),
        sql`${companyTransferRuns.containerRef}->'artifact'->>'state' in ('stored','ready','expired')`));
    });
  },

  async getRunForActor(db: Db, runId: string, actorKey: string): Promise<CompanyTransferRunRow | null> {
    const run = await getRun(db, runId);
    return run && run.actorKey === actorKey ? run : null;
  },

  /**
   * Find the actor's run for this exact content (same idempotency key and
   * direction) or create a fresh one. A completed prior run is returned with
   * `alreadyCompleted` so the caller can skip the apply outright; a pending,
   * running, failed, or mid-apply prior run is resumed with its part progress
   * intact (an "applying" run resumes so a concurrent re-declaration never
   * spawns a duplicate, but `start` leaves it alone until the apply settles).
   */
  async resumeOrCreate(db: Db, input: ResumeOrCreateTransferRunInput): Promise<ResumeOrCreateTransferRunResult> {
    return db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      // No unique index backs the (actor, direction, content key) lookup, so
      // two concurrent identical declarations could both miss the lookup and
      // both insert. Serialize them with a transaction-scoped advisory lock
      // on the key: the second caller waits here until the first commits and
      // then resumes the first caller's row.
      const lockKey = `${input.actorKey}|${input.direction}|${input.idempotencyKey}`;
      await txDb.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      if (input.direction === "export" && input.companyId) {
        const [company] = await txDb.select({ id: companies.id, status: companies.status }).from(companies)
          .where(eq(companies.id, input.companyId)).for("update");
        if (!company || company.status !== "active")
          throw conflict("Company is not accepting new exports", { code: "company_export_company_unavailable" });
      }
      const terminalStatuses = [...RESUMABLE_STATUSES, "applying", "needs_reconciliation", "completed",
        ...(input.direction === "export" ? ["cancelled" as const] : [])];
      const matches = await txDb
        .select()
        .from(companyTransferRuns)
        .where(
          and(
            eq(companyTransferRuns.idempotencyKey, input.idempotencyKey),
            eq(companyTransferRuns.direction, input.direction),
            eq(companyTransferRuns.actorKey, input.actorKey),
            inArray(companyTransferRuns.status, terminalStatuses),
          ),
        )
        .orderBy(desc(companyTransferRuns.createdAt))
        .limit(1);
      const existing = matches[0] ? rowFromRecord(matches[0]) : null;
      if (existing) {
        return { run: existing, resumed: true, alreadyCompleted: existing.status === "completed" };
      }
      const [created] = await txDb
        .insert(companyTransferRuns)
        .values({
          direction: input.direction,
          actorKey: input.actorKey,
          idempotencyKey: input.idempotencyKey,
          containerRef: input.containerRef,
          companyId: input.companyId ?? null,
          manifest: input.manifest ?? null,
          manifestSha256: input.manifestSha256 ?? null,
        })
        .returning();
      return { run: rowFromRecord(created!), resumed: false, alreadyCompleted: false };
    });
  },

  /**
   * Persist the parsed manifest so resume can re-verify parts without
   * refetching it. Counts default to the manifest's chunk/blob index when it
   * has one; manifests with a different part layout pass them explicitly.
   */
  async recordManifest(
    db: Db,
    runId: string,
    manifest: unknown,
    manifestSha256: string,
    counts?: { chunkCount: number; blobCount: number },
  ): Promise<void> {
    const index = asPartsIndex(manifest);
    const chunkCount = counts?.chunkCount ?? index?.chunks.length ?? 0;
    const blobCount = counts?.blobCount ?? index?.blobs.length ?? 0;
    await db
      .update(companyTransferRuns)
      .set({
        manifest,
        manifestSha256,
        chunkCount,
        blobCount,
        updatedAt: new Date(),
      })
      .where(eq(companyTransferRuns.id, runId));
  },

  /**
   * Atomically claim a run for apply. The apply itself is not idempotent, so
   * of any overlapping apply attempts exactly one caller gets `true` here —
   * a single guarded UPDATE moves the run to "applying" only while it is
   * still open (pending/running/failed). The winner settles the claim with
   * `complete` on success or `releaseApplyClaim`/`fail` on error (which makes
   * the run retryable again); every concurrent loser gets `false` and must
   * not run the apply.
   */
  async claimApply(db: Db, runId: string): Promise<boolean> {
    const claimed = await db
      .update(companyTransferRuns)
      .set({ status: "applying", error: null, updatedAt: new Date() })
      .where(
        and(eq(companyTransferRuns.id, runId), inArray(companyTransferRuns.status, RESUMABLE_STATUSES)),
      )
      .returning({ id: companyTransferRuns.id });
    return claimed.length > 0;
  },

  async start(db: Db, runId: string): Promise<void> {
    await db
      .update(companyTransferRuns)
      .set({ status: "running", error: null, startedAt: new Date(), finishedAt: null, updatedAt: new Date() })
      .where(
        and(eq(companyTransferRuns.id, runId), inArray(companyTransferRuns.status, RESUMABLE_STATUSES)),
      );
  },

  async attachCompany(db: Db, runId: string, companyId: string): Promise<void> {
    await db
      .update(companyTransferRuns)
      .set({ companyId, updatedAt: new Date() })
      .where(eq(companyTransferRuns.id, runId));
  },

  /**
   * Record one finished container part. Appends atomically in SQL and is
   * idempotent: re-completing an already recorded part leaves the ledger
   * unchanged, so a retried part never double-counts. Only open runs
   * (pending/running) accept parts; when the run has meanwhile gone terminal
   * (e.g. the abandoned-spool sweep cancelled it) or is mid-apply, nothing is
   * recorded and `false` comes back so the caller can discard the part.
   */
  async completePart(db: Db, runId: string, partName: string): Promise<boolean> {
    const partJson = JSON.stringify([partName]);
    const updated = await db
      .update(companyTransferRuns)
      .set({
        completedParts: sql`case when ${companyTransferRuns.completedParts} @> ${partJson}::jsonb then ${companyTransferRuns.completedParts} else ${companyTransferRuns.completedParts} || ${partJson}::jsonb end`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(companyTransferRuns.id, runId), inArray(companyTransferRuns.status, PART_UPLOAD_STATUSES)),
      )
      .returning({ id: companyTransferRuns.id });
    return updated.length > 0;
  },

  /** Container part names the run still has to process, in manifest order. */
  remainingParts(run: CompanyTransferRunRow, manifest: CompanyTransferPartsIndex): string[] {
    const completed = new Set(run.completedParts);
    const remaining: string[] = [];
    for (const chunk of manifest.chunks) {
      if (!completed.has(chunk.name)) remaining.push(chunk.name);
    }
    for (const blob of manifest.blobs) {
      if (!completed.has(blob.name)) remaining.push(blob.name);
    }
    return remaining;
  },

  async complete(db: Db, runId: string): Promise<void> {
    await db
      .update(companyTransferRuns)
      .set({ status: "completed", error: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(companyTransferRuns.id, runId));
  },

  /**
   * Atomically claim an abandoned open run: cancel it only while it is still
   * open (pending/running) AND saw no activity since `idleSince` — one
   * guarded UPDATE, so any concurrent part upload or resume that bumped
   * `updatedAt` makes the guard miss and `false` comes back. Callers must
   * only touch the run's spooled data after a `true` claim.
   *
   * The terminal state is "cancelled", not "failed", precisely because failed
   * runs stay claimable: a failed sweep target could be claimed by an apply
   * and assembled while its spool is being deleted underneath it. A cancelled
   * run is unclaimable the instant this UPDATE commits — before any
   * filesystem deletion — and `resumeOrCreate` ignores it, so redeclaring the
   * same content afterwards starts a fresh run.
   */
  async cancelIfIdle(db: Db, runId: string, idleSince: Date, error: string): Promise<boolean> {
    const claimed = await db
      .update(companyTransferRuns)
      .set({ status: "cancelled", error, finishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(companyTransferRuns.id, runId),
          inArray(companyTransferRuns.status, PART_UPLOAD_STATUSES),
          lt(companyTransferRuns.updatedAt, idleSince),
        ),
      )
      .returning({ id: companyTransferRuns.id });
    return claimed.length > 0;
  },

  /**
   * Release a held apply claim into "failed". Guarded on "applying", unlike
   * `fail`: catch-all error paths around an apply cannot know whether the run
   * already settled (a cleanup error thrown after `complete` reaches the same
   * catch as a real apply failure), and an unguarded fail there would flip a
   * completed run back to claimable and invite a duplicate import. When the
   * run already settled this is a no-op and returns false.
   */
  async releaseApplyClaim(db: Db, runId: string, error: string): Promise<boolean> {
    const released = await db
      .update(companyTransferRuns)
      .set({ status: "failed", error, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.status, "applying")))
      .returning({ id: companyTransferRuns.id });
    return released.length > 0;
  },

  /** A domain call that may have written cannot be released for replay.
   * An actual completion receipt can still settle it; uncertainty cannot. */
  async markApplyOutcomeUnknown(db: Db, runId: string): Promise<boolean> {
    const rows = await db.update(companyTransferRuns).set({
      status: "needs_reconciliation", error: "Import outcome is unknown; reconcile the existing transfer before another apply.",
      updatedAt: new Date(),
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.status, "applying")))
      .returning({ id: companyTransferRuns.id });
    return rows.length > 0;
  },

  /** Startup observation cannot prove whether a non-idempotent apply wrote.
   * Preserve the same logical run and its parts; never authorize a replay.
   * This is conservative for another replica's live apply as well: its real
   * completion can settle the run, while startup cannot create a new attempt. */
  async recoverStrandedApplyingRuns(db: Db): Promise<string[]> {
    const recovered = await db.update(companyTransferRuns).set({
      status: "needs_reconciliation", error: "Import outcome is unknown after restart; reconcile the existing transfer before another apply.",
      updatedAt: new Date(),
    }).where(eq(companyTransferRuns.status, "applying")).returning({ id: companyTransferRuns.id });
    return recovered.map(row => row.id);
  },

  async fail(db: Db, runId: string, error: string): Promise<void> {
    await db
      .update(companyTransferRuns)
      .set({ status: "failed", error, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(companyTransferRuns.id, runId), inArray(companyTransferRuns.status, RESUMABLE_STATUSES)));
  },


  /** Atomic lease used only by the read-only native company-export worker. */
  async claimExport(db: Db, runId: string, workerId: string, options: { leaseMs?: number; now?: Date } = {}): Promise<CompanyTransferRunRow | null> {
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      const [preflight] = await tx.select({ companyId: companyTransferRuns.companyId }).from(companyTransferRuns)
        .where(eq(companyTransferRuns.id, runId)).limit(1);
      if (!preflight?.companyId) return null;
      const [company] = await tx.select({ id: companies.id, status: companies.status }).from(companies)
        .where(eq(companies.id, preflight.companyId)).for("update");
      if (!company || company.status !== "active") return null;
      const [row] = await tx.select().from(companyTransferRuns).where(eq(companyTransferRuns.id, runId)).for("update");
      if (!row || row.direction !== "export" || !["pending", "running", "failed"].includes(row.status)) return null;
      const ref = row.containerRef && typeof row.containerRef === "object" ? row.containerRef as Record<string, unknown> : null;
      if (!ref || ref.kind !== "company_export_transfer_v1" || ref.version !== 1) return null;
      const now = options.now ?? new Date();
      const priorLease = ref.lease && typeof ref.lease === "object" ? ref.lease as Record<string, unknown> : null;
      const retainsArtifact = ref.artifact !== null && ref.artifact !== undefined;
      const priorArtifact = ref.artifact && typeof ref.artifact === "object" ? ref.artifact as Record<string, unknown> : null;
      if (row.status === "pending" && typeof priorLease?.expiresAt === "string" && Date.parse(priorLease.expiresAt) > now.getTime()) return null;
      if (priorArtifact?.state === "allocated") {
        if (row.status === "running") {
          const priorExpiry = typeof priorLease?.expiresAt === "string" ? Date.parse(priorLease.expiresAt) : NaN;
          if (Number.isFinite(priorExpiry) && priorExpiry <= now.getTime()) {
            await tx.update(companyTransferRuns).set({ status: "failed", error: "company_export_storage_outcome_unknown",
              finishedAt: now, updatedAt: now }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.status, "running")));
          }
        }
        return null;
      }
      // A failed export that still owns an artifact is terminal for this
      // request key. Cleanup may be racing an explicit retry; a new request
      // key is required to publish another artifact.
      if (row.status === "failed" && retainsArtifact) return null;
      if (row.status === "running") {
        const priorExpiry = typeof priorLease?.expiresAt === "string" ? Date.parse(priorLease.expiresAt) : NaN;
        if (!Number.isFinite(priorExpiry) || priorExpiry > now.getTime()) return null;
      }
      const nextRef = { ...ref, lease: { ownerId: workerId, expiresAt: new Date(now.getTime() + (options.leaseMs ?? 120_000)).toISOString() } };
      const [updated] = await tx.update(companyTransferRuns).set({ status: "running", containerRef: nextRef, error: null, finishedAt: null,
        startedAt: row.startedAt ?? now, updatedAt: now }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"))).returning();
      return updated ? rowFromRecord(updated) : null;
    });
  },

  async renewExportLease(db: Db, runId: string, workerId: string, options: { leaseMs?: number; now?: Date } = {}): Promise<boolean> {
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      const [row] = await tx.select().from(companyTransferRuns).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "running"))).for("update");
      const ref = row?.containerRef && typeof row.containerRef === "object" ? row.containerRef as Record<string, unknown> : null;
      const lease = ref?.lease && typeof ref.lease === "object" ? ref.lease as Record<string, unknown> : null;
      const now = options.now ?? new Date();
      if (!row || lease?.ownerId !== workerId || typeof lease.expiresAt !== "string" || Date.parse(lease.expiresAt) <= now.getTime()) return false;
      const [updated] = await tx.update(companyTransferRuns).set({ containerRef: { ...ref!, lease: { ownerId: workerId, expiresAt: new Date(now.getTime() + (options.leaseMs ?? 120_000)).toISOString() } }, updatedAt: now })
        .where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.status, "running"))).returning({ id: companyTransferRuns.id });
      return Boolean(updated);
    });
  },

  async recordExportArtifact(db: Db, runId: string, workerId: string, artifact: { objectKey: string; state: "allocated" | "stored"; storageScopeId?: string; sha256?: string; byteSize?: number; expiresAt?: string; manifestSha256?: string }): Promise<boolean> {
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      // A cancelled owner can still receive its own in-flight storage receipt.
      // The guarded update below preserves `cancelled`; it never reopens publish.
      const [row] = await tx.select().from(companyTransferRuns).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"),
        inArray(companyTransferRuns.status, artifact.state === "allocated" ? ["running"] : ["running", "failed", "cancelled"]))).for("update");
      const ref = row?.containerRef && typeof row.containerRef === "object" ? row.containerRef as Record<string, unknown> : null;
      const lease = ref?.lease && typeof ref.lease === "object" ? ref.lease as Record<string, unknown> : null;
      const previous = ref?.artifact && typeof ref.artifact === "object" ? ref.artifact as Record<string, unknown> : null;
      if (!row || lease?.ownerId !== workerId) return false;
      if (artifact.state === "allocated") {
        if (typeof artifact.storageScopeId !== "string" || !/^[a-f0-9]{64}$/.test(artifact.storageScopeId)) return false;
        if (typeof lease.expiresAt !== "string" || Date.parse(lease.expiresAt) <= Date.now()) return false;
        if (ref!.artifact != null) return previous?.state === "allocated" && previous.objectKey === artifact.objectKey;
      } else if (previous?.state !== "allocated" || previous.objectKey !== artifact.objectKey ||
          typeof previous.storageScopeId !== "string" || !/^[a-f0-9]{64}$/.test(previous.storageScopeId)) {
        // Storage's settlement callback is proof about this exact allocated key.
        // Lease expiry can change work ownership, but cannot revoke evidence of
        // the original provider write; allocated rows cannot be reassigned.
        return false;
      }
      const [updated] = await tx.update(companyTransferRuns).set({
        containerRef: { ...ref!, artifact: { ...artifact, storageScopeId: artifact.state === "allocated" ? artifact.storageScopeId : previous!.storageScopeId } }, updatedAt: new Date(),
        ...(artifact.state === "stored" ? { error: sql`case when ${companyTransferRuns.error} = 'company_export_storage_outcome_unknown' then null else ${companyTransferRuns.error} end` } : {}),
      })
        .where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.status, row.status))).returning({ id: companyTransferRuns.id });
      return Boolean(updated);
    });
  },

  async clearAllocatedExportArtifact(db: Db, runId: string, workerId: string, objectKey: string): Promise<boolean> {
    const [updated] = await db.update(companyTransferRuns).set({
      containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{artifact}', 'null'::jsonb, false)`, updatedAt: new Date(),
      error: sql`case when ${companyTransferRuns.error} = 'company_export_storage_outcome_unknown' then null else ${companyTransferRuns.error} end`,
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), inArray(companyTransferRuns.status, ["running", "failed", "cancelled"]),
      sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'allocated'`,
      sql`${companyTransferRuns.containerRef}->'artifact'->>'objectKey' = ${objectKey}`,
      sql`${companyTransferRuns.containerRef}->'lease'->>'ownerId' = ${workerId}`)).returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  async clearFailedExportArtifact(db: Db, runId: string, workerId: string, objectKey: string): Promise<boolean> {
    const [updated] = await db.update(companyTransferRuns).set({
      containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{artifact}', 'null'::jsonb, false)`, updatedAt: new Date(),
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "failed"),
      sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'allocated'`,
      sql`${companyTransferRuns.containerRef}->'artifact'->>'objectKey' = ${objectKey}`,
      sql`${companyTransferRuns.containerRef}->'lease'->>'ownerId' = ${workerId}`)).returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  async markFailedExportArtifactDeleted(db: Db, runId: string, workerId: string, objectKey: string): Promise<boolean> {
    const [updated] = await db.update(companyTransferRuns).set({
      containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{artifact,state}', '"deleted"'::jsonb, false)`, updatedAt: new Date(),
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"),
      sql`((${companyTransferRuns.status} = 'failed' and ${companyTransferRuns.containerRef}->'artifact'->>'state' in ('allocated','stored'))
        or (${companyTransferRuns.status} = 'cancelled' and ${companyTransferRuns.containerRef}->'artifact'->>'state' = 'stored'))`,
      sql`${companyTransferRuns.containerRef}->'artifact'->>'objectKey' = ${objectKey}`,
      sql`${companyTransferRuns.containerRef}->'lease'->>'ownerId' = ${workerId}`)).returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  async completeExport(db: Db, runId: string, workerId: string, manifestSha256: string): Promise<boolean> {
    const now = new Date();
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      const [row] = await tx.select().from(companyTransferRuns).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "running"))).for("update");
      const ref = row?.containerRef && typeof row.containerRef === "object" ? row.containerRef as Record<string, unknown> : null;
      const lease = ref?.lease && typeof ref.lease === "object" ? ref.lease as Record<string, unknown> : null;
      const artifact = ref?.artifact && typeof ref.artifact === "object" ? ref.artifact as Record<string, unknown> : null;
      if (!row || lease?.ownerId !== workerId || typeof lease.expiresAt !== "string" || Date.parse(lease.expiresAt) <= now.getTime()
        || artifact?.state !== "stored" || typeof artifact.sha256 !== "string" || typeof artifact.objectKey !== "string"
        || typeof artifact.expiresAt !== "string" || Date.parse(artifact.expiresAt) <= now.getTime()
        || typeof artifact.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.manifestSha256)
        || artifact.manifestSha256 !== manifestSha256) return false;
      const [updated] = await tx.update(companyTransferRuns).set({ status: "completed", manifestSha256,
        containerRef: { ...ref!, lease: null, artifact: { ...artifact, state: "ready" } }, error: null, finishedAt: now, updatedAt: now })
        .where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.status, "running"))).returning({ id: companyTransferRuns.id });
      return Boolean(updated);
    });
  },

  async failExport(db: Db, runId: string, workerId: string, code: string): Promise<boolean> {
    const now = new Date();
    const [updated] = await db.update(companyTransferRuns).set({
      status: "failed", error: code.slice(0, 80), finishedAt: now, updatedAt: now,
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "running"),
        sql`${companyTransferRuns.containerRef}->'lease'->>'ownerId' = ${workerId}`)).returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  /** A closed transient authority conflict can retry only with no write or a
   * confirmed stored object. Unknown PUTs never regain dispatch authority. */
  async deferExport(db: Db, runId: string, workerId: string, code: string): Promise<boolean> {
    const now = new Date();
    const [updated] = await db.update(companyTransferRuns).set({
      status: "pending", error: code, updatedAt: now,
      containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{lease,expiresAt}', ${JSON.stringify(new Date(now.getTime() + 1000).toISOString())}::jsonb, false)`,
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "running"),
      sql`${companyTransferRuns.containerRef}->'lease'->>'ownerId' = ${workerId}`,
      sql`(${companyTransferRuns.containerRef}->'artifact' = 'null'::jsonb or ${companyTransferRuns.containerRef}->'artifact'->>'state' = 'stored')`))
      .returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  async listExportRunsForRecovery(db: Db, limit = 25): Promise<CompanyTransferRunRow[]> {
    const nowIso = new Date().toISOString();
    const rows = await db.select().from(companyTransferRuns).where(and(eq(companyTransferRuns.direction, "export"), or(
      and(eq(companyTransferRuns.status, "pending"),
        sql`coalesce(${companyTransferRuns.containerRef}->'lease'->>'expiresAt', '') <= ${nowIso}`),
      and(eq(companyTransferRuns.status, "running"),
        sql`coalesce(${companyTransferRuns.containerRef}->'lease'->>'expiresAt', '') <= ${nowIso}`),
    ))).orderBy(companyTransferRuns.createdAt).limit(Math.max(1, Math.min(100, limit)));
    return rows.map(rowFromRecord);
  },

  async listExpiredExportArtifacts(db: Db, limit = 20, now = new Date()): Promise<CompanyTransferRunRow[]> {
    const rows = await db.select().from(companyTransferRuns).where(and(eq(companyTransferRuns.direction, "export"), or(
      and(eq(companyTransferRuns.status, "completed"),
        inArray(sql<string>`${companyTransferRuns.containerRef}->'artifact'->>'state'`, ["ready", "expired"]),
        sql`coalesce(${companyTransferRuns.containerRef}->'artifact'->>'expiresAt', '') <= ${now.toISOString()}`),
      and(inArray(companyTransferRuns.status, ["failed", "cancelled"]),
        sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'stored'`),
    )))
      .orderBy(companyTransferRuns.updatedAt).limit(Math.max(1, Math.min(100, limit)));
    return rows.map(rowFromRecord);
  },

  async markExportArtifactDeleted(db: Db, runId: string, objectKey: string): Promise<boolean> {
    const [updated] = await db.update(companyTransferRuns).set({
      containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{artifact,state}', '"deleted"'::jsonb, false)`, updatedAt: new Date(),
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "completed"),
      sql`${companyTransferRuns.containerRef}->'artifact'->>'objectKey' = ${objectKey}`,
      sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'expired'`)).returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  async expireExportArtifact(db: Db, runId: string, objectKey: string): Promise<boolean> {
    const [updated] = await db.update(companyTransferRuns).set({
      containerRef: sql`jsonb_set(${companyTransferRuns.containerRef}, '{artifact,state}', '"expired"'::jsonb, false)`, updatedAt: new Date(),
    }).where(and(eq(companyTransferRuns.id, runId), eq(companyTransferRuns.direction, "export"), eq(companyTransferRuns.status, "completed"),
      sql`${companyTransferRuns.containerRef}->'artifact'->>'objectKey' = ${objectKey}`,
      sql`${companyTransferRuns.containerRef}->'artifact'->>'state' = 'ready'`,
      sql`coalesce(${companyTransferRuns.containerRef}->'artifact'->>'expiresAt', '') <= ${new Date().toISOString()}`)).returning({ id: companyTransferRuns.id });
    return Boolean(updated);
  },

  async cancel(db: Db, runId: string): Promise<void> {
    await db
      .update(companyTransferRuns)
      .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(companyTransferRuns.id, runId), inArray(companyTransferRuns.status, RESUMABLE_STATUSES)));
  },
};
