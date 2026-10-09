import { z } from "zod";

/** Commitment scope identifies the native owner/context, not an implicit
 * population filter. The pinned metric definition still owns measurement. */
export const businessMetricTargetScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("company") }).strict(),
  z.object({ type: z.literal("goal"), goalId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("project"), projectId: z.string().uuid() }).strict(),
  // Native Portfolio is a current-user multi-company view, not another company
  // hierarchy. Each commitment remains one explicitly owned company unit.
  z.object({ type: z.literal("portfolio"), mode: z.literal("company_unit") }).strict(),
]);
export const businessMetricTargetCriterionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at_least"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("at_most"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("between"), lower: z.number().finite(), upper: z.number().finite() }).strict(),
  z.object({ kind: z.literal("equals_boolean"), value: z.boolean() }).strict(),
]).refine(value => value.kind !== "between" || value.lower <= value.upper, "Target interval is reversed");
export const businessMetricTargetDefinitionSchema = z.object({
  metricId: z.string().uuid(), metricVersionId: z.string().uuid(),
  scope: businessMetricTargetScopeSchema,
  periodStart: z.iso.datetime(), periodEnd: z.iso.datetime(),
  criterion: businessMetricTargetCriterionSchema,
  rationale: z.string().trim().min(10).max(2000),
  assumptions: z.array(z.string().trim().min(1).max(1000)).min(1).max(32),
  ownerUserId: z.string().trim().min(1).max(300),
}).strict().refine(value => Date.parse(value.periodStart) < Date.parse(value.periodEnd), "Target period must be nonempty")
  .refine(value => Date.parse(value.periodEnd) - Date.parse(value.periodStart) <= 366 * 86_400_000, "Target period exceeds query window budget")
  .refine(value => [value.periodStart, value.periodEnd].every(time => !/\.\d{4,}Z$/.test(time)), "Target period precision is milliseconds");
export const createBusinessMetricTargetSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/), definition: businessMetricTargetDefinitionSchema,
}).strict();
export const reviseBusinessMetricTargetSchema = z.object({
  expectedRevision: z.number().int().positive(), definition: businessMetricTargetDefinitionSchema,
}).strict();
export const approveBusinessMetricTargetSchema = z.object({
  expectedRevision: z.number().int().positive(), versionId: z.string().uuid(),
  approvalRationale: z.string().trim().min(10).max(2000),
}).strict();
export const retireBusinessMetricTargetSchema = z.object({
  expectedRevision: z.number().int().positive(), reason: z.string().trim().min(10).max(2000),
}).strict();
export type BusinessMetricTargetDefinition = z.infer<typeof businessMetricTargetDefinitionSchema>;
export type CreateBusinessMetricTarget = z.infer<typeof createBusinessMetricTargetSchema>;
export type ReviseBusinessMetricTarget = z.infer<typeof reviseBusinessMetricTargetSchema>;
export type ApproveBusinessMetricTarget = z.infer<typeof approveBusinessMetricTargetSchema>;
export type RetireBusinessMetricTarget = z.infer<typeof retireBusinessMetricTargetSchema>;
export interface BusinessMetricTargetView {
  id: string; companyId: string; metricId: string; key: string; revision: number;
  status: "draft" | "approved" | "needs_review" | "retired";
  approvedVersionId: string | null; createdAt: string; updatedAt: string;
}
export interface BusinessMetricTargetVersionView {
  id: string; companyId: string; targetId: string; revision: number;
  definition: BusinessMetricTargetDefinition; contentHash: string; createdAt: string;
}
export interface BusinessMetricTargetComparison {
  targetId: string; targetVersionId: string; observationId: string | null;
  status: "met" | "not_met" | "period_in_progress" | "unknown" | "needs_review";
  value: number | boolean | null; reason: string | null; asOf: string;
}
