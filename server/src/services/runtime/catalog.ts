import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  agentPresenceRuntimeBindings,
  heartbeatRuns,
  platformAdminAudit,
  runtimeBackups,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeOperations,
  runtimeVersionCatalog,
  type Db,
} from "@paperclipai/db";
import {
  runtimeCapacityQualificationSchema,
  runtimeVersionCandidateSchema,
  runtimeVersionTransitionSchema,
} from "@paperclipai/shared";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";

export function hostVersionMeetsMinimum(
  actual: string | null,
  minimum: string,
) {
  if (
    (actual?.length ?? 0) > 64 ||
    minimum.length > 64 ||
    !/^\d+\.\d+\.\d+$/.test(actual ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(minimum)
  )
    return false;
  const left = actual!.split(".").map(BigInt),
    right = minimum.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i]! > right[i]!) return true;
    if (left[i]! < right[i]!) return false;
  }
  return true;
}
export function runtimeCatalogService(db: Db, config: SaasPlatformConfig) {
  function operator(id: string) {
    if (!config.operatorUserIds.includes(id))
      throw forbidden("Internal operator access required");
  }
  function evidence(
    value: {
      reportUri: string;
      qualifiedAt: string;
      qualificationSourceSha: string;
    },
    now: Date,
  ) {
    const url = new URL(value.reportUri),
      endpoint = new URL(config.objects.endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.origin !== endpoint.origin ||
      !url.pathname.includes("/qualification/") ||
      value.qualificationSourceSha !== config.deployment.sourceSha ||
      new Date(value.qualifiedAt) > now ||
      now.getTime() - new Date(value.qualifiedAt).getTime() > 30 * 86400000
    )
      throw unprocessable(
        "Current protected qualification evidence for this build is required",
      );
  }
  async function candidate(userId: string, raw: unknown, now = new Date()) {
    operator(userId);
    const input = runtimeVersionCandidateSchema.parse(raw);
    evidence(input.conformance, now);
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.imageDigest},0))`,
      );
      const [existing] = await tx
        .select()
        .from(runtimeVersionCatalog)
        .where(eq(runtimeVersionCatalog.imageDigest, input.imageDigest))
        .limit(1);
      if (existing) {
        if (
          existing.providerVersion !== input.providerVersion ||
          existing.stateFormat !== input.stateFormat ||
          existing.hostAgentMinimumVersion !== input.hostAgentMinimumVersion
        )
          throw conflict(
            "Immutable runtime version has a different provider or state contract",
          );
        if (
          existing.conformance.reportSha256 ===
            input.conformance.reportSha256 &&
          existing.conformance.qualificationSourceSha ===
            input.conformance.qualificationSourceSha
        )
          return existing;
        if (!["candidate", "halted"].includes(existing.status))
          throw conflict(
            "Halt admission before recording new qualification evidence",
          );
        const [updated] = await tx
          .update(runtimeVersionCatalog)
          .set({ conformance: input.conformance })
          .where(eq(runtimeVersionCatalog.imageDigest, input.imageDigest))
          .returning();
        await tx
          .insert(platformAdminAudit)
          .values({
            operatorUserId: userId,
            action: "runtime.version_requalified",
            resourceId: input.imageDigest,
            safeDetails: {
              previousReportSha256: existing.conformance.reportSha256,
              reportSha256: input.conformance.reportSha256,
              sourceSha: input.conformance.qualificationSourceSha,
            },
          });
        return updated!;
      }
      const [version] = await tx
        .insert(runtimeVersionCatalog)
        .values(input)
        .returning();
      await tx
        .insert(platformAdminAudit)
        .values({
          operatorUserId: userId,
          action: "runtime.version_candidate_registered",
          resourceId: input.imageDigest,
          safeDetails: {
            reportSha256: input.conformance.reportSha256,
            sourceSha: input.conformance.qualificationSourceSha,
          },
        });
      return version!;
    });
  }
  async function qualifyCapacity(
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    operator(userId);
    const input = runtimeCapacityQualificationSchema.parse(raw);
    evidence(input.benchmarkEvidence, now);
    const benchmark = input.benchmarkEvidence;
    if (
      benchmark.hostPlan !== config.runtime.hostPlan ||
      benchmark.hostCpuMillis < input.cpuMillis ||
      BigInt(benchmark.hostMemoryBytes) <
        BigInt(input.memoryBytes) + 1073741824n ||
      BigInt(benchmark.hostDiskBytes) < BigInt(input.diskBytes) + 2147483648n
    )
      throw unprocessable(
        "Capacity does not fit the qualified host and operating reserve",
      );
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"aw-profile:" + input.key},0))`,
      );
      const [existing] = await tx
        .select()
        .from(runtimeCapacityProfiles)
        .where(eq(runtimeCapacityProfiles.key, input.key))
        .limit(1);
      if (existing) {
        if (
          existing.cpuMillis !== input.cpuMillis ||
          existing.memoryBytes !== BigInt(input.memoryBytes) ||
          existing.diskBytes !== BigInt(input.diskBytes) ||
          existing.pidsLimit !== input.pidsLimit ||
          existing.commercialProductKey !== input.commercialProductKey ||
          existing.benchmarkEvidence?.reportSha256 !== benchmark.reportSha256
        )
          throw conflict(
            "Use a new capacity key for a changed resource contract or benchmark",
          );
        if (existing.qualified) return existing;
      }
      const values = {
        ...input,
        memoryBytes: BigInt(input.memoryBytes),
        diskBytes: BigInt(input.diskBytes),
        qualified: true,
      };
      const [profile] = await tx
        .insert(runtimeCapacityProfiles)
        .values(values)
        .onConflictDoUpdate({
          target: runtimeCapacityProfiles.key,
          set: { qualified: true, benchmarkEvidence: benchmark },
        })
        .returning();
      await tx
        .insert(platformAdminAudit)
        .values({
          operatorUserId: userId,
          action: "runtime.capacity_qualified",
          resourceId: input.key,
          safeDetails: {
            reportSha256: benchmark.reportSha256,
            commercialProductKey: input.commercialProductKey,
          },
        });
      return profile!;
    });
  }
  async function transition(userId: string, raw: unknown, now = new Date()) {
    operator(userId);
    const input = runtimeVersionTransitionSchema.parse(raw);
    return db.transaction(async (tx) => {
      const [version] = await tx
        .select()
        .from(runtimeVersionCatalog)
        .where(eq(runtimeVersionCatalog.imageDigest, input.imageDigest))
        .for("update");
      if (!version) throw notFound();
      if (version.status !== input.expectedStatus)
        throw conflict("Runtime version changed; reload its status");
      const allowed: Record<string, string[]> = {
        candidate: ["canary", "halted"],
        canary: ["approved", "halted"],
        approved: ["halted", "retired"],
        halted: ["canary", "retired"],
        retired: [],
      };
      if (!allowed[version.status]?.includes(input.status))
        throw conflict("Runtime version transition is unavailable");
      if (["canary", "approved"].includes(input.status)) {
        const { canaryStartedAt: _canaryStartedAt, ...payload } =
          version.conformance;
        const conformance =
          runtimeVersionCandidateSchema.shape.conformance.parse(payload);
        evidence(conformance, now);
      }
      if (input.status === "approved") {
        if (
          typeof version.conformance.canaryStartedAt !== "string" ||
          !Number.isFinite(Date.parse(version.conformance.canaryStartedAt)) ||
          now.getTime() - Date.parse(version.conformance.canaryStartedAt) <
            3600000
        )
          throw conflict("Canary observation requires at least one hour");
        const cells = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.activeImageDigest, version.imageDigest),
              eq(runtimeCells.status, "HEALTHY"),
              isNull(runtimeCells.deletedAt),
              gt(runtimeCells.lastHealthyAt, new Date(now.getTime() - 90000)),
            ),
          );
        let accepted = false;
        for (const cell of cells) {
          if (!cell.providerBindingId) continue;
          const [canary] = await tx
            .select({ id: runtimeOperations.id })
            .from(runtimeOperations)
            .where(
              and(
                eq(runtimeOperations.runtimeCellId, cell.id),
                eq(runtimeOperations.operationType, "provision"),
                eq(runtimeOperations.status, "SUCCEEDED"),
                gt(
                  runtimeOperations.completedAt,
                  new Date(version.conformance.canaryStartedAt),
                ),
                inArray(
                  sql`${runtimeOperations.desiredState}->>'canaryOperatorId'`,
                  config.operatorUserIds,
                ),
                sql`${runtimeOperations.desiredState}->>'imageDigest' = ${version.imageDigest}`,
              ),
            )
            .limit(1);
          const [restore] = await tx
            .select({
              id: runtimeOperations.id,
              completedAt: runtimeOperations.completedAt,
            })
            .from(runtimeOperations)
            .innerJoin(
              runtimeBackups,
              sql`${runtimeOperations.desiredState}->>'backupId' = ${runtimeBackups.id}::text`,
            )
            .where(
              and(
                eq(runtimeOperations.runtimeCellId, cell.id),
                eq(runtimeOperations.operationType, "restore"),
                eq(runtimeOperations.status, "SUCCEEDED"),
                gt(
                  runtimeOperations.completedAt,
                  new Date(version.conformance.canaryStartedAt),
                ),
                eq(runtimeBackups.runtimeCellId, cell.id),
                eq(runtimeBackups.imageDigest, version.imageDigest),
                eq(runtimeBackups.generation, cell.generation - 1n),
                eq(runtimeBackups.status, "VERIFIED"),
                isNotNull(runtimeBackups.verifiedAt),
                isNotNull(runtimeBackups.ciphertextSha256),
                gt(runtimeBackups.byteSize, 31n),
                isNull(runtimeBackups.deletedAt),
                sql`${runtimeOperations.desiredState}->>'sourceGeneration' = ${(cell.generation - 1n).toString()}`,
              ),
            )
            .orderBy(sql`${runtimeOperations.completedAt} desc`)
            .limit(1);
          const [binding] = await tx
            .select({ agentId: agentPresenceRuntimeBindings.agentId })
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
                  "aw:cell:" +
                    cell.id +
                    ":generation:" +
                    cell.generation.toString(),
                ),
                eq(agentPresenceRuntimeBindings.status, "active"),
                isNotNull(
                  agentPresenceRuntimeBindings.qualifiedConfigurationHash,
                ),
                isNotNull(agentPresenceRuntimeBindings.conformanceSnapshotHash),
              ),
            )
            .limit(1);
          const [run] =
            binding && restore?.completedAt
              ? await tx
                  .select({ id: heartbeatRuns.id })
                  .from(heartbeatRuns)
                  .where(
                    and(
                      eq(heartbeatRuns.companyId, cell.companyId),
                      eq(heartbeatRuns.agentId, binding.agentId),
                      eq(heartbeatRuns.status, "succeeded"),
                      gt(heartbeatRuns.startedAt, restore.completedAt),
                      gt(heartbeatRuns.finishedAt, restore.completedAt),
                    ),
                  )
                  .limit(1)
              : [];
          if (canary && restore && run) {
            accepted = true;
            break;
          }
        }
        if (!accepted)
          throw conflict(
            "Successful canary execution, provider qualification, verified backup and restore are required",
          );
      }
      if (input.status === "retired") {
        const [cell] = await tx
          .select({ id: runtimeCells.id })
          .from(runtimeCells)
          .where(
            and(
              isNull(runtimeCells.deletedAt),
              or(
                eq(runtimeCells.activeImageDigest, version.imageDigest),
                eq(runtimeCells.desiredImageDigest, version.imageDigest),
              ),
            ),
          )
          .limit(1);
        if (cell)
          throw conflict(
            "Drain or upgrade every runtime before retiring this image",
          );
      }
      const [updated] = await tx
        .update(runtimeVersionCatalog)
        .set({
          status: input.status,
          conformance: {
            ...version.conformance,
            ...(input.status === "canary"
              ? { canaryStartedAt: now.toISOString() }
              : {}),
          },
          ...(input.status === "approved"
            ? { approvedAt: now, approvedByUserId: userId }
            : {}),
        })
        .where(eq(runtimeVersionCatalog.imageDigest, input.imageDigest))
        .returning();
      await tx
        .insert(platformAdminAudit)
        .values({
          operatorUserId: userId,
          action: "runtime.version_" + input.status,
          resourceId: version.imageDigest,
          safeDetails: { from: version.status, reason: input.reason },
        });
      return updated!;
    });
  }
  return { candidate, qualifyCapacity, transition };
}
