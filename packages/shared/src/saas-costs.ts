import { z } from "zod";
const money = z.string().regex(/^[0-9]{1,40}$/);
export const saasCostReportSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    month: z.string().regex(/^20[0-9]{2}-(0[1-9]|1[0-2])$/),
    currency: z.literal("EUR"),
    reportUri: z.string().url().max(2048),
    reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
    basis: z.enum(["provider_invoice", "provider_price_estimate"]),
    platformMonthlyMinor: money,
    newHostMonthlyMinor: money,
    hostPlan: z.string().min(1).max(100),
    hosts: z
      .array(
        z.object({ hostId: z.string().uuid(), monthlyMinor: money }).strict(),
      )
      .max(50),
    accountRevenue: z
      .array(
        z
          .object({ accountId: z.string().uuid(), monthlyMinor: money })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [rows, key] of [
      [value.hosts, "hostId"],
      [value.accountRevenue, "accountId"],
    ] as const) {
      const ids = rows.map((row) =>
        key === "hostId"
          ? (row as { hostId: string }).hostId
          : (row as { accountId: string }).accountId,
      );
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate cost or revenue resource",
        });
    }
  });
export interface SaasCostSnapshot {
  observedAt: string;
  month: string;
  currency: "EUR";
  basis: "provider_invoice" | "provider_price_estimate";
  platformMonthlyMinor: string;
  newHostMonthlyMinor: string;
  hostPlan: string;
  reportSha256: string;
  estimatedMonthlyCogsMinor: string;
  reportedMrrMinor: string;
  reportedArrMinor: string;
  estimatedGrossMarginMinor: string;
  unallocatedHostCostMinor: string;
  hosts: {
    hostId: string;
    monthlyMinor: string;
    allocatedMinor: string;
    reservedCpuMillis: number;
    totalCpuMillis: number;
  }[];
  accounts: {
    accountId: string;
    estimatedRuntimeMonthlyMinor: string;
    reportedMrrMinor: string;
  }[];
  /** A current operator-only projection over existing ledgers. It deliberately
   * keeps incomparable currencies and quantities separate and never implies
   * complete cost-to-serve coverage. */
  unitEconomics?: {
    windowStart: string;
    windowEnd: string;
    observedAt: string;
    coverage: "partial_sources_only";
    platformCost: { amountMinor: string; currency: "EUR"; basis: "provider_invoice" | "provider_price_estimate"; source: "operator_report"; allocation: "environment_unallocated" };
    managedRuntimeHostCost: { amountMinor: string; currency: "EUR"; basis: "provider_invoice" | "provider_price_estimate"; source: "operator_report_cpu_reservation_estimate"; unallocatedMultiCompanyMinor: string; unallocatedNoActiveCompanyMinor: string };
    providerModelCost: { reportedCents: string | null; estimatedCents: string | null; currency: "unspecified"; source: "cost_events"; reportedEventCount: number; estimatedEventCount: number; unpricedEventCount: number; unrecognizedEventCount: number; captureCompleteness: "not_established" };
    runtimeAndStorageUsage: { source: "usage_aggregates"; status: "aggregated_rows" | "no_aggregate_rows"; companyCount: number; bucketCount: number; latestSourceWatermark: string | null; quantities: { meterKey: string; quantity: string; unit: string }[] };
    unavailable: { supportCost: "not_recorded"; analyticsCost: "not_recorded"; networkAndToolCost: "not_recorded"; storageAndRuntimeRates: "not_configured"; agentRunClassCost: "not_classified"; acceptedOutcomeCost: "no_canonical_cost_attribution" };
    tenants: {
      companyId: string;
      billingAccountId: string;
      activeCompanyCountOnBillingAccount: number;
      providerReportedCents: string | null;
      providerEstimatedCents: string | null;
      providerReportedEventCount: number;
      providerEstimatedEventCount: number;
      providerUnpricedEventCount: number;
      providerUnrecognizedEventCount: number;
      usage: { meterKey: string; quantity: string; unit: string }[];
      estimatedHostRuntimeMinor: string | null;
      estimatedHostRuntimeCurrency: "EUR" | null;
      hostAllocation: "single_active_company" | "shared_account_unallocated" | "no_active_company_unallocated" | "no_reported_allocation";
      totalCost: "unavailable_incomplete_components";
    }[];
  };
}

export const saasCostSnapshotSchema = z.strictObject({
  observedAt: z.iso.datetime(), month: z.string().regex(/^20[0-9]{2}-(0[1-9]|1[0-2])$/), currency: z.literal("EUR"),
  basis: z.enum(["provider_invoice", "provider_price_estimate"]), platformMonthlyMinor: money, newHostMonthlyMinor: money,
  hostPlan: z.string(), reportSha256: z.string().regex(/^[a-f0-9]{64}$/), estimatedMonthlyCogsMinor: money,
  reportedMrrMinor: money, reportedArrMinor: money, estimatedGrossMarginMinor: z.string().regex(/^-?[0-9]{1,40}$/),
  unallocatedHostCostMinor: money,
  hosts: z.array(z.strictObject({ hostId: z.uuid(), monthlyMinor: money, allocatedMinor: money, reservedCpuMillis: z.number().int().nonnegative(), totalCpuMillis: z.number().int().positive() })).max(50),
  accounts: z.array(z.strictObject({ accountId: z.uuid(), estimatedRuntimeMonthlyMinor: money, reportedMrrMinor: money })).max(1000),
  unitEconomics: z.strictObject({
    windowStart: z.iso.datetime(), windowEnd: z.iso.datetime(), observedAt: z.iso.datetime(), coverage: z.literal("partial_sources_only"),
    platformCost: z.strictObject({ amountMinor: money, currency: z.literal("EUR"), basis: z.enum(["provider_invoice", "provider_price_estimate"]), source: z.literal("operator_report"), allocation: z.literal("environment_unallocated") }),
    managedRuntimeHostCost: z.strictObject({ amountMinor: money, currency: z.literal("EUR"), basis: z.enum(["provider_invoice", "provider_price_estimate"]), source: z.literal("operator_report_cpu_reservation_estimate"), unallocatedMultiCompanyMinor: money, unallocatedNoActiveCompanyMinor: money }),
    providerModelCost: z.strictObject({ reportedCents: z.string().regex(/^-?[0-9]{1,40}$/).nullable(), estimatedCents: z.string().regex(/^-?[0-9]{1,40}$/).nullable(), currency: z.literal("unspecified"), source: z.literal("cost_events"), reportedEventCount: z.number().int().nonnegative(), estimatedEventCount: z.number().int().nonnegative(), unpricedEventCount: z.number().int().nonnegative(), unrecognizedEventCount: z.number().int().nonnegative(), captureCompleteness: z.literal("not_established") }),
    runtimeAndStorageUsage: z.strictObject({ source: z.literal("usage_aggregates"), status: z.enum(["aggregated_rows", "no_aggregate_rows"]), companyCount: z.number().int().nonnegative(), bucketCount: z.number().int().nonnegative(), latestSourceWatermark: z.iso.datetime().nullable(), quantities: z.array(z.strictObject({ meterKey: z.string(), quantity: money, unit: z.string() })).max(5000) }),
    unavailable: z.strictObject({ supportCost: z.literal("not_recorded"), analyticsCost: z.literal("not_recorded"), networkAndToolCost: z.literal("not_recorded"), storageAndRuntimeRates: z.literal("not_configured"), agentRunClassCost: z.literal("not_classified"), acceptedOutcomeCost: z.literal("no_canonical_cost_attribution") }),
    tenants: z.array(z.strictObject({
      companyId: z.uuid(), billingAccountId: z.uuid(), activeCompanyCountOnBillingAccount: z.number().int().nonnegative(),
      providerReportedCents: z.string().regex(/^-?[0-9]{1,40}$/).nullable(), providerEstimatedCents: z.string().regex(/^-?[0-9]{1,40}$/).nullable(), providerReportedEventCount: z.number().int().nonnegative(),
      providerEstimatedEventCount: z.number().int().nonnegative(), providerUnpricedEventCount: z.number().int().nonnegative(), providerUnrecognizedEventCount: z.number().int().nonnegative(),
      usage: z.array(z.strictObject({ meterKey: z.string(), quantity: money, unit: z.string() })).max(5),
      estimatedHostRuntimeMinor: money.nullable(), estimatedHostRuntimeCurrency: z.literal("EUR").nullable(),
      hostAllocation: z.enum(["single_active_company", "shared_account_unallocated", "no_active_company_unallocated", "no_reported_allocation"]),
      totalCost: z.literal("unavailable_incomplete_components"),
    })).max(1000),
  }),
});
