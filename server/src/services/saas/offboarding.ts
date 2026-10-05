import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  activityLog,
  agentApiKeys,
  agentIdentities,
  agents,
  companies,
  companyDeletionOperations,
  companyMemberships,
  runtimeBackups,
  runtimeCells,
  runtimeHosts,
  runtimeOperations,
  supportSessions,
  type Db,
} from "@paperclipai/db";
import { companyDeletionRequestSchema } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { purgeCompanyContent } from "./company-purge.js";
import type { companyObjectErasure } from "./object-erasure.js";
import { companyService } from "../companies.js";
import type { billingService } from "../billing/billing.js";
import type { runtimeControlService } from "../runtime/control.js";
export function saasOffboardingService(
  db: Db,
  billing: ReturnType<typeof billingService>,
  runtime: ReturnType<typeof runtimeControlService>,
  objects: ReturnType<typeof companyObjectErasure>,
  retireHost?: (hostId: string) => Promise<unknown>,
) {
  async function request(
    companyId: string,
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = companyDeletionRequestSchema.parse(raw);
    return db.transaction(async (tx) => {
      const [company] = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .for("update");
      if (!company) throw notFound();
      const [owner] = await tx
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.membershipRole, "owner"),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1);
      if (!owner) throw forbidden("Company owner required");
      if (input.confirmation !== company.name)
        throw conflict("Company name confirmation does not match");
      const [existing] = await tx
        .select()
        .from(companyDeletionOperations)
        .where(eq(companyDeletionOperations.companyId, companyId))
        .limit(1);
      if (existing) {
        if (existing.idempotencyKey !== input.idempotencyKey)
          throw conflict("Company offboarding is already requested");
        return existing;
      }
      await tx
        .select({ id: agentIdentities.id })
        .from(agentIdentities)
        .where(eq(agentIdentities.homeCompanyId, companyId))
        .orderBy(agentIdentities.id)
        .for("update");
      const shared = await tx.execute<{ id: string }>(
        sql`select i.id from agent_identities i join agents a on a.agent_identity_id=i.id where i.home_company_id=${companyId}::uuid and i.status <> 'archived' and a.company_id <> ${companyId}::uuid and a.status <> 'terminated' limit 1`,
      );
      if (shared.length)
        throw conflict(
          "Rehome shared agents before deleting their home organization",
          { code: "IDENTITY_REHOME_REQUIRED" },
        );
      await tx
        .update(companies)
        .set({
          status: "archived",
          pauseReason: "company_deletion",
          updatedAt: now,
        })
        .where(eq(companies.id, companyId));
      const [operation] = await tx
        .insert(companyDeletionOperations)
        .values({
          companyId,
          requestedByUserId: userId,
          idempotencyKey: input.idempotencyKey,
          evidence: {
            exportAcknowledgedAt: now.toISOString(),
            storageTargets: objects.targets(companyId),
          },
        })
        .returning();
      await tx
        .update(agents)
        .set({
          status: "paused",
          pauseReason: "company_deletion",
          pausedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agents.companyId, companyId),
            sql`${agents.status} not in ('terminated','pending_approval')`,
          ),
        );
      await tx
        .update(agentApiKeys)
        .set({ revokedAt: now })
        .where(
          and(
            eq(agentApiKeys.companyId, companyId),
            isNull(agentApiKeys.revokedAt),
          ),
        );
      await tx
        .update(supportSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(supportSessions.companyId, companyId),
            isNull(supportSessions.revokedAt),
          ),
        );
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "company.deletion_requested",
          entityType: "company_deletion",
          entityId: operation!.id,
        });
      return operation!;
    });
  }
  async function get(companyId: string) {
    const [row] = await db
      .select()
      .from(companyDeletionOperations)
      .where(eq(companyDeletionOperations.companyId, companyId))
      .limit(1);
    return row ?? null;
  }
  async function processOne(now = new Date()) {
    const [operation] = await db
      .select()
      .from(companyDeletionOperations)
      .where(
        and(
          inArray(companyDeletionOperations.status, [
            "requested",
            "processing",
            "waiting_retention",
          ]),
          lt(companyDeletionOperations.notBefore, now),
        ),
      )
      .orderBy(companyDeletionOperations.createdAt)
      .limit(1);
    if (!operation) return false;
    try {
      if (operation.stage === "revoke") {
        await companyService(db).archive(operation.companyId, {
          actorType: "user",
          actorId: operation.requestedByUserId,
        });
        await db
          .update(companyDeletionOperations)
          .set({ status: "processing", stage: "runtimes", errorCode: null })
          .where(eq(companyDeletionOperations.id, operation.id));
        return true;
      }
      if (operation.stage === "runtimes") {
        await runtime.cancelUnplacedForDeletion(
          operation.companyId,
          operation.requestedByUserId,
          now,
        );
        const cells = await runtime.list(operation.companyId);
        for (const cell of cells.filter((value) => !value.deletedAt)) {
          const [active] = await db
            .select({ id: runtimeCells.id })
            .from(runtimeCells)
            .where(eq(runtimeCells.id, cell.id));
          if (!active) continue;
          if (cell.runtimeHostId) {
            const [host] = await db
              .select({ fencedAt: runtimeHosts.fencedAt })
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
              .limit(1);
            if (host?.fencedAt && retireHost) {
              try {
                await retireHost(cell.runtimeHostId);
              } catch (error) {
                if (
                  !(
                    error &&
                    typeof error === "object" &&
                    "status" in error &&
                    error.status === 409
                  )
                )
                  throw error;
              }
              continue;
            }
          }
          const deletions = await db
            .select()
            .from(runtimeOperations)
            .where(
              and(
                eq(runtimeOperations.runtimeCellId, cell.id),
                eq(runtimeOperations.operationType, "delete"),
              ),
            )
            .orderBy(
              desc(runtimeOperations.createdAt),
              desc(runtimeOperations.id),
            );
          const failed = deletions.filter((value) => value.status === "FAILED");
          if (failed.length >= 3)
            throw conflict(
              "Runtime erasure attempts require operator reconciliation",
            );
          const key =
            "offboard:" +
            operation.id +
            ":" +
            cell.id +
            (failed.length ? ":" + failed[0]!.id : "");
          try {
            await runtime.request(
              operation.companyId,
              cell.id,
              operation.requestedByUserId,
              { action: "delete", idempotencyKey: key },
              now,
            );
          } catch (error) {
            if (
              !(
                error &&
                typeof error === "object" &&
                "status" in error &&
                error.status === 409
              )
            )
              throw error;
          }
        }
        if (cells.some((cell) => !cell.deletedAt)) {
          await db
            .update(companyDeletionOperations)
            .set({
              notBefore: new Date(now.getTime() + 10000),
              errorCode: "runtime_erasure_pending",
            })
            .where(eq(companyDeletionOperations.id, operation.id));
          return true;
        }
        await db
          .update(companyDeletionOperations)
          .set({
            stage: "billing",
            errorCode: null,
            evidence: {
              ...operation.evidence,
              runtimesErasedAt: now.toISOString(),
            },
          })
          .where(eq(companyDeletionOperations.id, operation.id));
        return true;
      }
      if (operation.stage === "billing") {
        const evidence = await billing.offboardCompany(operation.companyId);
        await db
          .update(companyDeletionOperations)
          .set({
            stage: "retention",
            errorCode: null,
            evidence: {
              ...operation.evidence,
              billing: evidence,
              billingReconciledAt: now.toISOString(),
            },
          })
          .where(eq(companyDeletionOperations.id, operation.id));
        return true;
      }
      if (operation.stage === "retention") {
        const backups = await db
          .select({
            id: runtimeBackups.id,
            retainUntil: runtimeBackups.retainUntil,
          })
          .from(runtimeBackups)
          .where(
            and(
              eq(runtimeBackups.companyId, operation.companyId),
              isNull(runtimeBackups.deletedAt),
            ),
          );
        const future = backups.filter((backup) => backup.retainUntil > now);
        if (future.length) {
          await db
            .update(companyDeletionOperations)
            .set({
              status: "waiting_retention",
              notBefore: new Date(
                Math.min(...future.map((v) => v.retainUntil.getTime())),
              ),
              errorCode: "backup_retention_pending",
            })
            .where(eq(companyDeletionOperations.id, operation.id));
          return true;
        }
        await db
          .update(companyDeletionOperations)
          .set({
            stage: "purge",
            status: "processing",
            notBefore: now,
            errorCode: null,
          })
          .where(eq(companyDeletionOperations.id, operation.id));
        return true;
      }
      if (operation.stage === "purge") {
        const objectEvidence = await objects.erase(
          operation.companyId,
          now,
          operation.evidence.storageTargets,
        );
        const databaseEvidence = await purgeCompanyContent(
          db,
          operation.companyId,
        );
        await db
          .update(companyDeletionOperations)
          .set({
            status: "completed",
            stage: "completed",
            completedAt: now,
            errorCode: null,
            evidence: {
              ...operation.evidence,
              objects: objectEvidence,
              database: databaseEvidence,
              completedAt: now.toISOString(),
            },
          })
          .where(eq(companyDeletionOperations.id, operation.id));
        return true;
      }
      throw conflict("Unknown offboarding stage");
    } catch {
      await db
        .update(companyDeletionOperations)
        .set({
          notBefore: new Date(now.getTime() + 60000),
          errorCode: "offboarding_reconciliation_pending",
        })
        .where(eq(companyDeletionOperations.id, operation.id));
      return true;
    }
  }
  return { request, get, processOne };
}
