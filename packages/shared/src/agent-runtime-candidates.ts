import { z } from "zod";
import { providerConformanceInputSchema } from "./provider-capabilities.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive();

export const agentRuntimeCandidateCreateSchema = z.strictObject({
  requestId: z.uuid(), expectedVersion: version, modelProfileId: z.uuid(),
});
export const agentRuntimeCandidateCatalogSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), version, agentId: z.uuid().nullable(),
  identityId: z.uuid().nullable().default(null),
  choices: z.array(z.strictObject({ modelProfileId: z.uuid(), model: z.string().min(1).max(200),
    configurationHash: hash, maxOutputTokens: z.number().int().positive(), maximumMinorPerCall: z.number().int().nonnegative(),
    currency: z.literal("USD"), requiresConformance: z.literal(true), changesLive: z.literal(false),
  })).max(100),
});
export const agentRuntimeCandidateViewSchema = z.strictObject({
  id: z.uuid(), companyId: z.uuid(), draftId: z.uuid(), agentId: z.uuid(), modelProfileId: z.uuid(),
  configurationHash: hash, recordedStatus: z.enum(["draft", "testing", "qualified", "failed", "unknown", "retired"]),
  qualificationRequestId: z.uuid().nullable(), qualificationCurrent: z.boolean(),
  createdAt: z.iso.datetime(), changesLive: z.literal(false),
});
export const agentRuntimeCandidateConformanceCommandSchema = providerConformanceInputSchema.extend({
  requestId: z.uuid(), expectedVersion: version, expectedReviewHash: hash,
  confirmBoundedConformance: z.literal(true), confirmCompanyVisibleProbes: z.literal(true),
}).strict();
export const agentRuntimeCandidateConformanceReviewSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), candidateId: z.uuid(), version,
  reviewHash: hash, canTest: z.boolean(), blockers: z.array(z.string().min(1).max(200)).max(20),
  maximumMinor: z.number().int().nonnegative().nullable(), currency: z.literal("USD"),
  probeCount: z.literal(4), toolsGranted: z.literal(false), changesLiveConfiguration: z.literal(false),
  providerComputeStopConfirmed: z.literal(false),
});
export const agentRuntimeCandidateConformanceReceiptSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), candidateId: z.uuid(), requestId: z.uuid(),
  status: z.enum(["pending", "qualified", "failed", "unknown"]),
  createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  runIds: z.array(z.uuid()).max(4), reservationIds: z.array(z.uuid()).max(4),
  reservedMinor: z.number().int().nonnegative(), unknownCharges: z.number().int().min(0).max(4),
  changesLiveConfiguration: z.literal(false), providerComputeStopConfirmed: z.literal(false),
});
export type AgentRuntimeCandidateView = z.infer<typeof agentRuntimeCandidateViewSchema>;
export type AgentRuntimeCandidateCatalog = z.infer<typeof agentRuntimeCandidateCatalogSchema>;
export type AgentRuntimeCandidateCreate = z.infer<typeof agentRuntimeCandidateCreateSchema>;
export type AgentRuntimeCandidateConformanceCommand = z.infer<typeof agentRuntimeCandidateConformanceCommandSchema>;
