import { z } from "zod";
import { ISSUE_STATUSES, PROJECT_STATUSES } from "./constants.js";

const ref = z.string().trim().min(1).max(300);
const text = z.string().trim().min(1).max(2000);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const issueStatus = z.enum(ISSUE_STATUSES);
const projectStatus = z.enum(PROJECT_STATUSES);

/** Counts native objects created in [from, until), filtered by their current
 * state at query time. This is deliberately not a historical status reconstruction. */
export const nativeMetricPopulationSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("issue"), statuses: z.array(issueStatus).min(1).max(ISSUE_STATUSES.length), projectId: z.string().uuid().nullable() }).strict(),
  z.object({ entity: z.literal("project"), statuses: z.array(projectStatus).min(1).max(PROJECT_STATUSES.length) }).strict(),
]);
const nativeCalculation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native_count"), population: nativeMetricPopulationSchema }).strict(),
  z.object({ kind: z.literal("native_ratio"), numerator: nativeMetricPopulationSchema, denominator: nativeMetricPopulationSchema }).strict(),
]);
const externalCalculation = z.object({
  kind: z.literal("external_metric"), providerKey: z.enum(["metricflow", "cube"]),
  connectionId: z.string().uuid(), providerMetricRef: ref, providerVersion: ref,
  definitionHash: hash, qualificationHash: hash,
}).strict();

export const businessMetricDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(200), description: text,
  businessQuestion: text, decisionUse: text, populationDescription: text,
  inclusions: z.array(ref).min(1).max(32), exclusions: z.array(ref).max(32),
  authorityMode: z.enum(["aw_native", "external_authoritative", "external_projection"]),
  valueType: z.enum(["number", "currency", "ratio", "duration", "count", "boolean"]),
  unit: ref, currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  grain: z.enum(["issue", "project", "external_entity"]), timeGrain: z.literal("window"),
  timezone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Unknown timezone"),
  timeSemantics: z.enum(["created_in_window_current_state", "external_provider_defined"]),
  dimensions: z.array(z.enum(["status", "project"])).max(2),
  calculation: z.union([nativeCalculation, externalCalculation]),
  ownerUserId: ref, reviewFrequencyDays: z.number().int().min(1).max(365),
  freshnessSeconds: z.number().int().min(1).max(31_536_000),
  missingPolicy: z.literal("explicit_unknown"), goodhartRisk: text,
  purpose: z.literal("management_intelligence"), sensitivity: z.enum(["internal", "confidential"]),
  governanceObligationRefs: z.array(z.string().uuid()).min(1).max(16),
  retentionDays: z.number().int().min(1).max(3650),
}).strict().superRefine((value, context) => {
  const reject = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(value.dimensions).size !== value.dimensions.length) reject("Duplicate dimensions");
  if ((value.valueType === "currency") !== (value.currency !== null)) reject("Currency must match the value type");
  const calculation = value.calculation;
  if (calculation.kind === "external_metric") {
    if (value.authorityMode === "aw_native" || value.grain !== "external_entity" || value.timeSemantics !== "external_provider_defined")
      reject("External definitions require explicit external authority, grain and time semantics");
    return;
  }
  if (value.authorityMode !== "aw_native" || value.timezone !== "UTC" || value.timeSemantics !== "created_in_window_current_state")
    reject("Native calculations require native authority and explicit UTC current-state semantics");
  const population = calculation.kind === "native_count" ? calculation.population : calculation.denominator;
  if (value.grain !== population.entity) reject("Calculation and entity grain differ");
  if (population.entity === "project" && value.dimensions.includes("project")) reject("Project is not a project-metric breakdown dimension");
  if (calculation.kind === "native_count" && (value.valueType !== "count" || value.unit !== "objects")) reject("Native count has unit objects and count type");
  if (calculation.kind === "native_ratio") {
    if (value.valueType !== "ratio" || value.unit !== "ratio") reject("Native ratios have ratio type and unit");
    const numerator = calculation.numerator;
    if (numerator.entity !== population.entity || (numerator.entity === "issue" && population.entity === "issue" && numerator.projectId !== population.projectId))
      reject("Ratio populations must use the same entity and project scope");
    const denominatorStatuses = new Set<string>(population.statuses);
    if (numerator.statuses.some(status => !denominatorStatuses.has(status))) reject("Numerator must be a subset of the denominator population");
  }
  for (const item of calculation.kind === "native_count" ? [calculation.population] : [calculation.numerator, calculation.denominator])
    if (new Set(item.statuses).size !== item.statuses.length) reject("Duplicate population statuses");
});

export const createBusinessMetricSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/), definition: businessMetricDefinitionSchema,
}).strict();
export const createBusinessMetricVersionSchema = z.object({
  expectedRevision: z.number().int().positive(), definition: businessMetricDefinitionSchema,
}).strict();
export const publishBusinessMetricSchema = z.object({
  expectedRevision: z.number().int().positive(), versionId: z.string().uuid(),
}).strict();
export const transitionBusinessMetricSchema = z.object({
  expectedRevision: z.number().int().positive(), status: z.enum(["deprecated", "revoked"]), reason: text,
}).strict();
export const queryBusinessMetricSchema = z.object({
  metricId: z.string().uuid(), versionId: z.string().uuid(),
  from: z.iso.datetime(), until: z.iso.datetime(),
  dimensions: z.array(z.enum(["status", "project"])).max(2).default([]),
  maxRows: z.number().int().min(1).max(10_000).default(5000),
}).strict().refine(value => Date.parse(value.from) < Date.parse(value.until), "Metric window must be nonempty")
  .refine(value => [value.from, value.until].every(time => !/\.\d{4,}Z$/.test(time)), "Metric window precision is milliseconds")
  .refine(value => Date.parse(value.until) - Date.parse(value.from) <= 366 * 86_400_000, "Metric window exceeds native query budget")
  .refine(value => new Set(value.dimensions).size === value.dimensions.length, "Duplicate query dimensions");

export type BusinessMetricDefinition = z.infer<typeof businessMetricDefinitionSchema>;
export type NativeMetricPopulation = z.infer<typeof nativeMetricPopulationSchema>;
export type BusinessMetricQuery = z.infer<typeof queryBusinessMetricSchema>;
export type CreateBusinessMetric = z.infer<typeof createBusinessMetricSchema>;
export type CreateBusinessMetricVersion = z.infer<typeof createBusinessMetricVersionSchema>;
export type PublishBusinessMetric = z.infer<typeof publishBusinessMetricSchema>;
export type TransitionBusinessMetric = z.infer<typeof transitionBusinessMetricSchema>;
export interface BusinessMetricView {
  id: string; companyId: string; key: string; revision: number;
  status: "draft" | "published" | "deprecated" | "revoked";
  publishedVersionId: string | null; createdAt: string; updatedAt: string;
}
export interface BusinessMetricVersionView {
  id: string; companyId: string; metricId: string; revision: number;
  definition: BusinessMetricDefinition; contentHash: string; createdAt: string;
}
export interface BusinessMetricResult {
  id: string; companyId: string; metricId: string; versionId: string;
  from: string; until: string; asOf: string; expiresAt: string;
  status: "observed" | "undefined" | "unavailable" | "restricted";
  value: number | null; reason: string | null;
  groups: Array<{ dimensions: Record<string, string | null>; value: number | null; numerator?: number; denominator?: number }>;
  inputHash: string; definitionHash: string; engineVersion: string;
  lineageManifestId: string; sourceWatermark: string;
}
