import { z } from "zod";
import { businessScenarioDefinitionSchema, businessScenarioUnitSchema } from "./business-scenarios.js";

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true }), finite = z.number().finite();
const qualification = z.enum(["current", "needs_revalidation"]);
const root = z.object({ id, companyId: id, status: z.enum(["draft", "published", "retired"]), publishedVersionId: id.nullable() });
const version = z.object({ id, companyId: id, scenarioId: id, definition: businessScenarioDefinitionSchema,
  contentHash: hash, inputHash: hash, expiresAt: time, currentQualification: qualification });
export const insightScenarioPageSchema = z.object({ items: z.array(z.object({ scenario: root, version })).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
export const insightScenarioDetailSchema = z.object({ scenario: root, versions: z.array(version).max(20) });
const output = z.object({ key: z.string().min(1).max(64), unit: businessScenarioUnitSchema, nominal: finite,
  differenceFromBase: finite, constraint: z.enum(["satisfied", "violated", "not_declared"]) });
const scenarioCase = z.object({ key: z.string().min(1).max(64), name: z.string().min(2).max(160), kind: z.enum(["base", "option", "stress"]), outputs: z.array(output).max(16) });
const run = z.object({ id, companyId: id, scenarioId: id, versionId: id, createdAt: time, expiresAt: time, currentQualification: qualification,
  result: z.object({ status: z.enum(["calculated", "inconclusive", "data_not_ready"]), definitionHash: hash, inputHash: hash,
    cases: z.array(scenarioCase).max(8), limitations: z.array(z.string().max(2000)).max(64) }) })
  .refine(value => Date.parse(value.createdAt) < Date.parse(value.expiresAt));
export const insightScenarioRunsSchema = z.object({ items: z.array(run).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
export interface InsightScenarioComparison {
  scenarioId: string; definition: z.infer<typeof businessScenarioDefinitionSchema>; expiresAt: string;
  currentQualification: z.infer<typeof qualification>; run: z.infer<typeof run> | null; hasMoreRuns: boolean;
}
export interface InsightScenarioComparisonPage { items: InsightScenarioComparison[]; hasMoreScenarios: boolean; boundedPage: true; }
