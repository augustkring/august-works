import { z } from "zod";

const ceiling = z.number().int().positive().max(2147483647);
const companyRule = z.object({
  companyId: z.string().guid().toLowerCase(), hardLimit: ceiling,
  fairnessClass: z.string().trim().min(1).max(80), priority: z.number().int().min(-2147483648).max(2147483647),
}).strict();
const pool = z.object({
  resource: z.enum(["durable_execution", "analytical_request"]),
  unit: z.enum(["active_work_item", "admitted_request"]),
  hardLimit: ceiling, softLimit: ceiling.optional(),
  onSoftLimit: z.literal("observe"), onHardLimit: z.enum(["defer", "reject"]),
  exceptionOwner: z.string().trim().min(1).max(200),
  companies: z.array(companyRule).max(10000),
}).strict().superRefine((value, ctx) => {
  if (value.unit !== (value.resource === "durable_execution" ? "active_work_item" : "admitted_request") ||
      value.onHardLimit !== (value.resource === "durable_execution" ? "defer" : "reject"))
    ctx.addIssue({ code: "custom", message: "Resource unit and action must match the original owner lifetime" });
  if (value.softLimit !== undefined && value.softLimit > value.hardLimit)
    ctx.addIssue({ code: "custom", message: "Soft limit exceeds the hard limit" });
  if (new Set(value.companies.map(rule => rule.companyId)).size !== value.companies.length)
    ctx.addIssue({ code: "custom", message: "Duplicate company resource rule" });
});

/** Optional measured operator policy. Absence supplies no quota or weight. */
export const resourceGovernancePolicySchema = z.object({
  version: z.literal(1), pools: z.array(pool).max(2),
  rates: z.array(z.object({
    resource: z.literal("gateway_request"), scope: z.literal("company"), companyId: z.string().guid().toLowerCase(),
    hardLimit: ceiling, burst: z.number().int().nonnegative().max(2147483647),
    windowMs: ceiling, onHardLimit: z.literal("reject"), exceptionOwner: z.string().trim().min(1).max(200),
  }).strict()).max(10000),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.pools.map(rule => rule.resource)).size !== value.pools.length ||
      new Set(value.rates.map(rule => rule.companyId)).size !== value.rates.length)
    ctx.addIssue({ code: "custom", message: "Duplicate resource pool or rate scope" });
  if (value.rates.some(rule => rule.hardLimit + rule.burst > 2147483647))
    ctx.addIssue({ code: "custom", message: "Rate plus burst exceeds the counter range" });
});
export type ResourceGovernancePolicy = z.infer<typeof resourceGovernancePolicySchema>;
