import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { customerOperations, companyTransferRuns, type Db } from "@paperclipai/db";
import type { CompanyPortabilityImportResult, CustomerOperationReceipt } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import { pinCurrentBoardActor, authorizationService, hasCurrentInstanceAdminRole, type AuthorizationActor } from "./authorization.js";
import { isAuthenticationStateBusy } from "../auth/authenticator-assurance.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type CompanyImportJob = typeof customerOperations.$inferSelect;

type JobTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function pinImportCredential(tx: JobTransaction, actor?: AuthorizationActor) {
  if (!actor || actor.source === "local_implicit") return null;
  if (actor.type !== "board") throw forbidden("The original import requester is required");
  if (actor.authenticatedCredentialExpiresAt != null && !Number.isFinite(actor.authenticatedCredentialExpiresAt))
    throw forbidden("The original import credential is unavailable");
  if (actor.source === "cloud_tenant") return { actor, credentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? null };
  if (actor.sessionId == null && actor.keyId == null && actor.authenticatedCredentialExpiresAt == null && actor.source !== "board_key") return null;
  const pinned = await pinCurrentBoardActor(tx, actor).catch(error => {
    if (isAuthenticationStateBusy(error)) throw conflict("Authentication state is changing; try again", { code: "authentication_state_busy" });
    throw error;
  });
  if (!pinned) throw forbidden("The original import credential is unavailable");
  return pinned;
}

async function finishImportCredential(tx: JobTransaction, pinned: Awaited<ReturnType<typeof pinImportCredential>>) {
  if (!pinned) return;
  const [current] = await tx.execute<{ active: boolean }>(sql`select
    not exists(select 1 from account_deletion_operations where user_id=${pinned.actor.userId})
    and ${pinned.credentialExpiresAt === null ? sql`true` : sql`${pinned.credentialExpiresAt}::double precision > extract(epoch from clock_timestamp())*1000`} as active`);
  if (!current?.active) throw forbidden("The original import credential is unavailable");
}

/** Durable status only. The original portability owner performs the import;
 * this service neither stores executable input nor retries business effects. */
export function companyImportJobService(db: Db) {
  return {
    async admit(input: { actorKey: string; userId: string | null; actorKind: "board" | "cloud_tenant";
      inputHash: string; scopeKey: string; companyId: string | null; idempotencyKey?: string;
      transferId?: string | null }, actor?: AuthorizationActor) {
      const requesterKeyHash = hash(input.actorKey);
      const rawKey = input.idempotencyKey ?? `input:${input.inputHash}`;
      if (!rawKey || rawKey.length > 256) throw conflict("Import request key is invalid");
      const key = hash(rawKey);
      return db.transaction(async tx => {
        if (actor && (actor.type !== "board" || (actor.userId ?? null) !== input.userId)) throw forbidden("The original import requester changed");
        // Preserve the original one-active-import-per-requester boundary across
        // replicas. Unknown effects also block another admission.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`company-import:${requesterKeyHash}`},0))`);
        if (input.actorKind === "board" && input.userId) {
          // Match the native account-erasure principal lock. An authenticated
          // account deleted while waiting cannot create a new durable job.
          const users = await tx.execute(sql`select id from "user" where id=${input.userId} for key share`);
          const erased = await tx.execute(sql`select id from account_deletion_operations where user_id=${input.userId} limit 1`);
          if (!users.length || erased.length) throw forbidden("The current import requester is unavailable");
        }
        const pinned = await pinImportCredential(tx, actor);
        const finish = async <T>(result: T) => { await finishImportCredential(tx, pinned); return result; };
        const [existing] = await tx.select().from(customerOperations).where(and(
          eq(customerOperations.requesterKeyHash, requesterKeyHash), eq(customerOperations.operationType, "company_import"),
          eq(customerOperations.scopeKey, input.scopeKey), eq(customerOperations.idempotencyKey, key),
        )).limit(1);
        if (existing) {
          if (existing.inputHash !== input.inputHash) throw conflict("Import request key already refers to different input", { code: "import_request_changed" });
          if (existing.status === "needs_reconciliation") throw conflict("The import outcome is unknown. Reconcile the existing import before trying again.",
            { code: "import_outcome_unknown", operationId: existing.id });
          if (existing.status !== "failed" || existing.progressStage !== "rejected_before_import")
            return finish({ job: existing, replay: true });
        }
        const [uncertainTransfer] = await tx.select({ id: companyTransferRuns.id }).from(companyTransferRuns).where(and(
          eq(companyTransferRuns.actorKey, input.actorKey), eq(companyTransferRuns.direction, "import"),
          inArray(companyTransferRuns.status, ["applying", "needs_reconciliation"]),
          ...(input.transferId ? [ne(companyTransferRuns.id, input.transferId)] : []),
        )).limit(1);
        if (uncertainTransfer) throw conflict("An earlier import has an unconfirmed outcome. Reconcile it before starting another import.",
          { code: "import_outcome_unknown", transferId: uncertainTransfer.id });
        const [active] = await tx.select().from(customerOperations).where(and(
          eq(customerOperations.requesterKeyHash, requesterKeyHash), eq(customerOperations.operationType, "company_import"),
          inArray(customerOperations.status, ["running", "needs_reconciliation"]),
        )).orderBy(desc(customerOperations.createdAt)).limit(1);
        if (active) throw conflict(active.status === "needs_reconciliation"
          ? "An earlier import has an unconfirmed outcome. Reconcile it before starting another import."
          : "A different import is already running for this account. Wait for it to finish before starting another.",
          { code: active.status === "needs_reconciliation" ? "import_outcome_unknown" : "import_already_running" });
        if (existing) {
          // Only the original owner's pre-domain failure can resume. The
          // request is unchanged and this admission has a current requester;
          // an old callback cannot settle the new fenced attempt.
          const [resumed] = await tx.update(customerOperations).set({ status: "running", progressStage: "admitted",
            attempt: sql`${customerOperations.attempt} + 1`, attemptId: randomUUID(), errorCode: null,
            startedAt: null, completedAt: null, resultRef: null, domainOperationRef: input.transferId ?? null,
            updatedAt: sql`clock_timestamp()`, progressAt: sql`clock_timestamp()` })
            .where(and(eq(customerOperations.id, existing.id), eq(customerOperations.attemptId, existing.attemptId)))
            .returning();
          return finish({ job: resumed!, replay: false });
        }
        const [job] = await tx.insert(customerOperations).values({
          id: `${input.actorKind === "cloud_tenant" ? "tenant-import" : "import"}-${randomUUID()}`,
          operationType: "company_import", domain: "company_portability", domainOperationRef: input.transferId ?? null,
          requesterKeyHash, requestedByUserId: input.userId, scopeKey: input.scopeKey,
          idempotencyKey: key, inputHash: input.inputHash, companyId: input.companyId,
        }).returning();
        return finish({ job: job!, replay: false });
      });
    },

    async get(id: string, actorKey: string) {
      return db.select().from(customerOperations).where(and(eq(customerOperations.id, id),
        eq(customerOperations.requesterKeyHash, hash(actorKey)), eq(customerOperations.operationType, "company_import")))
        .limit(1).then(rows => rows[0] ?? null);
    },

    async requestCancellation(id: string, actorKey: string, actor: AuthorizationActor) {
      return db.transaction(async tx => {
        const pinned = await pinImportCredential(tx, actor);
        const currentActor = pinned?.actor ?? actor;
        const [job] = await tx.select().from(customerOperations).where(and(
          eq(customerOperations.id, id), eq(customerOperations.requesterKeyHash, hash(actorKey)),
          eq(customerOperations.operationType, "company_import"),
        )).for("update");
        if (!job) return null;
        if (actor.type !== "board" || (actor.userId ?? null) !== job.requestedByUserId)
          throw forbidden("The original import requester is required");
        if (job.companyId) {
          const decision = await authorizationService(tx).decide({ actor: currentActor, action: "company_scope:read",
            resource: { type: "company", companyId: job.companyId }, enforceResponsibleUserIntersection: true });
          if (!decision.allowed) throw forbidden("Current company access is required");
        } else if (job.scopeKey === "new_company" && currentActor.source !== "local_implicit"
          && currentActor.source !== "cloud_tenant" && !(await hasCurrentInstanceAdminRole(tx, currentActor.userId))) {
          throw forbidden("Instance admin is required to cancel a new-company import");
        }
        if (job.status !== "running") return job;
        if (job.progressStage === "admitted") {
          const [cancelled] = await tx.update(customerOperations).set({ status: "cancelled", progressStage: "cancelled",
            cancelRequestedAt: sql`coalesce(${customerOperations.cancelRequestedAt}, clock_timestamp())`,
            completedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, progressAt: sql`clock_timestamp()` })
            .where(and(eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
              eq(customerOperations.status, "running"), eq(customerOperations.progressStage, "admitted")))
            .returning();
          await finishImportCredential(tx, pinned);
          return cancelled ?? job;
        }
        const [requested] = await tx.update(customerOperations).set({
          cancelRequestedAt: sql`coalesce(${customerOperations.cancelRequestedAt}, clock_timestamp())`,
          updatedAt: sql`clock_timestamp()`, progressAt: sql`clock_timestamp()`,
        }).where(and(eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
          eq(customerOperations.status, "running"))).returning();
        await finishImportCredential(tx, pinned);
        return requested ?? job;
      });
    },

    async cancellationRequested(job: CompanyImportJob) {
      const [current] = await db.select({ status: customerOperations.status,
        cancelRequestedAt: customerOperations.cancelRequestedAt }).from(customerOperations).where(and(
        eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
      )).limit(1);
      return !current || current.status !== "running" || current.cancelRequestedAt !== null;
    },

    /** Bounded discoverability for the original requester; never returns the
     * raw operation row outside this native owner. */
    async listForRequesterCompany(input: { actorKey: string; companyId: string; requestedByUserId: string | null;
      limit: number; before?: { createdAt: string; id: string } }, actor: AuthorizationActor) {
      if (actor.type !== "board" || (actor.userId ?? null) !== input.requestedByUserId)
        throw forbidden("The original import requester is required");
      const limit = Math.max(1, Math.min(50, Math.trunc(input.limit) || 20));
      return db.transaction(async tx => {
        const pinned = await pinImportCredential(tx, actor);
        const currentActor = pinned?.actor ?? actor;
        const decision = await authorizationService(tx).decide({ actor: currentActor, action: "company_scope:read",
          resource: { type: "company", companyId: input.companyId }, enforceResponsibleUserIntersection: true });
        if (!decision.allowed) throw forbidden("Current company access is required");
        const requester = input.requestedByUserId === null
          ? isNull(customerOperations.requestedByUserId) : eq(customerOperations.requestedByUserId, input.requestedByUserId);
        // New-company jobs are discoverable from an authorized company history
        // only while the original requester has no confirmed target yet. Their
        // original key, Human and explicit new_company scope must all match;
        // an unbound existing-company request is never adopted as this receipt.
        const unboundNewCompany = input.requestedByUserId === null ? undefined : and(
          isNull(customerOperations.companyId), isNull(customerOperations.resultRef),
          eq(customerOperations.scopeKey, "new_company"),
          eq(customerOperations.requestedByUserId, input.requestedByUserId),
          inArray(customerOperations.status, ["running", "needs_reconciliation"]),
        );
        const rows = await tx.select({ job: customerOperations,
          cursorCreatedAt: sql<string>`to_char(${customerOperations.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        }).from(customerOperations).where(and(
          eq(customerOperations.requesterKeyHash, hash(input.actorKey)), eq(customerOperations.operationType, "company_import"),
          or(and(eq(customerOperations.companyId, input.companyId), requester), unboundNewCompany),
          input.before ? or(sql`${customerOperations.createdAt} < ${input.before.createdAt}::timestamptz`, and(
            sql`${customerOperations.createdAt} = ${input.before.createdAt}::timestamptz`, lt(customerOperations.id, input.before.id))) : undefined,
        )).orderBy(desc(customerOperations.createdAt), desc(customerOperations.id)).limit(limit + 1);
        const current = await authorizationService(tx).decide({ actor: currentActor, action: "company_scope:read",
          resource: { type: "company", companyId: input.companyId }, enforceResponsibleUserIntersection: true });
        if (!current.allowed) throw forbidden("Current company access is required");
        await finishImportCredential(tx, pinned);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.at(-1);
        return { jobs: page.map(row => row.job), nextCursor: hasMore && last
          ? { createdAt: last.cursorCreatedAt, id: last.job.id } : null };
      });
    },

    async start(job: CompanyImportJob, actor?: AuthorizationActor) {
      return db.transaction(async tx => {
        if (actor && (actor.type !== "board" || (actor.userId ?? null) !== job.requestedByUserId)) throw forbidden("The original import requester changed");
        const pinned = await pinImportCredential(tx, actor);
        const currentActor = pinned?.actor ?? actor;
        if (currentActor && job.companyId) {
          const decision = await authorizationService(tx).decide({ actor: currentActor, action: "company_scope:read",
            resource: { type: "company", companyId: job.companyId }, enforceResponsibleUserIntersection: true });
          if (!decision.allowed) throw forbidden("The current import target is unavailable");
        }
        if (currentActor && job.scopeKey === "new_company" && currentActor.source !== "local_implicit"
          && currentActor.source !== "cloud_tenant" && !(await hasCurrentInstanceAdminRole(tx, currentActor.userId)))
          throw forbidden("Instance admin is required to start a new-company import");
        const rows = await tx.update(customerOperations).set({ progressStage: "importing", startedAt: sql`clock_timestamp()`,
          progressAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` }).where(and(
          eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
          eq(customerOperations.status, "running"), eq(customerOperations.progressStage, "admitted"),
          isNull(customerOperations.cancelRequestedAt),
        )).returning({ id: customerOperations.id });
        await finishImportCredential(tx, pinned);
        return rows.length === 1;
      });
    },

    async succeed(job: CompanyImportJob, result: CompanyPortabilityImportResult) {
      // This compact native result reference contains no source prose, warning
      // text, names, environment defaults, credentials or imported instructions.
      const [settled] = await db.update(customerOperations).set({ status: "succeeded", progressStage: "settled",
        companyId: result.company.id, resultRef: { companyId: result.company.id, agentCount: result.agents.length,
          warningCount: result.warnings.length, companyAction: result.company.action }, errorCode: null,
        completedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, progressAt: sql`clock_timestamp()`,
        expiresAt: sql`clock_timestamp() + interval '1 hour'`,
      }).where(and(eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
        inArray(customerOperations.status, ["running", "needs_reconciliation"]))).returning();
      return settled ?? null;
    },

    async fail(job: CompanyImportJob, unknownOutcome: boolean, knownError: "import_rejected" | "import_preview_source_changed" | "import_cancelled" = "import_rejected") {
      const cancelled = !unknownOutcome && knownError === "import_cancelled";
      const [settled] = await db.update(customerOperations).set({ status: unknownOutcome ? "needs_reconciliation" : cancelled ? "cancelled" : "failed",
        progressStage: unknownOutcome ? "needs_reconciliation" : cancelled ? "cancelled" : "rejected_before_import",
        errorCode: unknownOutcome ? "import_outcome_unknown" : cancelled ? null : knownError,
        completedAt: unknownOutcome ? null : sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, progressAt: sql`clock_timestamp()`,
      }).where(and(eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
        eq(customerOperations.status, "running"))).returning();
      return settled ?? null;
    },

    async recoverInterrupted() {
      // No retry is authorized by startup or elapsed time. A still-live native
      // owner can settle its exact attempt with a real result; no successor is
      // admitted and no old attempt ID is replaced.
      return db.update(customerOperations).set({ status: "needs_reconciliation", progressStage: "needs_reconciliation",
        errorCode: "import_outcome_unknown", updatedAt: sql`clock_timestamp()`, progressAt: sql`clock_timestamp()` })
        .where(and(eq(customerOperations.operationType, "company_import"), eq(customerOperations.status, "running")))
        .returning({ id: customerOperations.id });
    },
  };
}

export function companyImportOperationReceipt(job: CompanyImportJob): CustomerOperationReceipt {
  return { id: job.id, operationType: "company_import", domain: "company_portability", domainOperationRef: job.domainOperationRef,
    status: job.status === "needs_reconciliation" ? "inconclusive"
      : job.status === "cancelled" ? "cancelled"
        : job.cancelRequestedAt && job.status === "running" ? "cancel_requested"
      : job.status === "running" && job.progressStage === "admitted" ? "admitted" : job.status,
    progressStage: job.progressStage, attempt: job.attempt, unknownOutcome: job.status === "needs_reconciliation",
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null };
}
