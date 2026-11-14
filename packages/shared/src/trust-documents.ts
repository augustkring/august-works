import { z } from "zod";

export const trustDocumentVisibilitySchema = z.enum(["public", "gated", "internal"]);
export const trustMaterialChangeActionSchema = z.enum([
  "notice", "reacceptance", "customer_admin_acknowledgment", "no_action",
]);
export const trustDocumentActionReceiptKindSchema = z.enum(["notice_read", "customer_admin_acknowledgment"]);
export const trustDocumentSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  title: z.string().nullable(),
  version: z.string(),
  owner: z.string(),
  effectiveAt: z.string().datetime().nullable(),
  evidenceRefs: z.array(z.string()),
  customerVisibility: trustDocumentVisibilitySchema,
  ndaRequired: z.boolean(),
  lastReviewedAt: z.string().datetime().nullable(),
  nextReviewOrTrigger: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  supersededBy: z.string().uuid().nullable(),
  materialChangeAction: trustMaterialChangeActionSchema,
  /** Legacy projection. True exactly when materialChangeAction is reacceptance. */
  acceptanceRequired: z.boolean(),
});
export const trustDocumentRegistrySchema = z.object({
  configured: z.boolean(),
  documents: z.array(trustDocumentSchema),
});
export const trustDocumentContentSchema = z.object({
  document: trustDocumentSchema,
  format: z.string().min(1).max(100),
  body: z.string(),
});
export const trustDocumentNdaUnconfiguredSchema = z.object({
  state: z.literal("nda_binding_unconfigured"),
  registryEntryId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  version: z.string(),
  requiredBindingOwner: z.literal("canonical_nda_agreement"),
  receiptReference: z.null(),
});
export const trustDocumentNdaUnconfiguredErrorSchema = trustDocumentNdaUnconfiguredSchema.extend({
  code: z.literal("trust_nda_binding_unconfigured"),
});
export const trustDocumentGatedAccessSchema = z.object({
  document: trustDocumentSchema,
  access: z.discriminatedUnion("state", [
    z.object({ state: z.literal("grant_required") }),
    z.object({ state: z.literal("granted"), grantReceiptId: z.string().uuid(), expiresAt: z.string().datetime() }),
    trustDocumentNdaUnconfiguredSchema,
  ]),
});
export const trustDocumentGatedRegistrySchema = z.object({
  configured: z.boolean(),
  canGrant: z.boolean(),
  documents: z.array(trustDocumentGatedAccessSchema),
});
export const trustDocumentGatedContentQuerySchema = z.object({
  expectedUserId: z.string().min(1).max(300),
  grantReceiptId: z.string().uuid(),
}).strict();
export const trustDocumentGatedContentSchema = z.object({
  document: trustDocumentSchema,
  grantReceiptId: z.string().uuid(),
  format: z.string().min(1).max(100),
  body: z.string(),
});
export const trustDocumentGatedGrantCommandSchema = z.object({
  expectedUserId: z.string().min(1).max(300),
  requestId: z.string().uuid(),
  registryEntryId: z.string().uuid(),
  version: z.string().min(1).max(128),
  granteeUserId: z.string().min(1).max(300),
  expiresAt: z.string().datetime(),
  surface: z.string().min(1).max(128),
}).strict();
export const trustDocumentGatedGrantReceiptSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  registryEntryId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  documentVersion: z.string(),
  granteeUserId: z.string().min(1),
  grantedByUserId: z.string().min(1),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  requestId: z.string().uuid(),
  surface: z.string(),
});
export const trustDocumentGatedRevokeCommandSchema = z.object({
  expectedUserId: z.string().min(1).max(300),
  requestId: z.string().uuid(),
  grantReceiptId: z.string().uuid(),
  surface: z.string().min(1).max(128),
}).strict();
export const trustDocumentGatedRevokeReceiptSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  grantReceiptId: z.string().uuid(),
  revokedByUserId: z.string().min(1),
  revokedAt: z.string().datetime(),
  requestId: z.string().uuid(),
  surface: z.string(),
});
export const trustDocumentListQuerySchema = z.object({
  expectedUserId: z.string().min(1).max(300),
}).strict();
const trustDocumentRegisterCommandBase = z.object({
  expectedUserId: z.string().min(1).max(300),
  documentId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  effectiveAt: z.string().datetime().nullable(),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(100),
  customerVisibility: trustDocumentVisibilitySchema,
  ndaRequired: z.boolean(),
  lastReviewedAt: z.string().datetime().nullable(),
  nextReviewOrTrigger: z.string().trim().min(1).max(500).nullable(),
  expiresAt: z.string().datetime().nullable(),
});
const legacyTrustDocumentRegisterCommandSchema = trustDocumentRegisterCommandBase.extend({
  /** Backward-compatible alias; true maps to reacceptance and false to no_action. */
  acceptanceRequired: z.boolean(),
}).strict();
const ownerDeclaredTrustDocumentRegisterCommandSchema = trustDocumentRegisterCommandBase.extend({
  materialChangeAction: trustMaterialChangeActionSchema,
  /** When provided, must equal the derived compatibility projection. */
  acceptanceRequired: z.boolean().optional(),
}).strict().superRefine((command, context) => {
  if (command.acceptanceRequired !== undefined && command.acceptanceRequired !== (command.materialChangeAction === "reacceptance")) {
    context.addIssue({ code: "custom", message: "acceptanceRequired must match the selected material-change action", path: ["acceptanceRequired"] });
  }
});
export const trustDocumentRegisterCommandSchema = z.union([
  legacyTrustDocumentRegisterCommandSchema,
  ownerDeclaredTrustDocumentRegisterCommandSchema,
]);
export const trustDocumentAcceptanceCommandSchema = z.object({
  expectedUserId: z.string().min(1).max(300),
  requestId: z.string().uuid(),
  registryEntryId: z.string().uuid(),
  version: z.string().min(1).max(128),
  surface: z.string().min(1).max(128),
}).strict();
export const trustDocumentAcceptanceReceiptSchema = z.object({
  requestId: z.string().uuid(),
  companyId: z.string().uuid(),
  principal: z.string().min(1),
  registryEntryId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  documentVersion: z.string(),
  acceptedAt: z.string().datetime(),
  surface: z.string(),
});
export const trustDocumentActionCommandSchema = z.object({
  expectedUserId: z.string().min(1).max(300),
  requestId: z.string().uuid(),
  registryEntryId: z.string().uuid(),
  version: z.string().min(1).max(128),
  surface: z.string().min(1).max(128),
}).strict();
export const trustDocumentActionReceiptSchema = z.object({
  requestId: z.string().uuid(),
  companyId: z.string().uuid(),
  principal: z.string().min(1),
  registryEntryId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  documentVersion: z.string(),
  action: trustDocumentActionReceiptKindSchema,
  completedAt: z.string().datetime(),
  surface: z.string(),
});
export const trustDocumentRegistrationReceiptSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  version: z.string(),
  materialChangeAction: trustMaterialChangeActionSchema,
});
export type TrustDocument = z.infer<typeof trustDocumentSchema>;
export type TrustDocumentGatedAccess = z.infer<typeof trustDocumentGatedAccessSchema>;
export type TrustDocumentNdaUnconfigured = z.infer<typeof trustDocumentNdaUnconfiguredSchema>;
export type TrustDocumentAcceptanceCommand = z.infer<typeof trustDocumentAcceptanceCommandSchema>;
export type TrustDocumentRegisterCommand = z.infer<typeof trustDocumentRegisterCommandSchema>;
export type TrustDocumentAcceptanceReceipt = z.infer<typeof trustDocumentAcceptanceReceiptSchema>;
export type TrustMaterialChangeAction = z.infer<typeof trustMaterialChangeActionSchema>;
export type TrustDocumentActionReceipt = z.infer<typeof trustDocumentActionReceiptSchema>;
