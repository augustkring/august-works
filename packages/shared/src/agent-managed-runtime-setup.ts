import { z } from "zod";
const digest = z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const agentManagedRuntimeSetupReviewInputSchema = z.strictObject({
  capacityProfile: z.string().min(1).max(80), imageDigest: digest,
});
export const agentManagedRuntimeSetupCommandSchema = agentManagedRuntimeSetupReviewInputSchema.extend({
  requestId: z.uuid(), expectedVersion: z.number().int().positive(), expectedReviewHash: hash,
  confirmManagedCapacity: z.literal(true), confirmInactiveProvisioning: z.literal(true),
}).strict();
export const agentManagedRuntimeSetupCatalogSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), agentId: z.uuid(), version: z.number().int().positive(),
  capacity: z.array(z.strictObject({ key: z.string().min(1).max(80), product: z.enum(["runtime_standard", "runtime_performance"]),
    availableCells: z.number().int().nonnegative() })).max(100),
  versions: z.array(z.strictObject({ imageDigest: digest, providerVersion: z.string().min(1).max(100) })).max(100),
  changesLiveConfiguration: z.literal(false),
});
export const agentManagedRuntimeSetupReviewSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), agentId: z.uuid(), version: z.number().int().positive(), reviewHash: hash,
  canProvision: z.boolean(), blockers: z.array(z.string().min(1).max(120)).max(20),
  usesIncludedCapacity: z.literal(true), modelCalled: z.literal(false), activatesAgent: z.literal(false),
  grantsAuthority: z.literal(false), createsRuntime: z.literal(true),
});
export const agentManagedRuntimeSetupReceiptSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), agentId: z.uuid(), requestId: z.uuid(), cellId: z.uuid(), operationId: z.uuid(),
  recordedAt: z.iso.datetime(), operationStatus: z.enum(["REQUESTED", "RUNNING", "WAITING_FOR_CAPACITY", "NEEDS_RECONCILIATION", "SUCCEEDED", "FAILED", "CANCELED"]),
  runtimeStatus: z.string().min(1).max(40), modelConfigured: z.boolean(),
  activatesAgent: z.literal(false), grantsAuthority: z.literal(false), runtimeQualified: z.literal(false),
});
export type AgentManagedRuntimeSetupCommand = z.infer<typeof agentManagedRuntimeSetupCommandSchema>;
