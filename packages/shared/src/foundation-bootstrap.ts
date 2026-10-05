import { z } from "zod";
import { FOUNDATION_CATEGORIES, FOUNDATION_SENSITIVITIES } from "./types/foundation.js";
import { EVIDENCE_SOURCE_CLASSES, EVIDENCE_TRUST_LEVELS } from "./types/context.js";
import { foundationKeySchema } from "./validators/foundation.js";
export const bootstrapSourceSchema = z.object({
  sourceRef: z.string().min(1).max(2000), sourceVersion: z.string().max(1000).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), sourceClass: z.enum(EVIDENCE_SOURCE_CLASSES),
  sensitivity: z.enum(FOUNDATION_SENSITIVITIES), sourceUpdatedAt: z.string().datetime().nullable(),
  publicationScope: z.enum(["company", "public", "review_required"]),
  authorityDomain: z.string().max(240).nullable(), trustLevel: z.enum(EVIDENCE_TRUST_LEVELS),
}).strict();
export type BootstrapSource = z.infer<typeof bootstrapSourceSchema>;
export const startFoundationBootstrapSchema = z.object({
  agentId: z.string().uuid(), query: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();
export const bootstrapCandidateSchema = z.object({
  foundationKey: foundationKeySchema, category: z.enum(FOUNDATION_CATEGORIES), title: z.string().trim().min(1).max(240),
  proposedContent: z.string().trim().min(1).max(64000), sensitivity: z.enum(FOUNDATION_SENSITIVITIES).default("internal"),
  claims: z.array(z.object({ statement: z.string().trim().min(1).max(4000), sourceRefs: z.array(z.string().min(1).max(2000)).min(1).max(20) }).strict()).min(1).max(32),
  uncertainties: z.array(z.string().trim().min(1).max(2000)).max(32),
  conflicts: z.array(z.string().trim().min(1).max(2000)).max(32),
  materialQuestions: z.array(z.object({ key: foundationKeySchema, question: z.string().trim().min(1).max(2000), required: z.boolean() }).strict()).max(12),
}).strict();
export const submitBootstrapCandidatesSchema = z.object({ expectedVersion: z.number().int().positive(), candidates: z.array(bootstrapCandidateSchema).min(1).max(16) }).strict()
  .refine((value) => new Set(value.candidates.map((candidate) => candidate.foundationKey)).size === value.candidates.length, "Candidate keys must be unique")
  .refine((value) => {
    const questions = value.candidates.flatMap((candidate) => candidate.materialQuestions);
    const keys = [...new Set(questions.map((question) => question.key))];
    return keys.length <= 12 && keys.every((key) => new Set(questions.filter((question) => question.key === key).map((question) => `${question.required}:${question.question}`)).size === 1);
  }, "Use at most twelve consistent material questions across the discovery run");
export const answerBootstrapSchema = z.object({ expectedVersion: z.number().int().positive(), questionKey: foundationKeySchema, answer: z.string().trim().min(1).max(4000) }).strict();
export const bootstrapTransitionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export type BootstrapCandidate = z.infer<typeof bootstrapCandidateSchema>;
export type BootstrapRunView = {
  id: string; companyId: string; agentId: string; taskId: string; status: string; version: number;
  sources: BootstrapSource[]; answers: Record<string, string>; candidates: Array<BootstrapCandidate & { id: string; status: string; foundationDocumentId: string | null }>;
};
