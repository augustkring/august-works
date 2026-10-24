import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { customerOperations, companyTransferRuns, type Db } from "@paperclipai/db";
import type { CompanyPortabilityImportResult, CustomerOperationReceipt } from "@paperclipai/shared";
import { conflict } from "../errors.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type CompanyImportJob = typeof customerOperations.$inferSelect;

/** Durable status only. The original portability owner performs the import;
 * this service neither stores executable input nor retries business effects. */
export function companyImportJobService(db: Db) {
  return {
    async admit(input: { actorKey: string; userId: string | null; actorKind: "board" | "cloud_tenant";
      inputHash: string; scopeKey: string; companyId: string | null; idempotencyKey?: string;
      transferId?: string | null }) {
      const requesterKeyHash = hash(input.actorKey);
      const key = input.idempotencyKey ?? `input:${input.inputHash}`;
      if (!key || key.length > 256) throw conflict("Import request key is invalid");
      return db.transaction(async tx => {
        // Preserve the original one-active-import-per-requester boundary across
        // replicas. Unknown effects also block another admission.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`company-import:${requesterKeyHash}`},0))`);
        const [existing] = await tx.select().from(customerOperations).where(and(
          eq(customerOperations.requesterKeyHash, requesterKeyHash), eq(customerOperations.operationType, "company_import"),
          eq(customerOperations.scopeKey, input.scopeKey), eq(customerOperations.idempotencyKey, key),
        )).limit(1);
        if (existing) {
          if (existing.inputHash !== input.inputHash) throw conflict("Import request key already refers to different input", { code: "import_request_changed" });
          if (existing.status === "needs_reconciliation") throw conflict("The import outcome is unknown. Reconcile the existing import before trying again.",
            { code: "import_outcome_unknown", operationId: existing.id });
          return { job: existing, replay: true };
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
        const [job] = await tx.insert(customerOperations).values({
          id: `${input.actorKind === "cloud_tenant" ? "tenant-import" : "import"}-${randomUUID()}`,
          operationType: "company_import", domain: "company_portability", domainOperationRef: input.transferId ?? null,
          requesterKeyHash, requestedByUserId: input.userId, scopeKey: input.scopeKey,
          idempotencyKey: key, inputHash: input.inputHash, companyId: input.companyId,
        }).returning();
        return { job: job!, replay: false };
      });
    },

    async get(id: string, actorKey: string) {
      return db.select().from(customerOperations).where(and(eq(customerOperations.id, id),
        eq(customerOperations.requesterKeyHash, hash(actorKey)), eq(customerOperations.operationType, "company_import")))
        .limit(1).then(rows => rows[0] ?? null);
    },

    async start(job: CompanyImportJob) {
      const rows = await db.update(customerOperations).set({ progressStage: "importing", startedAt: sql`clock_timestamp()`,
        progressAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` }).where(and(
        eq(customerOperations.id, job.id), eq(customerOperations.attemptId, job.attemptId),
        eq(customerOperations.status, "running"), eq(customerOperations.progressStage, "admitted"),
      )).returning({ id: customerOperations.id });
      return rows.length === 1;
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

    async fail(job: CompanyImportJob, unknownOutcome: boolean) {
      const [settled] = await db.update(customerOperations).set({ status: unknownOutcome ? "needs_reconciliation" : "failed",
        progressStage: unknownOutcome ? "needs_reconciliation" : "rejected_before_import",
        errorCode: unknownOutcome ? "import_outcome_unknown" : "import_rejected",
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
    status: job.status === "needs_reconciliation" ? "inconclusive" : job.status,
    progressStage: job.progressStage, attempt: job.attempt, unknownOutcome: job.status === "needs_reconciliation",
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null };
}
