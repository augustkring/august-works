import { and, eq, inArray, sql } from "drizzle-orm";
import {
  runtimeCells,
  runtimeHosts,
  runtimePolicySnapshots,
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
      and (b.status='ready' or c.status in ('HEALTHY','DEGRADED','FAILED'))
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
        const live = ["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status);
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
