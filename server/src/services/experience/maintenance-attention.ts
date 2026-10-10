import {
  readMaintenanceAttemptCounts,
  hasUnconfirmedMaintenanceAttempt,
} from "../stewards/maintenance-attempts.js";
import type { ExperienceReader } from "./projection.js";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agentPackages,
  agentPackageVersions,
  companyAgentPackageInstallations,
  type Db,
} from "@paperclipai/db";
import {
  v7FeatureEnabled,
  v9FeatureEnabled,
  type ExperienceCard,
} from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, notFound } from "../../errors.js";
import {
  authorizationService,
  type AuthorizationActor,
} from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import {
  PACKAGE_MAINTENANCE_POLICY_VERSION,
  packageStewardReviewSchema,
  packageStewardReviewIsCurrent,
  packageMaintenanceRecurrenceAllows,
} from "../stewards/maintenance-policy.js";
import {
  packageChangeIsMaterial,
  packageReleaseBlockers,
} from "../agent-packages/package-policy.js";

/** Escalation is a current native budget/source finding, not a historical alert. */
export async function readPackageMaintenanceAttention(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  signal: AbortSignal,
): Promise<{
  needsYou: ExperienceCard[];
  coverage?: Awaited<ReturnType<ExperienceReader["read"]>>["coverage"];
}> {
  v5HumanActorId(actor);
  const current = {
      ...actor,
      ignoreInstanceAdmin: true,
      isInstanceAdmin: false,
    },
    started = performance.now();
  function budget() {
    signal.throwIfAborted();
    if (performance.now() - started > 1500)
      throw conflict("Maintenance source review expired", {
        code: "maintenance_attention_stale",
      });
  }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='1500ms'`);
    await lockMemoryPrivacy(tx, companyId);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (
        !v9FeatureEnabled(flags, "maintenance_autopilot_v9") ||
        !v7FeatureEnabled(flags, "agent_packages_v7")
      )
        throw notFound("Maintenance attention is unavailable");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      budget();
    }
    await access();
    const rows = await tx
      .select({
        event: activityLog,
        installation: companyAgentPackageInstallations,
      })
      .from(activityLog)
      .innerJoin(
        companyAgentPackageInstallations,
        and(
          eq(companyAgentPackageInstallations.companyId, companyId),
          sql`${companyAgentPackageInstallations.id}::text = ${activityLog.entityId}`,
        ),
      )
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.actorType, "system"),
          eq(activityLog.actorId, "core-stewards"),
          eq(activityLog.entityType, "agent_package_installation"),
          eq(activityLog.action, "agent_package.maintenance_loop_blocked"),
          eq(companyAgentPackageInstallations.status, "active"),
          eq(companyAgentPackageInstallations.updatePolicy, "auto_low_risk"),
          sql`${activityLog.createdAt} > now()-interval '24 hours'`,
          sql`${activityLog.details}->>'policyVersion' = ${PACKAGE_MAINTENANCE_POLICY_VERSION}`,
        ),
      )
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(6)
      .for("share");
    const cards: ExperienceCard[] = [],
      auth = authorizationService(tx);
    let missingSource = false;
    for (const { event, installation } of rows.slice(0, 5)) {
      budget();
      const resource = {
        type: "agent" as const,
        companyId,
        agentId: installation.agentId,
      };
      if (
        !(await auth.decide({ actor: current, action: "agent:read", resource }))
          .allowed ||
        !(
          await auth.decide({
            actor: current,
            action: "agents:configure",
            resource,
          })
        ).allowed
      )
        continue;
      const details = event.details,
        review = packageStewardReviewSchema.safeParse(details?.reviewedSource);
      if (
        !review.success ||
        details?.maintenanceClass !== "M2" ||
        ![
          "configured_change_budget",
          "attempt_budget",
          "unknown_outcome",
        ].includes(String(details.reason)) ||
        details.humanReviewRequired !== true ||
        typeof details.candidateVersion !== "string"
      ) {
        missingSource = true;
        continue;
      }
      if (
        review.data.expectedInstallationVersion !== installation.version ||
        review.data.expectedInstalledVersionId !==
          installation.installedVersionId ||
        review.data.expectedUpdatedAt !== installation.updatedAt.toISOString()
      )
        continue;
      const counts = await readMaintenanceAttemptCounts(
        tx,
        companyId,
        installation.id,
      );
      if (details.reason === "unknown_outcome") {
        if (
          !(await hasUnconfirmedMaintenanceAttempt(
            tx,
            companyId,
            installation.id,
            review.data,
          ))
        )
          continue;
      } else if (
        packageMaintenanceRecurrenceAllows(counts.resource, counts.company)
      )
        continue;
      const [before] = await tx
        .select()
        .from(agentPackageVersions)
        .where(
          and(
            eq(agentPackageVersions.packageId, installation.packageId),
            eq(agentPackageVersions.id, installation.installedVersionId),
          ),
        )
        .for("share");
      const [candidate] = await tx
        .select({ version: agentPackageVersions, package: agentPackages })
        .from(agentPackageVersions)
        .innerJoin(
          agentPackages,
          eq(agentPackages.id, agentPackageVersions.packageId),
        )
        .where(
          and(
            eq(agentPackageVersions.packageId, installation.packageId),
            eq(agentPackageVersions.id, details.candidateVersion),
          ),
        )
        .for("share");
      if (!before || !candidate) {
        missingSource = true;
        continue;
      }
      if (
        !packageStewardReviewIsCurrent(
          review.data,
          installation,
          candidate.version.contentHash,
        ) ||
        candidate.package.status !== "active" ||
        candidate.version.state !== "published" ||
        packageReleaseBlockers(candidate.version.release).length ||
        packageChangeIsMaterial(before.release, candidate.version.release)
      )
        continue;
      const previous = before.version.split(".").map(Number),
        next = candidate.version.version.split(".").map(Number),
        difference = next.findIndex((part, index) => part !== previous[index]);
      if (difference < 0 || next[difference]! <= previous[difference]!)
        continue;
      await assertV5Authorization(
        tx,
        current,
        companyId,
        "agent:read",
        resource,
      );
      await assertV5Authorization(
        tx,
        current,
        companyId,
        "agents:configure",
        resource,
      );
      budget();
      const source = {
        domain: "agent_package_installation" as const,
        companyId,
        resourceId: installation.id,
        version: String(installation.version),
        observedAt: new Date().toISOString(),
      };
      cards.push({
        id: `maintenance:${event.id}`,
        kind: "maintenance",
        title: "Review automatic package maintenance",
        whyYou: "You can review this installation's current configuration.",
        consequence:
          "Automatic maintenance needs a native outcome or attempt-budget review through the existing package owner.",
        source,
        freshness: "fresh",
        evidence: [String(details.reason)],
        actions: [
          {
            id: "open",
            label: "Review",
            labelKey: "review",
            operation: "open",
            href: `/agents/packages/installations/${installation.id}/maintenance`,
            criticality: "C2",
            source,
            requiresCurrentAuthorization: true,
          },
        ],
      });
    }
    await access();
    return {
      needsYou: cards,
      ...(missingSource || rows.length > 5
        ? {
            coverage: {
              state: "partial" as const,
              reason: missingSource
                ? ("source_stale" as const)
                : ("more_items_available" as const),
            },
          }
        : {}),
    };
  });
}
