import { z } from "zod";
import { processAnalysisDefinitionSchema } from "./process-analysis.js";
import { createProcessFindingSchema, PROCESS_FINDING_STATES } from "./process-findings.js";

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const root = z.object({ id, companyId: id, status: z.enum(["draft", "published", "retired", "needs_review"]), publishedVersionId: id.nullable() });
const version = z.object({ id, companyId: id, definitionId: id, contentHash: hash, expiresAt: time, definition: processAnalysisDefinitionSchema });
export const insightProcessDefinitionsSchema = z.object({ items: z.array(root).max(100), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
export const insightProcessDetailSchema = z.object({ root, effectiveVersion: version });
const run = z.object({ id, companyId: id, definitionId: id, versionId: id, definitionHash: hash, eventSetHash: hash,
  from: time, until: time, createdAt: time, expiresAt: time }).refine(value => Date.parse(value.from) < Date.parse(value.until) && Date.parse(value.createdAt) < Date.parse(value.expiresAt));
export const insightProcessRunsSchema = z.object({ items: z.array(run).max(5), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
const finding = z.object({ id, companyId: id, definitionId: id, analysisRunId: id,
  findingType: createProcessFindingSchema.shape.findingType, severity: createProcessFindingSchema.shape.severity,
  status: z.enum(PROCESS_FINDING_STATES), version: z.number().int().positive(), summary: z.string().min(1).max(2000),
  interpretation: createProcessFindingSchema.shape.interpretation,
  facts: z.object({ semantics: z.literal("human_process_interpretation_of_observed_facts"),
    observed: z.record(z.string().max(100), z.union([z.number().finite(), z.string().max(2000), z.null()])).refine(value => Object.keys(value).length <= 32),
    limitations: z.array(z.string().max(2000)).max(50) }),
  definitionHash: hash, eventSetHash: hash, contentHash: hash, createdAt: time, expiresAt: time,
}).refine(value => Date.parse(value.createdAt) < Date.parse(value.expiresAt));
export const insightProcessFindingsSchema = z.object({ items: z.array(finding).max(100), nextCursor: id.nullable() });
export interface InsightProcessFindingGroup {
  definitionId: string; name: string; businessQuestion: string; expiresAt: string;
  run: z.infer<typeof run> | null; findings: z.infer<typeof finding>[]; hasMoreEvidence: boolean;
}
export interface InsightProcessFindingPage { items: InsightProcessFindingGroup[]; hasMoreDefinitions: boolean; boundedPage: true; }
