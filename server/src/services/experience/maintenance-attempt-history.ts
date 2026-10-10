import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, agentPackageVersions, type Db } from "@paperclipai/db";
import { maintenanceAttemptHistorySchema } from "@paperclipai/shared";
import { notFound } from "../../errors.js";
import {
  PACKAGE_MAINTENANCE_LIMITS,
  PACKAGE_MAINTENANCE_POLICY_VERSION,
  packageStewardReviewSchema,
} from "../stewards/maintenance-policy.js";

const startDetails = z.strictObject({
  policyVersion: z.literal(PACKAGE_MAINTENANCE_POLICY_VERSION),
  maintenanceClass: z.literal("M2"),
  attemptId: z.uuid(),
  policyOwnerUserId: z.string().min(1).max(300),
  reviewedSource: packageStewardReviewSchema,
  candidateVersion: z.uuid(),
});
const finishDetails = startDetails.omit({ policyOwnerUserId: true }).extend({
  outcome: z.enum(["configured_activation_required", "no_effect"]),
});

/** Read only inside the existing authorized history transaction, with the native
 * installation held. Activity records do not authorize another attempt or prove
 * activation, successful work or an independent business result. */
export async function readMaintenanceAttemptHistory(
  tx: Db,
  companyId: string,
  installation: {
    id: string;
    packageId: string;
    version: number;
    installedVersionId: string;
    updatedAt: Date;
  },
  budget: () => void,
) {
  const scope = and(
    eq(activityLog.companyId, companyId),
    eq(activityLog.entityType, "agent_package_installation"),
    eq(activityLog.entityId, installation.id),
    eq(activityLog.actorType, "system"),
    eq(activityLog.actorId, "core-stewards"),
  );
  const starts = await tx
    .select({
      id: activityLog.id,
      createdAt: activityLog.createdAt,
      details: activityLog.details,
    })
    .from(activityLog)
    .where(
      and(
        scope,
        eq(activityLog.action, "agent_package.maintenance_attempt_started"),
      ),
    )
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(11)
    .for("share");
  const entries = [];
  const unavailable = () =>
    notFound("Native maintenance attempt source is unavailable");
  for (const start of starts.slice(0, 10)) {
    budget();
    const parsed = startDetails.safeParse(start.details);
    if (!parsed.success) throw unavailable();
    const original = parsed.data;
    const versionIds = [
      ...new Set([
        original.candidateVersion,
        original.reviewedSource.expectedInstalledVersionId,
      ]),
    ];
    const versions = await tx
      .select({
        id: agentPackageVersions.id,
        hash: agentPackageVersions.contentHash,
      })
      .from(agentPackageVersions)
      .where(
        and(
          eq(agentPackageVersions.packageId, installation.packageId),
          inArray(agentPackageVersions.id, versionIds),
        ),
      )
      .for("share");
    if (
      versions.length !== versionIds.length ||
      versions.find((row) => row.id === original.candidateVersion)?.hash !==
        original.reviewedSource.expectedReleaseContentHash
    )
      throw unavailable();
    const [finishes, configured] = await Promise.all([
      tx
        .select({
          createdAt: activityLog.createdAt,
          details: activityLog.details,
        })
        .from(activityLog)
        .where(
          and(
            scope,
            eq(
              activityLog.action,
              "agent_package.maintenance_attempt_finished",
            ),
            sql`${activityLog.details}->>'attemptId'=${original.attemptId}`,
          ),
        )
        .limit(2)
        .for("share"),
      tx
        .select({
          createdAt: activityLog.createdAt,
          details: activityLog.details,
        })
        .from(activityLog)
        .where(
          and(
            scope,
            eq(activityLog.action, "agent_package.low_risk_update_configured"),
            sql`${activityLog.details}->>'attemptId'=${original.attemptId}`,
          ),
        )
        .limit(2)
        .for("share"),
    ]);
    if (
      finishes.length > 1 ||
      configured.length > 1 ||
      (!finishes.length && configured.length)
    )
      throw unavailable();
    let outcome: "awaiting_receipt" | "no_effect" | "configuration_recorded" =
      "awaiting_receipt";
    if (finishes[0]) {
      const terminal = finishDetails.safeParse(finishes[0].details);
      if (
        !terminal.success ||
        terminal.data.candidateVersion !== original.candidateVersion ||
        JSON.stringify(terminal.data.reviewedSource) !==
          JSON.stringify(original.reviewedSource)
      )
        throw unavailable();
      if (terminal.data.outcome === "no_effect") {
        if (configured.length) throw unavailable();
        outcome = "no_effect";
      } else {
        const receipt = configured[0]?.details;
        const review = packageStewardReviewSchema.safeParse(
          receipt?.reviewedSource,
        );
        if (
          !receipt ||
          receipt.policyVersion !== PACKAGE_MAINTENANCE_POLICY_VERSION ||
          receipt.maintenanceClass !== "M2" ||
          receipt.policy !== "auto_low_risk" ||
          receipt.postcondition !== "configured_activation_required" ||
          receipt.activationRequired !== true ||
          receipt.nextVersion !== original.candidateVersion ||
          receipt.previousVersion !==
            original.reviewedSource.expectedInstalledVersionId ||
          !review.success ||
          JSON.stringify(review.data) !==
            JSON.stringify(original.reviewedSource)
        )
          throw unavailable();
        outcome = "configuration_recorded";
      }
    }
    entries.push({
      attemptId: original.attemptId,
      startedAt: start.createdAt.toISOString(),
      leaseExpiresAt: new Date(
        start.createdAt.getTime() +
          PACKAGE_MAINTENANCE_LIMITS.maximumTransactionSeconds * 1000,
      ).toISOString(),
      finishedAt: finishes[0]?.createdAt.toISOString() ?? null,
      outcome,
      sourceMatchesCurrent:
        original.reviewedSource.expectedInstallationVersion ===
          installation.version &&
        original.reviewedSource.expectedInstalledVersionId ===
          installation.installedVersionId &&
        original.reviewedSource.expectedUpdatedAt ===
          installation.updatedAt.toISOString(),
    });
  }
  const [clock] = await tx.execute<{ observed_at: Date }>(
    sql`select clock_timestamp() as observed_at`,
  );
  if (!clock) throw unavailable();
  const observedAt = new Date(clock.observed_at).toISOString();
  budget();
  return maintenanceAttemptHistorySchema.parse({
    observedAt,
    hasMore: starts.length > 10,
    entries: entries.map((entry) => ({
      ...entry,
      outcome:
        entry.outcome === "awaiting_receipt" &&
        Date.parse(entry.leaseExpiresAt) <= Date.parse(observedAt)
          ? "unconfirmed"
          : entry.outcome,
    })),
  });
}
