import { and, eq, inArray, sql } from "drizzle-orm";
import {
  runtimeCells,
  runtimeHosts,
  runtimePolicySnapshots,
  runtimeHostCommands,
  runtimeSandboxBindings,
  type Db,
} from "@paperclipai/db";
import {
  SANDBOX_CONTROLS,
  sandboxCapabilitySnapshotSchema,
  v7FeatureEnabled,
} from "@paperclipai/shared";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { logger } from "../../middleware/logger.js";

type StopRequest = {
  companyId: string;
  cellId: string;
  generation: string;
  bindingId: string;
  idempotencyKey: string;
};

/** Fence one exact admission generation after an ambiguous workload outcome.
 * This internal safety owner deliberately does not depend on the initiating
 * operator remaining authorized; callers must still use the native Stop lane
 * and treat an unconfirmed Stop as unknown. */
export async function fenceSandboxAdmissionOutcome(
  db: Db,
  input: {
    companyId: string;
    bindingId: string;
    cellId: string;
    generation: string;
    policySnapshotId: string;
    claimKey: string;
    operationKeys: string[];
    stopConfirmed: boolean;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return withV7ActivityTransaction(db, async (tx, publications) => {
    // Preserve the runtime owner’s cell-before-binding lock order. The binding
    // predicate also pins the original generation if the cell has advanced.
    await tx
      .select({ id: runtimeCells.id })
      .from(runtimeCells)
      .where(
        and(
          eq(runtimeCells.companyId, input.companyId),
          eq(runtimeCells.id, input.cellId),
        ),
      )
      .for("update");
    const [binding] = await tx
      .select()
      .from(runtimeSandboxBindings)
      .where(
        and(
          eq(runtimeSandboxBindings.companyId, input.companyId),
          eq(runtimeSandboxBindings.id, input.bindingId),
          eq(runtimeSandboxBindings.runtimeCellId, input.cellId),
          eq(runtimeSandboxBindings.cellGeneration, input.generation),
        ),
      )
      .for("update");
    if (!binding || binding.status === "deleted") return false;
    if (binding.status !== "quarantined") {
      await tx
        .update(runtimeSandboxBindings)
        .set({ status: "quarantined", version: binding.version + 1, updatedAt: now })
        .where(
          and(
            eq(runtimeSandboxBindings.companyId, input.companyId),
            eq(runtimeSandboxBindings.id, input.bindingId),
            eq(runtimeSandboxBindings.cellGeneration, input.generation),
          ),
        );
    }
    await tx
      .update(runtimePolicySnapshots)
      .set({ status: "revoked" })
      .where(
        and(
          eq(runtimePolicySnapshots.companyId, input.companyId),
          eq(runtimePolicySnapshots.bindingId, input.bindingId),
          inArray(runtimePolicySnapshots.status, ["draft", "qualified"]),
        ),
      );
    await logActivity(
      tx,
      {
        companyId: input.companyId,
        actorType: "system",
        actorId: "sandbox-guardian",
        action: "sandbox.admission_safety_fenced",
        entityType: "runtime_sandbox",
        entityId: input.bindingId,
        details: {
          generation: input.generation,
          policySnapshotId: input.policySnapshotId,
          claimKey: input.claimKey,
          operationKeys: input.operationKeys,
          stopConfirmed: input.stopConfirmed,
        },
      },
      publications,
    );
    return true;
  });
}

/** Release a durable reservation only on a path that has proved no apply/start
 * command was attempted. The exact claim and generation prevent clearing a
 * successor reservation. */
export async function releaseSandboxAdmissionClaim(
  db: Db,
  input: {
    companyId: string;
    bindingId: string;
    cellId: string;
    generation: string;
    policySnapshotId: string;
    claimKey: string;
    applyKey: string;
    startKey: string;
    reason: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return withV7ActivityTransaction(db, async (tx, publications) => {
    await tx
      .select({ id: runtimeCells.id })
      .from(runtimeCells)
      .where(and(eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, input.cellId)))
      .for("update");
    const [binding] = await tx
      .select()
      .from(runtimeSandboxBindings)
      .where(
        and(
          eq(runtimeSandboxBindings.companyId, input.companyId),
          eq(runtimeSandboxBindings.id, input.bindingId),
          eq(runtimeSandboxBindings.runtimeCellId, input.cellId),
          eq(runtimeSandboxBindings.cellGeneration, input.generation),
          eq(runtimeSandboxBindings.status, "admitting"),
        ),
      )
      .for("update");
    if (!binding) return false;
    const [claim] = await tx
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, input.companyId),
          eq(activityLog.entityType, "runtime_sandbox"),
          eq(activityLog.entityId, input.bindingId),
          eq(activityLog.action, "sandbox.admission_claimed"),
          sql`${activityLog.details}->>'claimKey' = ${input.claimKey}`,
          sql`${activityLog.details}->>'generation' = ${input.generation}`,
          sql`${activityLog.details}->>'policySnapshotId' = ${input.policySnapshotId}`,
        ),
      )
      .limit(1);
    if (!claim) return false;
    const [applyCommand] = await tx
      .select({ status: runtimeHostCommands.status, safeResult: runtimeHostCommands.safeResult })
      .from(runtimeHostCommands)
      .where(
        and(
          eq(runtimeHostCommands.companyId, input.companyId),
          eq(runtimeHostCommands.runtimeCellId, input.cellId),
          eq(runtimeHostCommands.cellGeneration, BigInt(input.generation)),
          sql`${runtimeHostCommands.payload}->>'action' = 'apply'`,
          sql`${runtimeHostCommands.payload}->'admission'->>'idempotencyKey' = ${input.applyKey}`,
        ),
      )
      .limit(1);
    const [startCommand] = await tx
      .select({ id: runtimeHostCommands.id })
      .from(runtimeHostCommands)
      .where(
        and(
          eq(runtimeHostCommands.companyId, input.companyId),
          eq(runtimeHostCommands.runtimeCellId, input.cellId),
          eq(runtimeHostCommands.cellGeneration, BigInt(input.generation)),
          sql`${runtimeHostCommands.payload}->>'action' = 'start'`,
          sql`${runtimeHostCommands.payload}->'start'->>'idempotencyKey' = ${input.startKey}`,
        ),
      )
      .limit(1);
    const knownNoEffectApply = applyCommand?.status === "SUCCEEDED" &&
      (applyCommand.safeResult as { action?: string; applied?: boolean; requiresRecreate?: boolean } | null)?.action === "apply" &&
      !(applyCommand.safeResult as { applied?: boolean; requiresRecreate?: boolean }).applied;
    if (startCommand || (applyCommand && !knownNoEffectApply)) return false;
    await tx
      .update(runtimeSandboxBindings)
      .set({ status: "ready", version: binding.version + 1, updatedAt: now })
      .where(
        and(
          eq(runtimeSandboxBindings.companyId, input.companyId),
          eq(runtimeSandboxBindings.id, input.bindingId),
          eq(runtimeSandboxBindings.cellGeneration, input.generation),
          eq(runtimeSandboxBindings.version, binding.version),
          eq(runtimeSandboxBindings.status, "admitting"),
        ),
      );
    await logActivity(
      tx,
      {
        companyId: input.companyId,
        actorType: "system",
        actorId: "sandbox-guardian",
        action: "sandbox.admission_claim_released",
        entityType: "runtime_sandbox",
        entityId: input.bindingId,
        details: {
          claimKey: input.claimKey,
          generation: input.generation,
          policySnapshotId: input.policySnapshotId,
          reason: input.reason,
        },
      },
      publications,
    );
    return true;
  });
}

/** Safety reconciliation is independent of rollout and the original user's
 * continued membership. Only the existing runtime Stop engine can perform a
 * physical effect; quarantine or an accepted request never proves termination.
 */
export async function reconcileSandboxSafety(
  db: Db,
  options: {
    requestStop?: (
      input: StopRequest,
    ) => Promise<{ id: string; status?: string }>;
    hostMaxAgeSeconds?: number;
  } = {},
  limit = 20,
  now = new Date(),
) {
  const candidates =
    await db.execute(sql`select b.id,b.company_id,b.runtime_cell_id
    from runtime_sandbox_bindings b join runtime_cells c on c.company_id=b.company_id and c.id=b.runtime_cell_id
    where b.status not in ('deleted','stopped') and c.deleted_at is null
      and (b.status in ('ready','running') or (b.status='admitting' and b.updated_at <= ${new Date(now.getTime() - 60000).toISOString()}::timestamptz) or c.status in ('HEALTHY','DEGRADED','FAILED'))
    order by b.updated_at,b.id limit ${Math.max(1, Math.min(100, Math.trunc(limit) || 20))}`);
  let quarantined = 0,
    stopRequested = 0,
    stopPending = 0;
  for (const candidate of candidates) {
    const outcome = await withV7ActivityTransaction(
      db,
      async (tx, publications) => {
        // Runtime mutations lock the cell before their binding invalidation trigger.
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.companyId, String(candidate.company_id)),
              eq(runtimeCells.id, String(candidate.runtime_cell_id)),
            ),
          )
          .for("update", { skipLocked: true });
        if (!cell || cell.deletedAt) return null;
        const [binding] = await tx
          .select()
          .from(runtimeSandboxBindings)
          .where(
            and(
              eq(runtimeSandboxBindings.companyId, cell.companyId),
              eq(runtimeSandboxBindings.id, String(candidate.id)),
            ),
          )
          .for("update", { skipLocked: true });
        if (!binding || ["deleted", "stopped"].includes(binding.status))
          return null;
        const flags = await instanceSettingsService(tx).getExperimental();
        const parsed = sandboxCapabilitySnapshotSchema.safeParse(
          binding.capabilitySnapshot,
        );
        const caps = parsed.success ? parsed.data : null;
        const [host] = cell.runtimeHostId
          ? await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
          : [];
        const reasons: string[] = [];
        const staleAdmission = binding.status === "admitting" && binding.updatedAt.getTime() <= now.getTime() - 60000;
        let staleClaimKey: string | null = null;
        if (staleAdmission) {
          reasons.push("admission_claim_stale");
          const [claim] = await tx.select({ details: activityLog.details }).from(activityLog).where(and(
            eq(activityLog.companyId, cell.companyId),
            eq(activityLog.entityType, "runtime_sandbox"),
            eq(activityLog.entityId, binding.id),
            eq(activityLog.action, "sandbox.admission_claimed"),
          )).orderBy(sql`${activityLog.createdAt} desc, ${activityLog.id} desc`).limit(1);
          const details = claim?.details as Record<string, unknown> | undefined;
          staleClaimKey = typeof details?.claimKey === "string" ? details.claimKey : null;
        }
        if (
          !v7FeatureEnabled(flags, "sandbox_abstraction_v7") ||
          (binding.backend === "openshell" &&
            !v7FeatureEnabled(flags, "openshell_v7"))
        )
          reasons.push("rollout_disabled");
        if (binding.cellGeneration !== cell.generation.toString())
          reasons.push("generation_changed");
        if (
          !caps ||
          caps.evidenceKind !== "protected_host_report" ||
          caps.backend !== binding.backend ||
          binding.capabilitySnapshotHash !== nativeSha256(caps)
        )
          reasons.push("protected_qualification_missing");
        if (
          caps &&
          (caps.filesystemEnforcementMode !== "hard_requirement" ||
            SANDBOX_CONTROLS.some((control) => !caps[control]))
        )
          reasons.push("required_controls_unavailable");
        if (
          caps &&
          (new Date(caps.expiresAt) <= now ||
            new Date(caps.testedAt) > now ||
            caps.sandboxImageDigest !==
              (cell.activeImageDigest ?? cell.desiredImageDigest))
        )
          reasons.push("qualification_changed_or_expired");
        if (
          !host ||
          host.credentialRevokedAt ||
          host.fencedAt ||
          host.retiredAt ||
          !["READY", "DRAINING"].includes(host.status) ||
          !host.lastHeartbeatAt ||
          host.lastHeartbeatAt.getTime() <=
            now.getTime() - (options.hostMaxAgeSeconds ?? 90) * 1000
        )
          reasons.push("host_authority_unavailable");
        const live = binding.status === "running" || ["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status);
        // Native V7-bound admission remains closed until applied-policy execution
        // is integrated. A live bound cell currently represents a lifecycle bypass.
        if (live) reasons.push("applied_boundary_admission_unavailable");
        if (!reasons.length) return null;
        const changed = binding.status !== "quarantined";
        if (changed) {
          await tx
            .update(runtimeSandboxBindings)
            .set({
              status: "quarantined",
              version: binding.version + 1,
              updatedAt: now,
            })
            .where(eq(runtimeSandboxBindings.id, binding.id));
          await logActivity(
            tx,
            {
              companyId: cell.companyId,
              actorType: "system",
              actorId: "sandbox-guardian",
              action: "sandbox.authority_quarantined",
              entityType: "runtime_sandbox",
              entityId: binding.id,
              details: {
                generation: binding.cellGeneration,
                reasonCodes: reasons,
              },
            },
            publications,
          );
          if (staleAdmission) {
            await logActivity(
              tx,
              {
                companyId: cell.companyId,
                actorType: "system",
                actorId: "sandbox-guardian",
                action: "sandbox.admission_safety_fenced",
                entityType: "runtime_sandbox",
                entityId: binding.id,
                details: {
                  generation: binding.cellGeneration,
                  claimKey: staleClaimKey,
                  stopConfirmed: false,
                  reason: "stale_admission_outcome_unknown",
                },
              },
              publications,
            );
          }
        } else
          await tx
            .update(runtimeSandboxBindings)
            .set({ updatedAt: now })
            .where(eq(runtimeSandboxBindings.id, binding.id));
        await tx
          .update(runtimePolicySnapshots)
          .set({ status: "revoked" })
          .where(
            and(
              eq(runtimePolicySnapshots.companyId, cell.companyId),
              eq(runtimePolicySnapshots.bindingId, binding.id),
              inArray(runtimePolicySnapshots.status, ["draft", "qualified"]),
            ),
          );
        return {
          changed,
          stop:
            live && binding.cellGeneration === cell.generation.toString()
              ? {
                  companyId: cell.companyId,
                  cellId: cell.id,
                  generation: binding.cellGeneration,
                  bindingId: binding.id,
                  idempotencyKey: `v7-sandbox-guardian:${binding.id}:${binding.cellGeneration}`,
                }
              : null,
        };
      },
    );
    if (!outcome) continue;
    quarantined += Number(outcome.changed);
    if (outcome.stop) {
      if (!options.requestStop) {
        stopPending++;
        continue;
      }
      try {
        const receipt = await options.requestStop(outcome.stop);
        if (receipt.status && ["FAILED", "CANCELED"].includes(receipt.status))
          throw new Error("native_stop_terminal_failure");
        stopRequested++;
      } catch {
        stopPending++;
        logger.warn(
          {
            companyId: outcome.stop.companyId,
            bindingId: outcome.stop.bindingId,
          },
          "Sandbox remains quarantined; native Stop requires reconciliation",
        );
      }
    }
  }
  return {
    checked: candidates.length,
    quarantined,
    stopRequested,
    stopPending,
  };
}
