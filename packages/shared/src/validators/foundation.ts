import { z } from "zod";
import {
  FOUNDATION_AUTHORITY_LEVELS,
  FOUNDATION_CATEGORIES,
  FOUNDATION_SENSITIVITIES,
} from "../types/foundation.js";

export const foundationKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/,
    "Foundation key must use lowercase letters, numbers, hyphens, underscores, or dots",
  );

const nullableDateTimeSchema = z.string().datetime().nullable();

const foundationGovernanceFields = {
  category: z.enum(FOUNDATION_CATEGORIES),
  documentType: z.string().trim().min(1).max(120),
  authorityLevel: z.enum(FOUNDATION_AUTHORITY_LEVELS).default("canonical"),
  sensitivity: z.enum(FOUNDATION_SENSITIVITIES).default("internal"),
  ownerUserId: z.string().trim().min(1).max(255).nullable().optional(),
  ownerAgentId: z.string().guid().nullable().optional(),
  reviewFrequencyDays: z.number().int().positive().max(3650).nullable().optional(),
  validFrom: nullableDateTimeSchema.optional(),
  validUntil: nullableDateTimeSchema.optional(),
};

function validateValidityWindow(
  value: { validFrom?: string | null; validUntil?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.validFrom && value.validUntil && new Date(value.validUntil) <= new Date(value.validFrom)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validUntil"],
      message: "validUntil must be later than validFrom",
    });
  }
}

export const createFoundationDocumentSchema = z
  .object({
    foundationKey: foundationKeySchema,
    title: z.string().trim().max(240).nullable().optional(),
    body: z.string(),
    ...foundationGovernanceFields,
  })
  .strict()
  .superRefine(validateValidityWindow);

export const updateFoundationDraftSchema = z
  .object({
    baseRevisionId: z.string().guid(),
    title: z.string().trim().max(240).nullable().optional(),
    body: z.string().optional(),
    changeSummary: z.string().trim().max(1000).nullable().optional(),
    category: z.enum(FOUNDATION_CATEGORIES).optional(),
    documentType: z.string().trim().min(1).max(120).optional(),
    authorityLevel: z.enum(FOUNDATION_AUTHORITY_LEVELS).optional(),
    sensitivity: z.enum(FOUNDATION_SENSITIVITIES).optional(),
    ownerUserId: z.string().trim().min(1).max(255).nullable().optional(),
    ownerAgentId: z.string().guid().nullable().optional(),
    reviewFrequencyDays: z.number().int().positive().max(3650).nullable().optional(),
    validFrom: nullableDateTimeSchema.optional(),
    validUntil: nullableDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateValidityWindow(value, ctx);
    const mutableKeys = Object.keys(value).filter((key) => key !== "baseRevisionId");
    if (mutableKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one Foundation field must be updated",
      });
    }
  });

export const transitionFoundationDocumentSchema = z
  .object({
    expectedRevisionId: z.string().guid(),
  })
  .strict();

export const createFoundationChangeProposalSchema = z
  .object({
    sourceType: z.string().trim().min(1).max(120),
    sourceId: z.string().trim().min(1).max(500).nullable().optional(),
    baseRevisionId: z.string().guid().nullable().optional(),
    proposedBody: z.string(),
    changeSummary: z.string().trim().max(1000).nullable().optional(),
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export type CreateFoundationDocument = z.input<typeof createFoundationDocumentSchema>;
export type UpdateFoundationDraft = z.infer<typeof updateFoundationDraftSchema>;
export type TransitionFoundationDocument = z.infer<typeof transitionFoundationDocumentSchema>;
export type CreateFoundationChangeProposal = z.infer<typeof createFoundationChangeProposalSchema>;

export const foundationSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    scope: z.enum(["approved", "working"]).optional().default("approved"),
  })
  .strict();

export type FoundationSearchQuery = z.infer<typeof foundationSearchQuerySchema>;
