import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.uuid().refine(id => id === id.toLowerCase(), "Use the canonical request ID");
export const agentPackageSetupReviewSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), version: z.number().int().positive(), agentId: z.uuid(),
  installationId: z.uuid(), installationVersion: z.number().int().positive(),
  packageName: z.string().min(1).max(200), packageVersion: z.string().min(1).max(120),
  intendedPurpose: z.string().min(1).max(4000),
  purposes: z.array(z.strictObject({ id: z.uuid(), version: z.number().int().positive(),
    purposeVersion: z.number().int().positive(), name: z.string().min(1).max(200) })).max(100),
  selectedPurposeId: z.uuid().nullable(), packageCurrent: z.boolean(), canConfirm: z.boolean(),
  blockers: z.array(z.enum(["approved_purpose_required", "representative_test_required"])).max(2),
  reviewHash: digest, modelCalled: z.literal(false), authorityGranted: z.literal(false), executionStarted: z.literal(false),
});
export const agentPackageSetupCommandSchema = z.strictObject({
  requestId, expectedVersion: z.number().int().positive(), expectedReviewHash: digest,
  purposeId: z.uuid(), confirmIntendedPurpose: z.literal(true), confirmPackageActivation: z.literal(true),
});
export const agentPackageSetupReceiptSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), requestId: z.uuid(), agentId: z.uuid(), installationId: z.uuid(),
  installationVersion: z.number().int().positive(), purposeId: z.uuid(), purposeVersion: z.number().int().positive(),
  activatedAtConfirmation: z.literal(true), authorityGranted: z.literal(false), executionStarted: z.literal(false),
});
export type AgentPackageSetupReview = z.infer<typeof agentPackageSetupReviewSchema>;
export type AgentPackageSetupCommand = z.infer<typeof agentPackageSetupCommandSchema>;
export type AgentPackageSetupReceipt = z.infer<typeof agentPackageSetupReceiptSchema>;
