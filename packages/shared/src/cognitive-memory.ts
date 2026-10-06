import { z } from "zod";
import { EVIDENCE_SENSITIVITIES } from "./types/context.js";
import { memoryScopeSchema } from "./validators/memory.js";
export const cognitiveBindingSchema = z.object({
  bindingKey: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/).max(160),
  providerKey: z.enum(["local_baseline", "noop"]), scope: memoryScopeSchema,
  sensitivityCeiling: z.enum(EVIDENCE_SENSITIVITIES).default("internal"),
  purpose: z.string().trim().min(1).max(240), approvedPrivateProjection: z.boolean().default(false),
}).strict().refine((value) => !value.approvedPrivateProjection || value.scope.type === "agent", "Private projection approval requires an agent scope");
export const cognitiveReconcileSchema = z.object({ bindingId: z.string().uuid() }).strict();
export interface CognitiveScope { companyId: string; bindingId: string; scopeType: "company" | "project" | "agent" | "subject"; scopeId: string | null; purpose: string }
export interface GovernedMemoryProjection {
  id: string; companyId: string; version: string; content: string; sensitivity: typeof EVIDENCE_SENSITIVITIES[number];
  validFrom: string | null; validUntil: string | null; sourceRefs: string[];
}
export interface CognitiveRecallRequest { scope: CognitiveScope; query: string; allowedRecords: GovernedMemoryProjection[]; topK: number; signal?: AbortSignal }
export interface CognitiveRecallHit { id: string; companyId: string; version: string; score: number }
export interface CognitiveConformance {
  schema: "aw.cognitive-conformance.v1"; providerKey: string; providerVersion: string;
  storage: "stateless" | "persistent"; governedOnly: true; scopedRecall: boolean; deletionReceipts: boolean; synthesis: boolean;
}
export interface CognitiveMemoryProvider {
  providerKey: string;
  upsertGovernedRecords(scope: CognitiveScope, records: GovernedMemoryProjection[], signal?: AbortSignal): Promise<{ receipt: string; count: number }>;
  deleteGovernedRecords(scope: CognitiveScope, records: Array<{ id: string; version: string }>, signal?: AbortSignal): Promise<{ receipt: string; count: number }>;
  recall(input: CognitiveRecallRequest): Promise<CognitiveRecallHit[]>;
  synthesize(input: CognitiveRecallRequest): Promise<{ content: string; evidenceIds: string[] }>;
  health(): Promise<{ status: "healthy" | "unavailable" }>;
  conformance(): Promise<CognitiveConformance>;
}
export interface CognitiveBindingView {
  id: string; companyId: string; bindingKey: string; providerKey: string; scopeType: CognitiveScope["scopeType"]; scopeId: string | null;
  purpose: string; status: string; lastHealthyAt: string | null; lastReconciledAt: string | null; conformanceHash: string | null;
}
