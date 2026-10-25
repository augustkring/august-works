import { z } from "zod";
import {
  COMPANY_STATUSES,
  ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES,
} from "../constants.js";
import { objectWithoutDefaults } from "./partial.js";

const logoAssetIdSchema = z.string().guid().nullable().optional();
const feedbackDataSharingTermsVersionSchema = z.string().min(1).nullable().optional();
export const companyLocaleSchema = z.enum(["en", "da"]);

export const companyTimeZoneSchema = z.string().trim().min(1).max(128).refine((timeZone) => {
  // Intl accepts fixed UTC offsets too, but schedules require a timezone name
  // with IANA daylight-saving rules rather than an offset-only representation.
  if (/^[+-]\d{2}(?::?\d{2})?$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}, { message: "Invalid IANA timezone" });

const interactionResolverKindGovernanceSchema = z.object({
  defaultPolicy: z.enum(ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES).optional(),
  cap: z.enum(ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES).optional(),
}).strict();

export const interactionResolverGovernanceSchema = z.object({
  suggest_tasks: interactionResolverKindGovernanceSchema.optional(),
  ask_user_questions: interactionResolverKindGovernanceSchema.optional(),
  request_confirmation: interactionResolverKindGovernanceSchema.optional(),
  request_checkbox_confirmation: interactionResolverKindGovernanceSchema.optional(),
  request_item_verdicts: interactionResolverKindGovernanceSchema.optional(),
}).strict().default({});

export const createCompanySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  defaultResponsibleUserId: z.string().min(1).nullable().optional(),
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = objectWithoutDefaults(
  createCompanySchema
    .partial()
    .extend({
      status: z.enum(COMPANY_STATUSES).optional(),
      locale: companyLocaleSchema.optional(),
      timezone: companyTimeZoneSchema.optional(),
      spentMonthlyCents: z.number().int().nonnegative().optional(),
      requireBoardApprovalForNewAgents: z.boolean().optional(),
      interactionResolverGovernance: interactionResolverGovernanceSchema.optional(),
      feedbackDataSharingEnabled: z.boolean().optional(),
      feedbackDataSharingConsentAt: z.coerce.date().nullable().optional(),
      feedbackDataSharingConsentByUserId: z.string().min(1).nullable().optional(),
      feedbackDataSharingTermsVersion: feedbackDataSharingTermsVersionSchema,
      logoAssetId: logoAssetIdSchema,
    }),
);

export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const updateCompanyBrandingSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    logoAssetId: logoAssetIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined
      || value.description !== undefined
      || value.logoAssetId !== undefined,
    "At least one branding field must be provided",
  );

export type UpdateCompanyBranding = z.infer<typeof updateCompanyBrandingSchema>;
