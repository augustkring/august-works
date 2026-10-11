import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const requestKey = z.uuid().refine(value => value === value.toLowerCase(), "Use the canonical request key");
const statement = z.string().trim().min(1).max(2000);
const statements = z.array(statement).min(1).max(20);

/** Current original-owner explanation, not a provider credential or a grant.
 * All eight material decisions stay distinct. Provider sign-in scopes are
 * disclosed separately from AW's intended business-action authority. */
export const activationConnectionPermissionPreviewSchema = z.strictObject({
  neededNow: statements,
  why: statement,
  usedBy: statement,
  canRead: statements,
  canChange: statements,
  notRequested: statements,
  automatic: statements,
  asksFirst: statements,
});

export const activationConnectionReviewSchema = z.strictObject({
  companyId: z.uuid(),
  onboardingRunId: z.uuid(),
  onboardingVersion: z.number().int().positive(),
  packageVersionId: z.uuid(),
  packageContentHash: hash,
  applicationId: z.uuid(),
  applicationKey: z.string().min(1).max(120),
  applicationName: z.string().min(1).max(200),
  galleryKey: z.string().min(1).max(120),
  connectionMethodKey: z.string().min(1).max(120),
  methodHash: hash,
  providerScopes: z.array(z.string().min(1).max(1000)).max(100),
  scopeProfile: z.string().min(1).max(120).nullable(),
  grantKind: z.literal("user"),
  deferAgentAccess: z.literal(true),
  preview: activationConnectionPermissionPreviewSchema,
  // Locale-independent display facts derived from the already pinned Original
  // method/package. Presentation language must never change consent identity.
  explanation: z.strictObject({
    providerName: statement,
    resource: z.url().max(2000),
    capabilityName: statement,
    providerWriteTools: z.array(statement).max(100),
  }),
  existingConnection: z.strictObject({ id: z.uuid(), name: z.string().min(1).max(200), setupHash: hash }).nullable(),
  reviewHash: hash,
});

/** The original Native owner recomputes every review field under current
 * authority. Neither client-supplied scopes, agent IDs nor organization access
 * can be smuggled into this consent command. */
export const activationConnectionConsentCommandSchema = z.strictObject({
  requestKey,
  confirmConnectionAuthorization: z.literal(true),
  expectedReviewHash: hash,
});

export const activationConnectionConsentWithdrawalCommandSchema = z.strictObject({
  confirmWithdrawal: z.literal(true),
  expectedReviewHash: hash,
});

export const activationConnectionConsentReceiptSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  onboardingRunId: z.uuid(),
  packageVersionId: z.uuid(),
  applicationId: z.uuid(),
  requestKey,
  reviewHash: hash,
  onboardingVersion: z.number().int().positive(),
  status: z.enum(["approved", "allocating", "allocated", "connected", "withdrawn"]),
  connectionId: z.uuid().nullable(),
  requestedAt: z.iso.datetime(),
  connectedAt: z.iso.datetime().nullable(),
}).superRefine((receipt, context) => {
  if ((["approved", "allocating"].includes(receipt.status) && (receipt.connectionId !== null || receipt.connectedAt !== null)) ||
      (receipt.status === "allocated" && (receipt.connectionId === null || receipt.connectedAt !== null)) ||
      (receipt.status === "connected" && (receipt.connectionId === null || receipt.connectedAt === null)) ||
      (receipt.connectedAt !== null && receipt.connectionId === null))
    context.addIssue({ code: "custom", message: "Connection consent status requires its original allocation evidence" });
});

export type ActivationConnectionReview = z.infer<typeof activationConnectionReviewSchema>;
export type ActivationConnectionConsentCommand = z.infer<typeof activationConnectionConsentCommandSchema>;
export type ActivationConnectionConsentReceipt = z.infer<typeof activationConnectionConsentReceiptSchema>;
