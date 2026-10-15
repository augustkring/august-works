import { z } from "zod";
import { businessForecastDefinitionSchema, statisticalForecastProfileSchema } from "./business-forecasting.js";
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true }), finite = z.number().finite();
const root = z.object({ id, companyId: id, revision: z.number().int().positive(), status: z.enum(["draft", "published", "retired"]), publishedVersionId: id.nullable() });
const version = z.object({ id, companyId: id, specId: id, contentHash: hash, expiresAt: time, definition: businessForecastDefinitionSchema });
export const insightForecastPageSchema = z.object({ items: z.array(root).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
export const insightForecastDetailSchema = z.object({ spec: root, versions: z.array(version).max(5) });
const range = z.object({ lower: finite, upper: finite }).refine(value => value.lower <= value.upper);
const point = z.object({ from: time, until: time, value: finite, interval: range.safeExtend({ method: z.literal("statsforecast_model"), level: z.literal(0.95), level80: range }).nullable() })
  .refine(value => Date.parse(value.from) < Date.parse(value.until));
const artifact = z.object({ id, companyId: id, specId: id, versionId: id, kind: z.literal("run"), cutoff: time, createdAt: time, expiresAt: time,
  currentQualification: z.enum(["qualified", "needs_revalidation", "inconclusive"]),
  result: z.object({ engineVersion: z.enum(["aw-native-business-forecast-v1", "aw-statsforecast-business-forecast-v1"]),
    status: z.enum(["qualified", "not_qualified", "data_not_ready"]), definitionHash: hash, inputHash: hash, unit: z.string().min(1).max(200).nullable(),
    points: z.array(point).max(60), providerProvenance: statisticalForecastProfileSchema.optional(),
    uncertainty: z.object({ method: z.enum(["unavailable", "statsforecast_model"]), coverageLevel: z.union([z.null(), z.literal(0.95)]), reason: z.string().max(2000) }),
    limitations: z.array(z.string().max(2000)).max(64) }) })
  .refine(value => Date.parse(value.createdAt) < Date.parse(value.expiresAt));
export const insightForecastRunsSchema = z.object({ items: z.array(artifact).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
export interface InsightForecastResult { specId: string; definition: z.infer<typeof businessForecastDefinitionSchema>; expiresAt: string; artifact: z.infer<typeof artifact> | null; hasMoreRuns: boolean; }
export interface InsightForecastResultPage { items: InsightForecastResult[]; hasMoreForecasts: boolean; boundedPage: true; }
