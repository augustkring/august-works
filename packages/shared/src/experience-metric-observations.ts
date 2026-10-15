import { z } from "zod";
import { businessMetricDefinitionSchema } from "./business-metrics.js";

const id = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const metric = z.object({ id, companyId: id, key: z.string().min(1).max(300),
  status: z.enum(["draft", "published", "deprecated", "revoked"]), publishedVersionId: id.nullable() });
const version = z.object({ id, companyId: id, metricId: id, definition: businessMetricDefinitionSchema, contentHash: hash });
const observation = z.object({ id, companyId: id, metricId: id, versionId: id,
  from: timestamp, until: timestamp, asOf: timestamp, expiresAt: timestamp,
  definitionHash: hash,
  status: z.enum(["observed", "undefined", "unavailable", "restricted"]), value: z.number().finite().nullable() })
  .superRefine((value, context) => {
    if (Date.parse(value.from) >= Date.parse(value.until) || Date.parse(value.asOf) >= Date.parse(value.expiresAt) ||
      value.status === "observed" && value.value === null)
      context.addIssue({ code: "custom", message: "Invalid recorded metric result" });
  });
export const insightMetricPageSchema = z.object({ items: z.array(metric).max(100), nextCursor: id.nullable() });
export const insightMetricDetailSchema = z.object({ metric, versions: z.array(version).max(100) });
export const insightMetricObservationsSchema = z.object({ items: z.array(observation).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });

export interface InsightMetricObservation {
  metricId: string;
  name: string;
  definition: z.infer<typeof businessMetricDefinitionSchema>;
  observations: z.infer<typeof observation>[];
  hasMoreObservations: boolean;
}
export interface InsightMetricObservationPage {
  items: InsightMetricObservation[];
  boundedPage: true;
  hasMoreMetrics: boolean;
}

