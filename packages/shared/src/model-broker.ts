import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Owner-declared lifecycle facts are bound by the installed profile file pin.
 * Missing metadata is reported as untracked by the profile owner; it does not
 * create a replacement choice or qualify a fallback. */
export const modelLifecycleMetadataSchema = z.object({
  status: z.enum(["candidate", "qualifying", "qualified", "active", "deprecated", "migration_required", "blocked", "retired"]),
  owner: z.string().trim().min(1).max(200),
  retirementAt: z.iso.datetime().nullable(),
  replacementProfileId: z.string().trim().min(1).max(200).nullable(),
  regionOrRoutingProfile: z.string().trim().min(1).max(160),
  dataUseProfile: z.string().trim().min(1).max(160),
  supportedInputOutput: z.array(z.enum(["text", "image", "audio", "video"])).min(1).max(4),
  toolUseCapability: z.boolean(),
  rateLimits: z.object({ requestsPerMinute: z.number().int().positive().nullable(), tokensPerMinute: z.number().int().positive().nullable() }).strict(),
}).strict().superRefine((lifecycle, context) => {
  if (lifecycle.status === "migration_required" && !lifecycle.replacementProfileId)
    context.addIssue({ code: "custom", message: "Migration-required profiles need an owner-selected candidate profile", path: ["replacementProfileId"] });
  if (lifecycle.retirementAt !== null && !["deprecated", "migration_required", "retired"].includes(lifecycle.status))
    context.addIssue({ code: "custom", message: "A retirement date requires a deprecated, migration-required, or retired status", path: ["retirementAt"] });
});
export type ModelLifecycleMetadata = z.infer<typeof modelLifecycleMetadataSchema>;
/** Body-free identity of the exact provider request at its final send boundary.
 * The receipt contains no headers, credentials, or prompt body. */
export const modelProviderWireReceiptSchema = z.object({
  version: z.literal(1),
  reservationId: z.string().uuid(),
  requestHash: hash,
  method: z.literal("POST"),
  endpoint: z.enum([
    "https://api.anthropic.com/v1/messages",
    "https://openrouter.ai/api/alpha/decisions",
  ]),
  bodySha256: hash,
  callId: z.string().min(1).max(200).nullable(),
}).strict();
/** An operator-qualified price ceiling, never provider/worker output. Exact
 * tariff, currency, model and expiry are part of each immutable quote. */
export const modelTariffCeilingSchema = z
  .object({
    provider: z.enum(["openai", "anthropic", "openrouter"]),
    model: z.string().regex(/^[a-zA-Z0-9_./:-]{1,200}$/),
    currency: z.literal("USD"),
    inputMinorPerMillion: z.number().int().min(0).max(1_000_000_000),
    outputMinorPerMillion: z.number().int().min(0).max(1_000_000_000),
    fixedMinor: z.number().int().min(0).max(1_000_000),
    qualificationHash: hash,
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    testedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const modelReservationQuoteSchema = z
  .object({
    version: z.literal(1),
    provider: z.enum(["openai", "anthropic", "openrouter"]),
    model: z.string().regex(/^[a-zA-Z0-9_./:-]{1,200}$/),
    currency: z.literal("USD"),
    inputTokensUpperBound: z.number().int().min(1).max(2_000_000),
    maxOutputTokens: z.number().int().min(1).max(65_536),
    maximumMinor: z.number().int().min(0).max(1_000_000),
    tariffHash: hash,
    qualificationHash: hash,
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();
/** Server-operator supplied funding contract for taskless, first-party support
 * assistance. This is never accepted from a customer request. */
export const companyPurposeFundingSchema = z.object({
  companyId: z.string().uuid(),
  purpose: z.enum(["first_party_support", "decision_skill_suggestion"]),
  funder: z.enum(["blentera_platform", "company_connection"]),
  profileId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  profileHash: hash,
  providerAccountId: z.string().regex(/^[a-zA-Z0-9._:-]{1,160}$/),
  credentialBindingHash: hash,
  periodKey: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  periodStartsAt: z.iso.datetime(),
  periodEndsAt: z.iso.datetime(),
  maxCostMinor: z.number().int().min(1).max(1_000_000),
  maxCalls: z.number().int().min(1).max(10_000),
  tariff: modelTariffCeilingSchema,
  lifecycle: modelLifecycleMetadataSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const start = Date.parse(value.periodStartsAt), end = Date.parse(value.periodEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    ctx.addIssue({ code: "custom", message: "Invalid platform funding period" });
  }
  if (value.tariff.currency !== "USD") {
    ctx.addIssue({ code: "custom", message: "Company-purpose funding requires USD tariff" });
  }
  if ((value.purpose === "first_party_support") !== (value.funder === "blentera_platform"))
    ctx.addIssue({ code: "custom", message: "Company-purpose funding source does not match purpose" });
});
export const companyPurposeReservationInputSchema = z.object({
  companyId: z.string().uuid(),
  purpose: z.enum(["first_party_support", "decision_skill_suggestion"]).default("first_party_support"),
  idempotencyKey: z.string().min(1).max(200),
  inputHash: hash,
  authorityHash: hash,
  inputTokensUpperBound: z.number().int().min(1).max(2_000_000),
  maxOutputTokens: z.number().int().min(1).max(65_536),
}).strict();
export type ModelTariffCeiling = z.infer<typeof modelTariffCeilingSchema>;
export type ModelReservationQuote = z.infer<typeof modelReservationQuoteSchema>;
export type ModelProviderWireReceipt = z.infer<typeof modelProviderWireReceiptSchema>;
export type CompanyPurposeFunding = z.infer<typeof companyPurposeFundingSchema>;
