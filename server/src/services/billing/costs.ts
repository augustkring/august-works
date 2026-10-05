import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  billingAccounts,
  billingSubscriptions,
  platformAdminAudit,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeHosts,
  type Db,
} from "@paperclipai/db";
import {
  saasCostReportSchema,
  type SaasCostSnapshot,
} from "@paperclipai/shared";
import { conflict, forbidden } from "../../errors.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { sha256 } from "../saas/crypto.js";

/** Current CPU reservation allocation, explicitly an estimate rather than an invoice ledger. */
export function allocateHostCost(
  monthly: bigint,
  totalCpu: number,
  cells: { accountId: string; cpuMillis: number }[],
) {
  if (
    !Number.isSafeInteger(totalCpu) ||
    totalCpu <= 0 ||
    cells.some(
      (cell) => !Number.isSafeInteger(cell.cpuMillis) || cell.cpuMillis <= 0,
    ) ||
    monthly < 0n
  )
    throw Error("Invalid cost allocation inputs");
  const reserved = cells.reduce((sum, cell) => sum + cell.cpuMillis, 0);
  if (!Number.isSafeInteger(reserved) || reserved > totalCpu)
    throw conflict(
      "Host reservations exceed measured CPU; reconcile capacity before cost allocation",
    );
  const accounts = new Map<string, bigint>();
  let allocated = 0n;
  for (const cell of cells) {
    const amount = (monthly * BigInt(cell.cpuMillis)) / BigInt(totalCpu);
    accounts.set(cell.accountId, (accounts.get(cell.accountId) ?? 0n) + amount);
    allocated += amount;
  }
  return { accounts, allocated, unallocated: monthly - allocated, reserved };
}
export function saasCostService(db: Db, config: SaasPlatformConfig) {
  async function latest() {
    const [row] = await db
      .select({ data: platformAdminAudit.safeDetails })
      .from(platformAdminAudit)
      .where(
        and(
          eq(platformAdminAudit.action, "billing.cost_snapshot_recorded"),
          eq(platformAdminAudit.resourceId, config.environment),
        ),
      )
      .orderBy(desc(platformAdminAudit.createdAt))
      .limit(1);
    return (
      (row?.data?.snapshot as unknown as SaasCostSnapshot | undefined) ?? null
    );
  }
  async function record(operator: string, raw: unknown, now = new Date()) {
    if (!config.operatorUserIds.includes(operator)) throw forbidden();
    const input = saasCostReportSchema.parse(raw),
      url = new URL(input.reportUri);
    if (
      url.origin !== new URL(config.objects.endpoint).origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.includes("/cost-reports/")
    )
      throw conflict("Protected provider cost report required");
    if (input.month !== now.toISOString().slice(0, 7))
      throw conflict("A current-month cost report is required");
    if (
      input.hostPlan !== config.runtime.hostPlan ||
      BigInt(input.newHostMonthlyMinor) <= 0n ||
      input.hosts.some(
        (host) => BigInt(host.monthlyMinor) > BigInt(input.newHostMonthlyMinor),
      )
    )
      throw conflict(
        "The new-host cost envelope must cover this configured host plan and every existing host",
      );
    const payloadHash = sha256(JSON.stringify(input));
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"aw-cost-report:" + input.idempotencyKey},0))`,
      );
      const [receipt] = await tx
        .select()
        .from(platformAdminAudit)
        .where(
          and(
            eq(platformAdminAudit.action, "billing.cost_report_received"),
            eq(platformAdminAudit.resourceId, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (receipt) {
        if (receipt.safeDetails?.payloadHash !== payloadHash)
          throw conflict("Cost report retry differs from its original input");
        return receipt.safeDetails!.snapshot as unknown as SaasCostSnapshot;
      }
      const hosts = input.hosts.length
        ? await tx
            .select()
            .from(runtimeHosts)
            .where(
              and(
                inArray(
                  runtimeHosts.id,
                  input.hosts.map((host) => host.hostId),
                ),
                eq(runtimeHosts.environment, config.environment),
                isNull(runtimeHosts.retiredAt),
              ),
            )
            .for("share")
        : [];
      if (hosts.length !== input.hosts.length)
        throw conflict("Every reported host must belong to this environment");
      const allLive = await tx
        .select({ id: runtimeHosts.id })
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.environment, config.environment),
            isNull(runtimeHosts.retiredAt),
            sql`${runtimeHosts.providerResourceId} is not null`,
          ),
        );
      if (
        allLive.some(
          (host) => !input.hosts.some((rate) => rate.hostId === host.id),
        )
      )
        throw conflict("Include every live provider host in the cost report");
      const cells = hosts.length
        ? await tx
            .select({
              accountId: runtimeCells.billingAccountId,
              hostId: runtimeCells.runtimeHostId,
              cpuMillis: runtimeCapacityProfiles.cpuMillis,
            })
            .from(runtimeCells)
            .innerJoin(
              runtimeCapacityProfiles,
              eq(runtimeCapacityProfiles.key, runtimeCells.capacityProfile),
            )
            .where(
              and(
                inArray(
                  runtimeCells.runtimeHostId,
                  hosts.map((host) => host.id),
                ),
                isNull(runtimeCells.deletedAt),
              ),
            )
            .limit(1001)
        : [];
      if (cells.length > 1000)
        throw conflict("Cost allocation exceeds the qualified snapshot bound");
      const revenues = new Map(
        input.accountRevenue.map((row) => [
          row.accountId,
          BigInt(row.monthlyMinor),
        ]),
      );
      const activeAccounts = await tx
        .select({ id: billingSubscriptions.billingAccountId })
        .from(billingSubscriptions)
        .where(
          and(
            eq(billingSubscriptions.status, "active"),
            gt(billingSubscriptions.currentPeriodEnd, now),
          ),
        )
        .limit(1001);
      if (
        activeAccounts.length > 1000 ||
        activeAccounts.some((account) => !revenues.has(account.id))
      )
        throw conflict(
          "Include recurring revenue for every current active billing account",
        );
      for (const accountId of revenues.keys()) {
        const [account] = await tx
          .select({ id: billingAccounts.id })
          .from(billingAccounts)
          .where(
            and(
              eq(billingAccounts.id, accountId),
              eq(billingAccounts.status, "active"),
            ),
          )
          .limit(1);
        const [subscription] = await tx
          .select({ id: billingSubscriptions.id })
          .from(billingSubscriptions)
          .where(
            and(
              eq(billingSubscriptions.billingAccountId, accountId),
              eq(billingSubscriptions.status, "active"),
              gt(billingSubscriptions.currentPeriodEnd, now),
            ),
          )
          .limit(1);
        if (!account || !subscription)
          throw conflict(
            "Reported recurring revenue requires a current active local subscription",
          );
      }
      const accountCosts = new Map<string, bigint>();
      let hostCost = 0n,
        unallocated = 0n;
      const hostRows = input.hosts.map((rate) => {
        const host = hosts.find((host) => host.id === rate.hostId)!,
          monthly = BigInt(rate.monthlyMinor);
        const allocation = allocateHostCost(
          monthly,
          host.cpuTotalMillis,
          cells.filter((cell) => cell.hostId === host.id),
        );
        hostCost += monthly;
        unallocated += allocation.unallocated;
        for (const [id, value] of allocation.accounts)
          accountCosts.set(id, (accountCosts.get(id) ?? 0n) + value);
        return {
          hostId: host.id,
          monthlyMinor: rate.monthlyMinor,
          allocatedMinor: allocation.allocated.toString(),
          reservedCpuMillis: allocation.reserved,
          totalCpuMillis: host.cpuTotalMillis,
        };
      });
      const cogs = hostCost + BigInt(input.platformMonthlyMinor),
        mrr = [...revenues.values()].reduce((sum, value) => sum + value, 0n);
      const snapshot: SaasCostSnapshot = {
        observedAt: now.toISOString(),
        month: input.month,
        currency: "EUR",
        basis: input.basis,
        platformMonthlyMinor: input.platformMonthlyMinor,
        newHostMonthlyMinor: input.newHostMonthlyMinor,
        hostPlan: input.hostPlan,
        reportSha256: input.reportSha256,
        estimatedMonthlyCogsMinor: cogs.toString(),
        reportedMrrMinor: mrr.toString(),
        reportedArrMinor: (mrr * 12n).toString(),
        estimatedGrossMarginMinor: (mrr - cogs).toString(),
        unallocatedHostCostMinor: unallocated.toString(),
        hosts: hostRows,
        accounts: [
          ...new Set([...accountCosts.keys(), ...revenues.keys()]),
        ].map((id) => ({
          accountId: id,
          estimatedRuntimeMonthlyMinor: (accountCosts.get(id) ?? 0n).toString(),
          reportedMrrMinor: (revenues.get(id) ?? 0n).toString(),
        })),
      };
      await tx.insert(platformAdminAudit).values([
        {
          operatorUserId: operator,
          action: "billing.cost_report_received",
          resourceId: input.idempotencyKey,
          safeDetails: { payloadHash, snapshot },
        },
        {
          operatorUserId: operator,
          action: "billing.cost_snapshot_recorded",
          resourceId: config.environment,
          safeDetails: { snapshot },
        },
      ]);
      return snapshot;
    });
  }
  return { latest, record };
}
