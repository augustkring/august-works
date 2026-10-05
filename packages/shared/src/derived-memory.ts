import { z } from "zod";
import { memoryScopeSchema } from "./validators/memory.js";
import { EVIDENCE_SENSITIVITIES } from "./types/context.js";
const sharedScope = memoryScopeSchema.refine((scope) => scope.type !== "agent", "Private Memory cannot be promoted through shared derived intelligence");
const ids = z.array(z.string().uuid()).max(32).refine((value) => new Set(value).size === value.length, "Evidence IDs must be unique");
export const createObservationSchema = z.object({
  observationKey: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/).max(160), scope: sharedScope,
  purpose: z.string().trim().min(1).max(240), content: z.string().trim().min(1).max(64000),
  sensitivity: z.enum(EVIDENCE_SENSITIVITIES).default("internal"),
  evidence: z.array(z.object({ memoryRecordId: z.string().uuid(), relation: z.enum(["supports", "contradicts", "context"]) }).strict()).min(2).max(32),
}).strict().refine((value) => new Set(value.evidence.map((item) => item.memoryRecordId)).size === value.evidence.length, "Observation roots must be unique");
export const createMemoryModelSchema = z.object({
  modelKey: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/).max(160), name: z.string().trim().min(1).max(240), scope: sharedScope,
  purpose: z.string().trim().min(1).max(240), sourceQuery: z.string().trim().min(1).max(500),
  memoryRecordIds: ids, observationIds: ids,
}).strict().refine((value) => value.memoryRecordIds.length + value.observationIds.length > 0, "A model requires root evidence");
export const derivedReviewSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }).strict();
export const rebuildMemoryModelSchema = z.object({ expectedVersion: z.number().int().positive(), memoryRecordIds: ids, observationIds: ids }).strict()
  .refine((value) => value.memoryRecordIds.length + value.observationIds.length > 0, "Rebuild requires selected current evidence");
export interface MemoryObservationView {
  id: string; companyId: string; observationKey: string; content: string; purpose: string; status: string; version: number;
  confidence: number; supportCount: number; contradictionCount: number; independentSourceCount: number; sensitivity: typeof EVIDENCE_SENSITIVITIES[number];
  scopeType: string; scopeId: string | null; updatedAt: string;
}
export interface MemoryModelView {
  id: string; companyId: string; modelKey: string; name: string; content: string; purpose: string; status: string; version: number;
  sourceQuery: string; sourceWatermark: string; scopeType: string; scopeId: string | null; sensitivity: typeof EVIDENCE_SENSITIVITIES[number]; updatedAt: string;
}
