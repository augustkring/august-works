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
}
