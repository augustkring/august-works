import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  activityLog,
  companyAgentPackageInstallations,
  agentPackageVersions,
  type Db,
} from "@paperclipai/db";
import {
  maintenanceHistorySchema,
  v9FeatureEnabled,
  v7FeatureEnabled,
} from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import {
  PACKAGE_MAINTENANCE_POLICY_VERSION,
  packageStewardReviewSchema,
} from "../stewards/maintenance-policy.js";

/** Historical native receipts are separate from current installation/activation state. */
export async function readMaintenanceHistory(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  installationId: string,
) {
  v5HumanActorId(actor);
  const current = {
    ...actor,
    isInstanceAdmin: false,
    ignoreInstanceAdmin: true,
  };
  const started = performance.now();
  function budget() {
    if (performance.now() - started > 5000)
      throw conflict("Maintenance state changed; reload", {
        code: "maintenance_history_stale",
      });
  }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='5s'`);
    await lockMemoryPrivacy(tx, companyId);
    async function access(agentId?: string) {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (
        !v9FeatureEnabled(flags, "maintenance_autopilot_v9") ||
        !v7FeatureEnabled(flags, "agent_packages_v7")
      )
        throw notFound("Maintenance history is unavailable");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      if (agentId)
        await assertV5Authorization(tx, current, companyId, "agent:read", {
          type: "agent",
          companyId,
          agentId,
        });
      budget();
    }
    await access();
    const [installation] = await tx
      .select()
      .from(companyAgentPackageInstallations)
      .where(
        and(
          eq(companyAgentPackageInstallations.companyId, companyId),
          eq(companyAgentPackageInstallations.id, installationId),
        ),
      )
      .for("share");
    if (!installation) throw notFound("Package installation not found");
    await access(installation.agentId);
    const rows = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "agent_package_installation"),
          eq(activityLog.entityId, installationId),
          eq(activityLog.actorType, "system"),
          eq(activityLog.actorId, "core-stewards"),
          inArray(activityLog.action, [
            "agent_package.low_risk_update_configured",
            "agent_package.maintenance_loop_blocked",
          ]),
          sql`${activityLog.details}->>'policyVersion' = ${PACKAGE_MAINTENANCE_POLICY_VERSION}`,
        ),
      )
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(11)
      .for("share");
    const entries = [];
    for (const row of rows.slice(0, 10)) {
      budget();
      const details = row.details;
      if (
        details?.maintenanceClass !== "M2" ||
        typeof details.policyOwnerUserId !== "string"
      )
        throw notFound("Native maintenance receipt source is unavailable");
      let outcome: "configured_activation_required" | "human_review_required";
      if (row.action === "agent_package.low_risk_update_configured") {
        if (
          details.postcondition !== "configured_activation_required" ||
          details.activationRequired !== true ||
          details.policy !== "auto_low_risk" ||
          typeof details.previousVersion !== "string" ||
          typeof details.nextVersion !== "string"
        )
          throw notFound("Native maintenance postcondition is unavailable");
        const review = packageStewardReviewSchema.safeParse(
          details.reviewedSource,
        );
        if (
          !review.success ||
          review.data.expectedInstalledVersionId !== details.previousVersion
        )
          throw notFound("Native maintenance reviewed source is unavailable");
        const versions = await tx
          .select({
            id: agentPackageVersions.id,
            contentHash: agentPackageVersions.contentHash,
          })
          .from(agentPackageVersions)
          .where(
            and(
              eq(agentPackageVersions.packageId, installation.packageId),
              inArray(agentPackageVersions.id, [
                details.previousVersion,
                details.nextVersion,
              ]),
            ),
          )
          .for("share");
        if (
          versions.length !== 2 ||
          versions.find((version) => version.id === details.nextVersion)
            ?.contentHash !== review.data.expectedReleaseContentHash
        )
          throw notFound("Native maintenance versions are unavailable");
        outcome = "configured_activation_required";
      } else {
        if (
          ![
            "configured_change_budget",
            "attempt_budget",
            "unknown_outcome",
          ].includes(String(details.reason)) ||
          details.humanReviewRequired !== true
        )
          throw notFound("Native maintenance review source is unavailable");
        outcome = "human_review_required";
      }
      entries.push({
        receiptId: row.id,
        recordedAt: row.createdAt.toISOString(),
        maintenanceClass: "M2" as const,
        outcome,
      });
    }
    await access(installation.agentId);
    return maintenanceHistorySchema.parse({
      companyId,
      installationId,
      agentId: installation.agentId,
      installationVersion: installation.version,
      installationStatus: installation.status,
      observedAt: new Date().toISOString(),
      entries,
      hasMore: rows.length > 10,
    });
  });
}
