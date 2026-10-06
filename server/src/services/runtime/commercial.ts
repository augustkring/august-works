import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentPresenceRuntimeBindings,
  heartbeatRuns,
  billingAccountCompanies,
  billingAccounts,
  companies,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeOperations,
  type Db,
} from "@paperclipai/db";
import type { EntitlementKey } from "@paperclipai/shared";
import { entitlementService } from "../billing/entitlements.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { sha256 } from "../saas/crypto.js";

const ACTIVE = [
  "REQUESTED",
  "RUNNING",
  "WAITING_FOR_CAPACITY",
  "NEEDS_RECONCILIATION",
];
export function runtimeQuotaKey(mode: string): EntitlementKey {
  return mode === "dedicated_vm"
    ? "hosted_runtime.dedicated_vm.max_cells"
    : mode === "dedicated_agent_gateway"
      ? "hosted_runtime.dedicated_gateway.max_cells"
      : "hosted_runtime.standard.max_cells";
}

/** Admission and reconciliation use the same deterministic allocation across a billing account. */
export async function runtimeCommercialReason(
  db: Pick<Db, "select" | "insert">,
  cell: typeof runtimeCells.$inferSelect,
  now: Date,
) {
  const state = await entitlementService(db as Db).resolve(cell.companyId, now);
  if (
    state.access === "read_only" ||
    state.entitlements["platform.access"] !== true
  )
    return "commercial_access_expired";
  const [profile] = await db
    .select({ product: runtimeCapacityProfiles.commercialProductKey })
    .from(runtimeCapacityProfiles)
    .where(eq(runtimeCapacityProfiles.key, cell.capacityProfile))
    .limit(1);
  if (!profile) return "commercial_runtime_limit";
  const products =
    cell.isolationMode === "company_cell"
      ? ["runtime_standard", "runtime_performance"]
      : cell.isolationMode === "dedicated_vm"
        ? ["runtime_dedicated_vm"]
        : ["runtime_dedicated_gateway"];
  if (!products.includes(profile.product)) return "commercial_runtime_limit";
  if (profile.product === "runtime_performance") {
    const performance = await db
      .select({ id: runtimeCells.id })
      .from(runtimeCells)
      .innerJoin(
        runtimeCapacityProfiles,
        eq(runtimeCapacityProfiles.key, runtimeCells.capacityProfile),
      )
      .where(
        and(
          eq(runtimeCells.billingAccountId, cell.billingAccountId),
          eq(
            runtimeCapacityProfiles.commercialProductKey,
            "runtime_performance",
          ),
          isNull(runtimeCells.deletedAt),
        ),
      )
      .orderBy(runtimeCells.createdAt, runtimeCells.id);
    if (
      BigInt(performance.findIndex((row) => row.id === cell.id)) >=
      BigInt(String(state.entitlements["hosted_runtime.performance.max_cells"]))
    )
      return "commercial_runtime_limit";
  }
  const inventory = await db
    .select({ id: runtimeCells.id })
    .from(runtimeCells)
    .where(
      and(
        eq(runtimeCells.billingAccountId, cell.billingAccountId),
        eq(runtimeCells.isolationMode, cell.isolationMode),
        isNull(runtimeCells.deletedAt),
      ),
    )
    .orderBy(runtimeCells.createdAt, runtimeCells.id);
  const position = inventory.findIndex((value) => value.id === cell.id);
  return position < 0 ||
    BigInt(position) >=
      BigInt(String(state.entitlements[runtimeQuotaKey(cell.isolationMode)]))
    ? "commercial_runtime_limit"
    : null;
}

export function runtimeCommercialService(
  db: Db,
  notify?: NotifyCompany,
  cancelInvocations?: (agentIds: string[], reason: string) => Promise<unknown>,
) {
  async function reconcile(now = new Date()) {
    const associations = await db
      .select({
        companyId: billingAccountCompanies.companyId,
        accountId: billingAccountCompanies.billingAccountId,
      })
      .from(billingAccountCompanies)
      .innerJoin(companies, eq(companies.id, billingAccountCompanies.companyId))
      .where(
        and(
          eq(billingAccountCompanies.status, "active"),
          eq(companies.status, "active"),
        ),
      );
    for (const association of associations) {
      const cancelledAgentIds = await db.transaction(async (tx) => {
        await tx
          .select({ id: billingAccounts.id })
          .from(billingAccounts)
          .where(eq(billingAccounts.id, association.accountId))
          .for("update");
        const state = await entitlementService(tx as unknown as Db).resolve(
          association.companyId,
          now,
        );
        let cancelledAgentIds: string[] = [];
        if (
          state.access === "read_only" ||
          state.entitlements["platform.access"] !== true
        ) {
          const inventory = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, association.companyId),
                inArray(agents.status, ["idle", "running", "error", "paused"]),
              ),
            )
            .orderBy(agents.id)
            .for("update");
          cancelledAgentIds = inventory.map((agent) => agent.id);
          const paused = await tx
            .update(agents)
            .set({
              status: "paused",
              pauseReason: "commercial_access_expired",
              pausedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(agents.companyId, association.companyId),
                inArray(agents.status, ["idle", "running", "error"]),
              ),
            )
            .returning({ id: agents.id });
          for (const agent of paused)
            await tx.insert(activityLog).values({
              companyId: association.companyId,
              actorType: "system",
              actorId: "commercial-reconciler",
              action: "agent.commercial_paused",
              entityType: "agent",
              entityId: agent.id,
              details: { reason: "commercial_access_expired" },
            });
        }
        const cells = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.companyId, association.companyId),
              isNull(runtimeCells.deletedAt),
            ),
          )
          .orderBy(runtimeCells.id)
          .for("update");
        for (const cell of cells) {
          const reason = await runtimeCommercialReason(tx, cell, now);
          if (!reason) continue; // Payment recovery never automatically starts a cell or unpauses a budget-stopped agent.
          // Free Core preserves BYO execution. Only the presence bound to this
          // actual managed cell/generation loses expensive runtime capacity.
          if (cell.providerBindingId) {
            const presences = await tx
              .select({ id: agentPresenceRuntimeBindings.agentId })
              .from(agentPresenceRuntimeBindings)
              .where(
                and(
                  eq(agentPresenceRuntimeBindings.companyId, cell.companyId),
                  eq(
                    agentPresenceRuntimeBindings.providerBindingId,
                    cell.providerBindingId,
                  ),
                  eq(
                    agentPresenceRuntimeBindings.providerProfileRef,
                    `aw:cell:${cell.id}:generation:${cell.generation}`,
                  ),
                ),
              );
            const ids = presences.map((presence) => presence.id);
            cancelledAgentIds.push(...ids);
            if (ids.length) {
              // Fence authority before waiting for remote cancellation. A
              // transient controller failure cannot keep old sessions writable.
              await tx
                .update(heartbeatRuns)
                .set({
                  resultJson: sql`coalesce(${heartbeatRuns.resultJson},'{}'::jsonb)||jsonb_build_object('executionCancellation',jsonb_build_object('state','requested','reason','commercial_runtime_capacity_expired','runtimeCellId',${cell.id}::text,'generation',${cell.generation.toString()}::text,'requestedAt',now()))`,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(heartbeatRuns.companyId, cell.companyId),
                    inArray(heartbeatRuns.agentId, ids),
                    inArray(heartbeatRuns.status, ["running", "queued"]),
                    sql`coalesce(${heartbeatRuns.resultJson}->'executionCancellation'->>'state','')<>'requested'`,
                  ),
                );
              const paused = await tx
                .update(agents)
                .set({
                  status: "paused",
                  pauseReason: "commercial_runtime_capacity_expired",
                  pausedAt: now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(agents.companyId, cell.companyId),
                    inArray(agents.id, ids),
                    inArray(agents.status, ["idle", "running", "error"]),
                  ),
                )
                .returning({ id: agents.id });
              for (const agent of paused)
                await tx
                  .insert(activityLog)
                  .values({
                    companyId: cell.companyId,
                    actorType: "system",
                    actorId: "commercial-reconciler",
                    action: "agent.commercial_runtime_paused",
                    entityType: "agent",
                    entityId: agent.id,
                    details: {
                      runtimeCellId: cell.id,
                      generation: cell.generation.toString(),
                      reason,
                    },
                  });
            }
          }
          if (cell.suspendedReason !== reason) {
            await tx
              .update(runtimeCells)
              .set({ suspendedReason: reason, updatedAt: now })
              .where(eq(runtimeCells.id, cell.id));
            await tx.insert(activityLog).values({
              companyId: cell.companyId,
              actorType: "system",
              actorId: "commercial-reconciler",
              action: "runtime.commercial_suspended",
              entityType: "runtime_cell",
              entityId: cell.id,
              details: { reason, generation: cell.generation.toString() },
            });
            if (notify)
              await notify(
                cell.companyId,
                "billing",
                "A managed runtime needs a billing review",
                "company/settings/billing",
                cell.id + ":" + cell.generation + ":" + reason,
                tx,
              );
          }
          const [busy] = await tx
            .select()
            .from(runtimeOperations)
            .where(
              and(
                eq(runtimeOperations.runtimeCellId, cell.id),
                inArray(runtimeOperations.status, ACTIVE),
              ),
            )
            .limit(1);
          // A claimed command may already have changed state. Its receipt or confirmed provider fencing resolves it.
          if (
            busy ||
            !cell.runtimeHostId ||
            !["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status)
          )
            continue;
          const idempotencyKey = "commercial-stop:" + randomUUID();
          const input = { cellId: cell.id, action: "stop", idempotencyKey };
          await tx.insert(runtimeOperations).values({
            companyId: cell.companyId,
            runtimeCellId: cell.id,
            operationType: "stop",
            requestedByType: "system",
            requestedById: "commercial-reconciler",
            idempotencyKey,
            requestHash: sha256(JSON.stringify(input)),
            deadlineAt: new Date(now.getTime() + 900000),
          });
        }
        return [...new Set(cancelledAgentIds)];
      });
      // Remote cancellation follows commit. A failure is retried from paused agents on the next occurrence.
      if (cancelledAgentIds.length && cancelInvocations)
        await cancelInvocations(
          cancelledAgentIds,
          "Cancelled because commercial execution capacity expired",
        );
    }
    return associations.length;
  }
  return { reconcile };
}
