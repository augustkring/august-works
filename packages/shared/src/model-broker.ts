import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
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
export type CompanyPurposeFunding = z.infer<typeof companyPurposeFundingSchema>;
