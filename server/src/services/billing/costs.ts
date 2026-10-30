import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  billingAccountCompanies,
  billingAccounts,
  billingSubscriptions,
  companies,
  costEvents,
  platformAdminAudit,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeHosts,
  usageAggregates,
  type Db,
} from "@paperclipai/db";
import {
  saasCostReportSchema,
  type SaasCostSnapshot,
} from "@paperclipai/shared";
import { conflict } from "../../errors.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertConfiguredOperatorAuthentication } from "../../auth/authenticator-assurance.js";
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
  async function projectUnitEconomics(snapshot: SaasCostSnapshot, reader: Pick<Db, "select">, now = new Date()): Promise<SaasCostSnapshot> {
    const [year, month] = snapshot.month.split("-").map(Number);
    const windowStart = new Date(Date.UTC(year!, month! - 1, 1));
    const windowEnd = new Date(Date.UTC(year!, month!, 1));
    const [companyRows, providerRows, usageRows] = await Promise.all([
      reader.select({ companyId: billingAccountCompanies.companyId, billingAccountId: billingAccountCompanies.billingAccountId })
        .from(billingAccountCompanies)
        .innerJoin(companies, eq(companies.id, billingAccountCompanies.companyId))
        .where(and(eq(billingAccountCompanies.status, "active"), eq(companies.status, "active")))
        .orderBy(billingAccountCompanies.companyId).limit(1001),
      reader.select({
        companyId: costEvents.companyId,
        reportedCents: sql<string>`coalesce(sum(${costEvents.costCents}) filter (where ${costEvents.costStatus} = 'reported'), 0)::text`,
        estimatedCents: sql<string>`coalesce(sum(${costEvents.costCents}) filter (where ${costEvents.costStatus} = 'estimated'), 0)::text`,
        reportedEventCount: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'reported')::int`,
        estimatedEventCount: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'estimated')::int`,
        unpricedEventCount: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'unpriced')::int`,
        unrecognizedEventCount: sql<number>`count(*) filter (where ${costEvents.costStatus} not in ('reported','estimated','unpriced'))::int`,
      }).from(costEvents).innerJoin(companies, eq(companies.id, costEvents.companyId))
        .where(and(eq(companies.status, "active"), gte(costEvents.occurredAt, windowStart), lt(costEvents.occurredAt, windowEnd))).groupBy(costEvents.companyId)
        .orderBy(costEvents.companyId).limit(1001),
      reader.select({
        companyId: usageAggregates.companyId,
        billingAccountId: usageAggregates.billingAccountId,
        meterKey: usageAggregates.meterKey,
        unit: usageAggregates.unit,
        quantity: sql<string>`sum(${usageAggregates.quantity})::text`,
        bucketCount: sql<number>`count(*)::int`,
        sourceWatermark: sql<Date | string | null>`max(${usageAggregates.sourceWatermark})`,
      }).from(usageAggregates).innerJoin(companies, eq(companies.id, usageAggregates.companyId))
        .where(and(eq(companies.status, "active"), lt(usageAggregates.bucketStart, windowEnd), gt(usageAggregates.bucketEnd, windowStart)))
        .groupBy(usageAggregates.companyId, usageAggregates.billingAccountId, usageAggregates.meterKey, usageAggregates.unit)
        .orderBy(usageAggregates.companyId, usageAggregates.meterKey).limit(5001),
    ]);
    if (companyRows.length > 1000 || providerRows.length > 1000 || usageRows.length > 5000)
      throw conflict("Operator unit economics exceeds its bounded current-source projection");
    const companyCountByAccount = new Map<string, number>();
    for (const row of companyRows) companyCountByAccount.set(row.billingAccountId, (companyCountByAccount.get(row.billingAccountId) ?? 0) + 1);
    const providerByCompany = new Map(providerRows.map(row => [row.companyId, row]));
    const usageByCompany = new Map<string, { meterKey: string; quantity: string; unit: string }[]>();
    const globalUsage = new Map<string, { quantity: bigint; unit: string }>();
    let usageBucketCount = 0;
    let latestSourceWatermark: Date | null = null;
    for (const row of usageRows) {
      const item = { meterKey: row.meterKey, quantity: row.quantity, unit: row.unit };
      const companyItems = usageByCompany.get(row.companyId) ?? [];
      companyItems.push(item);
      usageByCompany.set(row.companyId, companyItems);
      const usageKey = `${row.meterKey}\u0000${row.unit}`;
      const total = globalUsage.get(usageKey);
      globalUsage.set(usageKey, { quantity: (total?.quantity ?? 0n) + BigInt(row.quantity), unit: row.unit });
      usageBucketCount += Number(row.bucketCount);
      if (row.sourceWatermark) {
        const watermark = row.sourceWatermark instanceof Date ? row.sourceWatermark : new Date(row.sourceWatermark);
        if (!latestSourceWatermark || watermark > latestSourceWatermark) latestSourceWatermark = watermark;
      }
    }
    const hostByAccount = new Map(snapshot.accounts.map(account => [account.accountId, account.estimatedRuntimeMonthlyMinor]));
    let unallocatedSharedAccountHostMinor = 0n;
    let unallocatedNoActiveCompanyHostMinor = 0n;
    for (const account of snapshot.accounts) {
      const activeCount = companyCountByAccount.get(account.accountId) ?? 0;
      if (activeCount > 1) unallocatedSharedAccountHostMinor += BigInt(account.estimatedRuntimeMonthlyMinor);
      else if (activeCount === 0) unallocatedNoActiveCompanyHostMinor += BigInt(account.estimatedRuntimeMonthlyMinor);
    }
    const tenantRows = companyRows.map(({ companyId, billingAccountId }) => {
      const provider = providerByCompany.get(companyId);
      const activeCompanyCount = companyCountByAccount.get(billingAccountId) ?? 0;
      const hostAmount = hostByAccount.get(billingAccountId);
      const hostAllocation = hostAmount === undefined ? "no_reported_allocation" as const
        : activeCompanyCount === 1 ? "single_active_company" as const
          : activeCompanyCount === 0 ? "no_active_company_unallocated" as const
            : "shared_account_unallocated" as const;
      return {
        companyId, billingAccountId, activeCompanyCountOnBillingAccount: activeCompanyCount,
        providerReportedCents: Number(provider?.reportedEventCount ?? 0) > 0 ? provider!.reportedCents : null,
        providerEstimatedCents: Number(provider?.estimatedEventCount ?? 0) > 0 ? provider!.estimatedCents : null,
        providerReportedEventCount: Number(provider?.reportedEventCount ?? 0), providerEstimatedEventCount: Number(provider?.estimatedEventCount ?? 0),
        providerUnpricedEventCount: Number(provider?.unpricedEventCount ?? 0), providerUnrecognizedEventCount: Number(provider?.unrecognizedEventCount ?? 0), usage: usageByCompany.get(companyId) ?? [],
        estimatedHostRuntimeMinor: hostAllocation === "single_active_company" ? hostAmount! : null,
        estimatedHostRuntimeCurrency: hostAllocation === "single_active_company" ? "EUR" as const : null,
        hostAllocation, totalCost: "unavailable_incomplete_components" as const,
      };
    });
    const providerTotals = providerRows.reduce((total, row) => ({
      reportedCents: total.reportedCents + BigInt(row.reportedCents),
      estimatedCents: total.estimatedCents + BigInt(row.estimatedCents),
      reportedEventCount: total.reportedEventCount + Number(row.reportedEventCount),
      estimatedEventCount: total.estimatedEventCount + Number(row.estimatedEventCount),
      unpricedEventCount: total.unpricedEventCount + Number(row.unpricedEventCount),
      unrecognizedEventCount: total.unrecognizedEventCount + Number(row.unrecognizedEventCount),
    }), { reportedCents: 0n, estimatedCents: 0n, reportedEventCount: 0, estimatedEventCount: 0, unpricedEventCount: 0, unrecognizedEventCount: 0 });
    return {
      ...snapshot,
      unitEconomics: {
        schemaVersion: 1,
        windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), observedAt: now.toISOString(), coverage: "partial_sources_only",
        platformCost: { amountMinor: snapshot.platformMonthlyMinor, currency: "EUR", basis: snapshot.basis, source: "operator_report", allocation: "environment_unallocated" },
        managedRuntimeHostCost: { amountMinor: snapshot.hosts.reduce((sum, host) => sum + BigInt(host.monthlyMinor), 0n).toString(), currency: "EUR", basis: snapshot.basis, source: "operator_report_cpu_reservation_estimate", unallocatedMultiCompanyMinor: unallocatedSharedAccountHostMinor.toString(), unallocatedNoActiveCompanyMinor: unallocatedNoActiveCompanyHostMinor.toString() },
        providerModelCost: { reportedCents: providerTotals.reportedEventCount > 0 ? providerTotals.reportedCents.toString() : null, estimatedCents: providerTotals.estimatedEventCount > 0 ? providerTotals.estimatedCents.toString() : null, currency: "unspecified", source: "cost_events", reportedEventCount: providerTotals.reportedEventCount, estimatedEventCount: providerTotals.estimatedEventCount, unpricedEventCount: providerTotals.unpricedEventCount, unrecognizedEventCount: providerTotals.unrecognizedEventCount, captureCompleteness: "not_established" },
        runtimeAndStorageUsage: { source: "usage_aggregates", status: usageRows.length ? "aggregated_rows" : "no_aggregate_rows", companyCount: new Set(usageRows.map(row => row.companyId)).size, bucketCount: usageBucketCount, latestSourceWatermark: latestSourceWatermark?.toISOString() ?? null, quantities: [...globalUsage].map(([key, value]) => ({ meterKey: key.slice(0, key.indexOf("\u0000")), quantity: value.quantity.toString(), unit: value.unit })) },
        unavailable: { supportCost: "not_recorded", analyticsCost: "not_recorded", networkAndToolCost: "not_recorded", storageAndRuntimeRates: "not_configured", agentRunClassCost: "not_classified", acceptedOutcomeCost: "no_canonical_cost_attribution" },
        tenants: tenantRows,
      },
    };
  }
  async function latest(reader: Pick<Db, "select"> = db) {
    const [row] = await reader
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
    const snapshot = row?.data?.snapshot as unknown as SaasCostSnapshot | undefined;
    return snapshot ? projectUnitEconomics(snapshot, reader) : null;
  }
  async function record(actor: AuthorizationActor, raw: unknown, now = new Date()) {
    await assertConfiguredOperatorAuthentication(db, actor, config.operatorUserIds);
    const operator = actor.userId!;
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
      await assertConfiguredOperatorAuthentication(tx, actor, config.operatorUserIds);
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
        await assertConfiguredOperatorAuthentication(tx, actor, config.operatorUserIds);
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
      const recordedReceipt = await projectUnitEconomics(snapshot, tx, now);
      await tx.insert(platformAdminAudit).values([
        {
          operatorUserId: operator,
          action: "billing.cost_report_received",
          resourceId: input.idempotencyKey,
          safeDetails: { payloadHash, snapshot: recordedReceipt },
        },
        {
          operatorUserId: operator,
          action: "billing.cost_snapshot_recorded",
          resourceId: config.environment,
          safeDetails: { snapshot: recordedReceipt },
        },
      ]);
      await assertConfiguredOperatorAuthentication(tx, actor, config.operatorUserIds);
      return recordedReceipt;
    });
  }
  return { latest, record };
}
